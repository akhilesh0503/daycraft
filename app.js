/* ═══════════════════════════════════════════
   DAYCRAFT v3 — app.js
   Modules: Store, Utils, Clock, Nav,
            Setup, GenPage, CalPage, Modals, AI, Fallback
   ═══════════════════════════════════════════ */

/* ─── STORE ─── */
const Store = (() => {
  const KEY = 'daycraft_v3';
  const defaults = () => ({
    mood:'', energy:6, interests:[], blocked:[], tasks:[], recurring:[], apiKey:'',
    schedules:{},   // dateKey => [{...item, done}]
    dayMoods:{},    // dateKey => mood string
    reminders:[],
    streak:0, streakDays:[0,0,0,0,0,0,0], lastStreakDate:''
  });
  let d = defaults();
  const load = () => { try { const r=localStorage.getItem(KEY); if(r) Object.assign(d,JSON.parse(r)); } catch(e){} };
  const save = () => { try { localStorage.setItem(KEY,JSON.stringify(d)); } catch(e){} };
  const get  = () => d;
  // Wipe everything (sign-out / user-change). The Groq apiKey is now part
  // of the synced doc — on sign-in it comes back from cloud; on sign-out
  // it's gone (you'd be signing into a different account anyway).
  const reset = () => {
    Object.keys(d).forEach(k => delete d[k]);
    Object.assign(d, defaults());
    save();
  };
  return { load, save, get, reset };
})();

/* ─── UTILS ─── */
const U = {
  t2m(t){ if(!t) return 0; const[h,m]=t.split(':').map(Number); return h*60+m; },
  mins(s,e){ let a=this.t2m(s),b=this.t2m(e); if(b<a)b+=1440; return b-a; },
  dateKey(d){ return d.toLocaleDateString('en-CA',{timeZone:'America/Phoenix'}); },
  nowKey(){ return this.dateKey(new Date()); },
  nowTime(){
    const n=new Date();
    return n.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'America/Phoenix'});
  },
  fmtDate(k){ const d=new Date(k+'T12:00:00'); return d.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'}); },
  shortDate(k){ const d=new Date(k+'T12:00:00'); return d.toLocaleDateString('en-US',{month:'short',day:'numeric'}); },
  dayName(k){ return new Date(k+'T12:00:00').toLocaleDateString('en-US',{weekday:'long'}); },
  shortDay(k){ return new Date(k+'T12:00:00').toLocaleDateString('en-US',{weekday:'short'}); },
  dayNum(k){ return new Date(k+'T12:00:00').getDate(); },
  dowNum(k){ return new Date(k+'T12:00:00').getDay(); },
  addDays(k,n){ const d=new Date(k+'T12:00:00'); d.setDate(d.getDate()+n); return this.dateKey(d); },
  isWeekend(k){ const d=this.dowNum(k); return d===0||d===6; },
  esc(s){ return String(s).replace(/'/g,"&#39;").replace(/"/g,'&quot;'); },
  // minutes-since-midnight (0..1440) → "HH:MM" — clamps 1440 to "24:00"
  // so a window-end at midnight stays unambiguous in the rendered timeline.
  fmtMin(v){
    if(v >= 1440) return '24:00';
    const total = Math.max(0, Math.floor(v));
    return `${String(Math.floor(total/60)).padStart(2,'0')}:${String(total%60).padStart(2,'0')}`;
  },
  toast(msg, opts){
    const t=document.getElementById('toast');
    if(!t) return;
    clearTimeout(t._fadeTimer);
    if(opts && opts.action){
      t.classList.add('with-action');
      t.innerHTML = `<span class="toast-msg"></span><button class="toast-action">${this.esc(opts.action)}</button>`;
      t.querySelector('.toast-msg').textContent = msg;
      t.querySelector('.toast-action').onclick = (e)=>{
        e.stopPropagation();
        try { opts.onAction && opts.onAction(); } catch(err){}
        t.classList.remove('show');
      };
    } else {
      t.classList.remove('with-action');
      t.textContent = msg;
    }
    t.classList.add('show');
    t._fadeTimer = setTimeout(()=>t.classList.remove('show'), (opts && opts.duration) || 2800);
  },
  uid(){ return 'id_'+Date.now()+'_'+Math.random().toString(36).slice(2,7); }
};

/* ─── THEME (light / dark / auto) ─── */
const Theme = {
  KEY:'dc_theme',
  // Apply the theme: toggle <html class="theme-light"> or "theme-dark".
  // The inline boot script in <head> does this before first paint; this
  // method handles changes after boot.
  apply(){
    const pref=this.pref();
    const active = pref==='auto'
      ? (matchMedia('(prefers-color-scheme: light)').matches?'light':'dark')
      : pref;
    document.documentElement.classList.toggle('theme-light', active==='light');
    document.documentElement.classList.toggle('theme-dark',  active==='dark');
    const meta=document.querySelector('meta[name="theme-color"]');
    if(meta) meta.setAttribute('content', active==='light' ? '#f7f5ee' : '#09090f');
  },
  pref(){ try { return localStorage.getItem(this.KEY)||'auto'; } catch(e){ return 'auto'; } },
  set(v){
    try { localStorage.setItem(this.KEY,v); } catch(e){}
    this.apply();
    document.querySelectorAll('.theme-opt').forEach(b=>b.classList.toggle('active', b.dataset.theme===v));
  },
  init(){
    this.apply();
    const cur=this.pref();
    document.querySelectorAll('.theme-opt').forEach(b=>b.classList.toggle('active', b.dataset.theme===cur));
    // Re-apply if the OS theme flips while user is on auto
    matchMedia('(prefers-color-scheme: light)').addEventListener('change',()=>{
      if(this.pref()==='auto') this.apply();
    });
  }
};

/* ─── STREAK ─── */
const Streak = {
  // Bump streak when today's schedule is generated. Resets if a day was skipped.
  bump(){
    const s=Store.get();
    const todayK=U.nowKey();
    if(s.lastStreakDate===todayK) return; // already counted today
    const yesterdayK=U.addDays(todayK,-1);
    s.streak = (s.lastStreakDate===yesterdayK ? (s.streak||0) : 0) + 1;
    s.streakDays=[...(s.streakDays||[0,0,0,0,0,0,0]).slice(1),1];
    s.lastStreakDate=todayK;
    Store.save();
    this.render();
  },
  render(){
    const s=Store.get();
    const el=document.getElementById('streak-chip');
    const c=document.getElementById('streak-count');
    if(!el||!c) return;
    if(!s.streak||s.streak<1){ el.style.display='none'; return; }
    // Auto-reset stale streak (last entry older than yesterday)
    const todayK=U.nowKey(), yK=U.addDays(todayK,-1);
    if(s.lastStreakDate&&s.lastStreakDate!==todayK&&s.lastStreakDate!==yK){
      s.streak=0; Store.save(); el.style.display='none'; return;
    }
    el.style.display='flex';
    c.textContent=s.streak;
  }
};

/* ─── CLOCK ─── */
const Clock = {
  init(){
    this.tick();
    setInterval(()=>this.tick(), 1000);
  },
  tick(){
    const n=new Date();
    const t=n.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:true,timeZone:'America/Phoenix'});
    const d=n.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',timeZone:'America/Phoenix'});
    const te=document.getElementById('clock-time'), de=document.getElementById('clock-date');
    if(te) te.textContent=t;
    if(de) de.textContent=d+' · Tempe, AZ';
  }
};

/* ─── NAV ─── */
const Nav = {
  TITLES:{today:'Today',calendar:'Calendar',habits:'Habits',setup:'Settings',generate:'Plan my day'},
  go(page){
    const target=document.getElementById('page-'+page);
    if(!target) return;
    document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
    target.classList.add('active');
    document.querySelectorAll('.side-link').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll(`.side-link[data-page="${page}"]`).forEach(b=>b.classList.add('active'));
    const tt=document.getElementById('topbar-title');
    if(tt) tt.textContent=this.TITLES[page]||'Daycraft';
    document.body.classList.remove('side-open');
    if(page==='today')    Today.render();
    if(page==='calendar') CalPage.render();
    if(page==='generate') GenPage.init();
    if(page==='setup')    Setup.init();
  }
};

