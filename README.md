# Swen

**Siy vital ak materyèl, menm san entènèt** — vitals and supplies, even offline.

Swen (*care* in Haitian Creole) is open software for clinics and hospital
wards in Haiti. It runs on low-cost Android tablets and phones and keeps
working through power cuts and lost connections.

- **MEWS vitals assessment** — nurses enter vital signs (or read them from
  standard Bluetooth devices); the early-warning score and what to do appear
  as they type; medium and high scores ask what action was taken.
- **Medical supply inventory** — scan a QR label, dispense or receive stock,
  first-expiry-first-out suggestions, low-stock and expiry alerts. Optional
  ESP32 door sensor for the supply cabinet.
- **Supervisor dashboard** — patients at risk, scores without an action,
  overdue checks, stock alerts, devices, staff, and the score rules.
- **Kreyòl first**, with French and English.

> Swen is decision support, not a medical device. Read
> [docs/CLINICAL_SAFETY.md](docs/CLINICAL_SAFETY.md) before using it with patients.

## Repository

```
packages/core     shared: MEWS engine, plausibility checks, Bluetooth parsers,
                  stock ledger, sync contract, translations (ht / fr / en)
apps/server       Next.js 16 + Prisma 7 + PostgreSQL: device API + dashboard
apps/field        React PWA for tablets and phones (IndexedDB, offline-first)
hardware          vitals cart and supply cabinet: parts list, ESP32 firmware
docs              architecture, clinical safety, deployment
```

## Run it locally

Needs Node 20+, **npm 11+** (`npm i -g npm@11`; npm 10 has a bug with this
workspace) and PostgreSQL 16 (or a Neon database).

```bash
npm install
cp apps/server/.env.example apps/server/.env      # fill in DATABASE_URL and the secrets
npm run db:migrate --workspace @swen/server       # creates the tables
npm run db:seed --workspace @swen/server          # demo facility, staff, supplies, setup code
npm run build                                      # builds the tablet app into the server
npm run start --workspace @swen/server
```

- Dashboard: <http://localhost:3000> (password = `ADMIN_PASSWORD`)
- Tablet app: <http://localhost:3000/app/> — enter the setup code printed by
  the seed, then unlock as *Enfimyè Demo* with PIN **111111**.

For development with hot reload: `npm run dev:server` and `npm run dev:field`
(the tablet app is then at <http://localhost:5173/app/>).

New setup code from the command line: `npm run setup-code --workspace @swen/server`.

> The first migration (`apps/server/prisma/migrations/20261025000000_init`) was
> written by hand and tested against PostgreSQL 16, because Prisma's migration
> engine could not be downloaded where this was built. On your machine, the
> first `npm run db:migrate` should report the schema is in sync. If Prisma
> proposes a new migration right away, review it before applying.

## Tests

```bash
npm test --workspace @swen/core       # MEWS bands, Bluetooth parsing, stock, translations

# Server integration tests against a real Postgres with the migration applied:
TEST_DATABASE_URL=postgresql://... npm test --workspace @swen/server

# Two simulated tablets and a full UI walk-through against a running server:
SWEN_E2E_SERVER=http://localhost:3000 \
SWEN_E2E_CODES="$(npm run -s setup-code -w @swen/server),$(npm run -s setup-code -w @swen/server)" \
SWEN_E2E_UI_CODE="$(npm run -s setup-code -w @swen/server)" \
SWEN_E2E_PIN=111111 npm test --workspace @swen/field
```

## Documentation

- [Architecture, sync and security](docs/ARCHITECTURE.md)
- [Clinical safety and pilot checklist](docs/CLINICAL_SAFETY.md)
- [Deployment (Neon + Vercel, or a local clinic server)](docs/DEPLOY.md)
- [Hardware: parts, Bluetooth devices, cabinet sensor](hardware/README.md)

## License

MIT
