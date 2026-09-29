# Clinic Management Platform

Four portals — admin, staff, doctor, patient — behind one login.

**Current state: Phase 10 of section 17 is merged** (the dental chart, treatment plans and lab
tracking of Phases 11–13 are on their own branches). What works, end to end, in the web portals
and — for patients and doctors — over the REST API the mobile app uses:

| Area                  | What is there                                                                                                                      |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Identity and access   | Sign-in, sessions and devices, invitations, password reset, lockout; roles and permissions editable with no deploy; four portals   |
| Clinic setup          | Profile, locations, opening hours, closures, booking window; users; the patient directory with duplicate warnings; doctors         |
| Scheduling            | Staff and patient booking, walk-ins, rescheduling and cancelling with the clinic's cutoff, check-in to completion, reminders       |
| Clinical record       | Visits with a SOAP note, vitals and ICD-10 diagnoses; signing, addenda, sharing with the patient; prescriptions (PDF); attachments |
| Billing and stock     | Bills, partial payments, refunds, reconciliation; inventory intake, consumption during a visit, write-offs                         |
| Support and oversight | Support tickets, notifications, analytics, the audit explorer with its tamper-evident chain                                        |
| API                   | Every portal capability as REST under `/api/v1`, described by an OpenAPI document that a test checks against every route           |

Each portal's home page leads with that role's next step: the front desk sees today's queue, a
doctor their day and the notes still to sign, a patient their next appointment and anything
owed. [`ARCHITECTURE.md`](./ARCHITECTURE.md) is the blueprint; the phased plan is section 17.

**Clinical notes are saved explicitly and never autosaved** (ADR-0024). While the note, vitals or
diagnoses hold anything unsaved, the visit cannot be signed — the signing dialog says which part
and takes you there — and leaving the page asks _Save and leave_, _Discard and leave_ or _Stay_.
Reloading or closing the tab gets the browser's own warning. A signature names the revision the
doctor was shown; if anything was saved since (another tab, the phone), the server refuses it
with `NOTE_CHANGED` rather than sign content nobody reviewed.

**Not yet shown to be ready:** native iOS/Android behaviour on a device, a Hermes release build of
the app (see ADR-0035), load at a real clinic's volume, a full accessibility audit (screen
readers, 200% zoom, every flow by keyboard), and the Arabic interface, which is incomplete and
hidden from the language choice. Passing API tests is not evidence for any of these.

## Running it locally

Prerequisites: Node 22+, pnpm 9, Docker.

```bash
pnpm install
cp .env.example .env          # defaults match the Docker stack
pnpm infra:up                 # mongo (replica set) + redis + minio + mailpit
pnpm db:migrate               # collections, indexes, $jsonSchema validators
pnpm db:seed                  # demo clinic, roles, users, specialties, a doctor, 4 patients
pnpm dev                      # http://localhost:3000
```

Or in one step, from a clean clone: `pnpm setup && pnpm dev`.

`pnpm infra:up` checks first that nothing outside this stack holds the ports it publishes, and
names what does — it never stops anything. It then requires both one-shot initialisers (the
replica set, the storage bucket) to have **succeeded**, and waits for every service to be
healthy; MongoDB counts as healthy only once `rs.status()` answers. Running it again is safe.