/* ─── STORAGE EXPORT/IMPORT ─── */
const Storage = {
  export(){
    const data=JSON.stringify(Store.get(),null,2);
    const blob=new Blob([data],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url; a.download='daycraft-backup.json'; a.click();
    URL.revokeObjectURL(url);
    U.toast('Backup exported!');
  },
  importClick(){ document.getElementById('import-file').click(); },
  importFile(inp){
    const f=inp.files[0]; if(!f) return;
    const r=new FileReader();
    r.onload=e=>{
      try{
        const parsed=JSON.parse(e.target.result);
        Object.assign(Store.get(),parsed);
        Store.save();
        Setup.init();
        Streak.render();
        if(CalPage._selDay){ CalPage._renderMiniCal(); CalPage._renderReminders(); }
        U.toast('Backup imported successfully!');
      } catch(err){ U.toast('Import failed — invalid file.'); }
    };
    r.readAsText(f);
    inp.value='';
  }
};

/* ─── SETUP ─── */
const Setup = {
  _recDays:[],
  init(){
    const s=Store.get();
    this.renderInterests(); this.renderTasks(); this.renderBlocked(); this.renderRecurring();
    const es=document.getElementById('energy-slider');
    if(es){ es.value=s.energy; }
    document.getElementById('energy-val').textContent=s.energy+'/10';
    document.getElementById('energy-hint').textContent=this.eDesc(s.energy);
    if(s.mood) document.querySelectorAll('.mood-chip').forEach(c=>{ if(c.dataset.mood===s.mood) c.classList.add('sel'); });
    const ak=document.getElementById('apikey-inp'); if(ak&&s.apiKey) ak.value=s.apiKey;
    Notify._renderStatus();
  },
  mood(el){
    document.querySelectorAll('.mood-chip').forEach(c=>c.classList.remove('sel'));
    el.classList.add('sel');
    Store.get().mood=el.dataset.mood; Store.save();
  },
  energy(v){
    Store.get().energy=parseInt(v);
    document.getElementById('energy-val').textContent=v+'/10';
    document.getElementById('energy-hint').textContent=this.eDesc(parseInt(v));
    Store.save();
  },
  eDesc(v){ return ['','Barely functional — rest first.','Very low — ultra-gentle.','Low — easy tasks.','Low-moderate — light work.','Moderate — some structure.','Balanced — mix of focus and fun.','Good energy — solid blocks.','High — ambitious sessions.','Very high — long focus blocks.','Peak — tackle hardest things first.'][v]||''; },
  addPreset(v){ this._addTo('interests',v); },
  addInterest(){ const i=document.getElementById('interest-inp'); this._addTo('interests',i.value.trim()); i.value=''; },
  addTask(){ /* setup tasks not used separately now */ },
  _addTo(key,val){
    if(!val) return;
    const v=val[0].toUpperCase()+val.slice(1);
    const s=Store.get();
    if(s[key].includes(v)) return;
    s[key].push(v); Store.save();
    if(key==='interests') this.renderInterests();
    if(key==='tasks') this.renderTasks();
  },
  removeFrom(key,val){
    const s=Store.get(); s[key]=s[key].filter(v=>v!==val); Store.save();
    if(key==='interests') this.renderInterests();
    if(key==='tasks') this.renderTasks();
  },
  renderInterests(){
    document.getElementById('interest-tags').innerHTML=
      Store.get().interests.map(t=>`<div class="tag">${t}<span class="tag-x" onclick="Setup.removeFrom('interests','${U.esc(t)}')">×</span></div>`).join('');
  },
  renderTasks(){
    const el=document.getElementById('task-tags');
    if(el) el.innerHTML=Store.get().tasks.map(t=>`<div class="tag">${t}<span class="tag-x" onclick="Setup.removeFrom('tasks','${U.esc(t)}')">×</span></div>`).join('');
  },
  addBlock(){
    const n=document.getElementById('block-name').value.trim()||'Blocked';
    const s=document.getElementById('block-start').value;
    const e=document.getElementById('block-end').value;
    if(!s||!e) return;
    Store.get().blocked.push({label:n,start:s,end:e}); Store.save();
    this.renderBlocked(); document.getElementById('block-name').value='';
  },
  quickBlock(n,s,e){
    if(Store.get().blocked.find(b=>b.label===n)) return;
    Store.get().blocked.push({label:n,start:s,end:e}); Store.save(); this.renderBlocked();
  },
  removeBlock(i){ Store.get().blocked.splice(i,1); Store.save(); this.renderBlocked(); },
  renderBlocked(){
    document.getElementById('blocked-list').innerHTML=
      Store.get().blocked.map((b,i)=>`<div class="bitem"><span class="bitem-name">${b.label}</span><span class="bitem-time">${b.start}–${b.end}</span><button class="delbtn" onclick="Setup.removeBlock(${i})">×</button></div>`).join('');
  },
  toggleDay(el){
    el.classList.toggle('sel');
    const d=parseInt(el.dataset.d);
    if(el.classList.contains('sel')){ if(!this._recDays.includes(d)) this._recDays.push(d); }
    else this._recDays=this._recDays.filter(x=>x!==d);
  },
  addRecurring(){
    const n=document.getElementById('rec-name').value.trim();
    const s=document.getElementById('rec-start').value;
    const e=document.getElementById('rec-end').value;
    if(!n||!s||!e||!this._recDays.length){ U.toast('Fill name, times, and select days.'); return; }
    Store.get().recurring.push({label:n,start:s,end:e,days:[...this._recDays]});
    Store.save(); this.renderRecurring();
    document.getElementById('rec-name').value='';
    this._recDays=[]; document.querySelectorAll('.dpbtn').forEach(b=>b.classList.remove('sel'));
  },
  removeRecurring(i){ Store.get().recurring.splice(i,1); Store.save(); this.renderRecurring(); },
  renderRecurring(){
    const DN=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    document.getElementById('rec-list').innerHTML=
      Store.get().recurring.map((r,i)=>`
        <div class="rec-item">
          <span class="rec-item-name">${r.label}</span>
          <div class="rec-days-mini">${[1,2,3,4,5,6,0].map(d=>`<div class="rdd${r.days.includes(d)?' on':''}">${DN[d][0]}</div>`).join('')}</div>
          <span class="rec-item-time">${r.start}–${r.end}</span>
          <button class="delbtn" onclick="Setup.removeRecurring(${i})">×</button>
        </div>`).join('');
  },
  apiKey(v){ Store.get().apiKey=v.trim(); Store.save(); },
  toggleKey(){
    const i=document.getElementById('apikey-inp'),b=i.nextElementSibling;
    i.type=i.type==='password'?'text':'password'; b.textContent=i.type==='password'?'Show':'Hide';
  }
};

/* ─── AI ─── */
const AI = {
  async call(prompt, ctx){
    const apiKey=Store.get().apiKey;
    if(!apiKey) throw new Error('No API key');
    const doFetch = () => fetch('https://api.groq.com/openai/v1/chat/completions',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${apiKey}`},
      body:JSON.stringify({
        model:'llama-3.3-70b-versatile', temperature:0.7, max_tokens:3000,
        messages:[
          {role:'system',content:'You are a personal day scheduler. Respond ONLY with a valid JSON array. No markdown, no backticks, no extra text.'},
          {role:'user',content:prompt}
        ]
      })
    });

    // Up to 4 attempts with progressive backoff on 429 (rate limit) and 5xx.
    // Groq's free tier has a tight tokens-per-minute budget; for week
    // generation we hit it around day 3. The Retry-After header tells us
    // exactly how long to wait — respect it, but cap each wait at 15s.
    const MAX_TRIES = 4;
    let res, lastErr;
    for(let attempt = 1; attempt <= MAX_TRIES; attempt++){
      res = await doFetch();
      if(res.ok) break;
      const isRetryable = res.status === 429 || (res.status >= 500 && res.status < 600);
      if(!isRetryable || attempt === MAX_TRIES){
        const e = await res.json().catch(()=>({}));
        lastErr = e?.error?.message || `Groq ${res.status}`;
        break;
      }
      // Wait — respect server's Retry-After if present, else backoff
      const headerRA = parseFloat(res.headers.get('retry-after') || '0');
      const backoff = Math.min(15000, Math.max(headerRA * 1000, attempt * 2000));
      const sub = document.getElementById('gen-loading-sub');
      const prev = sub?.textContent;
      if(sub) sub.textContent = `Rate-limited — waiting ${Math.ceil(backoff/1000)}s (try ${attempt}/${MAX_TRIES-1})...`;
      await new Promise(r => setTimeout(r, backoff));
      if(sub && prev) sub.textContent = prev;
    }

    if(!res || !res.ok) throw new Error(lastErr || 'Groq request failed');
    const data=await res.json();
    const raw=data.choices[0].message.content;
    const parsed=JSON.parse(raw.replace(/```json|```/g,'').trim());
    const cleaned=this._validate(parsed, ctx);
    if(!cleaned) throw new Error('AI returned invalid schedule');
    return cleaned;
  },

  // Validate + auto-fix obvious issues. Returns cleaned array, or null if unrecoverable.
  _validate(arr, ctx){
    if(!Array.isArray(arr)||!arr.length) return null;
    const COLORS=new Set(['teal','purple','coral','blue','pink','amber','gray']);
    const TYPES=new Set(['interest','task','meal','break','blocked']);
    // The AI sometimes puts a color name ("blue") in the category field —
    // unhelpful as a label. Map color → human category so the badge reads
    // "focus" instead of "blue".
    const COLOR_TO_CAT={teal:'wellness',purple:'hobby',blue:'focus',coral:'task',pink:'social',amber:'meal',gray:'break'};
    // Generic filler titles the model leans on when it has nothing to say.
    // Reject these so empty stretches stay empty instead of becoming
    // "Free time 750 min" type garbage.
    const FILLER = /^\s*(free|personal|open|spare|empty|leisure|chill|relax|downtime)\s+(time|block|hour|hours)\s*$/i;
    const MAX_BLOCK_MIN = 150;
    const sm = ctx?.startTime ? U.t2m(ctx.startTime) : 0;
    const em = ctx?.endTime   ? U.t2m(ctx.endTime)   : 1440;
    const blocked = ctx?.blocked || [];

    const hasStr=v=>typeof v==='string'&&v.trim().length>0;
    const hitsBlocked=(s,e)=>blocked.some(b=>{
      const bs=U.t2m(b.start), be=U.t2m(b.end);
      const a=U.t2m(s), z=U.t2m(e);
      return a<be && z>bs;
    });

    const out=[];
    for(const it of arr){
      if(!it||typeof it!=='object') continue;
      if(!hasStr(it.time)||!hasStr(it.endTime)||!hasStr(it.title)) continue;
      const a=U.t2m(it.time), b=U.t2m(it.endTime);
      if(isNaN(a)||isNaN(b)||a>=b) continue;
      if(a<sm||b>em) continue;
      if(hitsBlocked(it.time,it.endTime)) continue;
      // Drop generic filler ("Free time 750 min" type garbage)
      if(FILLER.test(String(it.title))) continue;
      // Cap absurdly long blocks — the model occasionally tries to fill
      // an entire afternoon with one block. Drop instead of squashing.
      if(b - a > MAX_BLOCK_MIN) continue;
      // If the model dropped a color name into category, swap it for the
      // proper human label — never show "blue" / "gray" / "teal" as a tag.
      let category = hasStr(it.category) ? String(it.category).toLowerCase().slice(0,40) : 'general';
      if(COLOR_TO_CAT[category]) category = COLOR_TO_CAT[category];
      out.push({
        time:it.time,
        endTime:it.endTime,
        title:String(it.title).slice(0,120),
        description:hasStr(it.description)?String(it.description).slice(0,400):'',
        category,
        color:COLORS.has(it.color)?it.color:'gray',
        type:TYPES.has(it.type)?it.type:'interest',
        swaps:Array.isArray(it.swaps)?it.swaps.filter(hasStr).slice(0,5):[]
      });
    }
    if(!out.length) return null;
    // sort + drop overlapping items (keep earlier)
    out.sort((x,y)=>U.t2m(x.time)-U.t2m(y.time));
    const final=[]; let lastEnd=-1;
    for(const it of out){
      if(U.t2m(it.time)<lastEnd) continue;
      final.push(it);
      lastEnd=U.t2m(it.endTime);
    }
    return final.length?final:null;
  },
  prompt(dayLabel,startTime,endTime,mood,energy,interests,tasks,blocked,recurring,isWeekend,userNote,events){
    const bl = blocked.length ? blocked.map(b=>`"${b.label}" ${b.start}–${b.end}`).join(', ') : 'none';
    const rl = recurring.length ? recurring.map(r=>`"${r.label}" ${r.start}–${r.end}`).join(', ') : 'none';
    const el = (events||[]).length ? (events||[]).map(e=>`"${e.title}" ${e.time} (${e.durationMin||60}min)`).join(', ') : 'none';
    const note = (userNote||'').trim();

    return `Plan ${dayLabel} (${isWeekend ? 'weekend' : 'weekday'}) for one person, between ${startTime} and ${endTime}.

ABOUT THEM
- Mood: ${mood || 'unspecified'}, energy ${energy}/10
- Interests (priority order): ${interests.join(', ') || 'none'}
- Must-do tasks: ${tasks.length ? tasks.join(', ') : 'none'}
- Their note: ${note || '(none)'}

THE SYSTEM IS HANDLING THESE — leave their slots empty, don't schedule them yourself:
- Blocked: ${bl}
- Recurring (today): ${rl}
- Pinned events (today): ${el}

RULES
- Schedule only within ${startTime}–${endTime}.
- Build around the interests. Real activities, not "Personal time".
- No filler titles ("Free time", "Open time", etc). Empty space is fine — leave gaps.
- At most one 10–15 min break between intensive blocks. No back-to-back breaks. No invented "wind-down" or "reflection" rituals.
- Each block: a 1–2 sentence description explaining why-this-why-now. Calm tone.
- Each block: 3 alternative "swaps" drawn from interests (or alt formats for breaks).

OUTPUT — strict JSON array. No markdown, no prose:
[
  {
    "time":"HH:MM","endTime":"HH:MM",
    "title":"1–4 words",
    "description":"1–2 sentence why",
    "category":"wellness|hobby|focus|task|social|meal|break",
    "color":"teal|purple|blue|coral|pink|amber|gray",
    "type":"interest|task|meal|break",
    "swaps":["alt1","alt2","alt3"]
  }
]

Pair category↔color: wellness↔teal · hobby↔purple · focus↔blue · task↔coral · social↔pink · meal↔amber · break↔gray.`;
  }
};

/* ─── RECONCILE — merge user constraints into any schedule ─── */
// AI / Fallback only generate the "creative" part of the day. This module
// force-inserts the user's recurring activities and blocked times on top,
// because Settings is the user's source of truth: if they said Gym Mon/Wed
// 7–8am, that block appears, period. AI items overlapping a forced item
// lose. Cross-midnight blocked ranges (Sleep 22:30–07:00) are split into
// two segments and the visible portion that falls inside the active
// window is inserted.
const Reconcile = {
  // Priority (strongest → weakest): userEvents > blocked > recurring > AI items.
  // The user's pinned events for TODAY beat their default blocks (yesterday's
  // "Dinner blocked 8–9:30pm" loses to "Cricket 8–10pm pinned for today"),
  // because today's explicit signal overrides the habitual default.
  // userEvents come from the Time-sensitive events UI: {title, time, durationMin}.
  apply(sched, recurring, blocked, startTime, endTime, userEvents){
    const sm = U.t2m(startTime), em = U.t2m(endTime);
    const t2 = U.t2m;
    const ovlp = (a,b,c,d) => t2(a) < t2(d) && t2(b) > t2(c);
    let out = sched.slice();

    // 1. User-pinned events first — they win over everything else.
    (userEvents||[]).forEach(ev => {
      if(!ev||!ev.time) return;
      const dur = ev.durationMin || 60;
      const visStart = Math.max(t2(ev.time), sm);
      const visEnd   = Math.min(t2(ev.time) + dur, em);
      if(visStart >= visEnd) return;
      const vs = U.fmtMin(visStart), ve = U.fmtMin(visEnd);
      // Drop ALL conflicting items (incl. blocked — pinned overrides default)
      out = out.filter(it => !ovlp(it.time, it.endTime, vs, ve));
      out.push({
        time:vs, endTime:ve,
        title:ev.title || 'Event',
        description:'Pinned by you for this time.',
        category:'task', color:'coral', type:'task',
        swaps:[], done:false, _pinned:true
      });
    });

    // 2. Blocked — but abstain if a pinned event already occupies the slot.
    (blocked||[]).forEach(b => {
      if(!b||!b.start||!b.end) return;
      const s = t2(b.start), e = t2(b.end);
      // Cross-midnight ranges (e.g. Sleep 22:30–07:00) become two segments
      const ranges = s <= e ? [[s,e]] : [[s,1440],[0,e]];
      ranges.forEach(([rs,re]) => {
        const visStart = Math.max(rs, sm);
        const visEnd   = Math.min(re, em);
        if(visStart >= visEnd) return; // no overlap with the active window
        const vs = U.fmtMin(visStart), ve = U.fmtMin(visEnd);
        // If a pinned event covers any of this blocked range, the user
        // is overriding the default — drop the entire blocked segment.
        if(out.some(it => it._pinned && ovlp(it.time, it.endTime, vs, ve))) return;
        out = out.filter(it => it._pinned || !ovlp(it.time, it.endTime, vs, ve));
        out.push({
          time:vs, endTime:ve,
          title:b.label||'Blocked',
          description:'Blocked time — unavailable.',
          category:'blocked', color:'gray', type:'blocked',
          swaps:[], done:false
        });
      });
    });

    // 3. Recurring — abstain if blocked or pinned occupies the slot.
    (recurring||[]).forEach(r => {
      if(!r||!r.start||!r.end) return;
      const visStart = Math.max(t2(r.start), sm);
      const visEnd   = Math.min(t2(r.end), em);
      if(visStart >= visEnd) return;
      const vs = U.fmtMin(visStart), ve = U.fmtMin(visEnd);
      // Already at this exact slot? skip (avoid dup if AI happened to comply)
      if(out.some(it => it.title === r.label && it.time === vs && it.endTime === ve)) return;
      // Blocked or pinned in the slot — recurring abstains for today.
      if(out.some(it => (it.type === 'blocked' || it._pinned) && ovlp(it.time, it.endTime, vs, ve))) return;
      // Otherwise: drop conflicting AI items, then insert.
      out = out.filter(it => it.type === 'blocked' || it._pinned || !ovlp(it.time, it.endTime, vs, ve));
      out.push({
        time:vs, endTime:ve,
        title:r.label,
        description:`${r.label} — recurring.`,
        category:'recurring', color:'teal', type:'interest',
        swaps:[], done:false
      });
    });

    return out.sort((a,b) => t2(a.time) - t2(b.time));
  }
};

/* ─── FALLBACK ─── */
// Used when no Groq API key is set (or Groq fails). Generates a sparse,
// honest interest-cycling schedule — NO hardcoded meals, NO "Wind-down"
// ritual, no padding. Recurring + blocked are merged in by Reconcile so
// the user's actual Settings drive everything.
const Fallback = {
  build(dateKey,startTime,endTime,mood,energy,interests,tasks,blocked,recurring){
    const e = energy || 6;
    const i = interests.length ? interests : ['Personal time'];
    const sm = U.t2m(startTime||'07:00'), em = U.t2m(endTime||'22:30');

    // Block size scales with energy: low=45m, mid=60m, high=90m
    const blockMin = e <= 3 ? 45 : e >= 7 ? 90 : 60;
    const breakMin = 15;

    // Cycle: must-do tasks first, then interests in priority order
    const queue = [
      ...tasks.map(t => ({ title:t, type:'task',     color:'coral',  category:'task',  desc:`Must-do: ${t}.` })),
      ...i.map(name => ({  title:name, type:'interest', color:'purple', category:'hobby', desc:`Time for ${name}.` }))
    ];

    const slots = [];
    let cur = sm;
    let qIdx = 0;
    while(cur + blockMin <= em && qIdx < queue.length){
      const item = queue[qIdx++];
      const bStart = cur, bEnd = cur + blockMin;
      slots.push({
        time:U.fmtMin(bStart), endTime:U.fmtMin(bEnd),
        title:item.title, description:item.desc,
        category:item.category, color:item.color, type:item.type,
        swaps:i.filter(x => x !== item.title).slice(0,3),
        done:false
      });
      cur = bEnd;
      // Insert a break between blocks (skip the trailing one if no time / no more items)
      if(cur + breakMin <= em && qIdx < queue.length){
        slots.push({
          time:U.fmtMin(cur), endTime:U.fmtMin(cur+breakMin),
          title:'Break', description:'Stretch, water, look outside.',
          category:'break', color:'gray', type:'break',
          swaps:['Walk','Water','Look outside'], done:false
        });
        cur += breakMin;
      }
    }

    return Reconcile.apply(slots, recurring, blocked, U.fmtMin(sm), U.fmtMin(em));
  }
};

/* ─── TIMELINE RENDERER ─── */
const TL = {
  render(containerId, schedule, ctx){
    const el=document.getElementById(containerId);
    if(!el) return;
    el.innerHTML='<div class="tl-line"></div>';

    [['Morning',h=>h<12],['Afternoon',h=>h>=12&&h<18],['Evening',h=>h>=18]].forEach(([label,test])=>{
      const items=schedule.filter(s=>test(parseInt(s.time)));
      if(!items.length) return;
      const sep=document.createElement('div');
      sep.className='tl-sec'; sep.textContent=label;
      el.appendChild(sep);
      items.forEach((item,li)=>{ el.appendChild(this.block(item,schedule.indexOf(item),li,ctx)); });
    });
  },

  block(item, gi, li, ctx){
    const mins=U.mins(item.time,item.endTime);
    const isBlk=item.type==='blocked';
    const isDone=item.done;
    const sid=`sp-${ctx}-${gi}`;

    const wrap=document.createElement('div');
    wrap.className='tl-block';
    wrap.style.animationDelay=(li*0.04)+'s';

    if(!isBlk){
      wrap.draggable=true;
      wrap.dataset.gi=gi;
      wrap.addEventListener('dragstart',e=>{ e.dataTransfer.setData('text/plain',gi); wrap.querySelector('.tl-card').classList.add('dragging'); });
      wrap.addEventListener('dragend',()=>wrap.querySelector('.tl-card')?.classList.remove('dragging'));
      wrap.addEventListener('dragover',e=>{ e.preventDefault(); wrap.querySelector('.tl-card')?.classList.add('drag-over'); });
      wrap.addEventListener('dragleave',()=>wrap.querySelector('.tl-card')?.classList.remove('drag-over'));
      wrap.addEventListener('drop',e=>{
        e.preventDefault();
        wrap.querySelector('.tl-card')?.classList.remove('drag-over');
        const from=parseInt(e.dataTransfer.getData('text/plain'));
        if(from!==gi) TL._onDrag(ctx,from,gi);
      });
    }

    // swaps for EVERY block (including breaks)
    const swapsHTML=`
      <div class="swap-panel" id="${sid}">
        <div class="swap-lbl">Swap or add</div>
        <div class="swap-opts">
          ${(item.swaps||[]).map(s=>`<button class="sopt" onclick="TL._swap('${ctx}',${gi},'${U.esc(s)}')">${s}</button>`).join('')}
          <button class="sopt add-custom" onclick="Modals.openAdd('${ctx}',${gi})">+ Add custom</button>
        </div>
      </div>`;

    // Blocked entries (Sleep, Class) come from Settings → Blocked times.
    // Editing/swapping/deleting them on a single day's schedule wouldn't stick
    // anyway, so hide the entire action row for blocked entries.
    const actHTML = isBlk ? '' : `
      <div class="tl-actions">
        <button class="tlbtn done" onclick="TL._done('${ctx}',${gi})">${isDone?'Undo':'Done'}</button>
        <button class="tlbtn swap-btn" onclick="TL._toggleSwap('${sid}')">Swap</button>
        <button class="tlbtn edit-btn" onclick="Modals.openBlock('${ctx}',${gi})">Edit</button>
      </div>${swapsHTML}`;

    wrap.innerHTML=`
      <div class="tl-time">${item.time}</div>
      <div class="tl-dot dot-${item.color||'gray'}"></div>
      <div class="tl-card${isBlk?' is-blocked':''}${isDone?' is-done':''}">
        <div class="tl-top">
          <div class="tl-title-wrap">
            <div class="tl-title">${item.title}</div>
            <div class="tl-dur">${mins} min${isBlk?' · unavailable':''}</div>
          </div>
          <div class="tl-top-right">
            <span class="tl-cat c-${item.color||'gray'}">${item.category}</span>
            ${!isBlk?`<button class="tl-x" title="Remove activity" onclick="TL._delete('${ctx}',${gi})">×</button>`:''}
          </div>
        </div>
        <div class="tl-desc">${item.description}</div>
        ${actHTML}
      </div>`;
    return wrap;
  },

  _toggleSwap(id){ const e=document.getElementById(id); if(e) e.classList.toggle('open'); },

  _done(ctx, gi){
    const sch=TL._getSchByCtx(ctx);
    if(!sch||!sch[gi]) return;
    sch[gi].done=!sch[gi].done;
    Store.save();
    TL._refresh(ctx);
    CalPage._updateProgress(ctx);
  },

  _swap(ctx, gi, title){
    const sch=TL._getSchByCtx(ctx);
    if(!sch||!sch[gi]) return;
    sch[gi].title=title;
    sch[gi].description=`Swapped to: ${title}. Make it great!`;
    sch[gi].swaps=(sch[gi].swaps||[]).filter(s=>s!==title);
    Store.save(); TL._refresh(ctx);
  },

  _delete(ctx, gi){
    const sch=TL._getSchByCtx(ctx);
    if(!sch||!sch[gi]) return;
    const removed = sch.splice(gi,1)[0];
    const removedAt = gi;
    Store.save();
    TL._refresh(ctx);
    U.toast(`Removed "${removed.title}"`, {
      action:'Undo',
      duration:5000,
      onAction:()=>{
        const sch2=TL._getSchByCtx(ctx);
        if(!sch2) return;
        sch2.splice(Math.min(removedAt, sch2.length), 0, removed);
        sch2.sort((a,b)=>U.t2m(a.time)-U.t2m(b.time));
        Store.save();
        TL._refresh(ctx);
        U.toast('Restored.');
      }
    });
  },

  _onDrag(ctx, from, to){
    const sch=TL._getSchByCtx(ctx);
    if(!sch) return;
    const item=sch.splice(from,1)[0];
    sch.splice(to,0,item);
    Store.save(); TL._refresh(ctx);
  },

  _getSchByCtx(ctx){
    // ctx is a dateKey like "2025-03-16"
    return Store.get().schedules[ctx];
  },

  _refresh(ctx){
    const sch=TL._getSchByCtx(ctx);
    if(!sch) return;
    // Calendar: re-render timeline if calendar is the active context
    if(document.getElementById('page-calendar').classList.contains('active')){
      TL.render('cal-timeline', sch, ctx);
      CalPage._updateProgress(ctx);
    }
    // Today: re-render only if the changed day is today AND today is visible
    if(ctx===U.nowKey() && document.getElementById('page-today').classList.contains('active')){
      Today.render();
    }
    GenPage._refreshResultCards();
    TL._refreshNow();
  },

  // Highlight the block that contains the current time. Only on today's view.
  _refreshNow(){
    document.querySelectorAll('.tl-card.is-now').forEach(c=>c.classList.remove('is-now'));
    const dk=CalPage._selDay;
    if(!dk||dk!==U.nowKey()) return;
    const sch=Store.get().schedules[dk];
    if(!sch||!sch.length) return;
    const now=U.t2m(U.nowTime());
    let nowIdx=-1;
    sch.forEach((it,i)=>{
      if(it.type==='blocked') return;
      const a=U.t2m(it.time), b=U.t2m(it.endTime||it.time);
      if(a<=now&&now<b) nowIdx=i;
    });
    if(nowIdx<0) return;
    const wrap=document.querySelector(`#cal-timeline .tl-block[data-gi="${nowIdx}"]`);
    wrap?.querySelector('.tl-card')?.classList.add('is-now');
  }
};

/* ─── GENERATE PAGE ─── */
const GenPage = {
  _dayTasks:[], _weekTasks:[],
  _dayEvents:[], // [{title, time:'HH:MM', durationMin}]

  init(){
    // set default date to today
    const today=U.nowKey();
    document.getElementById('day-date-pick').value=today;
    document.getElementById('week-start-pick').value=today;

    // Hook the date picker so changing it re-evaluates whether "Start from
    // now" still applies. Add the listener once (subsequent inits are no-ops).
    const dp = document.getElementById('day-date-pick');
    if(dp && !dp._dcWired){
      dp.addEventListener('change', ()=>this._refreshStartOpts());
      dp._dcWired = true;
    }

    // Pull defaults from Settings — fixes the "energy always 6" bug.
    // The energy slider is a range input which can't be empty, so we MUST
    // populate it from Store on every visit; otherwise the user's actual
    // Settings energy never reaches the AI.
    const s = Store.get();
    const energy = s.energy || 6;
    ['day-energy','week-energy'].forEach(id=>{
      const el=document.getElementById(id);
      if(el) el.value = energy;
    });
    ['day-energy-val','week-energy-val'].forEach(id=>{
      const el=document.getElementById(id);
      if(el) el.textContent = energy;
    });
    // Mood select: leave on "Use default mood" — Store.mood is the fallback
    // in generateDay/generateWeek anyway.

    // Reset transient inputs (textareas + extra tasks tag rows) per visit
    ['day-notes','week-notes'].forEach(id=>{
      const el=document.getElementById(id);
      if(el) el.value='';
    });
    this._dayTasks=[]; this._weekTasks=[]; this._dayEvents=[];
    const dt=document.getElementById('day-task-tags');  if(dt) dt.innerHTML='';
    const wt=document.getElementById('week-task-tags'); if(wt) wt.innerHTML='';
    const tsList=document.getElementById('ts-list'); if(tsList) tsList.innerHTML='';

    this._updateWeekCta();
  },

  switchTab(t){
    document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
    document.getElementById('tab-'+t).classList.add('active');
    document.getElementById('panel-'+t).classList.add('active');
  },

  dayOpt(v){
    document.getElementById('day-opt-today').classList.toggle('active',v==='today');
    document.getElementById('day-opt-pick').classList.toggle('active',v==='pick');
    document.getElementById('day-date-pick').style.display=v==='pick'?'block':'none';
    this._refreshStartOpts();
  },

  startOpt(v){
    document.getElementById('start-opt-now').classList.toggle('active',v==='now');
    document.getElementById('start-opt-pick').classList.toggle('active',v==='pick');
    document.getElementById('day-start-pick').style.display=v==='pick'?'block':'none';
  },

  // "Start from now" only makes sense if you're scheduling TODAY. The
  // moment a future date is picked, hide it and force "Pick a time".
  _refreshStartOpts(){
    const usePick   = document.getElementById('day-opt-pick').classList.contains('active');
    const pickedDate= document.getElementById('day-date-pick').value;
    const isFuture  = usePick && pickedDate && pickedDate !== U.nowKey();
    const nowBtn    = document.getElementById('start-opt-now');
    nowBtn.style.display = isFuture ? 'none' : '';
    if(isFuture) this.startOpt('pick');
  },

  weekStartOpt(v){
    document.getElementById('week-opt-today').classList.toggle('active',v==='today');
    document.getElementById('week-opt-pick').classList.toggle('active',v==='pick');
    document.getElementById('week-start-pick').style.display=v==='pick'?'block':'none';
    this._updateWeekCta();
  },

  _weekDays:7,
  weekDaysChange(v){
    const n = parseInt(v) || 7;
    this._weekDays = n;
    document.getElementById('week-days-val').textContent = n+' day'+(n>1?'s':'');
    document.querySelectorAll('.day-count-btn').forEach(b=>{
      b.classList.toggle('active', parseInt(b.dataset.d) === n);
    });
    this._updateWeekCta();
  },

  _updateWeekCta(){
    const days = this._weekDays || 7;
    const sub = document.getElementById('week-cta-sub');
    if(sub) sub.textContent = `Generating ${days} day${days>1?'s':''} of schedules`;
  },

  addDayTask(){
    const i=document.getElementById('day-task-inp');
    const v=i.value.trim(); if(!v) return;
    if(!this._dayTasks.includes(v)) this._dayTasks.push(v);
    i.value='';
    document.getElementById('day-task-tags').innerHTML=
      this._dayTasks.map(t=>`<div class="tag">${t}<span class="tag-x" onclick="GenPage._removeDayTask('${U.esc(t)}')">×</span></div>`).join('');
  },
  _removeDayTask(v){
    this._dayTasks=this._dayTasks.filter(t=>t!==v);
    document.getElementById('day-task-tags').innerHTML=
      this._dayTasks.map(t=>`<div class="tag">${t}<span class="tag-x" onclick="GenPage._removeDayTask('${U.esc(t)}')">×</span></div>`).join('');
  },

  addWeekTask(){
    const i=document.getElementById('week-task-inp');
    const v=i.value.trim(); if(!v) return;
    if(!this._weekTasks.includes(v)) this._weekTasks.push(v);
    i.value='';
    document.getElementById('week-task-tags').innerHTML=
      this._weekTasks.map(t=>`<div class="tag">${t}<span class="tag-x" onclick="GenPage._removeWeekTask('${U.esc(t)}')">×</span></div>`).join('');
  },
  _removeWeekTask(v){
    this._weekTasks=this._weekTasks.filter(t=>t!==v);
    document.getElementById('week-task-tags').innerHTML=
      this._weekTasks.map(t=>`<div class="tag">${t}<span class="tag-x" onclick="GenPage._removeWeekTask('${U.esc(t)}')">×</span></div>`).join('');
  },

  // Time-sensitive events for Single Day. The user pins specific events to
  // specific times and the system locks them in place — no AI interpretation.
  addTimeEvent(){
    const title = document.getElementById('ts-title').value.trim();
    const time  = document.getElementById('ts-time').value;
    const dur   = parseInt(document.getElementById('ts-duration').value) || 60;
    if(!title || !time){ U.toast('Add both a title and a time.'); return; }
    this._dayEvents.push({ title, time, durationMin: dur });
    this._dayEvents.sort((a,b) => U.t2m(a.time) - U.t2m(b.time));
    document.getElementById('ts-title').value = '';
    document.getElementById('ts-time').value  = '';
    this._renderTimeEvents();
  },
  _renderTimeEvents(){
    const el = document.getElementById('ts-list');
    if(!el) return;
    el.innerHTML = this._dayEvents.map((e,i) => {
      const endMin = U.t2m(e.time) + (e.durationMin || 60);
      const range = `${e.time}–${U.fmtMin(endMin)}`;
      return `<div class="ts-item">
        <span class="ts-item-title">${U.esc(e.title)}</span>
        <span class="ts-item-time">${range}</span>
        <span class="ts-item-dur">${e.durationMin} min</span>
        <button class="ts-item-x" onclick="GenPage._removeTimeEvent(${i})" title="Remove">×</button>
      </div>`;
    }).join('');
  },
  _removeTimeEvent(i){
    this._dayEvents.splice(i, 1);
    this._renderTimeEvents();
  },

  async generateDay(){
    const s=Store.get();
    if(!s.interests.length){ U.toast('Add interests in Setup first!'); return; }

    // Which date?
    const usePick=document.getElementById('day-opt-pick').classList.contains('active');
    const dateKey=usePick ? document.getElementById('day-date-pick').value : U.nowKey();
    if(!dateKey){ U.toast('Please pick a date.'); return; }

    // Start time — cannot be before current time if today
    const useNow=document.getElementById('start-opt-now').classList.contains('active');
    let startTime;
    if(useNow){
      startTime=U.nowTime();
    } else {
      startTime=document.getElementById('day-start-pick').value;
      if(dateKey===U.nowKey()){
        const now=U.t2m(U.nowTime());
        if(U.t2m(startTime)<now){ U.toast("Start time can't be before current time for today."); return; }
      }
    }
    const endTime=document.getElementById('day-end-pick').value||'23:00';
    const mood=document.getElementById('day-mood').value||s.mood;
    const energy=parseInt(document.getElementById('day-energy').value)||s.energy||6;
    const tasks=[...s.tasks,...this._dayTasks];
    const userNote=(document.getElementById('day-notes')?.value||'').trim();
    const dow=U.dowNum(dateKey);
    const rec=s.recurring.filter(r=>r.days.includes(dow));
    const isWkd=U.isWeekend(dateKey);

    this._showLoading(true, 'Generating your day...', 'Building schedule around your interests');

    const events = this._dayEvents.slice();
    try{
      const prompt=AI.prompt(U.dayName(dateKey),startTime,endTime,mood,energy,s.interests,tasks,s.blocked,rec,isWkd,userNote,events);
      const sched=await AI.call(prompt,{startTime,endTime,blocked:s.blocked});
      // Reconcile user constraints on top of AI output. AI was told to leave
      // events + recurring slots empty; we insert them at exact times.
      const merged = Reconcile.apply(sched.map(x=>({...x,done:false})), rec, s.blocked, startTime, endTime, events);
      s.schedules[dateKey] = merged;
    } catch(e){
      const fallback = Fallback.build(dateKey,startTime,endTime,mood,energy,s.interests,tasks,s.blocked,rec);
      s.schedules[dateKey] = Reconcile.apply(fallback, [], [], startTime, endTime, events);
      U.toast(e.message?.includes('API key')?'Using smart fallback (add Groq key for AI generation).':'AI failed — using smart fallback.');
    }

    if(dateKey===U.nowKey()) Streak.bump();
    Store.save();
    this._showLoading(false);

    // If user came from "Plan my day" on Today, return there with the new schedule.
    if(this._returnToToday && dateKey===U.nowKey()){
      this._returnToToday=false;
      Nav.go('today');
      U.toast('Day planned!');
      return;
    }
    this._showResult([dateKey]);
  },

  async generateWeek(){
    const s=Store.get();
    if(!s.interests.length){ U.toast('Add interests in Setup first!'); return; }

    const usePick=document.getElementById('week-opt-pick').classList.contains('active');
    const startKey=usePick ? document.getElementById('week-start-pick').value : U.nowKey();
    if(!startKey){ U.toast('Pick a start date.'); return; }

    const days = this._weekDays || 7;
    const startTime=document.getElementById('week-start-time').value||'07:00';
    const endTime=document.getElementById('week-end-time').value||'22:30';
    const mood=document.getElementById('week-mood').value||s.mood;
    const energy=parseInt(document.getElementById('week-energy').value)||s.energy||6;
    const tasks=[...s.tasks,...this._weekTasks];
    const userNote=(document.getElementById('week-notes')?.value||'').trim();

    const dateKeys=Array.from({length:days},(_,i)=>U.addDays(startKey,i));

    this._showLoading(true,'Generating your week...','Starting with day 1');

    for(let i=0;i<dateKeys.length;i++){
      // Pace requests: stagger 1.2s between days so we don't blow the
      // free-tier TPM budget. AI.call has its own retry on 429 too, this
      // just keeps us out of trouble in the first place.
      if(i > 0) await new Promise(r => setTimeout(r, 1200));
      const dk=dateKeys[i];
      document.getElementById('gen-loading-sub').textContent=`Day ${i+1}/${days}: ${U.dayName(dk)}`;
      const dow=U.dowNum(dk);
      const rec=s.recurring.filter(r=>r.days.includes(dow));
      const isWkd=U.isWeekend(dk);
      const dayMood=s.dayMoods[dk]||mood;
      try{
        const prompt=AI.prompt(U.dayName(dk),startTime,endTime,dayMood,energy,s.interests,tasks,s.blocked,rec,isWkd,userNote,[]);
        const sched=await AI.call(prompt,{startTime,endTime,blocked:s.blocked});
        s.schedules[dk] = Reconcile.apply(sched.map(x=>({...x,done:false})), rec, s.blocked, startTime, endTime, []);
      } catch(e){
        s.schedules[dk]=Fallback.build(dk,startTime,endTime,dayMood,energy,s.interests,tasks,s.blocked,rec);
      }
    }

    Store.save();
    this._showLoading(false);
    this._showResult(dateKeys);
  },

  _showLoading(show,main,sub){
    document.getElementById('gen-loading').style.display=show?'flex':'none';
    document.getElementById('gen-result').style.display=show?'none':'none';
    if(show){
      document.getElementById('gen-loading-main').textContent=main||'Generating...';
      document.getElementById('gen-loading-sub').textContent=sub||'';
      document.getElementById('gen-day-btn').disabled=true;
      document.getElementById('gen-week-btn').disabled=true;
    } else {
      document.getElementById('gen-day-btn').disabled=false;
      document.getElementById('gen-week-btn').disabled=false;
    }
  },

  _showResult(dateKeys){
    const todayK=U.nowKey();
    document.getElementById('gen-result').style.display='block';
    document.getElementById('result-title').textContent=
      dateKeys.length===1 ? `Schedule for ${U.fmtDate(dateKeys[0])}` : `${dateKeys.length}-day schedule ready`;

    const container=document.getElementById('result-day-cards');
    container.innerHTML=dateKeys.map(dk=>{
      const sched=Store.get().schedules[dk]||[];
      const preview=sched.filter(s=>s.type!=='break'&&s.type!=='blocked').slice(0,3);
      const isToday=dk===todayK;
      return `<div class="rdc${isToday?' today-card':''}" onclick="Nav.go('calendar');CalPage.selectDay('${dk}')">
        <div class="rdc-day">${U.shortDay(dk)}</div>
        <div class="rdc-date">${U.dayNum(dk)}</div>
        <div class="rdc-preview">
          ${preview.map(a=>`<div class="rdc-act"><div class="rdc-dot dot-${a.color||'gray'}"></div>${a.title}</div>`).join('')}
          ${sched.length>3?`<div class="rdc-more">+${sched.filter(s=>s.type!=='break'&&s.type!=='blocked').length-3} more</div>`:''}
        </div>
      </div>`;
    }).join('');
  },

  _refreshResultCards(){
    const el=document.getElementById('result-day-cards');
    if(!el||el.children.length===0) return;
    // just re-render quietly — no-op if not visible
  }
};

/* ─── CALENDAR PAGE ─── */
const CalPage = {
  _year: new Date().getFullYear(),
  _month: new Date().getMonth(),
  _selDay: null,
  _filter: 'all',

  render(){
    this._year=new Date().getFullYear();
    this._month=new Date().getMonth();
    this._renderMiniCal();
    this._renderReminders();
    if(this._selDay) this._renderDayDetail(this._selDay);
  },

  selectDay(dk){
    this._selDay=dk;
    // sync calendar view to the month of the selected day
    const d=new Date(dk+'T12:00:00');
    this._year=d.getFullYear(); this._month=d.getMonth();
    this._renderMiniCal();
    this._renderDayDetail(dk);
    this._renderReminders();
  },

  _renderMiniCal(){
    const mc=document.getElementById('mini-cal');
    const y=this._year, m=this._month;
    const first=new Date(y,m,1), last=new Date(y,m+1,0);
    const startDow=(first.getDay()+6)%7;
    const todayK=U.nowKey();
    const s=Store.get();
    const remDays=new Set(s.reminders.map(r=>r.date));

    let cells='';
    for(let i=0;i<startDow;i++) cells+=`<div class="ccell other"></div>`;
    for(let d=1;d<=last.getDate();d++){
      const k=`${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const hasSch=!!s.schedules[k];
      const hasRem=remDays.has(k);
      const cls=[
        'ccell',
        k===todayK?'today':'',
        k===this._selDay?'selected':'',
        hasSch&&hasRem?'has-both':hasSch?'has-sched':hasRem?'has-rem':''
      ].filter(Boolean).join(' ');
      cells+=`<div class="${cls}" onclick="CalPage.selectDay('${k}')">${d}</div>`;
    }

    mc.innerHTML=`
      <div class="mcal-hdr">
        <button class="mcal-nav" onclick="CalPage._navMonth(-1)">‹</button>
        <span class="mcal-title">${first.toLocaleDateString('en-US',{month:'long',year:'numeric'})}</span>
        <button class="mcal-nav" onclick="CalPage._navMonth(1)">›</button>
      </div>
      <div class="mcal-grid">
        ${['M','T','W','T','F','S','S'].map(d=>`<div class="cdow">${d}</div>`).join('')}
        ${cells}
      </div>`;
  },

  _navMonth(dir){
    this._month+=dir;
    if(this._month>11){this._month=0;this._year++;}
    if(this._month<0){this._month=11;this._year--;}
    this._renderMiniCal();
  },

  _renderReminders(){
    const s=Store.get();
    const todayK=U.nowKey();
    let rems=[...s.reminders];

    if(this._filter==='today')    rems=rems.filter(r=>r.date===todayK);
    else if(this._filter==='high') rems=rems.filter(r=>r.priority==='high');
    else if(this._filter==='recurring') rems=rems.filter(r=>r.repeat!=='none');

    rems.sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));

    const CLRS={teal:'var(--teal)',purple:'var(--purple)',coral:'var(--coral)',blue:'var(--blue)',pink:'var(--pink)',amber:'var(--amber)'};
    const RL={none:'',daily:'Daily',weekly:'Weekly',weekdays:'Weekdays',weekends:'Weekends',monthly:'Monthly'};

    const list=document.getElementById('reminders-list');
    if(!rems.length){ list.innerHTML='<div class="no-rem">No reminders. Click "+ Reminder" to add one.</div>'; return; }

    list.innerHTML=rems.map(r=>`
      <div class="rem-item">
        <div class="rem-bar" style="background:${CLRS[r.color]||'var(--amber)'}"></div>
        <div class="rem-body">
          <div class="rem-top">
            <span class="rem-title">${r.title}</span>
            <div class="rem-badges">
              <span class="rbadge rbadge-${r.priority}">${r.priority}</span>
              ${r.repeat&&r.repeat!=='none'?`<span class="rbadge rbadge-rec">${RL[r.repeat]}</span>`:''}
            </div>
          </div>
          <div class="rem-meta">${U.shortDate(r.date)} · ${r.time}</div>
          ${r.notes?`<div class="rem-notes">${r.notes}</div>`:''}
        </div>
        <div class="rem-acts">
          <button class="iconbtn" onclick="CalPage._editRem('${r.id}')">✎</button>
          <button class="iconbtn del" onclick="CalPage._delRem('${r.id}')">×</button>
        </div>
      </div>`).join('');
  },

  _renderDayDetail(dk){
    document.getElementById('cal-right-empty').style.display='none';
    document.getElementById('cal-right-content').style.display='block';

    document.getElementById('cal-day-title').textContent=U.dayName(dk);
    document.getElementById('cal-day-meta').textContent=U.fmtDate(dk);

    const moodSel=document.getElementById('cal-day-mood');
    moodSel.value=Store.get().dayMoods[dk]||'';

    const sched=Store.get().schedules[dk];
    this._updateProgress(dk);

    const clearBtn=document.getElementById('cal-clear-btn');
    if(clearBtn) clearBtn.style.display = (sched && sched.length) ? 'inline-flex' : 'none';

    if(!sched||!sched.length){
      document.getElementById('cal-timeline').innerHTML=`
        <div class="no-sched">No schedule for this day yet.<br>
          <button class="addbtn" style="margin-top:10px" onclick="Nav.go('generate')">Go to Generate →</button>
        </div>`;
    } else {
      TL.render('cal-timeline', sched, dk);
      TL._refreshNow();
    }

    this._renderDayReminders(dk);
  },

  _renderDayReminders(dk){
    const rems=Store.get().reminders.filter(r=>CalPage._reminderMatches(r,dk));
    const CLRS={teal:'var(--teal)',purple:'var(--purple)',coral:'var(--coral)',blue:'var(--blue)',pink:'var(--pink)',amber:'var(--amber)'};
    const el=document.getElementById('cal-day-reminders');
    if(!rems.length){ el.innerHTML='<div class="no-rem">No reminders for this day.</div>'; return; }
    el.innerHTML=rems.map(r=>`
      <div class="rem-item">
        <div class="rem-bar" style="background:${CLRS[r.color]||'var(--amber)'}"></div>
        <div class="rem-body">
          <div class="rem-top"><span class="rem-title">${r.title}</span><span class="rbadge rbadge-${r.priority}">${r.priority}</span></div>
          <div class="rem-meta">${r.time}</div>
          ${r.notes?`<div class="rem-notes">${r.notes}</div>`:''}
        </div>
        <button class="iconbtn del" onclick="CalPage._delRem('${r.id}')">×</button>
      </div>`).join('');
  },

  _updateProgress(dk){
    const sched=Store.get().schedules[dk]||[];
    const items=sched.filter(s=>s.type!=='blocked'&&s.type!=='break');
    const done=items.filter(s=>s.done).length;
    const pct=items.length?Math.round((done/items.length)*100):0;
    const f=document.getElementById('cal-progress-fill');
    const l=document.getElementById('cal-progress-lbl');
    if(f) f.style.width=pct+'%';
    if(l) l.textContent=`${done} / ${items.length} done`;
  },

  updateDayMood(v){
    if(!this._selDay) return;
    Store.get().dayMoods[this._selDay]=v;
    Store.save();
  },

  async regenDay(){
    if(!this._selDay){ U.toast('Select a day first.'); return; }
    const dk=this._selDay, s=Store.get();
    const mood=s.dayMoods[dk]||s.mood;
    const dow=U.dowNum(dk);
    const rec=s.recurring.filter(r=>r.days.includes(dow));
    const sched=s.schedules[dk];
    const startTime=sched?.[0]?.time||'07:00';
    const endTime='23:00';

    U.toast(`Regenerating ${U.dayName(dk)}...`);
    try{
      const prompt=AI.prompt(U.dayName(dk),startTime,endTime,mood,s.energy,s.interests,s.tasks,s.blocked,rec,U.isWeekend(dk),'',[]);
      const ns=await AI.call(prompt,{startTime,endTime,blocked:s.blocked});
      s.schedules[dk] = Reconcile.apply(ns.map(x=>({...x,done:false})), rec, s.blocked, startTime, endTime, []);
    } catch(e){
      s.schedules[dk]=Fallback.build(dk,startTime,endTime,mood,s.energy,s.interests,s.tasks,s.blocked,rec);
    }
    Store.save();
    this._renderDayDetail(dk);
    this._renderMiniCal();
    U.toast('Day regenerated!');
  },

  // Wipe the selected day's schedule entirely.
  clearDay(){
    if(!this._selDay) return;
    const dk=this._selDay;
    const sch=Store.get().schedules[dk];
    if(!sch||!sch.length){ U.toast('No schedule for this day.'); return; }
    const backup = JSON.parse(JSON.stringify(sch));
    delete Store.get().schedules[dk];
    Store.save();
    this._renderDayDetail(dk);
    this._renderMiniCal();
    U.toast(`Cleared ${backup.length} activities`, {
      action:'Undo',
      duration:5000,
      onAction:()=>{
        Store.get().schedules[dk] = backup;
        Store.save();
        CalPage._renderDayDetail(dk);
        CalPage._renderMiniCal();
        U.toast('Restored.');
      }
    });
  },

  filter(el,f){
    this._filter=f;
    document.querySelectorAll('.rfbtn').forEach(b=>b.classList.remove('active'));
    el.classList.add('active');
    this._renderReminders();
  },

  openReminderModal(dk){
    Modals.openRem(dk||this._selDay);
  },

  // Does reminder r occur on date dk? Gates by start date so a daily reminder
  // created today doesn't backfill into past days.
  _reminderMatches(r, dk){
    if(!r||!dk) return false;
    if(r.date===dk) return true;
    if(!r.repeat||r.repeat==='none') return false;
    if(dk<r.date) return false;
    const dow=U.dowNum(dk);
    if(r.repeat==='daily')    return true;
    if(r.repeat==='weekly')   return U.dowNum(r.date)===dow;
    if(r.repeat==='weekdays') return dow>=1&&dow<=5;
    if(r.repeat==='weekends') return dow===0||dow===6;
    if(r.repeat==='monthly')  return U.dayNum(r.date)===U.dayNum(dk);
    return false;
  },

  _editRem(id){ Modals.openRem(null, id); },
  _delRem(id){
    Store.get().reminders=Store.get().reminders.filter(r=>r.id!==id);
    Store.save();
    this._renderReminders();
    if(this._selDay) this._renderDayReminders(this._selDay);
    this._renderMiniCal();
    if(document.getElementById('page-today').classList.contains('active')) Today.render();
    U.toast('Reminder deleted.');
  }
};

/* ─── TODAY (the daily-driver view) ─── */
const Today = {
  render(){
    const dk=U.nowKey();
    const s=Store.get();
    const sched=s.schedules[dk];

    // Header
    const hour=parseInt(U.nowTime().split(':')[0]);
    const greet = hour<12?'Good morning':hour<17?'Good afternoon':hour<22?'Good evening':'Late night';
    const greetEl=document.getElementById('today-greeting');
    if(greetEl) greetEl.textContent=greet;
    const titleEl=document.getElementById('today-title');
    if(titleEl) titleEl.textContent=U.dayName(dk);
    const metaEl=document.getElementById('today-meta');
    if(metaEl) metaEl.textContent=U.fmtDate(dk).split(', ').slice(1).join(', '); // "April 30"

    const hasSched = !!(sched&&sched.length);

    // Plan-my-day button label
    const btn=document.getElementById('today-plan-btn');
    if(btn){
      btn.querySelector('.primary-btn-main').textContent = hasSched ? 'Regenerate day' : 'Plan my day';
      btn.querySelector('.primary-btn-sub').textContent  = hasSched ? 'Replace today\'s schedule' : 'AI builds your schedule';
    }
    const clearBtn=document.getElementById('today-clear-btn');
    if(clearBtn) clearBtn.style.display = hasSched ? 'inline-flex' : 'none';

    // Progress
    const progWrap=document.getElementById('today-progress');
    if(hasSched){
      progWrap.style.display='flex';
      const items=sched.filter(x=>x.type!=='blocked'&&x.type!=='break');
      const done=items.filter(x=>x.done).length;
      const pct=items.length?Math.round((done/items.length)*100):0;
      document.getElementById('today-progress-fill').style.width=pct+'%';
      document.getElementById('today-progress-lbl').textContent=`${done} / ${items.length} done`;
    } else {
      progWrap.style.display='none';
    }

    // NOW card (current block)
    this._renderNowCard(sched);

    // Timeline
    const tl=document.getElementById('today-timeline');
    const tlTitle=document.getElementById('today-tl-title');
    if(!hasSched){
      tl.innerHTML='';
      tlTitle.style.display='none';
      tl.innerHTML=`<div class="empty-state" style="margin-top:8px">No schedule yet for today.<br>Click <b>Plan my day</b> above to let Daycraft build one around your interests.</div>`;
    } else {
      tlTitle.style.display='block';
      // Reuse TL.render — it scopes by ctx (dateKey) which works for both Today and Calendar
      TL.render('today-timeline', sched, dk);
      this._highlightNow();
    }

    // Today's reminders (right rail)
    this._renderTodayReminders(dk);

    // Auto-hide the ⌘K hint card once the user has actually used the palette
    // twice — it's helpful onboarding noise that gets stale fast otherwise.
    try {
      const used = parseInt(localStorage.getItem('dc_qk_uses')||'0', 10);
      const tip = document.querySelector('.today-tip');
      if(tip) tip.style.display = used >= 2 ? 'none' : '';
    } catch(e){}
  },

  // Make sure TL._refreshNow finds the right element when on Today
  _highlightNow(){
    document.querySelectorAll('#today-timeline .tl-card.is-now').forEach(c=>c.classList.remove('is-now'));
    const dk=U.nowKey();
    const sch=Store.get().schedules[dk]; if(!sch) return;
    const now=U.t2m(U.nowTime());
    let idx=-1;
    sch.forEach((it,i)=>{
      if(it.type==='blocked') return;
      const a=U.t2m(it.time), b=U.t2m(it.endTime||it.time);
      if(a<=now&&now<b) idx=i;
    });
    if(idx<0) return;
    const wrap=document.querySelector(`#today-timeline .tl-block[data-gi="${idx}"]`);
    wrap?.querySelector('.tl-card')?.classList.add('is-now');
  },

  _renderNowCard(sched){
    const card=document.getElementById('today-now-card');
    if(!card) return;
    if(!sched||!sched.length){ card.style.display='none'; return; }
    const now=U.t2m(U.nowTime());
    const cur=sched.find(it=>{
      if(it.type==='blocked') return false;
      const a=U.t2m(it.time), b=U.t2m(it.endTime||it.time);
      return a<=now&&now<b;
    });
    if(!cur){ card.style.display='none'; return; }
    card.style.display='block';
    document.getElementById('today-now-title').textContent=cur.title;
    const left=U.t2m(cur.endTime)-now;
    document.getElementById('today-now-meta').textContent=`${cur.time} → ${cur.endTime} · ${left} min left`;
    document.getElementById('today-now-desc').textContent=cur.description||'';
  },

  _renderTodayReminders(dk){
    const rems=Store.get().reminders.filter(r=>CalPage._reminderMatches(r,dk));
    rems.sort((a,b)=>a.time.localeCompare(b.time));
    const CLRS={teal:'var(--teal)',purple:'var(--purple)',coral:'var(--coral)',blue:'var(--blue)',pink:'var(--pink)',amber:'var(--amber)'};
    const el=document.getElementById('today-reminders');
    if(!el) return;
    if(!rems.length){ el.innerHTML='<div class="no-rem">Nothing scheduled. Try <b>⌘K</b> to add one.</div>'; return; }
    el.innerHTML=rems.map(r=>`
      <div class="rem-item">
        <div class="rem-bar" style="background:${CLRS[r.color]||'var(--amber)'}"></div>
        <div class="rem-body">
          <div class="rem-top"><span class="rem-title">${r.title}</span><span class="rbadge rbadge-${r.priority}">${r.priority}</span></div>
          <div class="rem-meta">${r.time}</div>
          ${r.notes?`<div class="rem-notes">${r.notes}</div>`:''}
        </div>
        <div class="rem-acts">
          <button class="iconbtn" title="Edit" onclick="CalPage._editRem('${r.id}')">✎</button>
          <button class="iconbtn del" title="Delete" onclick="CalPage._delRem('${r.id}')">×</button>
        </div>
      </div>`).join('');
  },

  // Triggered by the big "Plan my day" / "Regenerate day" button.
  // Sets a flag so generateDay() returns to Today after completion.
  planDay(){
    GenPage._returnToToday=true;
    Nav.go('generate');
  },

  // Wipe today's schedule entirely (different from Regenerate, which replaces).
  clearDay(){
    const dk=U.nowKey();
    const sch=Store.get().schedules[dk];
    if(!sch||!sch.length){ U.toast('Nothing to clear.'); return; }
    const backup = JSON.parse(JSON.stringify(sch));
    delete Store.get().schedules[dk];
    Store.save();
    Today.render();
    CalPage._renderMiniCal && CalPage._renderMiniCal();
    U.toast(`Cleared ${backup.length} activities`, {
      action:'Undo',
      duration:5000,
      onAction:()=>{
        Store.get().schedules[dk] = backup;
        Store.save();
        Today.render();
        CalPage._renderMiniCal && CalPage._renderMiniCal();
        U.toast('Restored.');
      }
    });
  }
};

/* ─── ONBOARD (3-step first-run) ─── */
const Onboard = {
  _step:1, _mood:'', _interests:new Set(),
  open(){
    this._step=1; this._mood=''; this._interests.clear();
    document.querySelectorAll('#ob-mood .mood-chip').forEach(c=>c.classList.remove('sel'));
    document.querySelectorAll('.ob-presets .preset').forEach(p=>p.classList.remove('sel'));
    document.getElementById('ob-tags').innerHTML='';
    document.getElementById('ob-energy').value=6;
    document.getElementById('ob-energy-val').textContent='6/10';
    document.getElementById('ob-apikey').value='';
    this._renderStep();
    document.getElementById('ob-overlay').classList.add('open');
  },
  close(){ document.getElementById('ob-overlay').classList.remove('open'); },
  mood(el){
    document.querySelectorAll('#ob-mood .mood-chip').forEach(c=>c.classList.remove('sel'));
    el.classList.add('sel');
    this._mood=el.dataset.mood;
  },
  toggleInterest(el){
    const v=el.dataset.i;
    if(this._interests.has(v)){ this._interests.delete(v); el.classList.remove('sel'); }
    else { this._interests.add(v); el.classList.add('sel'); }
    this._renderTags();
  },
  addCustomInterest(){
    const i=document.getElementById('ob-interest-inp');
    const v=i.value.trim(); if(!v) return;
    const cap=v[0].toUpperCase()+v.slice(1);
    this._interests.add(cap);
    i.value='';
    this._renderTags();
  },
  _renderTags(){
    const tags=[...this._interests];
    document.getElementById('ob-tags').innerHTML =
      tags.map(t=>`<div class="tag">${t}<span class="tag-x" onclick="Onboard._removeInterest('${U.esc(t)}')">×</span></div>`).join('');
  },
  _removeInterest(v){
    this._interests.delete(v);
    document.querySelectorAll('.ob-presets .preset').forEach(p=>{ if(p.dataset.i===v) p.classList.remove('sel'); });
    this._renderTags();
  },
  next(){
    if(this._step===2 && this._interests.size===0){ U.toast('Pick at least one interest.'); return; }
    if(this._step<3){ this._step++; this._renderStep(); return; }
    this._finish();
  },
  back(){ if(this._step>1){ this._step--; this._renderStep(); } },
  skip(){ this._finish(true); },
  _renderStep(){
    document.querySelectorAll('.ob-step').forEach(s=>s.classList.toggle('active',parseInt(s.dataset.step)===this._step));
    document.querySelectorAll('.ob-dot').forEach(d=>d.classList.toggle('active',parseInt(d.dataset.s)<=this._step));
    document.getElementById('ob-back').style.display=this._step>1?'inline-block':'none';
    document.getElementById('ob-next').textContent=this._step===3?'Finish':'Next →';
  },
  _finish(skipped){
    const s=Store.get();
    if(!skipped){
      if(this._mood) s.mood=this._mood;
      const energy=parseInt(document.getElementById('ob-energy').value);
      if(energy) s.energy=energy;
      [...this._interests].forEach(v=>{ if(!s.interests.includes(v)) s.interests.push(v); });
      const key=document.getElementById('ob-apikey').value.trim();
      if(key) s.apiKey=key;
    }
    // Even on skip we want to leave Setup-page; seed a minimal interest so the
    // Today view doesn't loop back into onboarding next reload.
    if(!s.interests.length) s.interests.push('Reading','Walking');
    Store.save();
    this.close();
    Setup.init();
    Nav.go('today');
    U.toast(skipped?'Set up later in Settings.':'Welcome to Daycraft!');
  }
};

/* ─── MODALS ─── */
const Modals = {
  _blockCtx:null, _blockGi:null,
  _addCtx:null,   _addAfterGi:null,
  _remId:null,    _remPri:'high', _remColor:'amber',

  // BLOCK EDIT
  openBlock(ctx, gi){
    const sch=Store.get().schedules[ctx];
    if(!sch||!sch[gi]) return;
    const item=sch[gi];
    this._blockCtx=ctx; this._blockGi=gi;
    document.getElementById('be-title').value=item.title;
    document.getElementById('be-desc').value=item.description;
    document.getElementById('be-start').value=item.time;
    document.getElementById('be-end').value=item.endTime;
    document.getElementById('be-category').value=item.category;
    document.getElementById('be-color').value=item.color||'gray';
    document.getElementById('block-edit-overlay').classList.add('open');
  },
  closeBlock(e){
    if(e&&e.target!==document.getElementById('block-edit-overlay')) return;
    document.getElementById('block-edit-overlay').classList.remove('open');
    this._blockCtx=null; this._blockGi=null;
  },
  saveBlock(){
    const ctx=this._blockCtx, gi=this._blockGi;
    const sch=Store.get().schedules[ctx];
    if(!sch||gi===null) return;

    const newStart = document.getElementById('be-start').value;
    const newEnd   = document.getElementById('be-end').value;
    const conflict = Modals._findConflict(sch, newStart, newEnd, gi);
    if(conflict){
      U.toast(`Time clashes with "${conflict.title}" (${conflict.time}–${conflict.endTime})`);
      return;
    }

    sch[gi].title=document.getElementById('be-title').value;
    sch[gi].description=document.getElementById('be-desc').value;
    sch[gi].time=newStart;
    sch[gi].endTime=newEnd;
    sch[gi].category=document.getElementById('be-category').value;
    sch[gi].color=document.getElementById('be-color').value;
    sch.sort((a,b)=>U.t2m(a.time)-U.t2m(b.time));
    Store.save();
    document.getElementById('block-edit-overlay').classList.remove('open');
    TL._refresh(ctx);
    U.toast('Activity updated!');
  },

  // Returns the first block in `sch` that overlaps [newStart, newEnd) and
  // is not at index `excludeIdx`. Also enforces start < end.
  _findConflict(sch, newStart, newEnd, excludeIdx){
    if(!newStart||!newEnd) return null;
    const a=U.t2m(newStart), b=U.t2m(newEnd);
    if(a>=b){ U.toast('End time must be after start time.'); return { title:'(invalid time)', time:newStart, endTime:newEnd }; }
    for(let i=0;i<sch.length;i++){
      if(i===excludeIdx) continue;
      const it=sch[i];
      if(!it.time||!it.endTime) continue;
      const s=U.t2m(it.time), e=U.t2m(it.endTime);
      if(a < e && b > s) return it;
    }
    return null;
  },

  // ADD CUSTOM ACTIVITY
  openAdd(ctx, afterGi){
    this._addCtx=ctx; this._addAfterGi=afterGi;
    const sch=Store.get().schedules[ctx];
    const after=sch?.[afterGi];
    if(after){
      document.getElementById('aa-start').value=after.endTime||'10:00';
      const endMins=U.t2m(after.endTime||'10:00')+60;
      const eh=Math.floor(endMins/60)%24;
      const em=endMins%60;
      document.getElementById('aa-end').value=`${String(eh).padStart(2,'0')}:${String(em).padStart(2,'0')}`;
    }
    document.getElementById('aa-title').value='';
    document.getElementById('aa-desc').value='';
    document.getElementById('aa-category').value='';
    document.getElementById('aa-color').value='amber';
    document.getElementById('add-act-overlay').classList.add('open');
  },
  closeAdd(e){
    if(e&&e.target!==document.getElementById('add-act-overlay')) return;
    document.getElementById('add-act-overlay').classList.remove('open');
  },
  saveAdd(){
    const ctx=this._addCtx;
    const title=document.getElementById('aa-title').value.trim();
    if(!title){ U.toast('Enter a title.'); return; }
    const newStart=document.getElementById('aa-start').value;
    const newEnd=document.getElementById('aa-end').value;
    const sch=Store.get().schedules[ctx];
    if(sch){
      const conflict = Modals._findConflict(sch, newStart, newEnd, -1);
      if(conflict){
        U.toast(`Time clashes with "${conflict.title}" (${conflict.time}–${conflict.endTime})`);
        return;
      }
    }
    const newItem={
      time:newStart, endTime:newEnd,
      title, description:document.getElementById('aa-desc').value,
      category:document.getElementById('aa-category').value||'custom',
      color:document.getElementById('aa-color').value,
      type:'interest', swaps:Store.get().interests.slice(0,3), done:false
    };
    if(sch){
      sch.splice(this._addAfterGi+1,0,newItem);
      sch.sort((a,b)=>U.t2m(a.time)-U.t2m(b.time));
    }
    Store.save();
    document.getElementById('add-act-overlay').classList.remove('open');
    TL._refresh(ctx);
    U.toast('Activity added!');
  },

  // REMINDER
  openRem(dk, editId){
    this._remId=editId||null;
    this._remPri='high'; this._remColor='amber';

    if(editId){
      const r=Store.get().reminders.find(r=>r.id===editId);
      if(!r) return;
      document.getElementById('rem-modal-title').textContent='Edit Reminder';
      document.getElementById('rm-title').value=r.title;
      document.getElementById('rm-date').value=r.date;
      document.getElementById('rm-time').value=r.time;
      document.getElementById('rm-repeat').value=r.repeat;
      document.getElementById('rm-notes').value=r.notes||'';
      this._remPri=r.priority; this._remColor=r.color;
    } else {
      document.getElementById('rem-modal-title').textContent='Add Reminder';
      document.getElementById('rm-title').value='';
      document.getElementById('rm-date').value=dk||U.nowKey();
      document.getElementById('rm-time').value='09:00';
      document.getElementById('rm-repeat').value='none';
      document.getElementById('rm-notes').value='';
    }

    document.querySelectorAll('.pribtn').forEach(b=>b.classList.toggle('active',b.dataset.p===this._remPri));
    document.querySelectorAll('.cswatch').forEach(b=>b.classList.toggle('active',b.dataset.c===this._remColor));
    document.getElementById('rem-overlay').classList.add('open');
  },
  closeRem(e){
    if(e&&e.target!==document.getElementById('rem-overlay')) return;
    document.getElementById('rem-overlay').classList.remove('open');
    this._remId=null;
  },
  setPri(el){
    this._remPri=el.dataset.p;
    document.querySelectorAll('.pribtn').forEach(b=>b.classList.remove('active'));
    el.classList.add('active');
  },
  setRemColor(el){
    this._remColor=el.dataset.c;
    document.querySelectorAll('.cswatch').forEach(b=>b.classList.remove('active'));
    el.classList.add('active');
  },
  saveRem(){
    const title=document.getElementById('rm-title').value.trim();
    const date=document.getElementById('rm-date').value;
    const time=document.getElementById('rm-time').value;
    if(!title||!date||!time){ U.toast('Fill in title, date and time.'); return; }
    const rem={
      id:this._remId||U.uid(), title, date, time,
      priority:this._remPri, color:this._remColor,
      repeat:document.getElementById('rm-repeat').value,
      notes:document.getElementById('rm-notes').value.trim()
    };
    const s=Store.get();
    const idx=s.reminders.findIndex(r=>r.id===rem.id);
    if(idx>=0) s.reminders[idx]=rem; else s.reminders.push(rem);
    Store.save();
    document.getElementById('rem-overlay').classList.remove('open');
    CalPage._renderReminders();
    CalPage._renderMiniCal();
    if(CalPage._selDay) CalPage._renderDayReminders(CalPage._selDay);
    if(document.getElementById('page-today').classList.contains('active')) Today.render();
    U.toast(idx>=0?'Reminder updated!':'Reminder added!');
  }
};

/* ─── NOTIFY (foreground only — Week 2 adds service worker for background) ─── */
const Notify = {
  _fired:new Set(),
  supported(){ return typeof Notification!=='undefined'; },
  init(){ /* permission requested explicitly via Setup */ },
  async request(){
    if(!this.supported()){ U.toast('This browser does not support notifications.'); return; }
    if(Notification.permission==='granted'){ U.toast('Notifications already enabled.'); return; }
    const p=await Notification.requestPermission();
    U.toast(p==='granted'?'Notifications enabled!':'Permission denied.');
    this._renderStatus();
  },
  _renderStatus(){
    const el=document.getElementById('notif-status');
    if(!el) return;
    if(!this.supported()){ el.textContent='Not supported in this browser.'; return; }
    el.textContent = Notification.permission==='granted'
      ? 'Enabled — reminders will fire while this tab is open.'
      : Notification.permission==='denied'
        ? 'Blocked — enable in your browser site settings.'
        : 'Click "Enable" to allow browser notifications.';
  },
  tick(){
    if(!this.supported()||Notification.permission!=='granted') return;
    const todayK=U.nowKey();
    const nowMin=U.t2m(U.nowTime());
    const s=Store.get();
    s.reminders.forEach(r=>{
      if(!CalPage._reminderMatches(r,todayK)) return;
      const remMin=U.t2m(r.time);
      // fire within a 90s window after the trigger time
      if(nowMin<remMin||nowMin-remMin>1) return;
      const key=`${r.id}|${todayK}|${r.time}`;
      if(this._fired.has(key)) return;
      this._fired.add(key);
      try{
        const n=new Notification(r.title,{
          body:r.notes||`${r.priority||'medium'} priority · ${r.time}`,
          tag:key,
          silent:false
        });
        n.onclick=()=>{ window.focus(); Nav.go('calendar'); CalPage.selectDay(todayK); n.close(); };
      }catch(e){}
    });
  }
};

/* ─── IDLE (signed-in only — 2h inactivity → 15min warn → sign out) ─── */
const Idle = {
  // Exposed as constants so tests / a future "idle timeout" setting can shrink them.
  WARN_AFTER_MS: 2 * 60 * 60 * 1000,        // 2 hours of no activity
  SIGN_OUT_AFTER_WARN_MS: 15 * 60 * 1000,    // 15 min after the warning shows
  _events: ['mousemove','keydown','click','scroll','touchstart','wheel'],
  _bound:false,
  _warnTimer:null,
  _countdownTimer:null,
  _activityHandler:null,

  init(){
    if(this._bound) return;
    this._activityHandler = ()=>this._onActivity();
    this._events.forEach(ev =>
      document.addEventListener(ev, this._activityHandler, { passive:true })
    );
    this._bound = true;
    this._scheduleWarn();
  },

  cleanup(){
    if(!this._bound) return;
    this._events.forEach(ev => document.removeEventListener(ev, this._activityHandler));
    this._bound = false;
    clearTimeout(this._warnTimer); this._warnTimer = null;
    clearInterval(this._countdownTimer); this._countdownTimer = null;
    document.getElementById('idle-overlay')?.classList.remove('open');
  },

  _onActivity(){
    // Once the warning is showing, only the explicit "I'm still here" button
    // dismisses it. Stray mouse jitter doesn't reset.
    if(this._countdownTimer) return;
    this._scheduleWarn();
  },

  _scheduleWarn(){
    clearTimeout(this._warnTimer);
    this._warnTimer = setTimeout(()=>this._showWarn(), this.WARN_AFTER_MS);
  },

  _showWarn(){
    this._warnTimer = null;
    const overlay = document.getElementById('idle-overlay');
    if(!overlay) return;
    overlay.classList.add('open');
    let remaining = Math.floor(this.SIGN_OUT_AFTER_WARN_MS / 1000);
    const render = ()=>{
      const m = Math.floor(remaining/60), s = remaining%60;
      const el = document.getElementById('idle-countdown');
      if(el) el.textContent = `${m}:${String(s).padStart(2,'0')}`;
    };
    render();
    this._countdownTimer = setInterval(()=>{
      remaining--;
      render();
      if(remaining <= 0){
        clearInterval(this._countdownTimer);
        this._countdownTimer = null;
        overlay.classList.remove('open');
        Auth.signOut();
      }
    }, 1000);
  },

  _iAmHere(){
    if(this._countdownTimer){
      clearInterval(this._countdownTimer);
      this._countdownTimer = null;
    }
    document.getElementById('idle-overlay')?.classList.remove('open');
    this._scheduleWarn();
  }
};

/* ─── QUICK ADD (Cmd/Ctrl+K) ─── */
const QuickAdd = {
  init(){
    document.addEventListener('keydown',e=>{
      if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){ e.preventDefault(); this.open(); return; }
      if(e.key==='Escape'&&document.getElementById('qa-overlay')?.classList.contains('open')) this.close();
      if(e.key==='Enter'&&document.activeElement?.id==='qa-input') this.submit();
    });
  },
  open(){
    document.getElementById('qa-overlay').classList.add('open');
    setTimeout(()=>document.getElementById('qa-input').focus(),40);
  },
  close(e){
    if(e&&e.target!==document.getElementById('qa-overlay')) return;
    document.getElementById('qa-overlay').classList.remove('open');
    document.getElementById('qa-input').value='';
  },
  submit(){
    const raw=document.getElementById('qa-input').value.trim();
    if(!raw) return;
    const parsed=this.parse(raw);
    if(!parsed.title){ U.toast('Add a title — e.g. "in 15m drink water".'); return; }
    // Track usage so the Today rail's ⌘K hint card auto-hides once you've
    // actually used the palette a couple of times.
    try {
      const used = parseInt(localStorage.getItem('dc_qk_uses')||'0', 10) + 1;
      localStorage.setItem('dc_qk_uses', String(used));
    } catch(e){}
    const rem={
      id:U.uid(), title:parsed.title, date:parsed.date, time:parsed.time,
      priority:'medium', color:'amber', repeat:'none', notes:''
    };
    Store.get().reminders.push(rem);
    Store.save();
    this.close();
    CalPage._renderReminders();
    CalPage._renderMiniCal();
    if(CalPage._selDay) CalPage._renderDayReminders(CalPage._selDay);
    if(document.getElementById('page-today').classList.contains('active')) Today.render();
    U.toast(`Reminder set · ${U.shortDate(rem.date)} ${rem.time}`);
  },
  // Parse: "in 15m water", "in 2h call mom", "tomorrow 9am gym",
  // "today 14:30 meeting", "9am gym", "14:30 meeting", or plain title (now+15m).
  parse(s){
    const todayK=U.nowKey();
    const nowMin=U.t2m(U.nowTime());
    const fmt=mins=>{
      const total=((mins%1440)+1440)%1440;
      return `${String(Math.floor(total/60)).padStart(2,'0')}:${String(total%60).padStart(2,'0')}`;
    };

    // "in N m/h <title>"
    let m=s.match(/^in\s+(\d+)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours)?\s+(.+)$/i);
    if(m){
      const n=parseInt(m[1]); const u=(m[2]||'min').toLowerCase();
      const add=u.startsWith('h')?n*60:n;
      const target=nowMin+add;
      const date=target>=1440?U.addDays(todayK,Math.floor(target/1440)):todayK;
      return { date, time:fmt(target), title:m[3].trim() };
    }

    // "(today|tomorrow) [time] <title>"
    m=s.match(/^(today|tomorrow)\s+(.+)$/i);
    if(m){
      const date=m[1].toLowerCase()==='tomorrow'?U.addDays(todayK,1):todayK;
      const rest=m[2];
      const tm=rest.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s+(.+)$/i);
      if(tm){
        const t=this._parseClock(tm[1],tm[2],tm[3]);
        if(t!=null) return { date, time:fmt(t), title:tm[4].trim() };
      }
      return { date, time:'09:00', title:rest.trim() };
    }

    // "<time> <title>"
    m=s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s+(.+)$/i);
    if(m && (m[3]||m[2])){ // require am/pm or :MM so "5 reps" doesn't get eaten
      const t=this._parseClock(m[1],m[2],m[3]);
      if(t!=null){
        const date = t<nowMin ? U.addDays(todayK,1) : todayK;
        return { date, time:fmt(t), title:m[4].trim() };
      }
    }

    // default → 15 minutes from now
    return { date:todayK, time:fmt(nowMin+15), title:s };
  },
  _parseClock(hh,mm,ampm){
    let h=parseInt(hh); const mn=parseInt(mm||'0');
    if(isNaN(h)||isNaN(mn)||mn>59) return null;
    const a=(ampm||'').toLowerCase();
    if(a==='pm'&&h<12) h+=12;
    if(a==='am'&&h===12) h=0;
    if(h>23) return null;
    return h*60+mn;
  }
};

