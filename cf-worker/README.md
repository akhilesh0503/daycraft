# daycraft-reminders — Cloudflare Worker

Cron-driven worker that fires reminder push notifications via FCM. Runs
every minute on Cloudflare's free plan.

## Deploy

From this directory (`cf-worker/`):

```bash
# 1. Push the encrypted service-account JSON into Cloudflare's secret
#    store. Wrangler will prompt you to paste the JSON. The whole file
#    contents — paste, hit Enter, then Ctrl+D (Linux/Mac) or Ctrl+Z then
#    Enter (Windows) to finish.
wrangler secret put GOOGLE_SERVICE_ACCOUNT_JSON

# 2. Deploy the Worker. The cron trigger registers automatically.
wrangler deploy
```

After deploy, the Worker URL will be printed (something like
`https://daycraft-reminders.<your-account>.workers.dev`).

## Verify

The cron fires every minute. To confirm without waiting:

```bash
# Open the manual trigger in a browser
curl "https://daycraft-reminders.<your-account>.workers.dev/?run=1"
```

Response is JSON like `{ ok: true, dateStr: "2026-05-02", timeStr: "14:30",
pushed: 0, errors: 0 }`. `pushed` will be 0 until you have a reminder due
this exact minute and an FCM-registered device.

To watch live logs:

```bash
wrangler tail
```

## What it does

Every minute, the cron handler:

1. Mints a Google OAuth2 access token from the service-account JSON
   (cached for ~50 min to save round-trips).
2. Lists all `users/*` documents from Firestore via the REST API.
3. For each user, scans `reminders[]` for entries with `time` matching the
   current minute (in `America/Phoenix`) and a `repeat` rule that lights
   up today.
4. Sends an FCM HTTP-v1 push to every token in the user's `fcmTokens[]`.
5. Detects invalid tokens (UNREGISTERED / NOT_FOUND / INVALID_ARGUMENT)
   and removes them from the user's array so we don't keep retrying.

## Costs

Free. Cloudflare's free Workers tier covers:

- 100,000 requests/day (cron triggers count as requests; 1440/day for
  every-minute scheduling — well under)
- Cron Triggers — included at no cost

The service account hits Google APIs which fall under the Firebase Spark
plan (unlimited reads/writes for the Firestore docs we touch and FCM is
free). No credit card required anywhere in the chain.
