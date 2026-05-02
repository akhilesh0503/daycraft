// daycraft-reminders — Cloudflare Worker
// Runs every minute on a cron trigger. Reads each user's reminders from
// Firestore, finds any due THIS minute (matching repeat rules + start
// date), and sends an FCM push to every device the user has registered.
//
// Auth: signs a Google service-account JWT in-Worker via Web Crypto, swaps
// it for an OAuth2 access token, and uses that token for both the
// Firestore REST API and the FCM HTTP v1 send API. Token is cached in
// module scope per Worker isolate (~50 min TTL).
//
// No SDKs — pure fetch + Web Crypto. Keeps the bundle tiny.

// ─── Config ──────────────────────────────────────────────────────────────
// PROJECT_ID + TIMEZONE come from wrangler.toml [vars]
// GOOGLE_SERVICE_ACCOUNT_JSON is a Wrangler secret (set via `wrangler
// secret put GOOGLE_SERVICE_ACCOUNT_JSON`).

// ─── Cached access token (module scope; lives for the Worker isolate) ────
let _cachedToken = null;
let _cachedTokenExpiry = 0;

// ─── Entry points ────────────────────────────────────────────────────────
export default {
  // Fired by the Cron Trigger every minute.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runOnce(env, { trigger: 'cron' }));
  },

  // Optional manual trigger for debugging — visit
  //   https://daycraft-reminders.<acct>.workers.dev/?run=1&secret=<token>
  // and the same logic runs. Safe to remove if you don't want the endpoint.
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.searchParams.get('run') === '1') {
      const result = await runOnce(env, { trigger: 'manual' });
      return Response.json(result);
    }
    return new Response('daycraft-reminders worker — fires every minute via cron', { status: 200 });
  }
};

// ─── Main loop ───────────────────────────────────────────────────────────
async function runOnce(env, ctx) {
  const log = (...a) => console.log('[daycraft]', ...a);
  try {
    const token = await getAccessToken(env);
    const users = await listUsers(env, token);
    const { dateStr, timeStr, dow } = nowInTz(env.TIMEZONE || 'America/Phoenix');
    log(`tick ${dateStr} ${timeStr} dow=${dow} users=${users.length}`);

    let pushed = 0, errors = 0, removed = 0;
    const nowMin = hhMmToMin(timeStr);

    for (const userDoc of users) {
      const u = parseFirestoreDoc(userDoc);
      const uid = userDoc.name.split('/').pop();
      const reminders = u.reminders || [];
      const tokens    = u.fcmTokens || [];
      const acks      = u.acknowledgements || {};
      if (!tokens.length || !reminders.length) continue;

      // A reminder is "due" if:
      //   1. Today's date matches its date or repeat rule
      //   2. The current minute is at-or-after the reminder time
      //   3. (now - reminderTime) is a multiple of the priority's interval:
      //        high → 5 min, medium → 30 min, low → 60 min
      //   4. The reminder hasn't been acknowledged for today
      // Repeat-firing stops naturally at midnight (next day = new ack key).
      const due = reminders.filter(r => {
        if (!r || !r.time) return false;
        if (!reminderMatches(r, dateStr, dow)) return false;
        const remMin = hhMmToMin(r.time);
        const delta = nowMin - remMin;
        if (delta < 0) return false;
        const interval = priorityInterval(r.priority);
        if (delta % interval !== 0) return false;
        if (acks[`${r.id || ''}|${dateStr}`]) return false;
        return true;
      });
      if (!due.length) continue;

      const tokensToRemove = new Set();

      for (const r of due) {
        for (const ft of tokens) {
          const result = await sendFCM(env, token, ft, {
            title: r.title || 'Reminder',
            body:  r.notes || `${r.priority || 'medium'} priority · ${r.time}`,
            data:  { reminderId: r.id || '', date: dateStr, time: r.time }
          });
          if (result.ok) { pushed++; }
          else {
            errors++;
            log(`FCM ${result.status} for ${uid}/${r.id}: ${result.body.slice(0, 200)}`);
            // Common invalid-token signals — clean up so we don't keep
            // hitting them every minute forever.
            if (result.body.includes('UNREGISTERED') ||
                result.body.includes('NOT_FOUND') ||
                result.body.includes('INVALID_ARGUMENT')) {
              tokensToRemove.add(ft);
            }
          }
        }
      }

      if (tokensToRemove.size) {
        const newTokens = tokens.filter(t => !tokensToRemove.has(t));
        await patchUserField(token, userDoc.name, { fcmTokens: newTokens });
        removed += tokensToRemove.size;
      }
    }

    return { ok: true, dateStr, timeStr, dow, pushed, errors, removed, ...ctx };
  } catch (e) {
    console.error('[daycraft] fatal', e.message, e.stack);
    return { ok: false, error: e.message };
  }
}

// ─── Reminder match (mirrors CalPage._reminderMatches in the client) ─────
function reminderMatches(r, dateStr, dow) {
  if (r.date === dateStr) return true;
  const repeat = r.repeat || 'none';
  if (repeat === 'none') return false;
  if (dateStr < r.date) return false;
  if (repeat === 'daily')    return true;
  if (repeat === 'weekly') {
    const startDow = utcDow(r.date);
    return startDow === dow;
  }
  if (repeat === 'weekdays') return dow >= 1 && dow <= 5;
  if (repeat === 'weekends') return dow === 0 || dow === 6;
  if (repeat === 'monthly') {
    return parseInt(r.date.slice(8, 10), 10) === parseInt(dateStr.slice(8, 10), 10);
  }
  return false;
}