/* ─── AUTH (Firebase wired in once config is added — see Sync.init) ─── */
const Auth = {
  _user:null,                  // null = guest; { uid, name, email, photoURL } when signed in
  _wired:false,                // becomes true once Sync.init successfully boots Firebase
  // Sidebar profile button: signed in → toggle popover; guest → open sign-in modal
  profileClick(e){
    if(e) e.stopPropagation();
    if(this._user) this.toggleUserMenu();
    else this.openSignIn();
  },
  openSignIn(){
    document.getElementById('signin-overlay').classList.add('open');
    this._renderFineprint();
  },
  toggleUserMenu(force){
    const m=document.getElementById('side-user-menu');
    if(!m||!this._user) return;
    const open = force!==undefined ? force : m.style.display==='none';
    if(open){
      document.getElementById('sum-name').textContent  = this._user.name||'Signed in';
      document.getElementById('sum-email').textContent = this._user.email||'';
      m.style.display='block';
      // Close on outside click — single global handler, removed when closed
      this._dismiss = (ev)=>{
        if(!m.contains(ev.target) && ev.target.id!=='side-profile-btn' && !document.getElementById('side-profile-btn').contains(ev.target)){
          this.toggleUserMenu(false);
        }
      };
      setTimeout(()=>document.addEventListener('click',this._dismiss),0);
    } else {
      m.style.display='none';
      if(this._dismiss){ document.removeEventListener('click',this._dismiss); this._dismiss=null; }
    }
  },
  closeSignIn(e){
    if(e&&e.target!==document.getElementById('signin-overlay')) return;
    document.getElementById('signin-overlay').classList.remove('open');
  },
  async signInWithGoogle(){
    if(!this._wired){
      U.toast('Sign-in is being set up — Firebase config arrives in Week 3 wire-up.');
      return;
    }
    try{
      await Sync.signInWithGoogle();
      this.closeSignIn();
    }catch(e){
      U.toast('Sign in failed — '+(e.message||'unknown error'));
    }
  },
  async signOut(){
    if(!this._wired) return;
    try{
      this.toggleUserMenu(false);
      await Sync.signOut();
      U.toast('Signed out. Daycraft is now in guest mode.');
    }catch(e){ U.toast('Sign out failed.'); }
  },
  _onUserChange(user){
    this._user = user;
    if(user){
      Idle.init();
    } else {
      Idle.cleanup();
      this._lastSyncedAt = null;
      this.toggleUserMenu(false);
    }
    this._renderProfileChip();
  },
  _lastSyncedAt:null,
  _renderProfileChip(){
    const av=document.getElementById('side-avatar');
    const nm=document.getElementById('side-profile-name');
    const mt=document.getElementById('side-profile-meta');
    const btn=document.getElementById('side-profile-btn');
    if(!av) return;
    if(this._user){
      // Use Google photoURL if present; fall back to first-letter initial.
      // referrerpolicy avoids the occasional 403 on Google profile photos.
      if(this._user.photoURL){
        av.innerHTML=`<img src="${U.esc(this._user.photoURL)}" alt="" referrerpolicy="no-referrer" onerror="this.parentNode.textContent='${U.esc((this._user.name||this._user.email||'?')[0].toUpperCase())}'">`;
      } else {
        av.textContent=(this._user.name||this._user.email||'?')[0].toUpperCase();
      }
      nm.textContent=this._user.name||(this._user.email||'').split('@')[0];
      mt.textContent=this._syncedAgoText();
      btn.title='Account · click to open menu';
    } else {
      av.textContent='G';
      nm.textContent='Guest';
      mt.textContent= this._wired ? 'Sign in to sync' : 'Local only';
      btn.title='Sign in to sync across devices';
    }
  },
  _syncedAgoText(){
    if(!this._lastSyncedAt) return 'Synced';
    const s=Math.max(0, Math.floor((Date.now()-this._lastSyncedAt)/1000));
    if(s<5)    return 'Synced just now';
    if(s<60)   return `Synced ${s}s ago`;
    const m=Math.floor(s/60);
    if(m<60)   return `Synced ${m}m ago`;
    const h=Math.floor(m/60);
    if(h<24)   return `Synced ${h}h ago`;
    return 'Synced over a day ago';
  },
  noteSynced(){
    this._lastSyncedAt = Date.now();
    const mt=document.getElementById('side-profile-meta');
    if(mt && this._user) mt.textContent = this._syncedAgoText();
  },
  _renderFineprint(){
    const fp=document.getElementById('signin-fineprint');
    if(!fp) return;
    fp.innerHTML = this._wired
      ? 'Your data stays yours — Daycraft stores it under your account in a private database. Skip and keep using Daycraft as a guest on this device.'
      : '<b>Sign-in is being set up.</b> The Firebase config arrives in the next deploy. For now, Daycraft works fully in guest mode — everything is saved on this device.';
  }
};