**If port 27018 is taken** (another project's MongoDB, say), move this one: in `.env` set
`MONGO_PORT` to a free port and change the port in **both** `MONGODB_URI` and
`MONGODB_AUDIT_URI` to match — the app reads the first, the audit writer the second, and
`infra:up` warns if either disagrees with `MONGO_PORT`. On an existing volume the replica set is
re-pointed at the new port; the data is untouched.

The background worker runs separately, in a second terminal:

```bash
pnpm worker                   # the outbox relay, the backstop sweep and appointment reminders
```

Nothing in the app _needs_ it to serve a request — every screen works without it. What stops
without it is delivery: confirmations, reminders and ticket notifications queue up in
`outboxEvents` and go out whenever a worker next runs, which is the point of an outbox
(section 13.4).

Open **http://localhost:3000** — not `127.0.0.1`. Sign-in requests from any origin other than
`APP_URL` are refused as cross-site.

| URL                              | What                                                        |
| -------------------------------- | ----------------------------------------------------------- |
| http://localhost:3000            | Sign in                                                     |
| http://localhost:3000/api/health | Readiness JSON (503 only when MongoDB is down)              |
| http://localhost:8025            | Mailpit — every email the app sends, including reset links  |
| http://localhost:9001            | MinIO console (`clinic` / `clinic-dev-secret`)              |
| `mongodb://localhost:27018`      | MongoDB (**not** 27017 — see `docs/adr/0015`; `MONGO_PORT`) |

## Seeded users

All use the demo password **`Clinic-Demo-2026!`** (set `SEED_PASSWORD` to change it; the seed
refuses the default when `NODE_ENV=production`).

| Email                  | Lands on   | Notes                                                 |
| ---------------------- | ---------- | ----------------------------------------------------- |
| `admin@clinic.local`   | `/admin`   | Can also switch to the staff portal                   |
| `staff@clinic.local`   | `/staff`   |                                                       |
| `doctor@clinic.local`  | `/doctor`  |                                                       |
| `patient@clinic.local` | `/patient` | Linked to the patient record for Sara Karam           |
| `nurse@clinic.local`   | —          | Signs in with no role: give it one in Admin → Users   |
| `invited@clinic.local` | —          | Not activated yet: the activation email is in Mailpit |

To see a role change reach someone with no deploy: sign in as `nurse@` in one browser, then as
`admin@` in another create a role in Roles & permissions, give it `Open the staff portal` and
`View patient records`, and assign it to Hana Aoun. Her next page load opens the staff portal.

## Commands

| Command                                      | What it does                                                                                                                          |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm verify`                                | Lint, typecheck, boundaries and unit tests — what CI's first job runs                                                                 |
| `pnpm lint` / `pnpm typecheck` / `pnpm test` | Individually                                                                                                                          |
| `pnpm graph`                                 | Architecture boundary check (dependency-cruiser)                                                                                      |
| `pnpm db:verify`                             | Proves transactions **and** change streams work                                                                                       |
| `pnpm test:integration`                      | Live tests against MongoDB, Redis and Mailpit (needs `infra:up`)                                                                      |
| `pnpm test:e2e`                              | Browser journeys **and** the mobile API parity suite (needs `infra:up`, `pnpm build`, and once: `pnpm --filter @clinic/e2e browsers`) |
| `pnpm --filter @clinic/mobile start`         | The Expo app. Needs `CLINIC_API_URL` set, and a device or simulator                                                                   |
| `pnpm --filter @clinic/mobile preview:web`   | The same app in a browser at http://localhost:8090, against the API on :3000 — no simulator needed, nothing native available          |
| `pnpm infra:reset`                           | Destroy and recreate the stack, data included                                                                                         |
| `pnpm audit`                                 | The **production** dependency tree, which is what ships, against high and critical advisories                                         |
| `pnpm db:backup`                             | One gzipped `mongodump --oplog` archive plus a manifest of counts, schema version and checksum                                        |
| `pnpm db:restore --from <dir> --verify`      | Restores into a scratch database and checks it — including by recomputing the audit hash chain                                        |
| `pnpm format`                                | Prettier                                                                                                                              |

Live and end-to-end tests use databases of their own (`clinic_test_*`, `clinic_e2e`), dropped
and re-migrated on every run. They never touch the development database. The e2e server runs on
port 3100, so it cannot collide with `pnpm dev`.

`tests/e2e/specs/mobile-api-parity.spec.ts` drives the patient and doctor portals through
`@clinic/api-client` over HTTP with a Bearer token and no cookie — no browser involved. It is the
check that the mobile app needs no backend of its own (ARCHITECTURE §9.1), and it will fail the
moment a capability exists only as a Server Action.

`db:backup` and `db:restore` find `mongodump`/`mongorestore` on `PATH`, or fall back to running
them inside the `clinic-mongo` container — so neither needs the MongoDB Database Tools installed
locally. **Restore defaults to a scratch database** (`<name>_restore`) and refuses to write over
the live one without an explicit flag. The drill and the real recovery are different procedures;
[`docs/runbooks/backup-and-restore.md`](docs/runbooks/backup-and-restore.md) walks through both.

## Layout

```
apps/web           Next.js — pages, REST API, cookies and redirects
apps/mobile        Expo — the patient and doctor portals on a phone (apps/mobile/README.md)
packages/core      ALL business logic. Zero framework imports.
  modules/identity   credentials, lockout, sessions, resets, invitations, accounts
  modules/access     permission catalogue, policy engine, roles editor, portals, navigation
  modules/session    turns a verified user into a signed-in session
  modules/clinic     profile, locations, opening hours, closures, booking window
  modules/users      user management: invites, roles, suspension, forced resets
  modules/patients   the patient directory, registration, duplicate warnings
  modules/doctors    doctor onboarding and the specialty vocabulary
  modules/scheduling calendar arithmetic, slots, the reservation grid (pure)
  modules/appointments booking, walk-ins, the appointment lifecycle
  modules/clinical   visits, notes, vitals, diagnoses, signing
  modules/prescriptions, files   prescriptions and their PDFs; attachments in object storage
  modules/billing    bills, payments, refunds, reconciliation
  modules/inventory  stock, consumption, write-offs
  modules/support, notifications   tickets; in-app, email and push delivery
  modules/analytics, audit, audit-explorer   reporting; the audit recorder and its chain
  modules/outbox, idempotency   reliable delivery; retried requests answered once
packages/db        Mongoose models, plugins, migrations
packages/contracts Zod schemas shared by server, web and the mobile app
packages/api-client The typed client both apps use: cookies for the browser, Bearer for a phone
packages/ui        Design tokens and primitives
packages/config    Env schema — the only place that reads process.env
packages/events    Domain event names and payload schemas
tests/e2e          Playwright journeys
```

Dependencies point inward only, and it is enforced: `pnpm graph` fails the build on a
cycle, a framework import inside `packages/core`, a deep cross-module import, or an
app reaching past a use case to the database.

## Things that will bite you

- **MongoDB must be a replica set.** Transactions and change streams do not exist
  without one. `pnpm db:verify` tells you in one second.
- **Every tenant-scoped query needs `clinicId`.** A query without it throws — that is
  the tenant guard, not a bug. Opt out explicitly with
  `.setOptions({ bypassTenantGuard: true })` and say why.
- **Every write to an audited model needs the audit sink installed first.** The web server
  does this at startup; a script or test that forgets gets `AuditSinkNotConfiguredError`
  rather than a silently unaudited write.
- **State that one part of the server sets and another reads goes through `processSingleton`.**
  Next.js can load a separate copy of a workspace package per bundle, so a plain module-level
  variable set at startup in `instrumentation.ts` is invisible to the route that reads it. The
  audit sink, request context, scope resolvers and shared connections already do this.
- **Only `@clinic/config` reads `process.env`.** Lint enforces it.
- **Bulk writes bypass audit middleware.** `updateMany` / `bulkWrite` / `insertMany`
  are confined to repositories and must record an explicit audit entry.
- **Write together through `runInTransaction`.** Captured audit entries wait for the commit, so a
  rollback leaves none. Record explicit audit entries after the transaction returns, not inside it.
- **Never write `search.*` fields.** The `searchKeys` plugin derives them from names, phones and
  emails on every write; search and duplicate matching query them.
- **Calendar dates are strings.** A date of birth or a holiday is `"YYYY-MM-DD"`, and "today" is
  computed in the clinic's timezone (`localDateIn`). A `Date` at midnight UTC is the wrong day in
  half the world.
- **`TRUST_PROXY` stays `false` unless a proxy you control sets the client address.** With it
  off, forwarded-for headers are ignored and per-IP rate limits are skipped rather than trusting
  a value any client can forge.
- **There is one `.env`, at the repository root** — not per package.
