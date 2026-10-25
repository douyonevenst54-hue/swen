# Deploying Swen

The simplest production setup is the same one used for other Next.js +
Prisma + Neon projects: **Neon** for Postgres, **Vercel** for the server.
The tablet app is served by the same deployment at `/app/`.

## 1. Database (Neon)

1. Create a Neon project, database `swen`.
2. Copy two connection strings:
   - **pooled** → `DATABASE_URL`
   - **direct** (non-pooled) → `DIRECT_DATABASE_URL` (migrations only)

## 2. Secrets

```bash
openssl rand -base64 48   # SESSION_SECRET
openssl rand -base64 32   # KEY_ENCRYPTION_KEY  — keep an offline copy!
```

If `KEY_ENCRYPTION_KEY` is lost, existing devices can no longer be unlocked
online and must be set up again (data already synced to the server is safe).

## 3. First deploy

```bash
npm install                     # npm 11+ (see README)
cp apps/server/.env.example apps/server/.env    # fill it in
npm run db:deploy --workspace @swen/server      # apply migrations
npm run db:seed --workspace @swen/server        # optional demo data
```

On Vercel:

- **Root directory:** `apps/server`
- **Install command:** `cd ../.. && npm install`
- **Build command:** `cd ../.. && npm run build --workspace @swen/field && npm run build --workspace @swen/server`
- **Environment variables:** everything from `.env.example`.
- Add `npm run db:deploy --workspace @swen/server` to your release step (or
  run it from your machine before each deploy that adds a migration).

## 4. Facility setup

1. Open the dashboard, sign in with `ADMIN_PASSWORD`.
2. **Administration**: add the facility, add staff with PINs, add supply
   items (or edit the seeded ones), print QR labels.
3. **Create setup code** → on each tablet, open `https://your-server/app/`
   in Chrome, enter the code, then *Add to Home screen*.
4. Each nurse unlocks once with internet. After that the tablet works offline.

## Running in the clinic without internet

If there is no reliable internet at all, run the server on a small local
machine (a mini-PC or laptop) on the clinic Wi-Fi, with a UPS:

```bash
# PostgreSQL 16 installed locally
npm run build
npm run db:deploy --workspace @swen/server
npm run start --workspace @swen/server -- -p 3000
```

Tablets use `http://<that-machine>:3000` as the server address. Note that
Chrome only allows the service worker (offline mode), the camera and
Bluetooth on HTTPS or `localhost`, so a local server needs an HTTPS
certificate (e.g. a local CA such as `mkcert`, installed on each tablet).

## Updates

The tablet app updates itself: when a new version is deployed, Settings shows
"A new version of Swen is ready". Tapping *Update now* reloads it. Unsynced
data is kept in IndexedDB across updates.
