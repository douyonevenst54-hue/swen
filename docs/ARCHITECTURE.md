# Architecture

```
 Android tablet / phone (Chrome)              Cloud (Vercel + Neon) or a local server
┌──────────────────────────────────┐        ┌──────────────────────────────────────┐
│ Field app (PWA, apps/field)      │  HTTPS │ Swen server (Next.js, apps/server)   │
│  React + IndexedDB (Dexie)       │◀──────▶│  /api/v1  device API (enroll, unlock,│
│  works fully offline             │  sync  │           push, pull, cabinet events)│
│  MEWS, plausibility, FEFO        │        │  /        supervisor dashboard        │
│  Bluetooth vitals, QR scanning   │        │  Prisma 7 → PostgreSQL (Neon)        │
└──────────────────────────────────┘        └──────────────────────────────────────┘
          ▲ standard BLE health profiles                 ▲ HTTPS, cabinet key
   thermometer · BP monitor · oximeter          ESP32 door sensor (hardware/)
```

`packages/core` is shared by both apps: MEWS scoring, plausibility checks,
Bluetooth parsers, stock ledger, record schemas, and all translations. The
same code scores vitals on the tablet and again on the server.

## Data model

Two kinds of records:

| Kind | Tables | Rule |
|---|---|---|
| Append-only | observations, escalations, stock movements | Never edited. A correction is a new record pointing at the old one (`supersedesId`). Sync is idempotent by id, so there are no conflicts. |
| Last-write-wins | patients, items | The copy with the newest `updatedAt` wins, on the server and on every device. |

Stock is never stored as a number. It is the sum of the movement ledger, so
two tablets dispensing offline both count once they sync.

## Sync protocol

1. **Push.** The device sends up to 200 unsynced records per type
   (`POST /api/v1/sync/push`). The server answers with accepted ids and
   rejected ids, each marked *retryable* (a record it depends on hasn't
   arrived — try again later) or not (needs a person; shown in Settings).
2. **Pull.** `GET /api/v1/sync/pull?cursor=N` returns every row with
   `seq > N`, oldest first, 500 at a time, plus the staff list and the
   facility's MEWS rules.

`seq` comes from one Postgres sequence, stamped by a trigger on every insert
and update. All writes for a facility take a per-facility advisory lock, so
sequence values become visible in order, and each pull reads all tables from
one REPEATABLE READ snapshot, so a pull can never skip a row that commits late.
`apps/server/test/sync.test.ts` tests that race.

When a device sends an edit that loses last-write-wins, the server touches its
newer copy so it moves past every cursor and the device pulls it back. Edit
times from the future are capped at server time + 5 minutes, and a device
always stamps an edit later than the version it edited.

Device clocks are corrected with the offset the server reports on every
response.

## Security

| Threat | Protection |
|---|---|
| Stolen tablet | Patient identity fields are encrypted in IndexedDB (AES-256-GCM). The key exists in memory only while someone is logged in; the app locks after 5 minutes of inactivity. |
| Guessing a PIN on a stolen tablet | PINs are 6–8 digits. Offline: the key is wrapped with a PBKDF2 key from the PIN (310k iterations), 5 tries then 15 min lockout, and offline unlock stops working 30 days after the last online unlock or as soon as the PIN is changed. Online: the server counts attempts atomically, so parallel guesses cannot get past 5. |
| Using the device token from a stolen tablet | The token alone cannot sync: sync also needs a staff session, issued only after a correct PIN and stored encrypted under the data key. |
| Lost device | Administration → Devices → Remove. Its token and sessions stop working immediately. |
| Database leak | Device, session, setup-code and cabinet tokens are stored as SHA-256 hashes. PINs use scrypt. Device data keys are encrypted with `KEY_ENCRYPTION_KEY`, which is not in the database. |
| Staff member leaves | Deactivate in the dashboard. Their sessions end, and devices forget their key at next contact. |

Known limitations, worth fixing before scale:

- Vital-sign numbers and stock data are not encrypted on the device (only
  identity fields are). They are linked to random ids, not names.
- All staff on one device share one data key, so a determined attacker with
  the tablet and enough time could brute-force the weakest 6-digit PIN
  offline. Android full-disk encryption plus a device screen lock is the
  second layer; turn both on.
- The dashboard has a single shared admin password. For more than one
  facility, add per-supervisor accounts.
- The first unlock for each staff member on each device needs internet.

## How the field app is served

`npm run build` builds the field app into `apps/server/public/app`, so one
deployment serves the dashboard at `/` and the tablet app at `/app/`. A
service worker caches the app so it opens without a connection. The field app
can also be hosted elsewhere: the device API allows cross-origin calls.