/* ─── SYNC (Firebase Auth + Firestore — bound only once config is provided) ─── */
const Sync = {
  _firebase:null, _auth:null, _db:null, _unsubFromSnapshot:null, _writeTimer:null,
  // Public client-side keys. Security comes from Firestore rules (users/{uid}
  // is locked to request.auth.uid == uid). Safe to commit.
  CONFIG:{
    apiKey: "AIzaSyDuauJ8w1vfqtNnvOAaqzjJrIMHZpLX5SU",
    authDomain: "daycraft-72848.firebaseapp.com",
    projectId: "daycraft-72848",
    storageBucket: "daycraft-72848.firebasestorage.app",
    messagingSenderId: "778642472327",
    appId: "1:778642472327:web:2e47a92f92d233fbe7e722"
  },
  async init(){
    if(!this.CONFIG){
      Auth._wired = false;
      Auth._renderProfileChip();
      return;
    }
    try{
      // Lazy-load the modular Firebase SDK from the CDN. No build step needed.
      const fbApp  = await import('https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js');
      const fbAuth = await import('https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js');
      const fbStore= await import('https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js');
      const app = fbApp.initializeApp(this.CONFIG);
      this._auth = fbAuth.getAuth(app);
      this._db   = fbStore.getFirestore(app);
      this._fbAuth=fbAuth; this._fbStore=fbStore;
      // Pick up the result of any redirect-based sign-in (mobile fallback).
      // Returns null if there's nothing pending — that's fine.
      try { await fbAuth.getRedirectResult(this._auth); } catch(e){ console.warn('getRedirectResult', e); }
      Auth._wired=true;
      // Watch auth state — survives reloads and the redirect from Google.
      // Distinguishes three transitions:
      //   guest → user      = first sign-in (or boot with persisted session)
      //   userA → userB     = different account took over: wipe local first
      //   user → guest      = signed out: wipe local + redirect to landing
      fbAuth.onAuthStateChanged(this._auth, async user=>{
        const oldUid = Auth._user?.uid || null;
        const newUid = user?.uid || null;

        // Different account or signed out → kill subscription + clear local cache
        if(oldUid && oldUid !== newUid){
          if(this._unsubFromSnapshot){ this._unsubFromSnapshot(); this._unsubFromSnapshot=null; }
          // Patch Store.save back to its original (no longer auto-pushes for old user)
          if(Store._origSave){ Store.save = Store._origSave; Store._wrappedForSync = false; }
          Store.reset();
        }

        // Signed out — go home
        if(!newUid){
          Auth._onUserChange(null);
          if(oldUid && location.pathname.startsWith('/app')){
            location.href = '/';
            return;
          }
          return;
        }

        Auth._onUserChange({ uid:user.uid, name:user.displayName, email:user.email, photoURL:user.photoURL });
        await this._pullThenSubscribe(user.uid);
      });
      // If user came from landing's "Sign in" CTA, surface the modal —
      // but only if they aren't already signed in (Firebase may have a
      // persisted session that the listener has already restored).
      if(sessionStorage.getItem('dc_signin_intent')){
        sessionStorage.removeItem('dc_signin_intent');
        if(!this._auth.currentUser){
          Auth.openSignIn();
        }
      }
    } catch(e){
      console.error('Sync init failed', e);
      Auth._wired=false;
      Auth._renderProfileChip();
    }
  },
  async signInWithGoogle(){
    const provider = new this._fbAuth.GoogleAuthProvider();
    // Force the Google account picker every time. Without this, Google's
    // OAuth silently reuses the last-signed-in account in the browser
    // session — so signing out of Daycraft and back in always lands on
    // the same Google account with no way to switch.
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      await this._fbAuth.signInWithPopup(this._auth, provider);
    } catch(e){
      // iOS Safari (and some PWA contexts) block OAuth popups. Fall back
      // to a full-page redirect — the result is picked up on next load
      // by getRedirectResult inside Sync.init.
      if(e && (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment')){
        await this._fbAuth.signInWithRedirect(this._auth, provider);
        return;
      }
      throw e;
    }
  },
  async signOut(){ await this._fbAuth.signOut(this._auth); },

  // Pull the user's stored doc, replace local with it, then subscribe to
  // future Firestore changes for cross-device live updates.
  async _pullThenSubscribe(uid){
    const ref = this._fbStore.doc(this._db, `users/${uid}`);
    try{
      const snap = await this._fbStore.getDoc(ref);
      if(snap.exists()){
        // Cloud wins entirely — replace local. apiKey is synced now, so the
        // user's Groq key follows them across devices without re-entry.
        const cloud = snap.data();
        const local = Store.get();
        Object.keys(local).forEach(k => delete local[k]);
        Object.assign(local, cloud);
        Store.save();
      } else {
        // First-ever sign-in for this user → seed Firestore from current local
        // (carries any guest data the user collected before signing in).
        await this._fbStore.setDoc(ref, this._cleanForFirestore(Store.get()));
      }
      Auth.noteSynced();
      // Re-render visible page after the data swap
      Streak.render();
      if(document.getElementById('page-today').classList.contains('active'))    Today.render();
      if(document.getElementById('page-calendar').classList.contains('active')) CalPage.render();

      // Live subscribe
      this._unsubFromSnapshot = this._fbStore.onSnapshot(ref, snap=>{
        if(!snap.exists()) return;
        const cloud=snap.data();
        const local=Store.get();
        Object.keys(local).forEach(k=>delete local[k]);
        Object.assign(local, cloud);
        if(document.getElementById('page-today').classList.contains('active')) Today.render();
        if(document.getElementById('page-calendar').classList.contains('active')) CalPage.render();
        Streak.render();
        Auth.noteSynced();
      });
      // Patch Store.save to also push to Firestore. We wrap once and remember
      // the original so we can unwrap on user-change.
      if(!Store._wrappedForSync){
        Store._origSave = Store.save;
        Store.save = (...args)=>{
          Store._origSave.apply(Store,args);
          if(Auth._user){
            clearTimeout(Sync._writeTimer);
            Sync._writeTimer = setTimeout(()=>{
              this._fbStore.setDoc(ref, Sync._cleanForFirestore(Store.get()))
                .then(()=>Auth.noteSynced())
                .catch(()=>{});
            }, 600);
          }
        };
        Store._wrappedForSync = true;
      }
    } catch(e){ console.error('pullThenSubscribe', e); }
  },
  // Firestore can't store undefined; strip internal flags only.
  // apiKey IS synced — users with the Groq key set on one device get it
  // on every signed-in device, no re-entry needed.
  _cleanForFirestore(obj){
    const out = JSON.parse(JSON.stringify(obj));
    delete out._wrappedForSync;    // internal flag, never sync
    delete out._origSave;          // internal ref, never sync
    return out;
  }
};

