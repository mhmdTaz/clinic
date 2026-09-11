# Clinic Management Platform

Four portals — admin, staff, doctor, patient — behind one login.

**Current state: Phase 0 (Foundations).** Monorepo, tooling and a walking skeleton.
No real features yet. [`ARCHITECTURE.md`](./ARCHITECTURE.md) is the blueprint; the
phased plan is section 17.

## Running it locally

Prerequisites: Node 22+, pnpm 9, Docker.

```bash
pnpm install
cp .env.example .env          # defaults match the Docker stack
pnpm infra:up                 # mongo (replica set) + redis + minio + mailpit
pnpm db:migrate               # collections, indexes, $jsonSchema validators
pnpm db:seed                  # demo clinic, 4 roles, 4 users
pnpm dev                      # http://localhost:3000
```

Or in one step, from a clean clone: `pnpm setup && pnpm dev`.

| URL                              | What                                           |
| -------------------------------- | ---------------------------------------------- |
| http://localhost:3000            | Walking skeleton page                          |
| http://localhost:3000/api/health | Readiness JSON (503 when a dependency is down) |
| http://localhost:8025            | Mailpit — outgoing mail                        |
| http://localhost:9001            | MinIO console (`clinic` / `clinic-dev-secret`) |
| `mongodb://localhost:27018`      | MongoDB (**not** 27017 — see `docs/adr/0015`)  |

## Commands

| Command                                      | What it does                                                |
| -------------------------------------------- | ----------------------------------------------------------- |
| `pnpm verify`                                | Everything CI runs: lint, typecheck, boundaries, unit tests |
| `pnpm lint` / `pnpm typecheck` / `pnpm test` | Individually                                                |
| `pnpm graph`                                 | Architecture boundary check (dependency-cruiser)            |
| `pnpm db:verify`                             | Proves transactions **and** change streams work             |
| `pnpm test:integration`                      | Live database tests (needs `infra:up` + `db:migrate`)       |
| `pnpm infra:reset`                           | Destroy and recreate the stack, data included               |
| `pnpm format`                                | Prettier                                                    |

## Layout

```
apps/web          Next.js — UI, REST API, auth (the only app for now)
packages/core     ALL business logic. Zero framework imports.
packages/db       Mongoose models, plugins, migrations, seeds
packages/contracts Zod schemas shared by server, web and the future mobile app
packages/ui       Design tokens and primitives
packages/config   Env schema — the only place that reads process.env
packages/events   Domain event names and payload schemas
packages/testing  Factories and test helpers
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
- **Only `@clinic/config` reads `process.env`.** Lint enforces it.
- **Bulk writes bypass audit middleware.** `updateMany` / `bulkWrite` / `insertMany`
  are confined to repositories and must record an explicit audit entry.
- **There is one `.env`, at the repository root** — not per package.

## Seeded users

`admin@` / `staff@` / `doctor@` / `patient@` `clinic.local`, all status `INVITED` with
no password: authentication arrives in Phase 1.
