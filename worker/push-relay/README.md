# push-relay

A tiny, dependency-free Cloudflare Worker that sends a real push notification
(delivered even when the app is backgrounded or fully closed) when the
IslamLifeV2 task manager's client asks it to. See `src/index.js` for why this
exists instead of a Firebase Cloud Function.

Deployed standalone with `wrangler` — **not** part of the `asbc-solutions`
Docker/Traefik fleet (`DEPLOYMENT_PLAYBOOK.md`). It doesn't need a server,
Dockerfile, or `fleet.yml` entry; it's a single stateless function better
suited to a direct Workers deploy.

## One-time setup

You need a Cloudflare account (you already have one — same one your domains
use) and Node installed.

```bash
cd worker/push-relay
npx wrangler login
```

This opens a browser tab to authorize `wrangler` against your Cloudflare
account — nothing to paste back here.

## Deploy

```bash
npx wrangler deploy
```

First deploy prints the Worker's URL, something like:
`https://islamlife-push-relay.<your-subdomain>.workers.dev`

## Secrets (never commit these — set them directly, not via wrangler.toml)

```bash
npx wrangler secret put FIREBASE_SERVICE_ACCOUNT
```
Paste the **same** JSON you already have in the `FIREBASE_SERVICE_ACCOUNT`
GitHub Actions secret (used by `scripts/daily-report.js`) — the full service
account key file, as one line or multi-line, wrangler reads it from stdin.
If you don't have it handy: Firebase Console → Project settings → Service
accounts → Generate new private key.

```bash
npx wrangler secret put APP_SHARED_SECRET
```
Any random string you make up (e.g. `openssl rand -hex 32`). This is **not**
a high-value secret — it ships inside the app bundle too (anyone who really
wants to could extract it), it just keeps the endpoint from being spammed by
someone who stumbles on the URL. The real access control is Firestore rules.

## Wire it into the app

Add these two keys to your deployed `firebase-config.json` (same file that
already holds `apiKey` etc. — see `SETUP.md`):

```json
{
  "pushRelayUrl": "https://islamlife-push-relay.<your-subdomain>.workers.dev",
  "pushRelaySecret": "<the same random string you set as APP_SHARED_SECRET>"
}
```

Without these two keys the app works exactly as before — `notifyPush()`
(`src/lib/push.ts`) just no-ops. Nothing breaks for a workspace that doesn't
set this up.

## Updating later

Change `src/index.js`, then `npx wrangler deploy` again. The URL stays the
same.