/* ─── BOOT ─── */
document.addEventListener('DOMContentLoaded',()=>{
  Store.load();
  Clock.init();
  Setup.init();
  Streak.render();
  Notify.init();
  QuickAdd.init();
  Theme.init();
  Auth._renderProfileChip();
  Sync.init(); // no-op until CONFIG is set

  // Register the service worker on real domains. Skip on localhost to keep
  // the e2e test runs clean (no stale cache between runs).
  if('serviceWorker' in navigator && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname)){
    navigator.serviceWorker.register('/sw.js').catch(()=>{});
  }

  // First run → onboarding modal + land on Today.
  // Returning users → straight to Today.
  Nav.go('today');
  if(!Store.get().interests.length){
    Onboard.open();
  }

  // Live ticks: NOW indicator (Today + Calendar) + reminder firing + sync chip
  const tick=()=>{
    TL._refreshNow();
    if(document.getElementById('page-today').classList.contains('active')){
      const sched=Store.get().schedules[U.nowKey()];
      Today._renderNowCard(sched);
      Today._highlightNow();
    }
    Notify.tick();
    // Refresh "Synced X ago" text in the sidebar without re-rendering the chip
    if(Auth._user && Auth._lastSyncedAt){
      const mt=document.getElementById('side-profile-meta');
      if(mt) mt.textContent = Auth._syncedAgoText();
    }
  };
  tick();
  setInterval(tick, 30000);
});