function utcDow(yyyymmdd) {
  return new Date(`${yyyymmdd}T12:00:00Z`).getUTCDay();
}

function hhMmToMin(hhmm) {
  if (!hhmm || typeof hhmm !== 'string') return -1;
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return -1;
  return h * 60 + m;
}

// Priority → re-fire interval (minutes). Reminder pings repeat at this
// cadence after the initial fire, until the user marks it Done. Default
// (unspecified priority) is treated as medium.
function priorityInterval(priority) {
  switch (priority) {
    case 'high':   return 5;
    case 'low':    return 60;
    case 'medium':
    default:       return 30;
  }
}

// ─── Time helpers (Intl-driven, no Date arithmetic in TZ) ────────────────
function nowInTz(timeZone) {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short'
  });
  const parts = fmt.formatToParts(now);
  const get   = t => parts.find(p => p.type === t).value;
  const dateStr = `${get('year')}-${get('month')}-${get('day')}`;
  const timeStr = `${get('hour')}:${get('minute')}`;
  // 2-letter weekday → 0-6 (Sun-Sat)
  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dow = map[get('weekday')] ?? utcDow(dateStr);
  return { dateStr, timeStr, dow };
}

// ─── Service-account → OAuth2 access token ───────────────────────────────
async function getAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (_cachedToken && _cachedTokenExpiry > now + 60) return _cachedToken;

  const sa = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss:   sa.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud:   'https://oauth2.googleapis.com/token',
    iat:   now,
    exp:   now + 3600
  };
  const enc = new TextEncoder();
  const signInput = b64UrlEncodeStr(JSON.stringify(header)) + '.' + b64UrlEncodeStr(JSON.stringify(claims));

  const key = await importPrivateKey(sa.private_key);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(signInput));
  const jwt = signInput + '.' + b64UrlEncodeBuf(sig);

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    })
  });
  const td = await tokenRes.json();
  if (!td.access_token) throw new Error('Token exchange failed: ' + JSON.stringify(td));

  _cachedToken = td.access_token;
  _cachedTokenExpiry = now + (td.expires_in || 3500);
  return _cachedToken;
}

async function importPrivateKey(pem) {
  const pkcs8 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const binary = Uint8Array.from(atob(pkcs8), c => c.charCodeAt(0));
  return crypto.subtle.importKey(
    'pkcs8', binary,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );
}

function b64UrlEncodeStr(s) {
  return btoa(unescape(encodeURIComponent(s)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64UrlEncodeBuf(buf) {
  let str = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.byteLength; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ─── Firestore REST API ──────────────────────────────────────────────────
async function listUsers(env, accessToken) {
  const url = `https://firestore.googleapis.com/v1/projects/${env.PROJECT_ID}/databases/(default)/documents/users?pageSize=300`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error('Firestore list failed: ' + res.status + ' ' + (await res.text()).slice(0, 200));
  const data = await res.json();
  return data.documents || [];
}

async function patchUserField(accessToken, fullDocPath, updates) {
  const fields = {};
  for (const [k, v] of Object.entries(updates)) fields[k] = jsToFirestoreValue(v);
  const masks = Object.keys(updates).map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
  const url = `https://firestore.googleapis.com/v1/${fullDocPath}?${masks}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields })
  });
  return res.ok;
}

function parseFirestoreDoc(doc) {
  const out = {};
  for (const [k, v] of Object.entries(doc.fields || {})) out[k] = parseFirestoreValue(v);
  return out;
}
function parseFirestoreValue(v) {
  if (v.stringValue   !== undefined) return v.stringValue;
  if (v.integerValue  !== undefined) return parseInt(v.integerValue, 10);
  if (v.doubleValue   !== undefined) return v.doubleValue;
  if (v.booleanValue  !== undefined) return v.booleanValue;
  if (v.nullValue     !== undefined) return null;
  if (v.timestampValue!== undefined) return v.timestampValue;
  if (v.arrayValue) return (v.arrayValue.values || []).map(parseFirestoreValue);
  if (v.mapValue) {
    const o = {};
    for (const [k, val] of Object.entries(v.mapValue.fields || {})) o[k] = parseFirestoreValue(val);
    return o;
  }
  return null;
}
function jsToFirestoreValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string')  return { stringValue: v };
  if (typeof v === 'number')  return Number.isInteger(v) ? { integerValue: v.toString() } : { doubleValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (Array.isArray(v))       return { arrayValue: { values: v.map(jsToFirestoreValue) } };
  if (typeof v === 'object') {
    const fields = {};
    for (const [k, val] of Object.entries(v)) fields[k] = jsToFirestoreValue(val);
    return { mapValue: { fields } };
  }
  return { nullValue: null };
}

// ─── FCM HTTP v1 ─────────────────────────────────────────────────────────
async function sendFCM(env, accessToken, fcmToken, { title, body, data }) {
  const url = `https://fcm.googleapis.com/v1/projects/${env.PROJECT_ID}/messages:send`;
  const message = {
    token: fcmToken,
    notification: { title, body },
    data: data || {},
    webpush: {
      fcmOptions: { link: '/app' },
      notification: {
        icon:  '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        tag:   (data && data.reminderId) || 'daycraft'
      }
    }
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message })
  });
  return { ok: res.ok, status: res.status, body: await res.text() };
}
