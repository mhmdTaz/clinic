# Clinic Management Platform

Four portals — admin, staff, doctor, patient — behind one login.

**Current state: Phase 2 (Clinic setup and directories).** On top of Phase 1's sign-in,
permission engine and portal shells: clinic settings (profile, locations, opening hours,
closures), user management, a roles and permissions editor that changes access with no deploy,
the patient directory with duplicate warnings, and doctor onboarding with specialties.
[`ARCHITECTURE.md`](./ARCHITECTURE.md) is the blueprint; the phased plan is section 17.

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

Open **http://localhost:3000** — not `127.0.0.1`. Sign-in requests from any origin other than
`APP_URL` are refused as cross-site.

| URL                              | What                                                       |
| -------------------------------- | ---------------------------------------------------------- |
| http://localhost:3000            | Sign in                                                    |
| http://localhost:3000/api/health | Readiness JSON (503 only when MongoDB is down)             |
| http://localhost:8025            | Mailpit — every email the app sends, including reset links |
| http://localhost:9001            | MinIO console (`clinic` / `clinic-dev-secret`)             |
| `mongodb://localhost:27018`      | MongoDB (**not** 27017 — see `docs/adr/0015`)              |

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

| Command                                      | What it does                                                                                      |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `pnpm verify`                                | Lint, typecheck, boundaries and unit tests — what CI's first job runs                             |
| `pnpm lint` / `pnpm typecheck` / `pnpm test` | Individually                                                                                      |
| `pnpm graph`                                 | Architecture boundary check (dependency-cruiser)                                                  |
| `pnpm db:verify`                             | Proves transactions **and** change streams work                                                   |
| `pnpm test:integration`                      | Live tests against MongoDB, Redis and Mailpit (needs `infra:up`)                                  |
| `pnpm test:e2e`                              | Browser journeys (needs `infra:up`, `pnpm build`, and once: `pnpm --filter @clinic/e2e browsers`) |
| `pnpm infra:reset`                           | Destroy and recreate the stack, data included                                                     |
| `pnpm format`                                | Prettier                                                                                          |

Live and end-to-end tests use databases of their own (`clinic_test_*`, `clinic_e2e`), dropped
and re-migrated on every run. They never touch the development database. The e2e server runs on
port 3100, so it cannot collide with `pnpm dev`.

## Layout

```
apps/web           Next.js — pages, REST API, cookies and redirects
packages/core      ALL business logic. Zero framework imports.
  modules/identity   credentials, lockout, sessions, resets, invitations, accounts
  modules/access     permission catalogue, policy engine, roles editor, portals, navigation
  modules/session    turns a verified user into a signed-in session
  modules/clinic     profile, locations, opening hours, closures
  modules/users      user management: invites, roles, suspension, forced resets
  modules/patients   the patient directory, registration, duplicate warnings
  modules/doctors    doctor onboarding and the specialty vocabulary
  modules/audit      audit recorder and capture
packages/db        Mongoose models, plugins, migrations
packages/contracts Zod schemas shared by server, web and the future mobile app
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
