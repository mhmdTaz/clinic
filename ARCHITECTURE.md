# Clinic Management Platform — Architecture & Scaffold (v1)

> **Status:** Proposed · **Version:** 1.0 · **Date:** 2026-09-11 · **Owner:** @mhmdTaz
>
> This document is the blueprint for the platform. It defines the folder structure, module
> boundaries, permission model, data model, API surface, auth flow, audit strategy, file
> storage, and the phased delivery plan for v1. **No application code exists yet** — this
> document is what the code will be built against.
>
> **v1.1 (2026-09-11):** the datastore changed from PostgreSQL/Prisma to **MongoDB/Mongoose**.
> Section 8 was rewritten around document design; sections 2, 3, 5, 6, 7, 11, 13, 15, 16, 17 and
> 19 were revised where the storage model genuinely changes the answer rather than the wording.
> Sections 9, 10, 12 and 14 are untouched, which is the layering in sections 5 and 6 paying for
> itself: the API contract, the auth flow, file storage and the frontend never knew what the
> database was.
>
> Priority order for every trade-off in this document: **scalable → readable → dynamic → decoupled.**

---

## Table of contents

1. [Product scope](#1-product-scope)
2. [Architectural principles](#2-architectural-principles)
3. [Technology stack](#3-technology-stack)
4. [Repository layout](#4-repository-layout)
5. [Module boundaries and decoupling](#5-module-boundaries-and-decoupling)
6. [Layering inside a module](#6-layering-inside-a-module)
7. [RBAC and the permission model](#7-rbac-and-the-permission-model)
8. [Data model (MongoDB document design)](#8-data-model-mongodb-document-design)
9. [API surface and mobile reuse](#9-api-surface-and-mobile-reuse)
10. [Auth and portal routing flow](#10-auth-and-portal-routing-flow)
11. [Audit logging](#11-audit-logging)
12. [File storage](#12-file-storage)
13. [Cross-cutting concerns](#13-cross-cutting-concerns)
14. [Frontend architecture](#14-frontend-architecture)
15. [Scalability plan](#15-scalability-plan)
16. [Security and compliance posture](#16-security-and-compliance-posture)
17. [Phased v1 delivery plan](#17-phased-v1-delivery-plan)
18. [Conventions](#18-conventions)
19. [Open decisions (ADR log)](#19-open-decisions-adr-log)
20. [Glossary](#20-glossary)

---

## 1. Product scope

A single web application serving **four portals** behind one login. The portal a user lands on
is derived from their role — there are no separate login pages and no separate URLs to remember.

```
                        ┌──────────────────┐
                        │   /login (one)   │
                        └────────┬─────────┘
                                 │  session + permissions resolved
                 ┌───────────────┼───────────────┬───────────────┐
                 ▼               ▼               ▼               ▼
          ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐
          │  /admin    │  │  /staff    │  │  /doctor   │  │ /patient   │
          │  portal    │  │  portal    │  │  portal    │  │  portal    │
          └────────────┘  └────────────┘  └────────────┘  └────────────┘
```

Web first, responsive down to mobile viewports. A React Native app follows in a later phase and
**reuses the same HTTP API** — section 9 explains how that is guaranteed rather than hoped for.

### 1.1 Feature matrix by portal

Legend: ✅ v1 · 🔸 v1 stretch · ⏭️ deliberately deferred to v1.1+

#### Patient portal

| # | Feature | Notes | v1 |
|---|---------|-------|----|
| P1 | **Dashboard** | Next appointment with countdown, outstanding balance, unread support replies, action items ("2 forms to sign") | ✅ |
| P2 | **My profile** | Demographics, contact, address, emergency contacts, insurance details, photo | ✅ |
| P3 | **Upcoming appointments** | Date, doctor, service, location, status; add-to-calendar (.ics) | ✅ |
| P4 | **Appointment history** | Past visits with diagnosis summary, notes shared by the doctor, attached files | ✅ |
| P5 | **Self-service booking** | Pick service, then doctor, then an available slot; reschedule/cancel within a configurable cutoff | ✅ |
| P6 | **Document vault** | All PDFs and images (lab results, scans, prescriptions, receipts) with preview and download | ✅ |
| P7 | **Prescriptions** | Active and past medications, dosage, printable PDF, refill request | ✅ |
| P8 | **Invoices and payments** | Statement of account, receipts, payment history | ✅ |
| P9 | **Support / contact clinic** | Threaded tickets with attachments, category, status tracking | ✅ |
| P10 | **Medical timeline** | One chronological stream: visits, diagnoses, prescriptions, labs, uploads | ✅ |
| P11 | **Notification preferences** | Email/SMS/push toggles per event type, reminder lead time | ✅ |
| P12 | **Pre-visit intake forms** | Dynamic questionnaire assigned per service, completed before arrival | 🔸 |
| P13 | **Consent forms with e-signature** | Draw or type a signature, stored as an immutable signed PDF | 🔸 |
| P14 | **Post-visit feedback** | 1-5 rating plus comment, feeds the admin analytics dashboard | 🔸 |
| P15 | **Dependants / family accounts** | A guardian manages a child's or parent's record from one login | ⏭️ |
| P16 | **Online card payment** | Checkout via a payment provider | ⏭️ |

#### Staff portal

| # | Feature | Notes | v1 |
|---|---------|-------|----|
| S1 | **Front-desk day view** | Calendar with one column per doctor, drag to reschedule, colour-coded status | ✅ |
| S2 | **Patient registration** | Full CRUD with **duplicate detection** on phone / national ID / email before insert | ✅ |
| S3 | **Doctor onboarding** | CRUD for doctors: specialties, licence number, consultation fee, bio, photo | ✅ |
| S4 | **Doctor schedules** | Weekly availability templates, slot duration, breaks, time-off and holiday blocking | ✅ |
| S5 | **Appointments CRUD** | Book, reschedule, cancel, check-in, check-out, mark no-show | ✅ |
| S6 | **Walk-in queue** | Unscheduled arrivals held in a live queue and assigned to the next free doctor | ✅ |
| S7 | **Invoicing** | Generate an invoice from services rendered plus consumed inventory; discounts and tax | ✅ |
| S8 | **Record payments** | Cash / card / transfer / insurance, partial payments, refunds, receipt PDF | ✅ |
| S9 | **Daily reconciliation** | End-of-day cash report: expected vs counted, broken down per method | ✅ |
| S10 | **Inventory CRUD** | Items, categories, units, reorder level, supplier, cost and sale price | ✅ |
| S11 | **Stock movements** | Stock-in, stock-out (consumption or waste), adjustments — a full ledger, never a mutable counter | ✅ |
| S12 | **Batch and expiry tracking** | Lot numbers with expiry dates; expiring-soon and low-stock alert widgets | ✅ |
| S13 | **Support inbox** | Tickets from patients *and* doctors; assign, prioritise, reply, resolve | ✅ |
| S14 | **Upload documents for a patient** | Scan a referral or lab sheet and attach it to the patient or a specific visit | ✅ |
| S15 | **Operational reports** | Revenue by day/doctor/service, appointment volume, no-show rate, top items | ✅ |
| S16 | **Suppliers and purchase orders** | Supplier directory, raise a PO, receive against it into stock | 🔸 |
| S17 | **Waitlist and auto-fill** | When a slot frees up, offer it to the waitlisted patient first | 🔸 |
| S18 | **Bulk reschedule** | A doctor calls in sick: move and notify their whole day in one action | 🔸 |
| S19 | **Broadcast announcements** | Clinic-wide notice to patients or to internal staff | 🔸 |
| S20 | **Insurance claim submission** | Claim lifecycle against a payer | ⏭️ |

#### Doctor portal

| # | Feature | Notes | v1 |
|---|---------|-------|----|
| D1 | **My day** | Today's list, current patient, next patient, running-late indicator | ✅ |
| D2 | **Profile self-service** | Edit bio, specialties, photo, consultation fee (fee can be admin-locked) | ✅ |
| D3 | **My patients** | Every patient this doctor has treated, searchable | ✅ |
| D4 | **Patient chart** | Allergy banner, chronic conditions, vitals trend, full encounter history | ✅ |
| D5 | **Upcoming and past appointments** | With full detail and a link into each encounter | ✅ |
| D6 | **Encounter workspace** | SOAP note (Subjective / Objective / Assessment / Plan), vitals, attachments | ✅ |
| D7 | **Diagnosis coding** | ICD-10 picker with search; multiple diagnoses per encounter with a primary flag | ✅ |
| D8 | **Prescription builder** | Drug, dose, frequency, duration, instructions; generates a printable PDF | ✅ |
| D9 | **Note sign and lock** | Signing freezes the note; later changes become append-only **addenda** | ✅ |
| D10 | **Availability self-service** | Manage own weekly schedule and request time off | ✅ |
| D11 | **Follow-up booking** | Book the next visit from inside the encounter, without leaving the chart | ✅ |
| D12 | **Internal messaging** | Threads with staff, and with patients if the clinic enables it | ✅ |
| D13 | **Note templates and quick phrases** | Reusable per-doctor templates for common presentations | 🔸 |
| D14 | **Lab orders and results** | Order a panel, receive or attach the result, mark reviewed | 🔸 |
| D15 | **Internal referral** | Refer a patient to another doctor in the clinic with a reason | 🔸 |
| D16 | **My stats** | Patients seen, average consult duration, follow-up rate | 🔸 |
| D17 | **E-prescription transmission** | Send directly to a pharmacy network | ⏭️ |

#### Admin portal

Admin sees **everything the other three portals expose**, plus the control plane:

| # | Feature | Notes | v1 |
|---|---------|-------|----|
| A1 | **Clinic details** | Name, logo, legal entity, tax id, address, phone, working hours, holidays | ✅ |
| A2 | **Branches / locations** | Multiple physical locations; appointments and stock are per-location | ✅ |
| A3 | **User management** | Create, invite, deactivate any user; assign roles; force password reset | ✅ |
| A4 | **Roles and permissions editor** | Create custom roles and toggle a permission matrix — **no deploy required** | ✅ |
| A5 | **Audit log explorer** | Filter by actor, entity, action, date; before/after diff viewer; CSV export | ✅ |
| A6 | **Services and price list** | Catalogue of billable services with durations, prices, tax class | ✅ |
| A7 | **Billing settings** | Currency, tax rates, invoice numbering, receipt footer | ✅ |
| A8 | **Analytics dashboard** | Revenue, appointments, utilisation per doctor, new vs returning patients | ✅ |
| A9 | **Notification templates** | Edit email/SMS bodies per event with variable placeholders | 🔸 |
| A10 | **Feature flags** | Turn modules on or off per clinic (inventory off for a small practice) | 🔸 |
| A11 | **Impersonation** | "View as" another user for support — heavily audited, banner always visible | 🔸 |
| A12 | **Data export / backup status** | Export a patient's full record (GDPR portability), verify backup health | 🔸 |

---

## 2. Architectural principles

These are the rules every PR is reviewed against, ordered by the project's stated priority:
**scalable, readable, dynamic, decoupled.**

### 2.1 Scalable

| Rule | Why |
|------|-----|
| **The app server is stateless.** No in-memory sessions, no local file writes, no in-process schedulers. | Any number of instances can run behind a load balancer, and a node can die at any moment. |
| **Every list endpoint is paginated from day one.** No endpoint ever returns an unbounded collection. | The first clinic has 200 patients; the tenth has 200,000. Retrofitting pagination touches every caller. |
| **Every document carries `clinicId`** (except global lookups), it leads almost every compound index, and a plugin refuses any tenant-scoped query that omits it. | Multi-clinic and multi-branch are schema decisions, not features. It is also the shard-key prefix, so scaling out later needs no re-indexing (section 8.16). |
| **Indexes are designed with the query, in the same PR, in Equality-Sort-Range order.** | An index whose keys are ordered wrongly silently degrades to a scan on the sort or range portion — the most common MongoDB performance bug (section 8.14). |
| **Slow work goes to a queue,** never inside the request: PDF generation, email, SMS, image processing, exports. | Keeps p99 latency flat and lets workers scale independently of web. |
| **Writes emit domain events** through a transactional outbox. | New consumers (notifications, analytics, webhooks) are added without touching the writer. |
| **The audit log is append-only, self-expiring and sharding-ready.** | It will become the largest collection in the system by an order of magnitude (sections 8.13, 8.16). |

### 2.2 Readable

| Rule | Why |
|------|-----|
| **Feature-first folders, not type-first.** `modules/appointments/*`, not a `controllers/` + `services/` + `models/` split across the tree. | Everything about one feature lives in one folder; onboarding means reading one directory. |
| **One concept, one name, everywhere.** `Encounter` is never also `Visit` or `Consultation` — see the [glossary](#20-glossary). | Naming drift is the leading cause of duplicated logic. |
| **Functions read top-down:** orchestration first, detail below; guard clauses instead of nesting. | |
| **Types are derived, never duplicated.** Zod schema → `z.infer` → TS type → OpenAPI. One source of truth. | A hand-written interface next to a schema will drift within a month. |
| **No abbreviations in public names.** `appointmentStatusHistory`, not `apptStatHist`. | |

### 2.3 Dynamic

| Rule | Why |
|------|-----|
| **Permissions are rows, not `if` statements.** | An admin can invent a "Senior Nurse" role at 3pm without a deploy. |
| **Navigation is generated from the user's permissions.** | The sidebar is never a hardcoded list per portal, so a new role gets a correct menu for free. |
| **Reference data is data:** services, specialties, appointment types, ticket categories, payment methods, units of measure. | The clinic configures its own vocabulary. |
| **Forms and tables are schema-driven.** One `<DataTable columns={...}>` and one `<AutoForm schema={...}>` serve the whole app. | Thirty CRUD screens with thirty bespoke forms is thirty places for the same bug. |
| **Feature flags gate modules per clinic.** | One codebase serves a solo dentist and a forty-doctor polyclinic. |

### 2.4 Decoupled

| Rule | Why |
|------|-----|
| **Business logic never imports from `next/*`.** No `NextRequest`, `cookies()`, or `redirect()` below the interface layer. | This is what makes the mobile API and background jobs possible. It is the single most important rule in this document. |
| **Modules talk through public entry points** (`modules/x/index.ts`), never by reaching into each other's internals. | Enforced by lint (section 5.3), not by good intentions. |
| **Cross-module reactions go through events, not direct calls.** Billing does not call notifications; it emits `invoice.issued`. | Adding a new reaction never edits the emitter. |
| **Infrastructure sits behind interfaces:** `StorageProvider`, `NotificationChannel`, `PaymentGateway`. | Swap MinIO for S3 for Azure Blob by writing one adapter; tests use in-memory fakes. |
| **The database is reached only through repositories** owned by the module. A Mongoose model is never imported outside `infrastructure/`, and a Mongoose document never escapes a repository — it is mapped to a plain domain object first. | Lint-enforced. It is also what keeps the weaker typing of Mongoose (section 8.1) contained in one layer instead of leaking through the codebase. |

---

## 3. Technology stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Language | **TypeScript** (strict, `noUncheckedIndexedAccess`) | One language across web, API, jobs, and the future React Native app; types cross the wire through shared contracts. |
| Web framework | **Next.js (App Router)** | Server Components keep PHI-heavy pages off the client, Route Handlers give us the REST API in the same deployment, and one codebase hosts both the UI and the mobile API. |
| UI | **Tailwind CSS + shadcn/ui** (Radix primitives) | shadcn is *copied in*, not depended on, so we own and restyle the components. Radix supplies accessibility (keyboard nav, focus traps, ARIA) that a clinical tool genuinely needs. |
| Data | **MongoDB 7 + Mongoose** | A visit, a chart and an invoice are each naturally one document, and the model in section 8 embeds accordingly — the allergy banner and the calendar render with no joins at all. Mongoose is chosen over Prisma's MongoDB connector because that connector has no migration history and no aggregation pipeline; the full reasoning is in section 8.1. **Must run as a replica set** — transactions and change streams both require one, in development as well as production. |
| Data migrations | **migrate-mongo** | MongoDB has no schema migrations of its own. Ordered, numbered, reversible scripts in the repo, applied by CI — the role `prisma migrate deploy` would have played (section 8.15). |
| Auth | **Own token service on `jose` + argon2id** (the `identity` and `session` modules of `@clinic/core`) | Short-lived HS256 access tokens, rotating refresh tokens with theft detection, and one verification path for the web cookie and the mobile Bearer header (section 9.1). Auth.js was named here originally and replaced in Phase 1: its credentials flow has no refresh-token rotation, its session token is not usable as a mobile Bearer token, and it would have put authentication inside the framework layer section 2.4 keeps business logic out of. OIDC/SSO arrives as another sign-in method on the same session service. See `docs/adr/0017`. |
| Validation | **Zod** | Single source of truth for API contracts, form validation, and generated OpenAPI. |
| Server state | **TanStack Query** | Cache, invalidation, optimistic updates. The same hooks package is reused by React Native. |
| Files | **S3-compatible** (MinIO in dev, S3 or R2 in prod) | Presigned uploads keep large files off the app server entirely. |
| Cache / queue | **Redis + BullMQ** | Permission cache, rate limiting, and the background job queue. |
| Email / SMS | Providers behind a `NotificationChannel` interface | Resend/SES and Twilio are adapters, not architecture. |
| Testing | **Vitest** (unit) · **Playwright** (E2E) · **Testcontainers** (integration against a real MongoDB **replica set**, so transactional paths are actually exercised) | |
| Monorepo | **pnpm workspaces + Turborepo** | Content-hashed task caching; `packages/core` is consumed by web today and by React Native later. |
| Observability | **Pino** logs · **OpenTelemetry** traces · **Sentry** errors | Structured logs carry a `requestId` that also appears on every audit entry. |
| Containers | Docker Compose (dev) · Dockerfile (prod) | `docker compose up` gives MongoDB (single-node replica set, auto-initiated), Redis, MinIO and Mailpit in one command. |

---

## 4. Repository layout

A **pnpm + Turborepo monorepo** running a **modular monolith**. One deployable web app today,
with module boundaries drawn so that any module can be lifted into its own service later
without rewriting its callers.

> Why not microservices in v1? A four-portal clinic app has one transactional boundary
> (appointment → encounter → invoice → stock movement). Splitting that across services in v1 buys
> distributed-transaction pain and buys nothing. The monolith is *modular*, which is what makes
> extraction cheap on the day it is actually needed. See section 15.

```
clinic/
├─ apps/
│  ├─ web/                          # Next.js App Router — UI + REST API + auth
│  │  ├─ src/
│  │  │  ├─ app/
│  │  │  │  ├─ (auth)/              # public: login, forgot/reset password, invite accept
│  │  │  │  ├─ (portals)/
│  │  │  │  │  ├─ layout.tsx        # shared shell: sidebar, topbar, breadcrumbs
│  │  │  │  │  ├─ admin/            # requires portal.admin:access
│  │  │  │  │  ├─ staff/            # requires portal.staff:access
│  │  │  │  │  ├─ doctor/           # requires portal.doctor:access
│  │  │  │  │  └─ patient/          # requires portal.patient:access
│  │  │  │  ├─ api/
│  │  │  │  │  ├─ v1/               # versioned REST — the contract the mobile app uses
│  │  │  │  │  │  ├─ appointments/
│  │  │  │  │  │  ├─ patients/
│  │  │  │  │  │  ├─ doctors/
│  │  │  │  │  │  ├─ encounters/
│  │  │  │  │  │  ├─ files/
│  │  │  │  │  │  ├─ billing/
│  │  │  │  │  │  ├─ inventory/
│  │  │  │  │  │  ├─ support/
│  │  │  │  │  │  ├─ admin/         # clinic, users, roles, permissions, audit
│  │  │  │  │  │  └─ me/            # session-scoped: profile, permissions, notifications
│  │  │  │  │  ├─ auth/[...nextauth]/
│  │  │  │  │  ├─ openapi/          # serves the generated OpenAPI document
│  │  │  │  │  └─ health/           # liveness + readiness for the load balancer
│  │  │  │  └─ layout.tsx
│  │  │  ├─ features/               # UI ONLY: components/hooks per feature, mirrors core modules
│  │  │  │  ├─ appointments/{components,hooks,schemas}/
│  │  │  │  ├─ patients/
│  │  │  │  └─ ...
│  │  │  ├─ components/             # app-level shared UI (nav, shells, empty/error states)
│  │  │  ├─ lib/                    # web-only glue: auth handlers, request context, api client
│  │  │  └─ middleware.ts           # session gate + portal routing (section 10)
│  │  └─ next.config.mjs
│  ├─ worker/                       # BullMQ consumers — separate process, separate scaling
│  └─ mobile/                       # (phase 9) Expo / React Native — consumes @clinic/api-client
│
├─ packages/
│  ├─ core/                         # ⭐ ALL business logic. Zero framework imports.
│  │  └─ src/modules/
│  │     ├─ identity/               # users, sessions, invitations, password policy
│  │     ├─ access/                 # roles, permissions, policy engine  (see section 7)
│  │     ├─ clinic/                 # clinic profile, branches, working hours, holidays, settings
│  │     ├─ patients/
│  │     ├─ doctors/                # profiles, specialties, availability, time off
│  │     ├─ scheduling/             # slot generation, availability, booking rules
│  │     ├─ appointments/           # lifecycle + status machine
│  │     ├─ encounters/             # clinical records, notes, diagnoses, prescriptions, vitals
│  │     ├─ files/                  # file metadata, presign orchestration, access checks
│  │     ├─ billing/                # invoices, payments, refunds, statements
│  │     ├─ inventory/              # items, batches, stock ledger, suppliers
│  │     ├─ support/                # tickets and messages
│  │     ├─ notifications/          # templates, dispatch, preferences
│  │     └─ audit/                  # recorder, query API, tamper-evident chain
│  ├─ contracts/                    # Zod request/response schemas + OpenAPI generation
│  ├─ api-client/                   # typed fetch client generated from contracts (web + mobile)
│  ├─ db/                           # Mongoose connection, models, plugins, migrations, seeds
│  │  ├─ models/                    #   one Mongoose schema per collection (section 8)
│  │  ├─ plugins/                   #   tenant-guard, soft-delete, audit-capture, timestamps
│  │  ├─ validators/                #   generated $jsonSchema collection validators
│  │  ├─ migrations/                #   migrate-mongo: ordered, reversible, committed
│  │  └─ counters.ts                #   atomic human-facing sequences (INV-…, MRN-…)
│  ├─ ui/                           # design system: primitives, DataTable, AutoForm, tokens
│  ├─ events/                       # domain event names, payload schemas, in-proc bus + outbox
│  ├─ config/                       # env parsing (zod), feature flags, constants
│  └─ testing/                      # factories, fixtures, in-memory fakes, test db helpers
│
├─ docs/
│  ├─ adr/                          # architecture decision records, one file per decision
│  └─ runbooks/                     # on-call: restore a backup, rotate a key, replay the outbox
├─ docker-compose.yml               # mongodb (replSet rs0) · redis · minio · mailpit
├─ turbo.json
└─ pnpm-workspace.yaml
```

### 4.1 Dependency direction

Dependencies point **inward only**. Nothing in `core` knows that a web app exists.

```
  apps/web ──┐
  apps/worker├──▶ packages/core ──▶ packages/db ──▶ MongoDB (replica set)
  apps/mobile┘         │
       │               ├──▶ packages/events
       │               └──▶ packages/config
       └──▶ packages/api-client ──▶ packages/contracts ──▶ (zod only)
       └──▶ packages/ui
```

A violation of this direction is a build error, not a code-review comment.

---

## 5. Module boundaries and decoupling

### 5.1 What a module owns

Every module in `packages/core/src/modules/<name>/` has the same internal shape:

```
appointments/
├─ index.ts            # ⭐ the ONLY file other modules may import from
├─ domain/
│  ├─ appointment.ts       # entity: invariants and pure behaviour, no I/O
│  ├─ status-machine.ts    # legal transitions (see 5.4)
│  └─ errors.ts            # AppointmentSlotTakenError, AppointmentTooLateToCancelError...
├─ application/
│  ├─ book-appointment.ts      # use case: orchestrates repos, policy, events
│  ├─ reschedule-appointment.ts
│  ├─ cancel-appointment.ts
│  └─ list-appointments.ts
├─ infrastructure/
│  └─ appointment.repository.ts   # the only place a Mongoose model is touched here
├─ policies/
│  └─ appointment.policy.ts       # can this actor do this to this row? (section 7.5)
└─ __tests__/
```

`index.ts` exports use cases, domain types, and the module's event names — **never** repositories,
never Mongoose documents or models, never anything from `infrastructure/`.

```ts
// packages/core/src/modules/appointments/index.ts
export { bookAppointment }       from './application/book-appointment'
export { cancelAppointment }     from './application/cancel-appointment'
export { listAppointments }      from './application/list-appointments'
export type { Appointment, AppointmentStatus } from './domain/appointment'
export { APPOINTMENT_EVENTS }    from './events'
// NOT exported: AppointmentRepository, the Mongoose model, internal helpers
```

### 5.2 The module dependency graph

Modules may only depend **downward**. Anything else is an event.

```
        support   notifications   audit          ← leaf consumers, depend on events only
            ▲            ▲          ▲
            └────────────┴──────────┘   (subscribe, never called directly)

  billing ──▶ inventory
     │            │
     └────────────┴──▶ encounters ──▶ appointments ──▶ scheduling ──▶ doctors
                                                                        │
                            patients ◀───────────────────────────────────┘
                                │
                          clinic ──▶ access ──▶ identity          ← foundation
                            ▲          ▲          ▲
                            └──────────┴──────────┴──── session    ← composes sign-in
```

| Allowed | Forbidden |
|---------|-----------|
| `appointments` imports `scheduling` to check slot availability | `scheduling` importing `appointments` (would be a cycle) |
| `billing` imports `inventory` to price consumed items | `inventory` importing `billing` — it emits `stock.consumed` instead |
| Anything imports `access` for permission checks | `access` importing any feature module |
| `notifications` subscribes to `appointment.booked` | `appointments` importing `notifications` directly |
| `session` imports `identity`, `access` and `clinic` to turn a verified user into a signed-in session | `identity` importing `access` — authentication sits beneath authorisation, which is why login lives in `session` and not in `identity` |
| Any module calls `recordAudit()` for an event that carries intent (section 11.4) | `audit` importing any feature module |

### 5.3 How boundaries are enforced

Three mechanisms, from cheapest to strongest:

1. **`@typescript-eslint/no-restricted-imports` zones** — fast in-editor feedback on the
   package-level rules: apps may not import `@clinic/db` or a driver, `packages/core` may not
   import a framework, contracts and UI stay free of both. Each zone carries its rationale in
   the error message.
2. **`dependency-cruiser`** in CI — the authoritative gate. Validates the graph in 5.2, forbids
   cycles, forbids `next/*` or `react` anywhere under `packages/core`, forbids deep cross-module
   imports, and fails on any import it cannot resolve (which is how a boundary gets crossed by
   accident: an import of a package the manifest does not declare).
3. **Package manifests** — `packages/core/package.json` does not list `next` or `react` as
   dependencies at all, so those imports cannot resolve even if lint is bypassed.

> `eslint-plugin-boundaries` was specified here originally and removed during Phase 0. Tested
> with a real violation, it did not fail: it matches element patterns against resolved file
> paths and cannot map a workspace specifier like `@clinic/db` onto `packages/db` without an
> import resolver, so every cross-package rule was silently passing. A rule that passes when it
> should fail is worse than no rule. See `docs/adr/0014`.
>
> **Every rule above is verified by introducing a deliberate violation and confirming a non-zero
> exit.** A boundary rule nobody has seen fail is a boundary rule nobody should trust.

```jsonc
// .dependency-cruiser.json (excerpt)
{
  "forbidden": [
    { "name": "no-cycles", "severity": "error", "from": {}, "to": { "circular": true } },
    { "name": "core-is-framework-free", "severity": "error",
      "from": { "path": "^packages/core" },
      "to":   { "path": "^(next|react|react-dom)" } },
    { "name": "no-deep-module-imports", "severity": "error",
      "from": { "path": "^packages/core/src/modules/([^/]+)" },
      "to":   { "path": "^packages/core/src/modules/(?!$1)([^/]+)/(?!index)" } }
  ]
}
```

### 5.4 State machines instead of scattered booleans

Anything with a lifecycle declares its transitions in one table. This keeps rules readable and
makes illegal states unrepresentable rather than merely unlikely.

```ts
// modules/appointments/domain/status-machine.ts
export const APPOINTMENT_TRANSITIONS = {
  SCHEDULED:   ['CONFIRMED', 'CANCELLED', 'NO_SHOW', 'RESCHEDULED'],
  CONFIRMED:   ['CHECKED_IN', 'CANCELLED', 'NO_SHOW', 'RESCHEDULED'],
  CHECKED_IN:  ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED'],
  COMPLETED:   [],          // terminal
  CANCELLED:   [],          // terminal
  NO_SHOW:     [],          // terminal
  RESCHEDULED: [],          // terminal — a new appointment row supersedes it
} as const satisfies Record<AppointmentStatus, readonly AppointmentStatus[]>
```

Every transition writes an `AppointmentStatusHistory` row, so "who cancelled this and when"
is answerable without reading the audit log.

The same pattern governs `Invoice` (DRAFT → ISSUED → PARTIALLY_PAID → PAID / VOID),
`SupportTicket` (OPEN → IN_PROGRESS → WAITING_ON_USER → RESOLVED → CLOSED), and
`ClinicalNote` (DRAFT → SIGNED → AMENDED).

---

## 6. Layering inside a module

Four layers. Each may call the layer below it and nothing above.

| Layer | Lives in | May import | Never contains |
|-------|----------|-----------|----------------|
| **Interface** | `apps/web/src/app/**` (route handlers, server components) | contracts, core use cases | business rules, queries |
| **Application** (use cases) | `core/.../application/` | domain, repositories, policies, event bus | HTTP objects, React, Mongoose documents |
| **Domain** | `core/.../domain/` | nothing but other domain code | I/O of any kind |
| **Infrastructure** | `core/.../infrastructure/` | Mongoose models, S3 SDK, Redis | business rules |

### 6.1 A use case, end to end

The interface layer is deliberately boring — parse, delegate, serialise. All of it is
mechanical, which is why it can be identical for web and mobile.

```ts
// apps/web/src/app/api/v1/appointments/route.ts   ← INTERFACE (thin, ~15 lines)
import { bookAppointment } from '@clinic/core/appointments'
import { BookAppointmentRequest } from '@clinic/contracts'
import { withApi } from '@/lib/api/with-api'

export const POST = withApi(
  { body: BookAppointmentRequest, permission: 'appointment:create' },
  async ({ body, actor }) => {
    const appointment = await bookAppointment(actor, body)
    return { status: 201, data: appointment }
  },
)
```

`withApi` is the one place that knows about HTTP: it authenticates, resolves the actor, checks
the coarse permission, validates the body, opens the request context used by audit logging
(section 11.2), maps domain errors to status codes, and shapes the response envelope.

```ts
// packages/core/src/modules/appointments/application/book-appointment.ts   ← APPLICATION
export async function bookAppointment(actor: Actor, input: BookAppointmentInput) {
  await assertCan(actor, 'appointment:create', { clinicId: input.clinicId })

  const doctor = await doctorRepo.findActive(input.doctorId, input.clinicId)
  if (!doctor) throw new DoctorNotAvailableError(input.doctorId)

  // Domain rules — pure, unit-testable without a database
  const slot = Slot.from(input.startsAt, input.durationMinutes)
  assertWithinWorkingHours(slot, doctor.schedule, clinic.holidays)
  assertNotInThePast(slot, clinic.timezone)

  return unitOfWork(async (tx) => {
    // Double-booking is settled by the storage engine: reserving the grid cells the slot
    // covers hits a unique _id, so the loser gets a duplicate-key error. Section 8.7.
    await slotReservationRepo.reserve(tx, input.doctorId, slot, appointmentId)

    const appointment = await appointmentRepo.create(tx, { ...input, _id: appointmentId,
                                                           status: 'SCHEDULED' })
    await appointmentRepo.pushStatusHistory(tx, appointmentId, null, 'SCHEDULED', actor)
    await outbox.emit(tx, 'appointment.booked', { appointmentId })
    return appointment
  })
}
```

Four properties worth naming:

- **`assertCan` is the first line.** Authorisation is not the route's job; a background job or the
  mobile API calling the same use case gets the same check.
- **The concurrency guard is a repository concern, not a use-case one.** `reserve()` throws
  `AppointmentSlotTakenError`; whether that is enforced by a Postgres advisory lock or a MongoDB
  unique index is invisible here. Swapping the storage engine changed section 8.7 and this one
  line — which is the layering in section 6 doing its job.
- **The event is written inside the transaction** (transactional outbox), so a booked appointment
  can never exist without its reminder being scheduled, and vice versa. `unitOfWork` wraps a
  MongoDB session with `withTransaction`, which is why the replica-set requirement in section 3
  is not optional.
- **Nothing here is Next.js-aware**, so `apps/worker` and a future gRPC or GraphQL surface can
  call it unchanged.

### 6.2 Testing per layer

| Layer | Test type | Tooling | Speed |
|-------|-----------|---------|-------|
| Domain | Pure unit — no mocks needed | Vitest | milliseconds |
| Application | Use case against in-memory fakes; repository tests against a real MongoDB replica set | Vitest + Testcontainers | seconds |
| Interface | Contract tests: request/response validated against the Zod schema | Vitest + `next-test-api-route-handler` | seconds |
| End to end | Critical journeys per portal | Playwright | minutes |

Non-negotiable E2E journeys for v1: login → correct portal landing; staff books an appointment;
doctor completes and signs an encounter; patient views the resulting document; staff records a
payment; admin edits a role and the affected user's menu changes on next request.

---

## 7. RBAC and the permission model

### 7.1 The rule

> **Never write `if (user.role === 'ADMIN')`.**
> Always write `if (await can(actor, 'patient:update', patient))`.

Roles are a way of *packaging* permissions for humans. Code checks permissions, never roles.
Admin, Staff, Doctor and Patient are seeded rows, not enum branches — and an admin can create a
fifth role, "Head Nurse", from the UI without a deploy. That is the whole point.

### 7.2 Permission shape: `subject:action`

```
patient:read       appointment:create      invoice:refund      role:assign
patient:update     appointment:cancel      payment:create      audit:read
patient:delete     appointment:reschedule  inventory:adjust    clinic:update
```

Permission strings are declared once, in code, as a typed catalogue. New permissions arrive by
migration; **grants** are pure data.

```ts
// packages/core/src/modules/access/permissions.catalog.ts
export const PERMISSIONS = {
  'portal.admin:access':   { group: 'Portals',  label: 'Access the admin portal' },
  'portal.staff:access':   { group: 'Portals',  label: 'Access the staff portal' },
  'portal.doctor:access':  { group: 'Portals',  label: 'Access the doctor portal' },
  'portal.patient:access': { group: 'Portals',  label: 'Access the patient portal' },

  'patient:read':   { group: 'Patients', label: 'View patients',   scopable: true },
  'patient:create': { group: 'Patients', label: 'Register patients' },
  'patient:update': { group: 'Patients', label: 'Edit patients',   scopable: true },
  'patient:delete': { group: 'Patients', label: 'Archive patients', dangerous: true },

  'encounter:read':    { group: 'Clinical', label: 'View medical records', scopable: true, phi: true },
  'encounter:write':   { group: 'Clinical', label: 'Write clinical notes', scopable: true, phi: true },
  'encounter:sign':    { group: 'Clinical', label: 'Sign and lock notes',  scopable: true },
  'prescription:issue':{ group: 'Clinical', label: 'Issue prescriptions',  scopable: true },
  // ...billing, inventory, support, files, admin
} as const

export type PermissionKey = keyof typeof PERMISSIONS
```

The `group` and `label` fields drive the admin permission-matrix UI directly, so a new permission
appears in the editor the moment it is added — no second list to maintain. `phi: true` marks
permissions whose *reads* must be audited (section 11.3). `dangerous: true` makes the UI toggle
require confirmation.

### 7.3 Scope: which rows, not which actions

A permission answers *may this actor touch this kind of thing*. A **scope** answers *which rows*.
Storing scope on the grant keeps the catalogue small.

| Scope | Meaning | Typical holder |
|-------|---------|----------------|
| `OWN` | Only rows belonging to the actor | Patient reading their own records |
| `ASSIGNED` | Rows the actor is professionally linked to | Doctor reading charts of patients they have treated |
| `CLINIC` | Every row in the actor's clinic | Staff, admin |
| `GLOBAL` | Every row across all clinics | Platform superadmin only |

So "a doctor can read medical records" is the grant
`encounter:read @ ASSIGNED`, while "staff can read medical records" is
`encounter:read @ CLINIC`. Same permission, different scope — and both are rows in
`role_permissions`.

### 7.4 Seeded roles

| Role | Key grants (abridged) |
|------|----------------------|
| **Admin** | Every permission at `CLINIC` scope, plus `role:*`, `permission:*`, `audit:read`, `clinic:update`, `user:impersonate` |
| **Staff** | `portal.staff:access`; patients/doctors/appointments full CRUD at `CLINIC`; `payment:*`, `invoice:*`, `inventory:*`, `support:*` at `CLINIC`; `encounter:read` at `CLINIC` **without** `encounter:write`; **no** `role:*` and **no** `audit:read` |
| **Doctor** | `portal.doctor:access`; `encounter:read/write/sign` at `ASSIGNED`; `patient:read` at `ASSIGNED`; `appointment:read` at `ASSIGNED`; `prescription:issue`; `doctor.profile:update` at `OWN`; `availability:*` at `OWN` |
| **Patient** | `portal.patient:access`; `patient:read/update` at `OWN`; `appointment:read/create/cancel` at `OWN`; `encounter:read` at `OWN` (only content flagged patient-visible); `file:read` at `OWN`; `invoice:read` at `OWN`; `ticket:*` at `OWN` |

Roles are `isSystem: true` (cannot be deleted, grants still editable) or user-created.
A user may hold **more than one role** — a doctor who is also the clinic owner holds both
Doctor and Admin, and the effective permission set is the union.

### 7.5 The policy engine

Two-stage evaluation, in this order:

1. **Coarse check** — does the actor hold the permission at all? Pure set membership, no I/O
   (the permission set is on the session). Used by middleware, menus, and route guards.
2. **Fine check** — given the *specific resource*, does the actor's scope reach it? Resolved by a
   per-subject **scope resolver** that the owning module registers.

```ts
// packages/core/src/modules/access/policy.ts
export interface Actor {
  userId: string
  clinicId: string
  roleIds: string[]
  permissions: Map<PermissionKey, Scope>   // highest scope wins on union
  doctorId?: string
  patientId?: string
  isImpersonating?: boolean
}

export async function can<S extends SubjectKey>(
  actor: Actor, permission: PermissionKey, resource?: SubjectOf<S>,
): Promise<boolean> {
  const scope = actor.permissions.get(permission)
  if (!scope) return false                 // stage 1: not granted at all
  if (!resource) return true               // collection-level check; scope narrows the query
  if (scope === 'GLOBAL') return true
  if (resource.clinicId !== actor.clinicId) return false   // hard tenant boundary
  if (scope === 'CLINIC') return true
  return scopeResolvers[subjectOf(permission)](actor, resource, scope)  // stage 2
}

/** Throwing variant — the default in use cases, so a missed `if` cannot become a silent allow. */
export async function assertCan(actor, permission, resource?) {
  if (!(await can(actor, permission, resource))) throw new ForbiddenError(permission)
}
```

The resolver is looked up by the permission's **subject** — the part before the colon — so
`availability:manage` and `availability:read` share one resolver, registered by whichever module
owns those documents. A subject with no registered resolver **denies**: forgetting one must never
open a door. The cost of that choice is that forgetting one instead closes a door quietly, and a
doctor refused their own working week looks exactly like a doctor who was never granted it. So the
set is checked rather than remembered: a unit test walks every permission the seeded roles grant at
`OWN` or `ASSIGNED` and asserts each subject resolves, with an explicit list of the subjects whose
modules have not been built yet. Deleting a line from that list is part of building the module.

For **list** endpoints, the same scope is compiled into a MongoDB filter rather than filtering in
memory — permission checks must never load documents the actor cannot see:

```ts
// modules/encounters/policies/encounter.policy.ts
export function encounterScopeFilter(actor: Actor, scope: Scope): FilterQuery<EncounterDoc> {
  switch (scope) {
    case 'GLOBAL':   return {}
    case 'CLINIC':   return { clinicId: actor.clinicId }
    case 'ASSIGNED': return { clinicId: actor.clinicId, doctorId: actor.doctorId }
    case 'OWN':      return { clinicId: actor.clinicId, patientId: actor.patientId,
                              'note.isPatientVisible': true }
  }
}
```

Every one of these filters is served by an index declared in section 8.8, in Equality-Sort-Range
order — a scope filter that forces a collection scan is a scope filter that will be quietly
removed under production load, so the two are designed together.

The `OWN` case is worth a second look. Because the clinical note is **embedded** in the encounter,
the patient-visibility gate is a field on the document being fetched rather than a join to a
separate `clinical_notes` table. The repository pairs it with a projection that strips
`note.subjective`, `internalNote` and unpublished diagnoses entirely, so hidden clinical content
is never loaded into application memory on a patient-portal request — not fetched and then
filtered, simply never read.

> #### 🔧 Decision for you — the `ASSIGNED` predicate
>
> The `ASSIGNED` case above is written the strict way: **a doctor sees only encounters they
> personally authored.** There is a real clinical argument for the looser reading — a doctor
> covering a colleague, or picking up a follow-up, needs the patient's *whole* chart, not just
> their own past notes. The looser rule would be "any encounter of any patient this doctor has
> ever treated":
>
> ```ts
> case 'ASSIGNED': return {
>   clinicId: actor.clinicId,
>   patient: { encounters: { some: { doctorId: actor.doctorId } } },
> }
> ```
>
> The trade-off is continuity of care versus minimum-necessary access (section 16). A common
> middle path is **break-the-glass**: default strict, but let a doctor open any chart in their
> clinic with a typed reason, which raises a high-severity audit event and notifies the admin.
>
> This is a clinic-policy call, not a technical one, so it is left open here.
> Pick one before Phase 4 and record it as `docs/adr/0004-assigned-scope.md`.

### 7.6 Where permissions are enforced

Four layers, because any single one can be bypassed:

| Layer | Mechanism | Protects against |
|-------|-----------|------------------|
| **Middleware** | Portal segment requires `portal.<x>:access` | Wandering into `/admin` by typing the URL |
| **Route handler** | `withApi({ permission })` coarse gate | Direct API calls that skip the UI |
| **Use case** | `assertCan(actor, perm, resource)` fine gate | Jobs, mobile, internal callers, IDOR by id-guessing |
| **Query** | `scopeFilter()` merged into every `where` | Over-fetching rows the actor may not see |
| **UI** | `<Can permission="...">` and permission-derived nav | Showing buttons that would only 403 |

The UI layer is a **courtesy, not a control**. Server-side checks are the security boundary.

### 7.7 Caching and invalidation

Resolving permissions is now two indexed queries rather than a three-table join (section 8.5),
so caching is an optimisation rather than a necessity. It is still worth doing on a path that runs
on every request — but a revoked permission must not survive in a stale session.

- Effective permissions are computed at login and cached in Redis under
  `perm:v{permVersion}:{userId}` with a 15-minute TTL.
- The JWT carries a `permVersion` claim. Any change to a role, grant, or user-role assignment
  bumps `Clinic.permissionVersion`.
- On each request, `withApi` compares the token's `permVersion` against the clinic's current
  value; a mismatch forces a re-resolve and re-issues the token.
- Pages make the same comparison but cannot set cookies. A mismatch still authorises the render
  against the re-resolved grants, and `TokenRenewal` has an API route store the replacement token
  from the browser. It is never a redirect to the refresh route: the client router replays a
  redirect met during a refresh or soft navigation, and loops (ADR-0018, Phase 2 amendment).
- `TokenRenewal` lives in the portal shell, so it runs when the shell renders: a full page load or
  a refresh. A navigation inside a portal re-renders only the page, which keeps authorising against
  current grants until the next shell render, API call, or token expiry replaces the cookie.

Net effect: **permission changes take effect on the affected user's next request**, without
either polling or waiting for a session to expire.

---

## 8. Data model (MongoDB document design)

### 8.1 Driver choice: Mongoose, not the Prisma MongoDB connector

Prisma is the more pleasant TypeScript experience, and it was the right answer on Postgres. On
MongoDB it is the wrong one, for three reasons that matter specifically to this system:

| Issue | Consequence here |
|-------|------------------|
| **No migration history.** Prisma's MongoDB connector supports `db push` only — there is no `prisma migrate`, no ordered migration files, no `migrate deploy` in CI. | A clinical system carries records for 7 years. Schema evolution has to be ordered, reviewable, reversible and auditable. "Push the current shape and hope" is not an operational story we can sign off. |
| **No aggregation pipeline.** Relations are emulated in the client with follow-up queries; `$lookup`, `$facet`, `$group` are reachable only through `aggregateRaw`, outside the type system. | Every report in section 1.1 — daily revenue, utilisation per doctor, no-show rate, stock valuation — is an aggregation. Writing them all as untyped raw escapes forfeits the reason to use Prisma. |
| **Embedded documents are second-class.** Composite types exist but are constrained, and the client pushes you toward a normalised shape. | Section 8.2 is built on deliberate embedding. A tool that fights that design makes the design worse. |

**Mongoose** gives us the full pipeline, discriminators, `pre`/`post` middleware (which is how
audit capture is implemented — section 11.3), change streams, transactions with sessions, and
plugins, which is how the mandatory tenant filter is enforced (section 8.15).

The honest cost is weaker type inference than Prisma's generated client. It is mitigated, and
the mitigation is itself useful:

- **Zod schemas in `packages/contracts` are the source of truth for shape**, exactly as before.
  Domain types are `z.infer`, not Mongoose document types.
- Mongoose schemas live **only** in `packages/db/src/models/` and are imported **only** by
  repositories under `infrastructure/`. A Mongoose document never escapes a repository — it is
  mapped to a plain domain object on the way out.
- `InferSchemaType` plus explicit interfaces close the gap where it matters.

That constraint pushes us further in the direction section 2.4 already wanted: the database
library becomes an implementation detail of one layer instead of a type vocabulary that leaks
through the whole codebase.

> ADR-0011 records this decision. If Prisma ships real migrations for MongoDB, revisit it — the
> repository boundary above is what makes that revisit cheap.

### 8.2 The embedding rule

This is the single most consequential design decision in a document database, so it is stated as
a rule rather than left to per-entity taste.

> **Embed when the child is (a) always read with its parent, (b) bounded in size by the business
> process, and (c) not queried independently across parents. Reference otherwise.**
>
> When those pull in different directions, **bounded growth wins.** An unbounded embedded array
> is the definitive MongoDB anti-pattern: it degrades every read of the parent, and eventually
> hits the hard 16 MB document limit — at which point the failure is a write that cannot succeed
> at all.

Applied across the model:

| Parent | Embedded | Referenced | Why |
|--------|----------|-----------|-----|
| `clinics` | branches, working hours, holidays, settings, feature flags | — | Read together on nearly every request, bounded (tens), never queried standalone |
| `users` | role assignments `[{ roleId, branchId }]` | roles | The assignment is per-user; the role definition is shared |
| `roles` | **permission grants** `[{ key, scope }]` | — | Always read as a unit. This deletes the `RolePermission` join table outright (section 8.5) |
| `patients` | emergency contacts, insurances, **allergies**, chronic conditions | appointments, encounters, invoices, files | Bounded and always shown on the chart. The allergy banner now costs **zero** extra queries |
| `appointments` | status history, denormalised patient/doctor/service snapshots | patient, doctor, service, encounter | A calendar day view renders with **no joins at all** (section 8.7) |
| `encounters` | clinical note + addenda, vitals, diagnoses | prescriptions, lab orders, files, stock movements | Note and vitals are 1:1; diagnoses are a handful. Prescriptions have their own lifecycle |
| `invoices` | line items | patient, encounter, payments | Lines are meaningless outside their invoice and are price snapshots by design |
| `payments` | allocations `[{ invoiceId, amount }]` | patient | One payment may settle several invoices; the payment owns the split |
| `inventoryItems` | batches | supplier, movements | FEFO deduction updates item + batch in **one atomic document write** (section 8.11) |
| `supportTickets` | messages | requester, assignee, files | A 2 KB message × 100 is 200 KB — three orders of magnitude below the limit |
| `auditLogs` | actor snapshot, before/after diff | — | Append-only, self-contained by design |

Two entries deserve their reasoning spelled out because they look inconsistent:

**Prescriptions are referenced, not embedded**, even though they are created inside an encounter.
They fail test (c): patients query "my active medications" across all encounters, refill requests
act on a prescription directly, PDF generation targets one, and pharmacy transmission later will
too. An independently-addressed entity gets its own collection.

**Stock movements are referenced** while batches are embedded. Batches are bounded per item and
needed atomically at deduction time; the movement ledger is unbounded by construction — it is the
one collection guaranteed to grow forever.

### 8.3 Conventions applied to every document

| Convention | Detail |
|-----------|--------|
| **`_id` is a cuid2 string, not an ObjectId** | ObjectId embeds a timestamp and a monotonic counter, which makes ids partially guessable and leaks record volume — unacceptable on a patient identifier exposed in a URL. A string `_id` also lets the mobile client generate ids offline. Costs: 25 bytes of index instead of 12, and `_id` no longer sorts by creation time, so cursor pagination uses a compound `{ createdAt, _id }` cursor (section 9.2 already specifies opaque cursors, so nothing above the repository changes). |
| **Tenancy** | Every document except global lookups carries `clinicId`. It is the **first field of nearly every compound index** and the mandatory filter enforced by a Mongoose plugin (section 8.15). |
| **Money is `Decimal128`** | Never `Double`. `0.1 + 0.2` in BSON `Double` is as wrong as it is in JavaScript. Repositories convert `Decimal128` to a `decimal.js` value on read and back on write; the API serialises money as a **string** (section 9.2). A raw `Decimal128` never reaches application code or JSON. |
| **Timestamps** | `createdAt` / `updatedAt` via `{ timestamps: true }`. All instants stored UTC as BSON `Date`. The clinic's IANA timezone lives on the clinic document; conversion happens only at the edges. |
| **Soft delete** | `deletedAt` on clinical, financial and identity documents. A global Mongoose plugin appends `deletedAt: null` to every query unless `.withDeleted()` is used. Medical and financial records are never hard-deleted. |
| **Attribution** | `createdBy` / `updatedBy` as `{ id, name }` snapshots — a name that survives the user being deactivated, without a lookup. |
| **Closed sets** | Mongoose `enum` validators plus a matching `$jsonSchema` collection validator. There is no database enum type in MongoDB, so the constraint lives in two places and both are generated from one TypeScript union (section 8.15). |
| **Editable vocabularies** | Services, specialties, ticket categories and inventory categories are **collections**, never enums — the clinic edits its own vocabulary (principle 2.3). |
| **Denormalised snapshots are display-only** | Any embedded copy of another document (`appointment.patient.name`) is for rendering. The `id` beside it is the truth. Refresh is event-driven (section 8.7). |
| **Hard limit** | 16 MB per document. Every embedding decision in 8.2 is checked against it explicitly. |

### 8.4 Collections

```
clinics              patients            encounters          invoices
users                doctors             prescriptions       payments
roles                staffProfiles       labOrders           refunds
invitations          specialties         files               inventoryItems
refreshTokens        services            supportTickets      inventoryBatchArchive
counters             appointments        notifications       stockMovements
slotReservations     appointmentWaitlist outboxEvents        suppliers
idempotencyKeys      auditLogs                               purchaseOrders
```

Note what is **absent** compared with the relational design: `permissions`, `rolePermissions`,
`userRoles`, `emergencyContacts`, `patientInsurances`, `allergies`, `chronicConditions`,
`clinicWorkingHours`, `clinicHolidays`, `branches`, `doctorSpecialties`, `clinicalNotes`,
`noteAddenda`, `vitals`, `diagnoses`, `invoiceLines`, `paymentAllocations`, `ticketMessages`,
`appointmentStatusHistory`, `inventoryBatches`, `notificationPreferences`. Twenty relational
tables collapse into their parent documents. Two new ones appear — `counters` and
`slotReservations` — for capabilities Postgres provided natively (sections 8.15 and 8.7).

### 8.5 Identity and access

```ts
// packages/db/src/models/clinic.model.ts
const WorkingHourSchema = new Schema({
  dayOfWeek: { type: Number, min: 0, max: 6, required: true },  // 0 = Sunday
  opensAt:   { type: String, required: true },                  // "09:00", local to the branch
  closesAt:  { type: String, required: true },
}, { _id: false })

const BranchSchema = new Schema({
  _id:          { type: String, default: () => createId() },
  name:         { type: String, required: true },
  phone:        String,
  address:      String,
  timezone:     String,                                          // falls back to the clinic
  workingHours: [WorkingHourSchema],
  isActive:     { type: Boolean, default: true },
})

const ClinicSchema = new Schema({
  _id:       { type: String, default: () => createId() },
  name:      { type: String, required: true },
  legalName: String,
  taxId:     String,
  logoFileId: String,
  contact:   { email: String, phone: String },
  address:   { line1: String, line2: String, city: String, country: String },
  timezone:  { type: String, default: 'UTC' },                   // IANA
  currency:  { type: String, default: 'USD' },                   // ISO-4217
  locale:    { type: String, default: 'en' },

  branches:  [BranchSchema],                                     // bounded: tens
  holidays:  [{ _id: false, date: String, name: String, branchId: String }], // "2026-12-25": a calendar date (ADR-0010)

  settings:     { type: Schema.Types.Mixed, default: {} },
  featureFlags: { type: Map, of: Boolean, default: {} },

  permissionVersion: { type: Number, default: 1 },               // section 7.7
  isActive:          { type: Boolean, default: true },
}, { timestamps: true })
```

Branches are embedded, so resolving "which branch is this appointment at, and is it open on a
Sunday" is answered from the clinic document that is already in the request cache. A branch's
subdocument `_id` is a stable string that other collections reference as `branchId`.

```ts
// packages/db/src/models/user.model.ts
const UserSchema = new Schema({
  _id:      { type: String, default: () => createId() },
  clinicId: { type: String, required: true },
  email:    { type: String, required: true, lowercase: true, trim: true },
  phone:    String,
  passwordHash: String,                                   // null while an invite is pending
  firstName:    { type: String, required: true },
  lastName:     { type: String, required: true },
  avatarFileId: String,
  locale:       String,

  roles: [{                                               // embedded assignments
    _id:        false,
    roleId:     { type: String, required: true },
    branchId:   String,                                   // optional branch-limited role
    assignedAt: { type: Date, default: Date.now },
    assignedBy: String,
  }],

  status:          { type: String, enum: USER_STATUSES, default: 'INVITED' },
  emailVerifiedAt: Date,
  lastLoginAt:     Date,
  security: {
    failedLoginCount:   { type: Number, default: 0 },
    lockedUntil:        Date,
    mfaSecretEncrypted: String,                           // CSFLE-encrypted (section 16.1)
    mfaEnabledAt:       Date,
    mustChangePassword: { type: Boolean, default: false },
  },
  preferredPortal: { type: String, enum: PORTAL_KEYS },
  deletedAt:       { type: Date, default: null },
}, { timestamps: true })

// Case-insensitive uniqueness, scoped per clinic, ignoring soft-deleted users.
UserSchema.index(
  { clinicId: 1, email: 1 },
  { unique: true,
    collation: { locale: 'en', strength: 2 },              // case-insensitive comparison
    partialFilterExpression: { deletedAt: null } },        // a deleted user frees their email
)
UserSchema.index({ clinicId: 1, status: 1 })
UserSchema.index({ 'roles.roleId': 1 })                    // "who holds this role"
```

Three details that are easy to get wrong and expensive to fix later:

- **The collation is on the index**, so `Sara@clinic.com` and `sara@clinic.com` collide. Queries
  must use the same collation or the index is not used — the repository sets it once.
- **`partialFilterExpression`** is what makes unique-plus-soft-delete work. A plain unique index
  would permanently reserve the email of every deactivated user.
- **`roles.roleId` is a multikey index**, which is what makes "revoke this role from everyone"
  and permission-version fan-out a single indexed query.

```ts
// packages/db/src/models/role.model.ts
const RoleSchema = new Schema({
  _id:         { type: String, default: () => createId() },
  clinicId:    { type: String, required: true },
  key:         { type: String, required: true },          // "admin" | "staff" | custom
  name:        { type: String, required: true },
  description: String,
  isSystem:    { type: Boolean, default: false },          // seeded roles are undeletable
  isDefault:   { type: Boolean, default: false },
  priority:    { type: Number, default: 0 },               // decides the landing portal

  permissions: [{                                          // ⭐ the join table, embedded
    _id:   false,
    key:   { type: String, required: true },               // "appointment:read"
    scope: { type: String, enum: PERMISSION_SCOPES, default: 'CLINIC' },
  }],
}, { timestamps: true })

RoleSchema.index({ clinicId: 1, key: 1 }, { unique: true })
```

**This is where the document model earns its keep for RBAC.** In the relational design, resolving
a user's permissions was a three-collection join (`users → userRoles → rolePermissions →
permissions`) that had to be cached to be affordable. Here it is:

```ts
const user  = await Users.findById(userId).lean()
const roles = await Roles.find({ _id: { $in: user.roles.map(r => r.roleId) } }).lean()
// permissions are already in hand — union them, highest scope wins
```

Two indexed queries, no joins, and the permission catalogue itself stays in code (section 7.2),
so the `permissions` and `rolePermissions` collections do not exist at all. The Redis cache and
`permissionVersion` invalidation from section 7.7 stay exactly as designed — they are now an
optimisation rather than a necessity, which is a strictly better position.

```ts
// TTL-managed collections — MongoDB expires these itself, no cleanup job required
const RefreshTokenSchema = new Schema({
  _id:        { type: String, default: () => createId() },
  userId:     { type: String, required: true },
  tokenHash:  { type: String, required: true, unique: true },
  deviceName: String, userAgent: String, ipAddress: String,
  revokedAt:  Date,
  expiresAt:  { type: Date, required: true },
})
RefreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })   // self-cleaning
RefreshTokenSchema.index({ userId: 1, revokedAt: 1 })

const InvitationSchema = new Schema({
  _id:       { type: String, default: () => createId() },
  clinicId:  { type: String, required: true },
  email:     { type: String, required: true },
  roleId:    { type: String, required: true },
  tokenHash: { type: String, required: true, unique: true },
  invitedBy: String,
  acceptedAt: Date,
  expiresAt: { type: Date, required: true },
})
InvitationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })
```

TTL indexes replace four of the nightly maintenance jobs listed in section 13.5 — expired
invitations, revoked refresh tokens, idempotency keys and processed outbox events all expire
themselves. That is a genuine operational simplification over the Postgres design.

### 8.6 People

```ts
// packages/db/src/models/patient.model.ts
const PatientSchema = new Schema({
  _id:      { type: String, default: () => createId() },
  clinicId: { type: String, required: true },
  userId:   String,                                        // null: registered by staff, no login
  medicalRecordNo: { type: String, required: true },       // "MRN-000142" (section 8.15)

  firstName: { type: String, required: true },
  lastName:  { type: String, required: true },
  dateOfBirth: String,                                     // "1990-04-17": never an instant (ADR-0010)
  gender:      { type: String, enum: GENDERS },
  nationalId:  String,
  bloodType:   { type: String, enum: BLOOD_TYPES, default: 'UNKNOWN' },
  contact:     { phone: String, email: String },
  address:     { line1: String, city: String, country: String },
  maritalStatus: String,
  occupation:    String,
  adminNotes:    String,                                   // administrative, NOT clinical

  // ── embedded: bounded, and needed on every single chart render ──────────────
  emergencyContacts: [{ _id: false,
    name: String, relationship: String, phone: String, isPrimary: Boolean }],

  insurances: [{ _id: { type: String, default: () => createId() },
    providerName: String, policyNumber: String, holderName: String,
    validFrom: Date, validTo: Date, cardFileId: String, isPrimary: Boolean }],

  allergies: [{ _id: { type: String, default: () => createId() },
    substance: { type: String, required: true }, reaction: String,
    severity: { type: String, enum: ALLERGY_SEVERITIES, default: 'UNKNOWN' },
    notedAt: { type: Date, default: Date.now } }],

  chronicConditions: [{ _id: { type: String, default: () => createId() },
    code: String, description: String, diagnosedAt: Date, resolvedAt: Date }],

  isActive:  { type: Boolean, default: true },
  deletedAt: { type: Date, default: null },
}, { timestamps: true })

PatientSchema.index({ clinicId: 1, medicalRecordNo: 1 },
                    { unique: true, partialFilterExpression: { deletedAt: null } })
PatientSchema.index({ clinicId: 1, lastName: 1, firstName: 1 })
PatientSchema.index({ clinicId: 1, 'contact.phone': 1 })   // duplicate detection (S2)
PatientSchema.index({ clinicId: 1, nationalId: 1 })
PatientSchema.index({ clinicId: 1, updatedAt: -1 })
```

**The allergy banner is now free.** In the relational design, opening a chart meant fetching the
patient, then allergies, then chronic conditions — three round trips before the doctor sees the
"PENICILLIN — ANAPHYLAXIS" warning. Here it is one `findById`. For a safety-critical banner that
must never fail to render, removing two failure points is worth more than the schema tidiness we
gave up.

**As built in Phase 2.** Three refinements to the sketch above. Search and duplicate matching read
**normalised keys** stored beside the originals — `search.firstName`, `search.lastName`,
`search.phone` (the last seven digits), `search.email`, `search.nationalId` — because an index can
serve a regex only when it is anchored and case-sensitive. A `searchKeys` plugin derives them on
every write path, so no use case computes one; the indexes lead with `clinicId` and target the keys
rather than `contact.phone`. An account belongs to at most one patient, enforced by a partial unique
index on `{ userId, clinicId }` (keys reversed, since `{ clinicId, userId }` already serves lookups).
And every find on `patients` is recorded as a view, so reads that only decide whether someone may
look pass `skipAudit` — a refused request is never logged as having seen a record.

```ts
// packages/db/src/models/doctor.model.ts
const DoctorSchema = new Schema({
  _id:      { type: String, default: () => createId() },
  clinicId: { type: String, required: true },
  userId:   { type: String, required: true },
  licenseNumber: String,
  title: String, bio: String,
  yearsOfExperience: Number,
  consultationFee:   Schema.Types.Decimal128,
  defaultSlotMinutes: { type: Number, default: 30 },

  specialties: [{ _id: false, id: String, name: String }], // reference + display snapshot, one entry each

  // Recurring weekly template — bounded at 7 days x a few blocks
  availability: [{ _id: { type: String, default: () => createId() },
    branchId: String, dayOfWeek: Number,
    startTime: String, endTime: String,                    // "09:00" local
    slotMinutes: Number,
    breakStartTime: String, breakEndTime: String,
    effectiveFrom: Date, effectiveTo: Date }],

  // One-off blocks. Bounded per year; an archival job trims entries older than 2 years.
  timeOff: [{ _id: { type: String, default: () => createId() },
    startsAt: Date, endsAt: Date, reason: String, isApproved: Boolean }],

  isAcceptingNew: { type: Boolean, default: true },
  isActive:  { type: Boolean, default: true },
  deletedAt: { type: Date, default: null },
}, { timestamps: true })

DoctorSchema.index({ clinicId: 1, isActive: 1 })
DoctorSchema.index({ userId: 1 }, { unique: true })
DoctorSchema.index({ clinicId: 1, 'specialties.id': 1 })   // multikey: "find cardiologists"
```

Availability and time-off embed for the same reason the allergy list does: slot computation
(section 8.7) needs the template, the exceptions and the doctor's slot length **together**, on
every calendar render. One document read replaces three queries on the hottest path in the app.

`specialties` is the snapshot pattern in miniature — each entry's id is the truth and drives the
filter index; its name renders the card without a lookup. The first sketch used two parallel
arrays, `specialtyIds` and `specialtyNames`; one array of pairs was chosen instead because parallel
arrays drift the moment one is edited without the other, and a rename becomes a single array-filter
update (`specialties.$[entry].name`). That refresh is a bulk write, so the rename records an
explicit `specialty.renamed` audit entry (section 8.15).

### 8.7 Scheduling and appointments

```ts
// packages/db/src/models/appointment.model.ts
const AppointmentSchema = new Schema({
  _id:      { type: String, default: () => createId() },
  clinicId: { type: String, required: true },
  branchId: String,
  number:   { type: String, required: true },              // "APT-000318"

  patientId: { type: String, required: true },
  doctorId:  { type: String, required: true },
  serviceId: String,

  // ── denormalised display snapshots: the calendar renders with zero joins ────
  patient: { name: String, medicalRecordNo: String, phone: String },
  doctor:  { name: String, specialtyNames: [String] },
  service: { name: String, durationMinutes: Number, colorHex: String },

  startsAt: { type: Date, required: true },                // UTC
  endsAt:   { type: Date, required: true },
  durationMinutes: Number,

  status: { type: String, enum: APPOINTMENT_STATUSES, default: 'SCHEDULED' },
  source: { type: String, enum: APPOINTMENT_SOURCES, default: 'STAFF' },
  reason:       String,                                    // patient's chief complaint
  internalNote: String,                                    // staff-only, never shown to patient

  checkedInAt: Date, startedAt: Date, completedAt: Date,
  cancelledAt: Date, cancelledBy: { id: String, name: String }, cancelReason: String,
  rescheduledToId: String,
  encounterId:     String,                                 // back-reference (section 8.15)

  // Embedded lifecycle trail — bounded at a handful of transitions
  statusHistory: [{ _id: false,
    fromStatus: String, toStatus: String, reason: String,
    changedBy: { id: String, name: String },
    changedAt: { type: Date, default: Date.now } }],

  createdBy: { id: String, name: String },
}, { timestamps: true })

AppointmentSchema.index({ clinicId: 1, startsAt: 1 })                  // day / week view
AppointmentSchema.index({ doctorId: 1, startsAt: 1 })                  // doctor column
AppointmentSchema.index({ patientId: 1, startsAt: -1 })                // patient timeline
AppointmentSchema.index({ clinicId: 1, status: 1, startsAt: 1 })       // "today's no-shows"
AppointmentSchema.index({ clinicId: 1, number: 1 }, { unique: true })
```

**Why the snapshots are worth the denormalisation.** A front-desk week view is roughly 300
appointments across eight doctors. Normalised, rendering it needs the appointments plus a lookup
of every distinct patient, doctor and service — either an `$lookup` aggregation across three
collections or an N+1 in the repository. With the snapshot embedded it is **one indexed range
query returning render-ready documents**, which is the difference between a calendar that feels
instant and one that does not.

The cost is staleness, handled explicitly and not left to hope:

| Question | Answer |
|----------|--------|
| What is authoritative? | `patientId` / `doctorId` / `serviceId`. The snapshot is display-only and is never read back for a business decision. |
| When does it refresh? | A `patient.updated` / `doctor.updated` / `service.updated` event triggers a handler that runs `updateMany` over that entity's **future and recent** appointments (`startsAt > now - 30d`). Historical appointments deliberately keep the name as it was on the day — which is the correct medical-record behaviour, not a bug. |
| What if a refresh is missed? | A nightly reconciliation job re-syncs snapshots for upcoming appointments and reports drift. |

#### Preventing double-booking without advisory locks

This is the design that changes most in the move from Postgres. The relational version took a
transactional advisory lock on `(doctorId, day)`. MongoDB has no advisory locks, and — critically
— **a MongoDB transaction aborts on a write conflict to the same document, not on a phantom
read.** Two concurrent bookings can both run an overlap query, both see a free slot, both insert
a different appointment document, and both commit. A naive port of the Postgres logic would be
silently broken under exactly the load it is meant to survive.

The fix is to make the conflict a **document-level** one, so the storage engine settles it:

```ts
// A reservation document per 5-minute grid cell the appointment covers.
const SlotReservationSchema = new Schema({
  _id:      { type: String, required: true },   // `${doctorId}:${cellStartISO}` — deterministic
  clinicId: { type: String, required: true },
  doctorId: { type: String, required: true },
  appointmentId: { type: String, required: true },
  cellStartsAt:  { type: Date, required: true },
  expiresAt:     Date,                          // set only for provisional holds
})
SlotReservationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })
SlotReservationSchema.index({ appointmentId: 1 })
```

```ts
// modules/appointments/application/book-appointment.ts (infrastructure detail)
const cells = gridCells(slot.startsAt, slot.endsAt, GRID_MINUTES)   // ["doc1:2026-09-14T09:00Z", ...]

await session.withTransaction(async () => {
  try {
    await SlotReservations.insertMany(
      cells.map(id => ({ _id: id, clinicId, doctorId, appointmentId, cellStartsAt: cellOf(id) })),
      { session, ordered: true },
    )
  } catch (e) {
    if (isDuplicateKeyError(e)) throw new AppointmentSlotTakenError(slot)   // → 409
    throw e
  }
  await Appointments.create([{ _id: appointmentId, /* ... */ }], { session })
})
```

Because `_id` is unique by definition, the second concurrent booking gets a duplicate-key error
from the storage engine itself. No lock, no read-then-write race, and it holds whether or not the
two requests land on the same application instance. Cancelling or rescheduling deletes the
reservations by `appointmentId`; provisional holds (a patient mid-checkout) set `expiresAt` and
MongoDB reclaims them.

The 5-minute grid is a deliberate trade: it caps reservations at 12 documents per hour of
appointment and matches the smallest bookable increment the clinic actually uses. It is a single
constant if that changes.

> **Slot availability is still computed, never stored** — the reasoning from the relational
> design is unchanged, and it gets cheaper here: the doctor document already carries availability
> and time-off, so the computation needs one doctor read, one clinic read (cached) and one
> indexed appointment range query. Cached in Redis per `(doctorId, date)`, invalidated by
> `appointment.*` and `availability.*` events.

### 8.8 Clinical records

The encounter is the clearest win for a document model: a visit **is** a document. The note,
the vitals and the diagnoses have no existence or meaning outside it, are always read with it,
and are bounded by the visit itself.

```ts
// packages/db/src/models/encounter.model.ts
const EncounterSchema = new Schema({
  _id:      { type: String, default: () => createId() },
  clinicId: { type: String, required: true },
  patientId: { type: String, required: true },
  doctorId:  { type: String, required: true },
  appointmentId: String,                                   // null for walk-ins

  patient: { name: String, medicalRecordNo: String, dateOfBirth: Date },
  doctor:  { name: String },

  encounterType:  { type: String, enum: ENCOUNTER_TYPES, default: 'CONSULTATION' },
  chiefComplaint: String,
  startedAt: { type: Date, default: Date.now },
  endedAt:   Date,
  status:    { type: String, enum: ENCOUNTER_STATUSES, default: 'OPEN' },

  // ── embedded 1:1 ───────────────────────────────────────────────────────────
  note: {
    subjective: String, objective: String, assessment: String, plan: String,
    isPatientVisible: { type: Boolean, default: false },
    status:    { type: String, enum: NOTE_STATUSES, default: 'DRAFT' },
    signedAt:  Date,
    signedBy:  { id: String, name: String },
    signatureHash: String,                                 // hash of content at signing
    addenda: [{ _id: { type: String, default: () => createId() },
      body: String, author: { id: String, name: String },
      createdAt: { type: Date, default: Date.now } }],
  },

  vitals: {
    heightCm: Schema.Types.Decimal128, weightKg: Schema.Types.Decimal128,
    temperatureC: Schema.Types.Decimal128,
    systolicMmHg: Number, diastolicMmHg: Number,
    heartRateBpm: Number, respiratoryRate: Number, oxygenSaturation: Number,
    bloodGlucose: Schema.Types.Decimal128,
    recordedAt: Date, recordedBy: { id: String, name: String },
  },

  // ── embedded 1:few ─────────────────────────────────────────────────────────
  diagnoses: [{ _id: { type: String, default: () => createId() },
    code: { type: String, required: true },                // "J06.9"
    codeSystem: { type: String, default: 'ICD10' },        // FHIR mapping seam (section 16.3)
    description: String, isPrimary: Boolean, isChronic: Boolean, notes: String }],

  deletedAt: { type: Date, default: null },
}, { timestamps: true })

EncounterSchema.index({ patientId: 1, startedAt: -1 })     // the chart timeline
EncounterSchema.index({ doctorId: 1, startedAt: -1 })      // "my patients", ASSIGNED scope
EncounterSchema.index({ clinicId: 1, startedAt: -1 })
EncounterSchema.index({ clinicId: 1, 'diagnoses.code': 1 })  // multikey: cohort by ICD-10
EncounterSchema.index({ appointmentId: 1 }, { sparse: true })
```

**Sign-and-lock is stronger here than it was relationally.** Signing is a single atomic document
update, so the note, its status, the signature hash and the signing identity can never be
partially applied — there is no window in which a note is marked `SIGNED` while its content is
still being written. The guard is a conditional update rather than a read-then-write:

```ts
const result = await Encounters.updateOne(
  { _id: encounterId, clinicId, 'note.status': 'DRAFT' },   // ← precondition in the filter
  { $set: { 'note.status': 'SIGNED', 'note.signedAt': new Date(),
            'note.signedBy': actorSnapshot, 'note.signatureHash': hash } },
)
if (result.matchedCount === 0) throw new NoteAlreadySignedError(encounterId)
```

Post-signature corrections `$push` to `note.addenda`, which cannot mutate signed content by
construction. A document validator additionally rejects any update touching `note.subjective`
and friends when `note.status !== 'DRAFT'` (section 8.15) — the belt to that brace.

**Prescriptions and lab orders are separate collections**, per the rule in 8.2:

```ts
const PrescriptionSchema = new Schema({
  _id:      { type: String, default: () => createId() },
  clinicId: { type: String, required: true },
  encounterId: { type: String, required: true },
  patientId:   { type: String, required: true },
  doctorId:    { type: String, required: true },
  doctor:  { name: String, licenseNumber: String },        // snapshot: printed on the PDF
  issuedAt:   { type: Date, default: Date.now },
  validUntil: Date,
  notes:      String,
  pdfFileId:  String,                                      // generated asynchronously
  items: [{ _id: { type: String, default: () => createId() },   // embedded: bounded 1:few
    drugName: { type: String, required: true },
    strength: String, form: String,
    dosage: String, frequency: String, durationDays: Number,
    quantity: Number, instructions: String,
    isRefillable: { type: Boolean, default: false } }],
  refillRequests: [{ _id: false, requestedAt: Date, status: String, handledBy: String }],
}, { timestamps: true })

PrescriptionSchema.index({ patientId: 1, issuedAt: -1 })
PrescriptionSchema.index({ encounterId: 1 })
PrescriptionSchema.index({ clinicId: 1, patientId: 1, validUntil: -1 })  // "active medications"
```

`LabOrder` follows the same shape (`clinicId`, `encounterId`, `patientId`, `panelName`, `status`,
`resultFileId`, `reviewedAt`, `reviewedBy`) with an index on `{ patientId: 1, orderedAt: -1 }`
and on `{ clinicId: 1, status: 1 }` for the "results awaiting review" queue.

**Patient-visible content stays a single flag on embedded data**, which makes the patient-portal
scope filter a projection rather than a join — see 8.14.

### 8.9 Files

Unchanged in substance: metadata in MongoDB, bytes in S3-compatible object storage (section 12).

```ts
const FileSchema = new Schema({
  _id:      { type: String, default: () => createId() },
  clinicId: { type: String, required: true },
  owner:    { type: { type: String, enum: FILE_OWNER_TYPES, required: true },
              id:   { type: String, required: true } },    // polymorphic, natural in Mongo
  category: String,                                        // "lab-result" | "consent" | ...
  storageKey: { type: String, required: true, unique: true },
  bucket:     String,
  fileName:   String, mimeType: String, sizeBytes: Number,
  checksumSha256: String,
  status:     { type: String, enum: FILE_STATUSES, default: 'PENDING' },
  scanResult: String,
  isPatientVisible: { type: Boolean, default: false },
  uploadedBy: { id: String, name: String },
  deletedAt:  { type: Date, default: null },
}, { timestamps: true })

FileSchema.index({ clinicId: 1, 'owner.type': 1, 'owner.id': 1, createdAt: -1 })
FileSchema.index({ clinicId: 1, category: 1, createdAt: -1 })
FileSchema.index({ status: 1, createdAt: 1 })              // the PENDING sweep
```

> **Why not GridFS.** GridFS stores files as chunk documents inside MongoDB. It exists for
> deployments that must keep binaries in the database, and it would put every MRI scan into the
> working set, into the oplog, into replication traffic and into backups. S3 with presigned
> URLs (section 12.1) keeps bytes off both the app server and the database. GridFS is the right
> tool when object storage is unavailable; it is not our situation.

### 8.10 Billing

```ts
const InvoiceSchema = new Schema({
  _id:      { type: String, default: () => createId() },
  clinicId: { type: String, required: true },
  branchId: String,
  patientId: { type: String, required: true },
  patient:  { name: String, medicalRecordNo: String },
  encounterId: String,
  number:   { type: String, required: true },              // "INV-2026-000318"
  status:   { type: String, enum: INVOICE_STATUSES, default: 'DRAFT' },
  issuedAt: Date, dueAt: Date,

  // Embedded: lines are price snapshots and are meaningless outside the invoice
  lines: [{ _id: { type: String, default: () => createId() },
    serviceId: String, inventoryItemId: String,
    description: { type: String, required: true },         // snapshot: catalogue prices change
    quantity:  Schema.Types.Decimal128,
    unitPrice: Schema.Types.Decimal128,
    discount:  Schema.Types.Decimal128,
    taxRatePercent: Schema.Types.Decimal128,
    lineTotal: Schema.Types.Decimal128 }],

  subtotal:      Schema.Types.Decimal128,
  discountTotal: Schema.Types.Decimal128,
  taxTotal:      Schema.Types.Decimal128,
  total:         Schema.Types.Decimal128,
  amountPaid:    Schema.Types.Decimal128,
  balanceDue:    Schema.Types.Decimal128,                  // stored: it is queried and indexed
  currency:      String,
  pdfFileId:     String,
  voidedAt: Date, voidReason: String,
  createdBy: { id: String, name: String },
}, { timestamps: true })

InvoiceSchema.index({ clinicId: 1, number: 1 }, { unique: true })
InvoiceSchema.index({ clinicId: 1, status: 1, issuedAt: -1 })
InvoiceSchema.index({ patientId: 1, issuedAt: -1 })
InvoiceSchema.index({ clinicId: 1, balanceDue: 1 })        // outstanding-balance report

const PaymentSchema = new Schema({
  _id:      { type: String, default: () => createId() },
  clinicId: { type: String, required: true },
  branchId: String,
  patientId: { type: String, required: true },
  amount:   Schema.Types.Decimal128,
  currency: String,
  method:   { type: String, enum: PAYMENT_METHODS, required: true },
  status:   { type: String, enum: PAYMENT_STATUSES, default: 'COMPLETED' },
  reference: String,
  receivedAt: { type: Date, default: Date.now },
  receivedBy: { id: String, name: String },                // who took the money
  note: String,
  refundedAmount: Schema.Types.Decimal128,

  // The payment owns the split, because one payment may settle several invoices
  allocations: [{ _id: false, invoiceId: String, amount: Schema.Types.Decimal128 }],

  idempotencyKey: String,
}, { timestamps: true })

PaymentSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true })  // double-click safe
PaymentSchema.index({ clinicId: 1, receivedAt: -1 })       // daily reconciliation
PaymentSchema.index({ patientId: 1, receivedAt: -1 })
PaymentSchema.index({ 'allocations.invoiceId': 1 })        // multikey: payments for an invoice
```

**Recording a payment is the one genuinely multi-document write in the system** — it inserts a
payment and updates one or more invoice balances. It runs in a transaction, and the invoice
update is expressed as a conditional `$inc` so it is correct even under concurrent settlement:

```ts
await session.withTransaction(async () => {
  await Payments.create([payment], { session })
  for (const alloc of payment.allocations) {
    const res = await Invoices.updateOne(
      { _id: alloc.invoiceId, clinicId, status: { $in: ['ISSUED', 'PARTIALLY_PAID'] } },
      [{ $set: {                                            // pipeline update: atomic, server-side
          amountPaid: { $add: ['$amountPaid', alloc.amount] },
          balanceDue: { $subtract: ['$balanceDue', alloc.amount] },
          status: { $cond: [{ $lte: [{ $subtract: ['$balanceDue', alloc.amount] }, 0] },
                            'PAID', 'PARTIALLY_PAID'] },
      }}],
      { session },
    )
    if (res.matchedCount === 0) throw new InvoiceNotPayableError(alloc.invoiceId)
  }
  await outbox.emit('payment.recorded', { paymentId: payment._id }, { session })
})
```

The status transition is computed **inside** the update pipeline rather than in application code,
so `PARTIALLY_PAID → PAID` cannot be decided from a stale read. `Refund` is its own small
collection referencing `paymentId`, indexed on `{ clinicId: 1, refundedAt: -1 }`.

> **Transactions require a replica set.** This is a hard MongoDB requirement, not a production-only
> concern: local development must run `mongod --replSet rs0` with an init step, and CI must do the
> same. It is called out in Phase 0 (section 17) because a single-node standalone silently fails
> every transactional path and the failure surfaces late.

**What Phase 5 shipped differs from the sketch above in five places**, each for a reason worth
keeping:

- **`dueAt` is a calendar date string, not a `Date`.** An invoice falls due *on the 30th* in the
  clinic's own zone, not at an instant — the same reasoning as ADR-0010, and the same reasoning
  that makes `isOverdue` a string comparison rather than a clock one.
- **Each line stores `gross`, `net` and `tax` beside `lineTotal`.** They are what the printed
  invoice shows and what ADR-0027's guarantee is expressed over; deriving them again at render
  time would be the same arithmetic implemented twice.
- **`OVERDUE` is not a stored status.** Whether an invoice is late is a question about today and
  its due date, so it is derived on read. The alternative is a nightly sweep whose silent failure
  leaves every invoice looking current.
- **`refunds` is a ledger and `payments.refundedAmount` is its projection** — the same
  relationship section 8.11 gives `stockMovements` and `quantityOnHand`. Two partial refunds on
  one payment are two events with two reasons and two cashiers, which a single field cannot hold.
  Each refund records which invoices it came back off.
- **Neither invoices nor payments carry a soft delete.** A financial document is voided with a
  stated reason, never hidden: an unexplained gap in a numbered sequence is the first thing an
  auditor looks for.

The invoice's allocation filter also carries `balanceDue: { $gte: amount }`, which the sketch
omits. It is what makes overpayment structurally impossible rather than merely checked.

### 8.11 Inventory

The ledger principle is unchanged: `stockMovements` is the truth, `quantityOnHand` is a
projection. What changes is that the hot path gets **cheaper** than it was relationally.

```ts
const InventoryItemSchema = new Schema({
  _id:      { type: String, default: () => createId() },
  clinicId: { type: String, required: true },
  branchId: String,
  sku:  { type: String, required: true },
  name: { type: String, required: true },
  categoryId: String,
  unit: String,                                            // "box" | "vial" | "tablet"
  costPrice: Schema.Types.Decimal128,
  salePrice: Schema.Types.Decimal128,
  quantityOnHand: { type: Schema.Types.Decimal128, default: 0 },   // ledger projection
  reorderLevel:   { type: Schema.Types.Decimal128, default: 0 },

  // Embedded: FEFO deduction needs item + batches together and atomically
  batches: [{ _id: { type: String, default: () => createId() },
    batchNumber: String, expiresAt: Date,
    quantity: Schema.Types.Decimal128, costPrice: Schema.Types.Decimal128 }],

  supplierId: String,
  isTracked:  { type: Boolean, default: true },
  isBillable: { type: Boolean, default: true },
  isActive:   { type: Boolean, default: true },
  deletedAt:  { type: Date, default: null },
}, { timestamps: true })

InventoryItemSchema.index({ clinicId: 1, sku: 1 },
                          { unique: true, partialFilterExpression: { deletedAt: null } })
InventoryItemSchema.index({ clinicId: 1, isActive: 1, name: 1 })
InventoryItemSchema.index({ clinicId: 1, quantityOnHand: 1 })        // low-stock widget
InventoryItemSchema.index({ clinicId: 1, 'batches.expiresAt': 1 })   // expiring-soon widget

const StockMovementSchema = new Schema({
  _id:      { type: String, default: () => createId() },
  clinicId: { type: String, required: true },
  itemId:   { type: String, required: true },
  item:     { name: String, sku: String, unit: String },   // snapshot for the ledger report
  batchId:  String,
  type:     { type: String, enum: STOCK_MOVEMENT_TYPES, required: true },
  quantity:     Schema.Types.Decimal128,                   // signed: +in, -out
  balanceAfter: Schema.Types.Decimal128,                   // running total, cheap auditing
  reason: String,
  encounterId: String, purchaseOrderId: String,
  performedBy: { id: String, name: String },
  occurredAt:  { type: Date, default: Date.now },
})

StockMovementSchema.index({ clinicId: 1, itemId: 1, occurredAt: -1 })
StockMovementSchema.index({ encounterId: 1 }, { sparse: true })
StockMovementSchema.index({ clinicId: 1, occurredAt: -1 })
```

**Deducting stock is one atomic document write.** The item and its batches live in the same
document, so decrementing the item total and the specific batch happens in a single update that
also asserts sufficient stock in its filter — no read-then-write, no transaction, no oversell:

```ts
const res = await InventoryItems.updateOne(
  { _id: itemId, clinicId,
    quantityOnHand: { $gte: qty },                          // ← precondition, not a prior read
    batches: { $elemMatch: { _id: batchId, quantity: { $gte: qty } } } },
  { $inc: { quantityOnHand: -qty, 'batches.$[b].quantity': -qty } },
  { arrayFilters: [{ 'b._id': batchId }] },
)
if (res.matchedCount === 0) throw new InsufficientStockError(itemId, qty)
```

Relationally this required a row lock on the item plus a second write to the batch table. Here
the storage engine's document-level concurrency control does the whole job. The ledger entry
still follows, in a transaction with the deduction when it is part of an encounter checkout, so
the projection and the ledger can never disagree.

Depleted and long-expired batches are moved to `inventoryBatchArchive` by a monthly job, which
is what keeps the embedded array bounded and honest about the rule in 8.2.

`Supplier` and `PurchaseOrder` are straightforward collections; `PurchaseOrder` embeds its lines
(bounded, snapshot semantics) exactly as `Invoice` does.

**What Phase 6 shipped differs from the sketch above in four places**, each for a reason worth
keeping:

- **A batch's `expiresAt` is a calendar date string, not a `Date`.** Stock goes out of date *on a
  day* in the clinic's own zone, and a batch that expires today is usable today — the same
  reasoning as ADR-0010, and it makes every expiry comparison a string comparison with no clock
  involved.
- **A withdrawal may span several batches**, so it is one conditional update with one
  `arrayFilters` entry per batch, and it writes **one ledger row per batch** — the ledger has to
  say which box the stock came out of. The bill still gets a single line: the patient was given
  five, not "three and two".
- **Quantities are decimal strings at three places**, counted by the same exact `bigint` engine as
  money (`@clinic/contracts/decimal.ts`, shared by `money.ts` and `quantity.ts`). A stock level is
  a running total of every movement ever made, and a float drifts a little further from the shelf
  with each one.
- **`isTracked` and `isBillable` are separate switches.** Gloves are consumed and never charged
  for; tap water is used and never counted. Collapsing them would force a clinic to either count
  what it does not count or charge for what it does not charge for.

The distinction the allocator draws between "there is not enough" and "what is left has expired"
is load-bearing rather than cosmetic: they call for entirely different actions, and an item whose
remaining stock has all expired reports a healthy count while refusing every withdrawal.

### 8.12 Support, notifications, outbox

```ts
const SupportTicketSchema = new Schema({
  _id:      { type: String, default: () => createId() },
  clinicId: { type: String, required: true },
  number:   { type: String, required: true },              // "TKT-001204"
  subject:  { type: String, required: true },
  categoryId: String,
  priority: { type: String, enum: TICKET_PRIORITIES, default: 'NORMAL' },
  status:   { type: String, enum: TICKET_STATUSES, default: 'OPEN' },

  requester: { id: String, name: String, role: String },   // patient OR doctor OR staff
  assignee:  { id: String, name: String },

  // Embedded: a 2 KB message x 100 is 200 KB — three orders of magnitude under the 16 MB limit
  messages: [{ _id: { type: String, default: () => createId() },
    author: { id: String, name: String },
    body: { type: String, required: true },
    isInternal: { type: Boolean, default: false },         // staff-only note
    fileIds: [String],
    createdAt: { type: Date, default: Date.now } }],

  firstReplyAt: Date, resolvedAt: Date, closedAt: Date,
}, { timestamps: true })

SupportTicketSchema.index({ clinicId: 1, number: 1 }, { unique: true })
SupportTicketSchema.index({ clinicId: 1, status: 1, priority: -1, createdAt: -1 })  // the inbox
SupportTicketSchema.index({ 'assignee.id': 1, status: 1 })
SupportTicketSchema.index({ 'requester.id': 1, createdAt: -1 })
```

Embedding messages means opening a ticket is one read, and posting a reply is one `$push` — and
the patient-facing view is the same document with `{ $filter: { messages, isInternal: false } }`
applied as a projection, so an internal note cannot leak through a forgotten `WHERE` clause.

```ts
const OutboxEventSchema = new Schema({
  _id:      { type: String, default: () => createId() },
  clinicId: { type: String, required: true },
  eventName: { type: String, required: true },
  payload:   Schema.Types.Mixed,
  occurredAt:  { type: Date, default: Date.now },
  processedAt: Date,
  attempts:    { type: Number, default: 0 },
  lastError:   String,
  expiresAt:   Date,                                       // set on success: TTL sweeps it
})
OutboxEventSchema.index({ processedAt: 1, occurredAt: 1 })
OutboxEventSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })
```

**The outbox stays, but the relay changes.** Events are still written inside the business
transaction, so "the appointment was booked but no reminder was scheduled" remains impossible.
What improves is delivery: instead of polling the collection, a worker opens a **change stream**
on `outboxEvents` and reacts to inserts as they replicate. That is push-based, near-zero latency,
and resumable from a stored resume token after a restart. Polling remains as a fallback sweep for
anything a stream gap missed.

`Notification` gets a TTL index on an `expiresAt` set 90 days out for read in-app notifications —
another nightly job that MongoDB now runs for us. `NotificationPreference` collapses into an
embedded array on the user document.

**What Phase 7 shipped differs from the sketch above in four places**, each for a reason worth
keeping:

- **A notification carries a `dedupeKey` with a unique index**, which is the whole of what makes
  at-least-once delivery survivable (ADR-0030). Nothing else in this section matters as much.
- **Delivery is tracked per channel rather than per notification.** IN_APP is a row in our own
  database and EMAIL depends on somebody else's server; one status would have to mean two
  different things, and an email failure would otherwise look like a lost reminder.
- **Preferences are a list of exceptions, not a full matrix.** Absent means the type's default
  applies, so adding a notification type needs no migration and a changed default reaches
  everybody who never opened the screen. Some types are locked and shown as such.
- **`ticket.firstReplyAt` is set with `$set`, not `$min`.** BSON orders null before every date,
  so `$min` against an unanswered ticket keeps the null and the response clock never stops — a
  bug that looks like nothing until somebody asks why no ticket has ever been answered.

`streamCursors` is a collection the sketch does not mention: one document per relay holding the
last resume token it committed, so a restarted worker resumes rather than replaying from the
beginning or skipping whatever arrived while it was down. The token is saved only **after** the
event has been accepted onto a queue — saving it on receipt would turn a crash mid-handler into a
silently dropped event.

### 8.13 Audit log

```ts
const AuditLogSchema = new Schema({
  _id:      { type: String, default: () => createId() },
  clinicId: { type: String, required: true },
  occurredAt: { type: Date, default: Date.now },

  actor: {                                                 // fully denormalised snapshot
    id: String,
    type: { type: String, enum: ACTOR_TYPES, default: 'USER' },
    label: String,                                         // survives the user being deleted
    roles: [String],                                       // roles held at the moment of action
  },
  impersonatorId: String,                                  // set when an admin acted "as" someone

  action:   { type: String, required: true },              // "appointment.cancelled"
  category: { type: String, enum: AUDIT_CATEGORIES, required: true },
  entity:   { type: { type: String }, id: String, label: String },

  before:   Schema.Types.Mixed,                            // changed fields only, PHI-redacted
  after:    Schema.Types.Mixed,
  metadata: Schema.Types.Mixed,

  request:  { id: String, ipAddress: String, userAgent: String },
  severity: { type: String, enum: AUDIT_SEVERITIES, default: 'INFO' },
  outcome:  { type: String, enum: AUDIT_OUTCOMES, default: 'SUCCESS' },

  previousHash: String,                                    // tamper-evident chain (section 11.5)
  hash:         String,

  expiresAt: { type: Date, required: true },               // ⭐ per-document retention
}, { versionKey: false })

AuditLogSchema.index({ clinicId: 1, occurredAt: -1 })
AuditLogSchema.index({ clinicId: 1, 'actor.id': 1, occurredAt: -1 })
AuditLogSchema.index({ clinicId: 1, 'entity.type': 1, 'entity.id': 1, occurredAt: -1 })
AuditLogSchema.index({ clinicId: 1, action: 1, occurredAt: -1 })
AuditLogSchema.index({ clinicId: 1, severity: 1, occurredAt: -1 })
AuditLogSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })
```

Three MongoDB-specific decisions here, each replacing something Postgres did natively:

**Retention becomes a per-document TTL, and it is better.** The relational plan used monthly range
partitions that had to be detached and archived by a maintenance job. Here, `expiresAt` is
computed **at write time** from the category — 7 years for `CLINICAL` and `FINANCIAL`, 2 years for
`AUTH` and `SYSTEM` (section 11.6) — and a single TTL index enforces every policy simultaneously.
Postgres could not do differentiated retention with one partition scheme; MongoDB does it with one
index and no job.

**Time-series collections were considered and rejected.** They are the idiomatic MongoDB answer
for append-only, time-ordered data and would bucket the audit log for a large storage win. They
were rejected for exactly one reason: their expiry is a single collection-level
`expireAfterSeconds`, which cannot express per-category retention. Differentiated retention is a
compliance requirement; storage efficiency is an optimisation. Revisit if MongoDB adds per-document
expiry to time-series collections.

**Immutability is enforced by a database user, not a trigger.** MongoDB has no table triggers
outside Atlas, so the Postgres `REVOKE UPDATE/DELETE` plus trigger approach does not port. The
replacement is a **dedicated MongoDB user with a custom role granting only `insert` and `find` on
`auditLogs`**, used over a **separate connection** reserved for audit writes. The application's
main user has no privileges on the collection at all. Details and the remaining layers are in
section 11.5.

### 8.14 Indexing strategy

The rules, then the consequences.

| Rule | Reason |
|------|--------|
| **ESR order: Equality, then Sort, then Range.** `{ clinicId: 1, status: 1, startsAt: 1 }` serves `clinicId = x AND status = y AND startsAt BETWEEN a AND b`. | A compound index used out of order silently degrades to a collection scan on the sort or range portion. This is the single most common MongoDB performance bug. |
| **`clinicId` is the first key of nearly every compound index.** | It is in every query by construction (section 8.15), gives tenant locality, and becomes the shard key prefix without re-indexing. |
| **Index prefixes are reused, not duplicated.** `{ clinicId, startsAt }` also serves `{ clinicId }`. | Every index costs write throughput and RAM in the working set. |
| **Multikey indexes for embedded arrays** — `diagnoses.code`, `roles.roleId`, `allocations.invoiceId`, `batches.expiresAt`. | This is what keeps embedding from making data unqueryable. |
| **`partialFilterExpression` on every unique index paired with soft delete.** | Otherwise a deactivated user's email is reserved forever. |
| **`sparse: true` on optional references** (`encounterId`, `appointmentId`). | Avoids indexing thousands of nulls. |
| **`.explain('executionStats')` on every new query pattern, in the PR.** | `totalDocsExamined` should be within a small factor of `nReturned`. CI fails a repository test whose query plan reports a `COLLSCAN` on a tenant-scoped collection. |
| **Covered queries where it is cheap.** A list that needs only indexed fields never touches the documents. | |

**Text search.** `pg_trgm` has no direct equivalent. Two options, chosen by deployment:

- **MongoDB Atlas Search** (Lucene-backed) if we host on Atlas — real fuzzy matching, autocomplete
  and relevance ranking on patient name, phone and MRN. This is the better experience.
- **Self-hosted:** a compound index plus **anchored** regex (`/^smi/i`) is index-eligible; an
  unanchored `/.*smi.*/` is not and will scan. Front-desk search is prefix search in practice, so
  this is acceptable, plus a `$text` index on a combined `searchName` field for word matching.

The fallback is not silent: the repository exposes one `searchPatients()` method with two
implementations behind the same interface, selected by config — precisely the pattern section 2.4
requires of infrastructure.

### 8.15 What MongoDB does not give us, and what replaces it

Stated plainly, because these are real costs of the decision and each one needs an owner in the
codebase rather than a hope.

| Lost | Replacement | Where it lives |
|------|-------------|----------------|
| **Foreign keys and cascade deletes** | Deletion is handled explicitly in use cases. We soft-delete clinical and financial data anyway, so cascades were already the wrong semantics — a deleted doctor must not take their patients' encounter history with them. A nightly **integrity job** reports orphans (`encounter.patientId` with no patient, `file.owner.id` with no owner) as a `SYSTEM` audit event rather than deleting anything. | `apps/worker` — `maintenance` queue |
| **Schema enforcement at the database** | Mongoose validators for the application path, plus a generated **`$jsonSchema` collection validator** applied at `validationLevel: 'strict'` in migrations. Anything writing outside the app — a `mongosh` session, an import script — is still rejected. Both are generated from the same TypeScript unions, so they cannot drift. | `packages/db/src/validators/` |
| **`SERIAL` / sequences** for human-facing numbers (`INV-2026-000318`, `MRN-000142`, `TKT-001204`) | A `counters` collection and one atomic operation: `findOneAndUpdate({ _id: 'invoice:2026:clinicX' }, { $inc: { seq: 1 } }, { returnDocument: 'after', upsert: true })`. Atomic on a single document, so it is safe under concurrency without a transaction. | `packages/db/src/counters.ts` |
| **Row-level security** for tenant isolation | A **global Mongoose plugin** that inspects every query on a tenant-scoped model and **throws** if `clinicId` is absent — it does not quietly inject one, because a silent injection hides the bug. Backed by a repository-layer test asserting the throw, and by `clinicId` leading every index. | `packages/db/src/plugins/tenant-guard.ts` |
| **`CHECK` constraints** | Conditional-update filters (the signed-note and stock examples above) plus `$jsonSchema`. The pattern is uniform: put the precondition in the query filter and assert `matchedCount`, never read-then-write. | Repositories |
| **Cross-document referential reads (`JOIN`)** | Embedding for the always-together cases (8.2), snapshots for display, and `$lookup` in aggregations for reports. `$lookup` is deliberately confined to the reporting repositories — if a transactional path needs one, the embedding decision was wrong. | `infrastructure/*.reporting.ts` |
| **A migration tool** | **`migrate-mongo`**: ordered, numbered, reversible scripts committed to the repo and run by `migrate-mongo up` in CI/CD, exactly as `prisma migrate deploy` would have been. Index creation, validator updates and data backfills all go through it. Documents carry a `schemaVersion` where lazy migration is safer than a bulk rewrite. | `packages/db/migrations/` |
| **`ILIKE` / trigram search** | Atlas Search or anchored-regex plus `$text` (section 8.14). | `patient.repository.ts` |

One more that is easy to miss, and is the most dangerous:

> **`updateMany`, `bulkWrite` and `insertMany` bypass Mongoose document middleware.** The audit
> hooks in section 11.3 are document and query middleware; a bulk operation slips past them and
> produces an **unaudited write**. Mitigation is threefold: bulk operations are only permitted
> inside repositories, an ESLint rule bans the model methods anywhere else, and the repository
> helpers that wrap them record an explicit `audit.record()` with the affected count and filter.
> This is documented in the definition of done (section 18.3).

### 8.16 Growth, TTL and sharding

| Collection | Growth | Plan |
|-----------|--------|------|
| `auditLogs` | Largest by an order of magnitude; ~50–200 documents per active user per day | Per-document TTL (8.13); `$merge` to cold storage before expiry; first candidate for sharding on `{ clinicId: 1, occurredAt: 1 }` |
| `stockMovements` | Unbounded ledger | Archive to `stockMovementArchive` past 3 years; `balanceAfter` means history is auditable without replaying from zero |
| `appointments` | ~10k/year per busy doctor | Compound indexes in 8.7 cover every view; archive completed appointments past 3 years |
| `slotReservations` | 12 documents per appointment-hour | Deleted on cancellation; TTL reclaims abandoned provisional holds |
| `notifications`, `outboxEvents`, `refreshTokens`, `idempotencyKeys`, `invitations` | High churn | **TTL indexes — no cleanup jobs at all** |
| `encounters` | Steady, small documents | Embedded notes keep these in the low KB; no action needed for years |

**Sharding.** Not needed for v1 and explicitly not premature: a single replica set comfortably
serves a multi-clinic deployment well past the point this product needs to reach. When it is
needed, the shard key is `{ clinicId: 1, _id: 1 }` — clinic-prefixed so a tenant's data is
co-located and every existing query (which already leads with `clinicId`) is targeted rather than
scatter-gather. Because `clinicId` is the first key of nearly every index already, adopting it
requires no re-indexing and no query changes. **Zone sharding** can later pin a large clinic to
dedicated hardware, which is a cleaner answer to the noisy-neighbour problem than the
"shard the tenant onto its own database" plan the Postgres design had to fall back on.

**Working set.** The metric that matters for MongoDB is whether indexes plus hot documents fit in
RAM. It is monitored from Phase 0 (`db.serverStatus().wiredTiger.cache`), alerting before the
cache eviction rate climbs — because the failure mode is a gradual, confusing slowdown rather
than a clean error.

---

## 9. API surface and mobile reuse

### 9.1 The promise, and how it is kept

The React Native app must not require a second backend. That is guaranteed by three rules:

1. **Every capability exists as a versioned REST endpoint under `/api/v1`.** Server Actions and
   React Server Components are allowed in the web UI, but only as *additional* callers of the
   same use cases — never as the only way to perform an operation. If a feature can only be done
   through a Server Action, it does not exist for mobile.
2. **`packages/contracts` is the single source of truth.** Zod schemas define every request and
   response; `zod-to-openapi` generates the OpenAPI document; `packages/api-client` is generated
   from it. Web hooks and mobile hooks import the same client.
3. **Auth is token-based underneath.** The web uses an httpOnly cookie holding the same JWT that
   mobile sends as `Authorization: Bearer`. One verification path, one session shape.

```
packages/contracts (Zod)
        │
        ├──▶ route handlers      — runtime request/response validation
        ├──▶ OpenAPI document    — /api/openapi, published for any client
        ├──▶ packages/api-client — typed fetch client
        │            ├──▶ apps/web    (TanStack Query hooks)
        │            └──▶ apps/mobile (the same hooks, same cache keys)
        └──▶ forms               — AutoForm validates against it client-side
```

### 9.2 Conventions

| Concern | Convention |
|---------|-----------|
| Versioning | Path-based: `/api/v1/...`. `v2` may live beside `v1`; both call the same use cases with different serialisers. |
| Naming | Plural nouns, HTTP verbs for CRUD. Non-CRUD transitions are explicit sub-resources: `POST /appointments/{id}/cancel`, not a `PATCH` that sets a status string. |
| Pagination | Cursor-based, `?cursor=&limit=` with a max of 100. Cursors are opaque base64. Offset pagination degrades badly past a few thousand rows. |
| Filtering | Explicit whitelisted params only, never a raw query object from the client. |
| Sparse fields | `?include=patient,doctor` — opt-in expansion, so the default response stays small. |
| Idempotency | An `Idempotency-Key` header is honoured on every POST that moves money or creates a booking. |
| Errors | One envelope with a stable machine-readable `code`. |
| Rate limits | Per user and per IP in Redis; stricter on auth routes and file presign. |
| Time | All timestamps ISO-8601 UTC. The client localises. |
| Money | Serialised as a string plus a `currency` field, never a JSON number — IEEE-754 loses cents. |

**Response envelopes**

```jsonc
// success — single
{ "data": { "id": "clx...", "startsAt": "2026-09-14T09:30:00Z" },
  "meta": { "requestId": "req_01J8" } }

// success — collection
{ "data": [],
  "meta": { "requestId": "req_01J8", "nextCursor": "eyJpZCI6", "hasMore": true } }

// error
{ "error": {
    "code": "APPOINTMENT_SLOT_TAKEN",
    "message": "That slot was just booked by someone else.",
    "details": [ { "field": "startsAt", "issue": "conflict" } ]
  },
  "meta": { "requestId": "req_01J8" } }
```

`code` is stable and translatable; `message` is for humans and may change. Clients switch on
`code`, never on `message`.

### 9.3 Endpoint map (v1)

```
POST   /api/v1/auth/login                        POST   /api/v1/auth/refresh
POST   /api/v1/auth/logout                       POST   /api/v1/auth/forgot-password
POST   /api/v1/auth/reset-password               POST   /api/v1/auth/accept-invite

GET    /api/v1/me                                PATCH  /api/v1/me
GET    /api/v1/me/permissions                    GET    /api/v1/me/navigation
GET    /api/v1/me/notifications                  POST   /api/v1/me/notifications/{id}/read

GET    /api/v1/patients                          POST   /api/v1/patients
GET    /api/v1/patients/{id}                     PUT    /api/v1/patients/{id}
POST   /api/v1/patients/{id}/archive             POST   /api/v1/patients/{id}/restore
POST   /api/v1/patients/{id}/portal-invitation
GET    /api/v1/patients/{id}/timeline            GET    /api/v1/patients/{id}/files
GET    /api/v1/patients/{id}/appointments        GET    /api/v1/patients/{id}/invoices
POST   /api/v1/patients/check-duplicates

GET    /api/v1/doctors                           POST   /api/v1/doctors
GET    /api/v1/doctors/{id}                      PUT    /api/v1/doctors/{id}
GET    /api/v1/specialties                       POST   /api/v1/specialties
PUT    /api/v1/specialties/{id}
GET    /api/v1/doctors/{id}/availability         PUT    /api/v1/doctors/{id}/availability
GET    /api/v1/doctors/{id}/slots                POST   /api/v1/doctors/{id}/time-off

GET    /api/v1/appointments                      POST   /api/v1/appointments
GET    /api/v1/appointments/{id}                 PATCH  /api/v1/appointments/{id}
POST   /api/v1/appointments/{id}/cancel          POST   /api/v1/appointments/{id}/reschedule
POST   /api/v1/appointments/{id}/check-in        POST   /api/v1/appointments/{id}/no-show
POST   /api/v1/appointments/{id}/complete

POST   /api/v1/encounters                        GET    /api/v1/encounters/{id}
PATCH  /api/v1/encounters/{id}                   POST   /api/v1/encounters/{id}/sign
POST   /api/v1/encounters/{id}/addendum          POST   /api/v1/encounters/{id}/vitals
POST   /api/v1/encounters/{id}/diagnoses         POST   /api/v1/encounters/{id}/prescriptions
GET    /api/v1/prescriptions/{id}/pdf

POST   /api/v1/files/presign-upload              POST   /api/v1/files/{id}/confirm
GET    /api/v1/files/{id}/download-url           DELETE /api/v1/files/{id}

GET    /api/v1/billing/invoices                  POST   /api/v1/billing/invoices
POST   /api/v1/billing/invoices/{id}/issue       POST   /api/v1/billing/invoices/{id}/void
GET    /api/v1/billing/payments                  POST   /api/v1/billing/payments
POST   /api/v1/billing/payments/{id}/refund      GET    /api/v1/billing/reports/daily

GET    /api/v1/inventory/items                   POST   /api/v1/inventory/items
PATCH  /api/v1/inventory/items/{id}              POST   /api/v1/inventory/items/{id}/movements
GET    /api/v1/inventory/alerts                  GET    /api/v1/inventory/suppliers

GET    /api/v1/support/tickets                   POST   /api/v1/support/tickets
GET    /api/v1/support/tickets/{id}              POST   /api/v1/support/tickets/{id}/messages
POST   /api/v1/support/tickets/{id}/assign       POST   /api/v1/support/tickets/{id}/status

GET    /api/v1/admin/clinic                      GET    /api/v1/admin/clinic/settings
PUT    /api/v1/admin/clinic/profile              PUT    /api/v1/admin/clinic/holidays
GET    /api/v1/admin/branches                    POST   /api/v1/admin/branches
PUT    /api/v1/admin/branches/{id}               PUT    /api/v1/admin/branches/{id}/working-hours
GET    /api/v1/admin/users                       POST   /api/v1/admin/users/invite
GET    /api/v1/admin/users/{id}                  PUT    /api/v1/admin/users/{id}
POST   /api/v1/admin/users/{id}/status           PUT    /api/v1/admin/users/{id}/roles
POST   /api/v1/admin/users/{id}/invitation       POST   /api/v1/admin/users/{id}/password-reset
GET    /api/v1/admin/roles                       POST   /api/v1/admin/roles
GET    /api/v1/admin/roles/{id}                  PUT    /api/v1/admin/roles/{id}
DELETE /api/v1/admin/roles/{id}                  PUT    /api/v1/admin/roles/{id}/permissions
GET    /api/v1/admin/permissions
GET    /api/v1/admin/audit-logs                  GET    /api/v1/admin/audit-logs/export
GET    /api/v1/admin/analytics/overview
```

### 9.4 What mobile gets for free, and what it needs later

| Concern | v1 web | Mobile addition |
|---------|--------|-----------------|
| Auth | JWT in an httpOnly cookie | The same JWT as a Bearer token, plus `RefreshToken` rows for long-lived sessions — **already in the schema** |
| Data | REST + TanStack Query | The same client and the same query keys; persist the cache for offline reads |
| Files | Presigned PUT from the browser | The same presign endpoint from the device |
| Push | In-app and email | Register a device token; `NotificationChannel.PUSH` is **already in the enum** |
| Realtime | Revalidation and polling in v1 | SSE or WebSocket added as a new transport over the same domain events |

None of these require reworking v1 — they are additive, which is the whole point of doing the
contract work up front.

---

## 10. Auth and portal routing flow

### 10.1 One login, four destinations

```
  User submits credentials at /login
            │
            ▼
  Credentials provider verifies argon2id hash
     ├─ user not found / bad password ─▶ generic error + failedLoginCount++
     ├─ lockedUntil in the future      ─▶ "account locked" + AUTH audit entry (DENIED)
     └─ ok
            │
            ▼
  Resolve the session payload
     • userId, clinicId
     • roles[]  (from UserRole)
     • permissions Map<key, scope>  (union across roles, highest scope wins)
     • doctorId / patientId if the user has that profile
     • permVersion (from Clinic.permissionVersion)
            │
            ▼
  Compute the landing portal
     portals = ['admin','staff','doctor','patient']
               .filter(p => permissions.has(`portal.${p}:access`))
     landing = user.preferredPortal (if still in portals)
             ?? portals sorted by Role.priority desc, first
            │
            ▼
  Set httpOnly, Secure, SameSite=Lax JWT cookie ─▶ redirect to /{landing}
            │
            ▼
  Write an AUTH audit entry (SUCCESS): actor, ip, userAgent, requestId
```

A user holding several portal permissions (a doctor who owns the clinic) gets a **portal
switcher** in the top bar. The chosen portal is stored on `User.preferredPortal` so the next
login lands where they left off.

### 10.2 Middleware

`apps/web/src/middleware.ts` is intentionally thin: is there a valid session, and if not, can one
be refreshed? It never queries the database. It runs on the Node.js runtime (stable since Next.js
15.5) but still imports only the dependency-free subset exported as `@clinic/core/edge`.

```ts
export async function middleware(request: NextRequest) {
  if (pathname.startsWith('/api/')) return forward()      // API routes authenticate in withApi

  const claims = await verifiedClaims(request.cookies.get(ACCESS_COOKIE))
  if (!claims) {
    if (isPublicPage(pathname)) return forward()
    // The refresh cookie is scoped to /api/v1/auth and invisible here; a hint cookie says one exists.
    return request.cookies.has(SESSION_HINT_COOKIE)
      ? redirectTo(`/api/v1/auth/refresh?next=${next}`)   // renew silently
      : redirectTo(`/login?next=${next}`)
  }
  if (pathname === '/' || pathname === '/login') return redirectTo(landingPath(claims.prt, claims.pp))
  return forward()                                        // stamps x-request-id and x-pathname
}
```

Four deliberate choices — the first a change from the original design:

- **Portal permissions are checked in each portal's layout, not in middleware.** The original
  sketch gated `/admin` here from the JWT. Phase 1 moved it to `requirePortal()`, which runs
  `assertCan` against *current* grants and records `permission.denied` in the audit log before
  redirecting. Middleware can do neither: it cannot reach the database, and its claims may be up
  to fifteen minutes stale. Portal pages await the same `requirePortal()`, memoised per request:
  a layout and its page render concurrently, so a page that only required an actor would run its
  own checks mid-redirect and audit a second, misleading denial. See `docs/adr/0018`.
- **Wrong-portal access redirects rather than 403s.** A patient who bookmarks `/staff` is not an
  attacker, they are lost — but the attempt is on the record either way.
- **A valid signature on an ended session** (signed out on another device) sends the browser
  through `/api/v1/auth/session-ended`, which clears the cookies. Without it the middleware would
  keep trusting the token and loop between the page and the sign-in screen.
- **The JWT carries a compact permission map** — one character per scope — so an admin's full set
  fits comfortably in a 4 KB cookie.

### 10.3 Session shape

```ts
interface AccessTokenClaims {   // HS256 with the algorithm pinned; 15 minutes; iss + aud checked
  sub: string                   // user id
  cid: string                   // clinic id — must equal the installation's CLINIC_ID (ADR-0005)
  sid: string                   // session (refresh-token family) id — a revoked family ends the token
  tv: number                    // user.security.tokenVersion — moves on password change and reset
  pv: number                    // clinic.permissionVersion — a mismatch re-resolves grants (7.7)
  name: string
  rls: string[]                 // role keys, for display only
  prm: Record<PermissionKey, 'O' | 'A' | 'C' | 'G'>   // the authority, one character per scope
  prt: PortalKey[]              // portals, most relevant first
  pp: PortalKey | null          // preferred portal
  did?: string                  // doctor profile id — Phase 2
  pid?: string                  // patient profile id — Phase 2
  imp?: string                  // impersonator — Phase 2 stretch
}
```

**The signature is necessary, not sufficient.** Every authenticated request also confirms in the
database that the user is still ACTIVE, that the session family is live, and that `tv` still
matches. Suspension, signing out and a password change therefore take effect on the next request
rather than whenever the token would have expired. That costs three indexed reads per request;
caching them in Redis is the scale path in section 15.2.

### 10.4 Password and session policy

| Control | v1 |
|---------|-----|
| Hashing | argon2id, per-user salt, tuned memory cost |
| Password rules | Minimum 12 characters, checked against a common-password list. No forced rotation, no composition rules — both push users toward weaker, written-down passwords. |
| Brute force | Per-account lockout doubling from the fifth consecutive failure (30s, 1m, 2m, 4m, 8m, then a flat 15 minutes from the tenth), forgiven after 24 hours; plus Redis rate limits per email and — behind a trusted proxy only — per IP. Every rejection spends the time of a real hash check, so response time never reveals whether an account exists |
| Reset tokens | Single-use, 30-minute expiry, only the hash is stored, invalidated on use or on password change |
| Session | 15-minute access token, 30-day refresh token, sliding. Refresh tokens are revocable per device from a "sessions" page. |
| MFA | TOTP, schema is in place (`mfaSecret`); enforced for Admin in v1.1, optional for everyone else |
| Logout | Clears the cookie and revokes the refresh token so mobile sessions die too |

---

## 11. Audit logging

**Requirement:** *"see every single thing done on the system."* Taken literally, that means
every write, every privileged read, and every failed attempt.

### 11.1 Three capture paths

| Path | Catches | Why it exists |
|------|---------|---------------|
| **1. Automatic (Mongoose plugin)** | Every create / update / delete on an audited model, with a field-level before/after diff | The safety net. A developer cannot forget to audit a new write, because they never wrote the audit call. Its one gap — bulk operations — is named and monitored in section 11.3. |
| **2. Explicit (`audit.record()`)** | Domain events that carry *intent*: login, logout, permission denied, role changed, note signed, invoice voided, file downloaded, impersonation started | The automatic path sees documents change; it cannot see *why*. Intent is what an auditor actually reads. |
| **3. PHI read logging** | Every read of a patient record, encounter, prescription or clinical file | HIPAA-style access logging. Writes alone do not answer "who looked at this patient's file". |

Path 1 without path 2 gives a log nobody can interpret. Path 2 without path 1 gives a log with
holes. Both are required.

### 11.2 Actor context without prop-drilling

The Mongoose middleware needs to know *who* is acting, but it fires from deep inside
repositories that have no idea a request exists. Passing an actor through every function
signature would poison every API in the codebase. Instead, `AsyncLocalStorage` carries an
ambient request context.

```ts
// packages/core/src/context/request-context.ts
import { AsyncLocalStorage } from 'node:async_hooks'
import { processSingleton } from '@clinic/config'

export interface RequestContext {
  requestId: string
  actorId?: string
  actorType: ActorType
  actorLabel?: string
  actorRoles: string[]
  clinicId?: string // absent on anonymous requests
  impersonatorId?: string
  ipAddress?: string
  userAgent?: string
}

// One store per process, not one per bundle copy of this file — see below.
const storage = processSingleton(
  'core:request-context',
  () => new AsyncLocalStorage<RequestContext>(),
)

export const runWithContext = <T>(ctx: RequestContext, fn: () => Promise<T>) =>
  storage.run(ctx, fn)

export const currentContext = () => storage.getStore()
```

`withApi` opens the context for every HTTP request; the BullMQ worker opens one per job with
`actorType: 'SYSTEM'`. Nothing downstream has to thread an actor argument.

**The store must be process-wide.** Next.js can compile instrumentation, route handlers and
pages into separate bundles, each with its own copy of the workspace packages. State that one
copy sets and another reads — this store, the audit sink installed at startup, the scope
resolver registry — would silently become two objects: the sink missing where the write
happens, or reading an empty context and recording entries with no actor. Such state lives on
`globalThis` through `processSingleton` (`@clinic/config`), and a unit test loads two module
copies to prove it is shared.

### 11.3 Automatic capture: the Mongoose audit plugin

Prisma's `$extends` becomes a **global Mongoose plugin** that installs middleware on every
audited schema. The intent is identical; the mechanics and the failure modes are not.

```ts
// packages/db/src/plugins/audit-capture.ts
const AUDITED = {
  Patient:      { category: 'CLINICAL',       phiRead: true  },
  Encounter:    { category: 'CLINICAL',       phiRead: true  },
  Prescription: { category: 'CLINICAL',       phiRead: true  },
  LabOrder:     { category: 'CLINICAL',       phiRead: true  },
  Appointment:  { category: 'CLINICAL',       phiRead: false },
  Invoice:      { category: 'FINANCIAL',      phiRead: false },
  Payment:      { category: 'FINANCIAL',      phiRead: false },
  StockMovement:{ category: 'INVENTORY',      phiRead: false },
  InventoryItem:{ category: 'INVENTORY',      phiRead: false },
  User:         { category: 'ADMIN',          phiRead: false },
  Role:         { category: 'ACCESS_CONTROL', phiRead: false },
  File:         { category: 'FILE',           phiRead: false },
} as const

export function auditCapture(schema: Schema, opts: { model: keyof typeof AUDITED }) {
  const cfg = AUDITED[opts.model]

  // ── writes through a document: create / save ──────────────────────────────
  schema.post('save', function (doc) {
    enqueueAuditEntry({
      action: `${dotted(opts.model)}.${this.isNew ? 'created' : 'updated'}`,
      category: cfg.category, entity: { type: opts.model, id: doc._id },
      before: null, after: redactPhi(changedPaths(this)),
    })
  })

  // ── writes through a query: the diff needs a pre-image ────────────────────
  schema.pre(/^findOneAnd(Update|Replace|Delete)$/, async function () {
    // `this` is the Query, not the document — the previous state has to be read
    // explicitly, and it must run on the same session so it sees the transaction.
    this.set('__before', await this.model
      .findOne(this.getFilter()).session(this.getOptions().session ?? null).lean())
  })

  schema.post(/^findOneAnd(Update|Replace|Delete)$/, function (result) {
    const before = this.get('__before')
    enqueueAuditEntry({
      action: `${dotted(opts.model)}.${this.op.includes('Delete') ? 'deleted' : 'updated'}`,
      category: cfg.category, entity: { type: opts.model, id: before?._id ?? result?._id },
      before: redactPhi(onlyChanged(before, result)),
      after:  redactPhi(onlyChanged(result, before)),
    })
  })

  // ── PHI reads: the access log HIPAA actually asks for ─────────────────────
  if (cfg.phiRead) {
    schema.post(/^find/, function (result) {
      enqueueAuditEntry({
        action: `${dotted(opts.model)}.viewed`, category: cfg.category,
        entity: { type: opts.model, id: idsOf(result) }, severity: 'INFO',
      })
    })
  }
}
```

Six details that matter, three of them specific to Mongoose and genuinely dangerous:

- **Query middleware has no document.** `findOneAndUpdate` runs against a filter, so the
  pre-image must be fetched in a `pre` hook — and **on the same session**, or inside a
  transaction the hook reads stale data from outside it and writes a wrong diff.
- **`updateMany`, `bulkWrite` and `insertMany` bypass this entirely.** They are query-level bulk
  operations and no document middleware fires. This is the one way to produce a **silently
  unaudited write** in the whole system. Mitigation is in section 8.15: bulk methods are confined
  to repositories, banned elsewhere by lint, and the repository wrappers emit an explicit
  `audit.record()` naming the filter and the affected count. It is on the definition-of-done
  checklist for that reason.
- **`.lean()` reads skip document middleware but not query middleware**, so PHI-read capture still
  fires — which is what we want, since almost every read path uses `.lean()`.
- **Only changed fields are stored.** Persisting whole documents would inflate the largest
  collection in the system and make the diff viewer unreadable.
- **`redactPhi`** replaces the *values* of clinical free-text fields with `"[redacted]"` while
  keeping the field names, so the log proves what was touched without copying the medical record
  into a second, less-protected collection.
- **`enqueueAuditEntry` is non-blocking**, buffered and flushed by the worker over the restricted
  audit connection (section 11.5). The audit write never sits on the request's critical path.
- **Inside a transaction, captured entries wait for the commit.** `withTransaction` keeps what the
  hooks capture on its session and hands it to the audit sink only once the transaction commits: a
  write that rolls back leaves no entry, and an attempt the driver retries starts with an empty
  buffer. Reads of protected records are not deferred — a record shown inside a transaction that
  later rolled back was still seen. Explicit `audit.record()` calls belong after the transaction
  returns, for the same reason.

> **A note on change streams.** They were considered as the capture mechanism, since they observe
> every write including bulk operations and cannot be bypassed. They were rejected as the
> *primary* path because the oplog carries no actor: a change stream sees that a document changed,
> never who changed it or why, and reconstructing that after the fact is exactly the ambiguity
> section 11.1 exists to avoid. They are used instead as an **independent watchdog** — a worker
> tails the audited collections and raises a `CRITICAL` alert on any write with no corresponding
> audit entry within a grace window. That turns the bulk-write gap from an invisible hole into a
> monitored one.

### 11.4 Explicit domain audit

```ts
await audit.record({
  action: 'appointment.cancelled',
  category: 'CLINICAL',
  entityType: 'Appointment',
  entityId: appointment.id,
  entityLabel: `${appointment.number} — ${patient.fullName} with Dr ${doctor.lastName}`,
  metadata: { reason: input.reason, cancelledBy: 'STAFF', hoursBeforeStart: 18 },
  severity: 'NOTICE',
})
```

Events that are **always** recorded explicitly, because the write path alone cannot express them:

| Category | Actions |
|----------|---------|
| `AUTH` | `auth.login`, `auth.login_failed`, `auth.logout`, `auth.password_reset_requested`, `auth.password_changed`, `auth.locked_out`, `auth.mfa_enabled` |
| `ACCESS_CONTROL` | `role.created`, `role.permissions_changed`, `user.role_assigned`, `user.role_revoked`, `permission.denied`, `impersonation.started`, `impersonation.ended` |
| `CLINICAL` | `note.signed`, `note.amended`, `prescription.issued`, `encounter.reopened`, `chart.break_glass_access` |
| `FINANCIAL` | `invoice.issued`, `invoice.voided`, `payment.recorded`, `payment.refunded`, `discount.applied` |
| `FILE` | `file.uploaded`, `file.downloaded`, `file.deleted`, `file.share_link_created` |
| `SYSTEM` | `data.exported`, `backup.completed`, `job.failed`, `settings.changed` |

`permission.denied` is worth calling out: **failed authorisation is logged with
`outcome: DENIED`.** A user repeatedly probing endpoints they cannot reach is exactly the signal
an audit log exists to surface, and it is invisible if only successes are recorded.

### 11.5 Tamper evidence

An audit log an admin can quietly edit is not evidence. Three layers, cheapest first:

MongoDB has no table triggers outside Atlas, so the relational approach — `REVOKE UPDATE/DELETE`
plus a `BEFORE UPDATE` trigger — does not port. Four layers replace it:

1. **A restricted database user on a dedicated connection.** A custom MongoDB role grants
   `insert` and `find` on `auditLogs` and nothing else, and the audit writer uses its own
   `MongoClient` with those credentials. The application's main user has **no privileges on the
   collection at all** — it cannot update or delete an audit document even with arbitrary code
   execution in a request handler. This is stronger than the Postgres version, because the
   separation is at the connection rather than at a grant on a shared session.
2. **A `$jsonSchema` validator plus a required-field guard** on the collection, so a malformed or
   partial audit document is rejected by the server rather than accepted and later
   uninterpretable.
3. **Hash chain.** Each document stores `hash = sha256(previousHash + canonicalJson(doc))`.
   Altering any historical document breaks every subsequent hash. A nightly job verifies the
   chain and raises a `CRITICAL` alert on a mismatch. Chaining is per `clinicId` so a single
   sequence is not a write bottleneck.
4. **Off-box shipping.** Documents are streamed to an append-only external sink (S3 Object Lock
   or a log platform) so a full database compromise cannot erase the trail.

Layers 1 and 2 are mandatory in v1. Layers 3 and 4 are Phase 8.

> **The TTL caveat.** MongoDB's TTL monitor deletes expired documents, which means the database
> *does* delete audit documents even though the application cannot. That is intended — it is the
> retention policy executing — but it means expiry is enforced by configuration rather than by
> permission. Changing `expiresAt` on the collection's documents would require write access the
> app does not have, and any change to the TTL index itself is a migration, reviewed like code.

### 11.6 Retention and access

- **Retention:** 7 years for `CLINICAL` and `FINANCIAL` (typical medical-records statutes),
  2 years for `AUTH` and `SYSTEM`. Configurable per clinic; the default errs long.
- **Expiry:** enforced per document by the `expiresAt` TTL index (section 8.13), so the two
  retention classes coexist under one index and no cleanup job runs at all.
- **Archival:** a monthly `$merge` aggregation copies documents approaching expiry to cold
  storage before the TTL monitor reclaims them.
- **Who can read it:** `audit:read` — Admin only by default. Reading the audit log is itself an
  audited action (`audit.viewed`), because "who has been reading the audit log" is a question
  auditors ask.
- **The explorer UI** filters by actor, entity, action, category, severity, outcome and date
  range; renders a side-by-side field diff; exports CSV; and links `requestId` to the
  application trace so an engineer can see the full request behind an entry.

---

## 12. File storage

### 12.1 Why presigned, and never through the app server

Uploads and downloads bypass the application entirely. Streaming a 40 MB MRI through a Next.js
route handler burns a request slot for the duration of the transfer, caps throughput at the app
server's bandwidth, and is the fastest way to make the whole app feel slow. The app server only
issues short-lived credentials and records metadata.

```
UPLOAD
  1. Client  POST /api/v1/files/presign-upload  { ownerType, ownerId, fileName, mimeType, size }
  2. Server  assertCan(actor, 'file:create', owner)      ← permission check happens HERE
             validate MIME against the allowlist, validate size against the cap
             create FileObject { status: PENDING, storageKey }
             return { uploadUrl, fileId, headers }        ← presigned PUT, 5-minute expiry
  3. Client  PUT the bytes straight to S3 (progress bar, resumable for large files)
  4. Client  POST /api/v1/files/{id}/confirm
  5. Server  HEAD the object to verify size and checksum, set status
  6. Worker  antivirus scan  ─▶ CLEAN | INFECTED (quarantined and reported)

DOWNLOAD
  1. Client  GET /api/v1/files/{id}/download-url
  2. Server  assertCan(actor, 'file:read', file)  +  audit 'file.downloaded'
             refuse if status !== CLEAN
             return a presigned GET, 60-second expiry, Content-Disposition with the original name
  3. Client  follows the URL
```

The `confirm` step exists because a presigned PUT succeeds without telling the application.
Without it, an abandoned upload leaves a `PENDING` row forever; a nightly job sweeps
`PENDING` rows older than 24 hours.

**As built, one correction to step 2.** The content type and length go into the signed request,
but S3 does **not** cover them with the signature on a presigned PUT — a client can declare
`application/pdf`, send an executable, and storage will take it. That was tested against MinIO
rather than assumed. So what the URL really limits is *where* the bytes may go and *for how long*;
what they are is established at step 5, by reading the object's first sixteen bytes and checking
them against the declared type. A file whose bytes disagree is marked `FAILED`, audited as
`file.rejected`, and never becomes downloadable. This is what section 12.3's "validated against
the sniffed type, not the client-supplied header" costs in practice: one ranged read per upload.

### 12.2 Key layout

```
s3://clinic-prod/
  clinics/{clinicId}/
    patients/{patientId}/documents/{fileId}-{slug}.pdf
    encounters/{encounterId}/attachments/{fileId}-{slug}.jpg
    prescriptions/{prescriptionId}/{fileId}.pdf
    invoices/{invoiceId}/{fileId}.pdf
    tickets/{ticketId}/{fileId}-{slug}.png
    users/{userId}/avatar/{fileId}.webp
    clinic/logo/{fileId}.svg
```

`clinicId` is the first path segment so that a per-tenant IAM policy, a per-tenant lifecycle
rule, or a full-tenant export is a prefix operation. `fileId` in the object name keeps the key
unguessable and collision-free even when two patients upload `scan.pdf`.

### 12.3 Controls

| Control | Rule |
|---------|------|
| Bucket access | Private. No public read, ever. Block Public Access on. |
| Encryption | SSE-KMS at rest, TLS in transit. |
| MIME allowlist | `application/pdf`, `image/jpeg|png|webp|heic`, `image/dicom`, `text/csv`. Validated server-side against the *sniffed* type, not the client-supplied header. |
| Size caps | 25 MB per file by default, 100 MB for imaging categories; enforced in the presign policy so S3 rejects an oversized PUT itself. |
| Antivirus | ClamAV in the worker; `INFECTED` files are moved to a quarantine prefix and reported to the admin. |
| Derivatives | Thumbnails and web-optimised previews generated asynchronously; the original is never modified. |
| Deletion | Soft-delete the row and mark the object; a lifecycle rule purges after the retention window. Clinical files are never hard-deleted inside the retention period. |
| Sharing | No public links. A patient sharing a document generates a signed, expiring, revocable link recorded as `file.share_link_created`. |

---

## 13. Cross-cutting concerns

### 13.1 Configuration

All environment variables are parsed and validated **once**, at boot, by a Zod schema in
`packages/config`. The process refuses to start on a missing or malformed variable rather than
failing at 2am on the first request that needs it.

```ts
export const env = z.object({
  MONGODB_URI:     z.string().url(),          // must resolve to a replica set
  MONGODB_DB:      z.string(),
  MONGODB_AUDIT_URI: z.string().url(),        // restricted user, insert+find on auditLogs only
  REDIS_URL:       z.string().url(),
  AUTH_SECRET:     z.string().min(32),
  S3_ENDPOINT:     z.string().url(),
  S3_BUCKET:       z.string(),
  S3_ACCESS_KEY:   z.string(),
  S3_SECRET_KEY:   z.string(),
  MAIL_FROM:       z.string().email(),
  APP_URL:         z.string().url(),
  NODE_ENV:        z.enum(['development', 'test', 'production']),
  LOG_LEVEL:       z.enum(['debug', 'info', 'warn', 'error']).default('info'),
}).parse(process.env)
```

No `process.env` access anywhere else in the codebase — lint-enforced.

### 13.2 Errors

A single hierarchy in `packages/core/src/errors.ts`, mapped to HTTP in exactly one place.

| Domain error | HTTP | Envelope `code` |
|--------------|------|-----------------|
| `ValidationError` | 400 | `VALIDATION_FAILED` |
| `UnauthenticatedError` | 401 | `UNAUTHENTICATED` |
| `ForbiddenError` | 403 | `FORBIDDEN` |
| `NotFoundError` | 404 | `NOT_FOUND` |
| `ConflictError` (slot taken, duplicate SKU) | 409 | domain-specific |
| `BusinessRuleError` (cancel window passed) | 422 | domain-specific |
| `RateLimitError` | 429 | `RATE_LIMITED` |
| anything else | 500 | `INTERNAL_ERROR` |

Two rules: **a 500 never leaks a stack trace or a database message to the client** — it returns
the `requestId` so support can find the trace. And **404 is returned instead of 403 when
revealing existence is itself a leak** ("patient 8842 exists but you can't see them" is
information).

### 13.3 Logging and tracing

- Structured JSON via Pino. Every line carries `requestId`, `userId`, `clinicId`, `route`,
  `durationMs`.
- A **redaction list** strips `password`, `token`, `authorization`, `mfaSecret`, `nationalId`
  and clinical free-text fields before anything is written.
- OpenTelemetry spans across HTTP → use case → database → S3.
- The same `requestId` appears on the log line, the trace, the Sentry event **and the audit entry** —
  one identifier ties an auditor's question to an engineer's investigation.

### 13.4 Domain events and the outbox

```ts
export const EVENTS = {
  'appointment.booked':      z.object({ appointmentId: z.string() }),
  'appointment.cancelled':   z.object({ appointmentId: z.string(), reason: z.string().optional() }),
  'encounter.completed':     z.object({ encounterId: z.string() }),
  'invoice.issued':          z.object({ invoiceId: z.string() }),
  'payment.recorded':        z.object({ paymentId: z.string() }),
  'stock.low':               z.object({ itemId: z.string(), quantityOnHand: z.string() }),
  'ticket.created':          z.object({ ticketId: z.string() }),
} as const
```

Events are written to `outboxEvents` **inside the business transaction**, which is what makes
"the appointment was booked but the confirmation email never sent" — and its mirror image, "an
email went out for a booking that rolled back" — impossible.

**The relay is a change stream, not a poller.** A worker opens
`db.collection('outboxEvents').watch([{ $match: { operationType: 'insert' } }])` and pushes each
event onto BullMQ as it replicates. That is push-based rather than polled, so latency is
milliseconds instead of a poll interval, and it survives restarts by persisting the stream's
**resume token** after each batch. A slower polling sweep stays in the `maintenance` queue as a
backstop for anything a resume gap missed — the stream is the fast path, the sweep is the
guarantee.

Consumers are handlers registered in `apps/worker`. Adding "SMS the patient when an invoice is
issued" means adding one handler file. It does not mean editing the billing module.

### 13.5 Background jobs

| Queue | Jobs |
|-------|------|
| `notifications` | Appointment reminders (T-24h, T-2h), booking confirmations, invoice issued, ticket replies, low-stock alerts |
| `documents` | Prescription PDF, invoice PDF, receipt PDF, patient record export |
| `media` | Thumbnails, image optimisation, antivirus scan |
| `maintenance` | Nightly: no-show marking, `PENDING` file sweep, expiring-batch scan, depleted-batch archival, orphan-reference integrity scan, audit hash-chain verification, overdue-invoice transition, outbox backstop sweep, appointment-snapshot drift reconciliation |
| `audit` | Buffered audit-row flush |

Several jobs that the relational design needed have **no entry here at all**: expired
invitations, revoked refresh tokens, spent idempotency keys, processed outbox events, read
notifications and expired audit documents are all reclaimed by TTL indexes (section 8.16). Work
the database can do itself is work that cannot silently stop running.

Every job is **idempotent** and keyed, because at-least-once delivery means a job will
occasionally run twice. Retries use exponential backoff with a dead-letter queue and an admin
alert after final failure.

### 13.6 Internationalisation

`next-intl` with locale files per namespace. Two rules that prevent the usual mess:

- **No user-facing string is hardcoded in a component**, including validation messages and
  error copy. Domain errors carry a `code`; translation happens at the edge.
- **CI fails on a missing key in any locale**, so a new feature cannot ship English-only.

Arabic support means RTL from day one: Tailwind logical properties (`ps-4`, `me-2`, not `pl-4`,
`mr-2`) and `dir` driven by the active locale. Retrofitting RTL after 40 screens exist is a
week of work; doing it from the first component is free.

### 13.7 Caching

| What | Where | Invalidated by |
|------|-------|----------------|
| Effective permissions | Redis, 15 min | `Clinic.permissionVersion` bump |
| Doctor slot availability | Redis, 5 min, key `slots:{doctorId}:{date}` | `appointment.*`, `availability.*`, `timeoff.*` events |
| Clinic settings and feature flags | Redis, 10 min | `settings.changed` |
| Reference data (services, specialties, categories) | Redis, 1 hour | write-through on edit |
| Dashboard aggregates | Redis, 60 s | time-based only |

Clinical and financial records are **never** cached. Freshness beats latency when the data is a
medical record.

---

## 14. Frontend architecture

### 14.1 Server vs client components

The default is a **Server Component**. A component becomes a Client Component only when it needs
state, effects, or event handlers. This is a security property as much as a performance one:
data fetched in a Server Component is never serialised into the HTML payload, so a chart that
renders a summary does not ship the full medical record to the browser.

| Pattern | Use |
|---------|-----|
| Server Component + direct use-case call | Page-level reads: patient list, chart, dashboard |
| Client Component + TanStack Query | Anything interactive: calendar, filters, live queues |
| Server Action | Simple form submits in the web UI — **always** delegating to the same use case the REST endpoint calls |
| Route Handler | Everything mobile needs, plus anything a client component mutates |

After a Client Component changes something through a Route Handler, it shows the result with
`refresh()` from `@/lib/navigation/use-router`, never Next.js's own. In Phase 2 end-to-end runs,
Next.js 15.5 sometimes received a refresh in full and never rendered it — no error, no navigation,
nothing written to history, about one attempt in four once the server was warm — so a suspended
account kept showing as active. The portal shell stamps every server render with its request id;
the wrapper's `refresh()` reloads the page if no new stamp has arrived within 2.5 seconds. Lint
refuses `useRouter` from `next/navigation` everywhere except the wrapper.

### 14.2 Permission-driven navigation

The sidebar is **data**, not markup. A new role automatically gets a correct menu.

```ts
// apps/web/src/config/navigation.ts
export const NAVIGATION: NavSection[] = [
  { label: 'nav.clinical', items: [
    { href: '/staff/appointments', icon: Calendar,  labelKey: 'nav.appointments',
      permission: 'appointment:read' },
    { href: '/staff/patients',     icon: Users,     labelKey: 'nav.patients',
      permission: 'patient:read' },
  ]},
  { label: 'nav.finance', items: [
    { href: '/staff/billing',      icon: Receipt,   labelKey: 'nav.billing',
      permission: 'invoice:read', flag: 'billing' },
  ]},
  { label: 'nav.administration', items: [
    { href: '/admin/roles',        icon: Shield,    labelKey: 'nav.roles',
      permission: 'role:read' },
    { href: '/admin/audit-logs',   icon: ScrollText,labelKey: 'nav.audit',
      permission: 'audit:read' },
  ]},
]

// Sections with no visible items disappear entirely — no empty headers.
export const visibleNav = (actor: Actor, flags: FeatureFlags) =>
  NAVIGATION
    .map(s => ({ ...s, items: s.items.filter(i =>
        actor.permissions.has(i.permission) && (!i.flag || flags[i.flag])) }))
    .filter(s => s.items.length > 0)
```

The same source powers `GET /api/v1/me/navigation`, so the mobile app's tab bar is generated from
the identical definition.

### 14.3 The two components that carry the app

Thirty CRUD screens hand-written thirty times is thirty places for the same bug. Two abstractions
absorb most of it.

**`<DataTable>`** — column definitions, server-side pagination/sort/filter wired to the API
conventions in section 9.2, URL-synced state (so a filtered view is shareable and survives a
refresh), column visibility, CSV export, row actions gated by permission, and — importantly —
loading, empty, and error states supplied once rather than per screen.

**`<AutoForm schema={ZodSchema} sections={…}>`** — validates client-side with the same schema the
server validates with, maps `details[]` from the error envelope back onto the offending fields,
moves focus to the first of them, and warns before a page with unsaved changes is closed.

As built in Phase 2, two deliberate departures. The **field list lays the form out**, not the
schema: deriving layout from Zod breaks on the first refinement, preprocessing step or nested array,
and a form's order and wording are decisions a schema does not hold — what the schema guarantees is
that browser and server accept exactly the same input. Validation issues travel as **stable codes**
(`issueCode()` in `packages/contracts`), so both sides produce "TOO_LONG" rather than an English
sentence, and translation happens at the edge (13.6). The unsaved-changes warning covers closing or
reloading the page; in-app navigation is not intercepted, because the App Router offers no reliable
hook for it, so an "Unsaved changes" marker sits beside the save button instead. `<DataTable>` ships
search, filters, cursor pages, responsive columns and all three states; CSV export and column
visibility arrive with the audit log explorer, the first screen that needs them.

Bespoke UI is reserved for the screens that genuinely deserve it: the calendar, the encounter
workspace, the analytics dashboard.

### 14.4 Responsive strategy

Mobile-first Tailwind, with three structural adaptations rather than a shrunken desktop layout:

| Breakpoint | Shell | Tables | Calendar |
|-----------|-------|--------|----------|
| `< 768px` | Sidebar collapses to a bottom tab bar (top 4 permitted destinations) + "More" sheet | Tables become stacked cards; primary action is a sticky button | Single-day agenda list |
| `768–1024px` | Icon-only rail | Tables with the lowest-priority columns hidden | Day view, doctors in a horizontal scroll |
| `> 1024px` | Full sidebar | Full table | Week grid with a column per doctor |

Column priority is declared in the column definition (`priority: 1 | 2 | 3`), so responsive
behaviour is data too. Touch targets are 44px minimum throughout — the front desk uses tablets.

### 14.5 Accessibility

Radix primitives supply keyboard navigation, focus management and ARIA. On top of that: visible
focus rings, WCAG AA contrast, real `<label>` associations, live-region announcements for async
results, and — never colour alone to convey status. An appointment status is a coloured badge
**with text**; a red dot alone is invisible to roughly 8% of male users.

---

## 15. Scalability plan

The system is built as one deployable unit that scales horizontally. This section names the
order in which things will break and what is done about each.

### 15.1 Deployment topology

```
                    ┌──────────────┐
   users ──────────▶│ CDN + WAF    │  static assets, DDoS, TLS
                    └──────┬───────┘
                           ▼
                    ┌──────────────┐
                    │ Load balancer│
                    └──────┬───────┘
              ┌────────────┼────────────┐
              ▼            ▼            ▼
        ┌─────────┐  ┌─────────┐  ┌─────────┐
        │ web N1  │  │ web N2  │  │ web N3  │   stateless — scale on CPU/RPS
        └────┬────┘  └────┬────┘  └────┬────┘
             └────────────┼────────────┘
              ┌───────────┼───────────┬──────────────┐
              ▼           ▼           ▼              ▼
        ┌──────────┐ ┌────────┐ ┌──────────┐  ┌────────────┐
        │ MongoDB  │ │ Redis  │ │ S3 / R2  │  │ worker x M │  scales on queue depth
        │ PRIMARY  │ │        │ │          │  │ (BullMQ +  │
        └────┬─────┘ └────────┘ └──────────┘  │  change    │
             │ oplog replication              │  streams)  │
     ┌───────┴───────┐                        └────────────┘
     ▼               ▼
┌───────────┐  ┌───────────┐
│ SECONDARY │  │ SECONDARY │   reports and exports read here
└───────────┘  └───────────┘   (readPreference: secondaryPreferred)
```

The replica set is **not optional and not a production-only concern**: MongoDB requires one for
transactions (section 8.10) and change streams (section 13.4), so development and CI run a
single-node replica set too. A standalone `mongod` fails every transactional path, and it fails
them late — which is precisely the kind of environment drift that reaches staging undetected.

### 15.2 What breaks first, and the response

| Pressure point | Symptom | Response | When |
|----------------|---------|----------|------|
| Connection exhaustion | Driver pool saturation; serverless makes this much worse, since every cold instance opens its own pool | The MongoDB driver pools natively, so there is no PgBouncer equivalent to deploy — but `maxPoolSize` must be tuned **per instance against the server's total connection ceiling**, and a serverless target needs a cached client across invocations or Atlas's proxy | Before the second web node |
| Audit log volume | Slow inserts, bloated collection, slow explorer queries | Per-document TTL expiry; async buffered writes over a dedicated connection; `$merge` archival before expiry; first collection to shard | Designed in from Phase 0 |
| Report queries competing with the front desk | Calendar feels slow while an admin exports a year of revenue | Route reporting aggregations to a **secondary** with `readPreference: secondaryPreferred`. Note the trade: secondaries are eventually consistent, which is fine for analytics and **not** fine for anything transactional — the reporting repositories are separate for exactly this reason | ~5k appointments/month |
| Calendar queries | Day view slows as appointments grow | Compound indexes in ESR order (section 8.7); embedded display snapshots so the view needs no `$lookup`; cached slot computation; archive completed appointments past 3 years | ~100k appointments |
| Patient search | Unanchored regex forces a collection scan | Anchored-prefix regex on a compound index, plus a `$text` index; **Atlas Search** for real fuzzy matching where we host on Atlas (section 8.14) | ~50k patients |
| Notification fan-out | Reminder batches delay interactive jobs | Separate queues with separate concurrency; dedicated worker deployment | Phase 7 |
| Multi-clinic growth | Noisy-neighbour and blast-radius concerns | `clinicId` already leads every index, so `{ clinicId: 1, _id: 1 }` becomes the shard key with **no re-indexing and no query changes**; **zone sharding** then pins a large clinic to dedicated hardware. MongoDB has no row-level security, so tenant isolation is enforced by the mandatory-filter plugin in section 8.15 and tested as a security control, not assumed | Multi-tenant SaaS phase |
| A module genuinely outgrowing the monolith | One module dominates CPU or deploy risk | Extract it: it already has a public interface, its own collections and event-based coupling. Replace the in-process call with an HTTP client behind the same `index.ts`. **Callers do not change.** | Only when measured |

### 15.3 Performance budgets

Enforced in CI (Lighthouse) and in production alerting, so regressions are caught by a build
rather than by a receptionist.

| Metric | Budget |
|--------|--------|
| API p95 (read) | < 200 ms |
| API p95 (write) | < 500 ms |
| Calendar day view, 40 appointments | < 800 ms to interactive |
| Largest Contentful Paint (3G, mid-tier mobile) | < 2.5 s |
| Initial JS per portal route | < 200 KB gzipped |
| Background job p95 | < 30 s |
| WiredTiger cache hit ratio | > 95% — the metric that predicts a MongoDB slowdown before users feel it (section 8.16) |

---

## 16. Security and compliance posture

This system stores **Protected Health Information**. The architecture assumes HIPAA-style and
GDPR-style obligations even where a specific jurisdiction has not yet been chosen — retrofitting
these controls is far more expensive than building with them.

### 16.1 Controls in v1

| Area | Control |
|------|---------|
| Transport | TLS 1.2+ everywhere; HSTS; secure, httpOnly, SameSite cookies |
| At rest | Encrypted database volumes; SSE-KMS on object storage; **Client-Side Field Level Encryption** for the highest-sensitivity fields (`mfaSecret`, `nationalId`, insurance policy numbers) — encrypted by the driver with a key the database server never holds, so a compromised backup or a rogue DBA does not yield plaintext. Queryable Encryption is the upgrade path if we later need equality search on an encrypted field |
| Access | Least privilege by default (a new custom role starts with **zero** permissions, not "everything except"); minimum-necessary scoping (section 7.3) |
| Audit | Every write, every privileged read, every denial (section 11) |
| Input | Zod validation at every boundary with `.strict()`, so unknown keys are **rejected, not stripped silently** |
| **Query-operator injection** | The NoSQL-specific risk, and the one most often missed: a JSON body of `{ "email": { "$ne": null } }` becomes a *query operator* if it reaches a filter unvalidated. Three defences — every filter is built from Zod-parsed primitives and never from a raw request object; the driver runs with `sanitizeFilter` semantics enforced in the repository helpers; and an ESLint rule bans spreading `req.body` into any query. `$where` and `mapReduce` are disabled server-side outright |
| Output | React escapes by default; strict CSP; `dangerouslySetInnerHTML` is lint-banned |
| CSRF | SameSite cookies plus origin checks on state-changing routes |
| Rate limiting | Per-IP and per-user, aggressive on `/auth/*`, presign, and export |
| Secrets | Never in the repo; managed by the platform's secret store; rotation runbook in `docs/runbooks/` |
| Dependencies | `pnpm audit` and Dependabot in CI; lockfile committed; builds fail on a critical advisory |
| Backups | Continuous oplog-based point-in-time recovery (Atlas Backup, or `mongodump` plus oplog capture self-hosted); **restores rehearsed quarterly into a scratch cluster** — an untested backup is a hope, not a backup. The rehearsal explicitly verifies that CSFLE-encrypted fields decrypt with the restored key material, since a backup you cannot read is not a restore |
| Database access | Least-privilege MongoDB users, one per role: the app user has no privileges on `auditLogs`; the audit writer has `insert`+`find` there and nothing else; migrations run as a separate user; no user has `dropDatabase` outside break-glass |
| Sessions | Short access tokens, revocable refresh tokens, visible device list, logout-everywhere |

### 16.2 Data subject rights

The data model supports these deliberately, not incidentally:

- **Access / portability** — `GET /api/v1/patients/{id}/export` produces a machine-readable
  archive of everything held about a patient, generated as a background job.
- **Rectification** — records are editable, and every edit is in the audit log with a diff.
- **Erasure** — *bounded by medical-record retention law.* A patient may request erasure, and the
  system pseudonymises identifying fields while preserving the clinical and financial record for
  the statutory period. `deletedAt` plus a `pseudonymisedAt` marker. Note a document-model wrinkle: identifying data is **denormalised into snapshots** across appointments, encounters, invoices and tickets (section 8.7), so pseudonymisation is a multi-collection sweep driven by a single job, not one `UPDATE`. The job is written and tested alongside the snapshots themselves rather than discovered during a subject request; the audit trail keeps
  `actorLabel` denormalised so history stays readable after the user row is gone.
- **Consent** — consent forms are versioned; the version signed is recorded on the signature.

### 16.3 Explicitly out of scope for v1

Named here so they are decisions rather than oversights: HL7/FHIR interchange, DICOM viewing,
e-prescription network transmission, insurance claim clearing-house integration, SOC 2
certification, and a formal Business Associate Agreement programme. The data model does not
block any of them — `Diagnosis.codeSystem` and the `FileObject` category field exist partly so
that FHIR mapping later is a translation layer, not a migration.

---

## 17. Phased v1 delivery plan

Ordered so that each phase produces something demonstrable and nothing is built on a foundation
that has not been proven. Estimates assume one or two full-time engineers; treat them as
sequencing, not as a contract.

### Phase 0 — Foundations · ~1 week

Monorepo, tooling, and the walking skeleton.

- pnpm workspaces, Turborepo, TypeScript strict, ESLint + Prettier, restricted-import zones and
  the dependency-cruiser rules from section 5.3, each proven against a deliberate violation
- `docker-compose.yml`: MongoDB **as a single-node replica set** (`--replSet rs0` plus an
  auto-`rs.initiate()` init container, on port **27018** so the stack cannot collide with another
  local MongoDB), Redis, MinIO, Mailpit. The replica set is the first thing built, not a later
  production concern — transactions and change streams do not exist without it
- Mongoose connection, `packages/db` skeleton, the tenant-guard and soft-delete plugins
- `migrate-mongo` wired up; migration 0001 creates the `clinics`, `users` and `roles` collections
  with their indexes and `$jsonSchema` validators; seed script for a demo clinic and four users
- The restricted `auditLogs` database user and its separate connection, created by migration
- `packages/ui` bootstrapped with tokens, theme, and the first shadcn primitives
- `packages/config` env schema; `packages/testing` factories
- CI: lint, typecheck, unit tests, `migrate-mongo up` against a throwaway replica set,
  dependency-graph validation
- One end-to-end vertical slice — health check + a single seeded page — deployed to staging

**Exit criteria:** `pnpm dev` runs the whole stack from a clean clone; a transaction and a change
stream both succeed against the local container (proving the replica set); CI is green; a boundary
violation fails the build; a query missing `clinicId` throws; staging is live.

### Phase 1 — Identity, RBAC, portal shell · ~2 weeks

The spine everything else hangs from. Built first because retrofitting authorisation is the most
expensive mistake available.

- Token service (`jose`, argon2id): login / logout / refresh / forgot / reset / accept-invite, with
  account lockout, per-IP and per-email rate limits, and refresh-token reuse detection
- Permission catalogue, seeded roles and grants, the policy engine (`can` / `assertCan`)
- Session resolution with the permission map; `permVersion` invalidation
- Middleware, portal routing, landing resolution, portal switcher
- App shell: sidebar, topbar, breadcrumbs, permission-driven navigation
- `withApi` wrapper: auth, permission gate, validation, request context, error mapping
- Audit foundations: request context, the Mongoose audit plugin, the restricted audit connection,
  `AUTH` and `ACCESS_CONTROL` events

**Exit criteria:** four seeded users log in and each lands on the correct portal; a patient
typing `/admin` is redirected; a direct API call without permission returns 403 **and** writes a
`permission.denied` audit entry.

### Phase 2 — Clinic setup and directories · ~2 weeks

- Clinic profile, branches, working hours, holidays, settings
- User management: invite, activate, suspend, assign roles, force password reset
- **Roles and permissions editor** — the permission matrix UI (this is what makes the system
  dynamic; building it early forces the permission model to prove itself)
- Patient CRUD with duplicate detection; doctor CRUD with specialties
- `<DataTable>` and `<AutoForm>` reach production quality here, because five screens need them

**Exit criteria:** an admin creates a "Head Nurse" role, grants it three permissions, assigns a
user, and that user's menu and API access change on their next request — with no deploy.

### Phase 3 — Scheduling and appointments · ~2.5 weeks

- Doctor availability templates, time off, holiday interaction
- Slot computation with caching and invalidation
- Appointment CRUD, the status machine, status history
- Calendar: day/week, column per doctor, drag to reschedule, responsive agenda on mobile
- Check-in, check-out, no-show, walk-in queue
- Patient self-service booking with the cancellation-window rule
- Slot reservation documents (section 8.7); double-booking prevention proven with a
  **concurrent-request test**, not a code review — this is the path most likely to be quietly
  wrong under a document database

**Exit criteria:** staff books, reschedules and cancels; a patient books from their portal; two
simultaneous bookings for the same slot produce exactly one appointment and one clean 409.

One item on the list above is deliberately not in the first pass, and it is not on the exit
criteria: **drag to reschedule**. Moving an appointment works, through a dialog that offers the
doctor's open times; dragging is a second way to reach the same use case, and an expensive one to
make keyboard-accessible. It is worth doing once the calendar's shape has settled under real use.

The walk-in queue is here, and cost a decision rather than a feature flag: a walk-in takes the
doctor's **next open slot** and is checked in at once (ADR-0023), so it is an ordinary appointment
on an ordinary slot and the reservation grid keeps making double-booking impossible for everyone.
The waiting room is then a query — today's appointments that are checked in — rather than a second
kind of thing to keep in step with the first.

### Phase 4 — Clinical records and files · ~2.5 weeks

- Encounter lifecycle; the doctor's encounter workspace
- SOAP notes with sign-and-lock and addenda; vitals; ICD-10 diagnoses; allergies and chronic
  conditions with the chart banner
- Prescription builder and async PDF generation
- File storage end to end: presign, confirm, scan, download-url, patient visibility gating
- Patient medical timeline and document vault
- **The `ASSIGNED` scope decision from section 7.5 must be settled before this phase ships.**
  Settled: ADR-0004 is Accepted, and Phase 4 amended it for rows that name no doctor — a patient
  is reachable through their own visits, while the chart's contents stay strict per row.

**Exit criteria:** a doctor completes and signs an encounter; the note becomes immutable; the
patient sees exactly what was flagged visible and nothing else; every PHI read appears in the
audit log.

Three items on the list above are deliberately not in the first pass, and none is on the exit
criteria:

- **Lab orders (D14).** Marked 🔸 in section 1.1 from the start; the file store and the encounter
  already carry a result that arrives as an attachment, which is how a small clinic works today.
- **The patient's e-signature on consent forms (P13)**, also 🔸. Consent documents upload and share
  like any other; signing them in the browser is its own piece of work.
- **Note templates and quick phrases (D13)**, 🔸 as well, and worth designing once real notes exist
  to template from.

### Phase 5 — Billing and payments · ~2 weeks

- Service catalogue and price list; tax configuration; invoice numbering
- Invoice generation from an encounter, including consumed inventory
- Payment recording with idempotency; partial payments; refunds
- Receipt and invoice PDFs; patient statement of account
- Daily reconciliation report

**Exit criteria:** an encounter produces an invoice; a partial payment moves it to
`PARTIALLY_PAID` with a correct balance; a double-clicked payment creates one row; the daily
report reconciles to the cent.

One item on the list above is deliberately not in this pass, and it is not on the exit criteria:

- **Consumed inventory on an invoice line.** Inventory arrives in Phase 6; there is nothing to
  consume from yet. The invoice line carries an `inventoryItemId` from the start so Phase 6 wires
  a source into a shape that already exists, rather than migrating every invoice ever written.
  Inventing half an inventory module to fill the field would have been worse than leaving it null.

Two decisions were recorded on the way through:

- **ADR-0027** — invoice totals round once per line, and the invoice is the sum of rounded lines,
  so the figures beside the lines add up to the figure at the bottom. Rounding is half away from
  zero, because half-even is defensible statistically and surprising on a receipt.
- **ADR-0028** — a payment is made idempotent by a unique index on `(clinicId, idempotencyKey)`,
  not by a read before the insert. The disabled button and the lookup-first fast path are
  courtesies; the index is the guarantee.

### Phase 6 — Inventory · ~1.5 weeks

- Items, categories, suppliers; batches with expiry
- The stock movement ledger with the `quantityOnHand` projection
- Consumption linked to an encounter and flowing into the invoice
- Low-stock and expiring-soon alerts

**Exit criteria:** consuming an item during a visit decrements stock, writes a ledger row, and
appears on the invoice — all in one transaction, and the ledger explains the balance.

Two items on the list above are deliberately not in this pass, and neither is on the exit
criteria:

- **Purchase orders.** Section 8.11 calls them straightforward and they are, but nothing in the
  phase's bullets or its exit criteria needs one: stock arrives through a RECEIPT movement
  against a supplier, which is what a small clinic actually does with a delivery note. The
  movement already carries a `reference` for the note's number, so a PO workflow later fills a
  field that exists rather than migrating the ledger.
- **The monthly batch-archive job.** Depleted batches are pruned on every withdrawal, which keeps
  the embedded array bounded in normal use; sweeping long-expired ones to `inventoryBatchArchive`
  needs a scheduled worker, and Phase 6 ships no background processor — the same reasoning that
  produced ADR-0026 in Phase 4.

One decision was recorded on the way through:

- **ADR-0029** — stock leaves the shelf by a single conditional document write whose filter
  carries the preconditions, which is what the embedded batches buy; consumption is FEFO, and
  expired stock is refused with its own error code rather than counted as a shortage.

### Phase 7 — Support and notifications · ~1.5 weeks

- Support tickets: patient and doctor submission, staff inbox, assignment, threaded replies with
  internal notes, status and priority
- Notification engine: templates, preferences, in-app centre, email
- Appointment reminders (T-24h, T-2h), booking confirmations, invoice and ticket notifications

**Exit criteria:** a patient opens a ticket and staff replies with both a public and an internal
message; reminders fire correctly across timezones and are not duplicated when a job retries.

This is the phase that built `apps/worker` — the background processor that ADR-0026 (prescription
PDFs), ADR-0029 (the batch-archive job) and section 13.5 had each deferred something to. It runs
three things: the change-stream relay, the backstop sweep, and the reminder sweep.

Two items on the list above are deliberately not in this pass, and neither is on the exit
criteria:

- **Admin-editable notification templates.** Every notification goes out through one layout, with
  the title and body written by whoever raised it. A template editor is a Phase 8 item alongside
  the i18n pass, because templates a clinic can edit have to be translatable first — building
  them now would mean building them twice.
- **SMS.** ADR-0008 is still open on the provider and on whether SMS is in v1 at all, and the
  answer drives the reminder strategy rather than following from it. The channel enum and the
  per-channel delivery record take a third value without a migration when that is settled.

One decision was recorded on the way through:

- **ADR-0030** — at-least-once delivery is made safe by a dedupe key with a unique index rather
  than by remembering what was sent, and reminders are found by sweeping the diary rather than by
  scheduling a job per appointment: an appointment that moves is simply found in its new window.

### Phase 8 — Audit explorer, analytics, hardening, launch · ~2 weeks

- Audit log explorer: filters, diff viewer, CSV export, `audit.viewed` self-logging
- Append-only database role and the update/delete trigger; hash chain and nightly verification
- Admin analytics dashboard
- Full i18n pass with an RTL locale; accessibility audit
- Load testing against the section 15.3 budgets; index tuning under realistic data volume
- Backup **and rehearsed restore**; runbooks; on-call alerting
- Security review: dependency audit, CSP, rate limits, penetration test of the four portals

**Exit criteria:** an admin can answer "who viewed this patient's file last Tuesday, and what did
they change" in under a minute; a restore has been performed successfully from a real backup.

### Phase 9 — React Native app · after v1

Expo app consuming `@clinic/api-client`. Patient portal first (appointments, documents,
reminders, support), then the doctor portal (my day, chart read, note capture). No backend work
should be required beyond push registration — that is the test of whether sections 6 and 9 were
implemented honestly.

### Sequencing rationale

- **RBAC before features.** Every later phase calls `assertCan`; adding it afterwards means
  auditing every endpoint written in the meantime.
- **The role editor in Phase 2, not Phase 8.** It is the forcing function that proves the
  permission model is genuinely data-driven rather than an enum with extra steps.
- **Files with clinical records, not standalone.** File permissions only make sense in the
  context of the records they attach to.
- **Audit foundations in Phase 1, the explorer in Phase 8.** Capture must start on day one;
  the reading UI can wait.

---

## 18. Conventions

### 18.1 Naming

| Thing | Convention | Example |
|-------|-----------|---------|
| Files | kebab-case | `book-appointment.ts` |
| React components | PascalCase file and export | `AppointmentCalendar.tsx` |
| Mongoose models | PascalCase singular | `Appointment` |
| Collections | camelCase plural | `appointments`, `stockMovements` |
| Embedded arrays | plural noun, no `List`/`Array` suffix | `diagnoses`, `allocations` |
| Snapshot sub-documents | singular noun matching the referenced entity | `appointment.patient` beside `appointment.patientId` |
| Permissions | `subject:action` | `appointment:cancel` |
| Events | `subject.past-tense` | `appointment.cancelled` |
| Audit actions | matching the event name | `appointment.cancelled` |
| Error codes | SCREAMING_SNAKE | `APPOINTMENT_SLOT_TAKEN` |
| Booleans | `is` / `has` / `can` prefix | `isPatientVisible` |
| Dates | `At` suffix for instants, `On` for dates | `cancelledAt`, `bornOn` |

### 18.2 Git

- Branches: `develop` is the integration branch; `dev` carries this scaffold; feature work uses
  `feat/<scope>-<short-description>`, fixes use `fix/<scope>-<short-description>`.
- Conventional Commits: `feat(appointments): add reschedule endpoint`.
- Every PR: passes lint, typecheck, unit and integration tests, and the dependency-graph check;
  includes a migration if the schema changed; updates this document if a decision changed.

### 18.3 Definition of done

A feature is done when **all** of the following are true — not when the happy path renders.

- [ ] Permission checks at the use-case layer, not only in the UI
- [ ] Scope filter applied to every list query it introduces
- [ ] Audited (automatic coverage confirmed, or an explicit `audit.record` where intent matters)
- [ ] Loading, empty, and error states implemented — every one of them
- [ ] Responsive at 375px, 768px and 1280px
- [ ] Keyboard navigable, labels associated, contrast checked
- [ ] All strings in locale files, present in every configured locale
- [ ] Unit tests for domain rules; integration test for the use case; E2E if it is a critical journey
- [ ] Indexes added for any new query pattern, in ESR order, with `.explain()` output in the PR
- [ ] No bulk operation (`updateMany` / `bulkWrite` / `insertMany`) outside a repository, and any
      that exists carries an explicit `audit.record()` — bulk writes bypass the audit middleware
- [ ] Every new query filters on `clinicId`; a test asserts the tenant guard throws without it
- [ ] Embed-or-reference decision justified against the rule in section 8.2 if a new field is an
      array, with its growth bound stated
- [ ] Money in `Decimal128` and never `Double`, timestamps in UTC, timezone conversion only at
      the edge
- [ ] Contract added to `packages/contracts` so mobile can call it

---

## 19. Open decisions (ADR log)

Recorded as `docs/adr/NNNN-title.md` as each is settled.

| # | Decision | Status | Notes |
|---|----------|--------|-------|
| 0001 | Modular monolith over microservices for v1 | **Accepted** | Section 5; revisit only on measured evidence |
| 0002 | Permissions as data with scoped grants | **Accepted** | Section 7 |
| 0003 | Transactional outbox for domain events, relayed by a change stream | **Accepted** | Section 13.4 |
| 0011 | **MongoDB + Mongoose**, not Prisma's MongoDB connector | **Accepted** | Section 8.1 — driven by the absence of migrations and of the aggregation pipeline in that connector. Revisit if Prisma ships real MongoDB migrations |
| 0012 | Embed-or-reference rule and the per-entity verdicts | **Accepted** | Section 8.2 — the highest-leverage decision in a document model, so it is a stated rule rather than per-entity taste |
| 0013 | Slot reservation documents for booking concurrency | **Accepted** | `docs/adr/0013` and section 8.7 — MongoDB transactions do not prevent phantom-read double-booking; a unique `_id` does |
| 0014 | Restricted-import zones instead of `eslint-plugin-boundaries` | **Accepted** | Section 5.3 — the plugin silently enforced nothing across workspace packages |
| 0015 | Replica set in development and CI, on port 27018 | **Accepted** | `docs/adr/0015` — a standalone fails only transactions and change streams, and fails them late |
| 0016 | Audit connection separated before auth exists | **Accepted** | `docs/adr/0016` — structural from day one; the privilege separation itself lands with auth in staging |
| 0005 | One clinic per installation | **Accepted** | `docs/adr/0005` — `CLINIC_ID` names the installation's clinic. Every document still carries `clinicId`, so serving many clinics later means resolving it from the hostname instead: an addition, not a rewrite |
| 0006 | Staff register patients; patients activate by emailed link | **Accepted** | `docs/adr/0006` — no public sign-up. Activation sets the first password on an account that already exists, so a leaked link cannot mint accounts |
| 0017 | Own token service instead of Auth.js | **Accepted** | `docs/adr/0017` — rotating refresh tokens, one path for cookie and Bearer, authentication outside the framework layer |
| 0018 | Portal permissions gated in layouts, not middleware | **Accepted** | `docs/adr/0018` — current grants rather than a token's, and every denial audited |
| 0004 | `ASSIGNED` reaches the rows you are named on | **Accepted** | `docs/adr/0004` — strict: the resolver compares the row against the actor's own doctor profile, and a clinic that wants wider reach grants `CLINIC`, which the matrix shows. Break-the-glass stays additive. Amended in Phase 4 for rows that name no doctor: a patient is reachable through their visits, while the chart's contents stay strict per row |
| 0007 | Payment provider for online payments | **OPEN** | Deferred with P16; `PaymentGateway` interface reserves the seam |
| 0008 | SMS provider and whether SMS is in v1 at all | **OPEN** | Cost per message drives reminder strategy |
| 0009 | Hosting target: **Atlas or self-hosted MongoDB**, and serverless or containers | **OPEN** | Now materially bigger than a hosting preference: Atlas brings Atlas Search (patient search quality, section 8.14), managed point-in-time restore and Online Archive. Serverless also forces connection-pool caching (section 15.2). Worth deciding early |
| 0019 | Text search: Atlas Search, or `$text` plus anchored regex | **OPEN** | Follows directly from 0009; the repository interface hides which, so it is reversible |
| 0010 | One timezone for the whole clinic | **Accepted** | `docs/adr/0010` — branches share the clinic's IANA zone; the unused branch field keeps a per-branch override an addition. Calendar dates are `YYYY-MM-DD` strings, never instants |
| 0020 | Possible duplicate patients warn, and saving anyway takes a reason | **Accepted** | `docs/adr/0020` — national ID, phone (last seven digits), email, or name plus date of birth; re-checked at save; overrides audited |
| 0021 | One branch until a second exists | **Accepted** | `docs/adr/0021` — branch fields appear only in a multi-branch clinic; the last open branch cannot close |
| 0022 | Patients book inside a window; staff are not limited | **Accepted** | `docs/adr/0022` — booking horizon, minimum notice and cancellation cutoff live in clinic settings and bind self-service only |
| 0023 | A walk-in takes the next open slot, not the current minute | **Accepted** | `docs/adr/0023` — recording an arrival off the five-minute grid would end the double-booking guarantee for everyone; genuine overbooking stays a separate, deliberate decision |
| 0024 | A signed note is closed to everyone, including its author | **Accepted** | `docs/adr/0024` — the precondition lives in the update's filter and corrections are `$push`ed addenda, so append-only is a property of the write rather than a rule to remember |
| 0025 | A patient sees what was shared, and only once it is final | **Accepted** | `docs/adr/0025` — sharing is deliberate and reversible, a draft is never shared however it is flagged, and hidden content is projected out rather than loaded and filtered |
| 0026 | Prescription PDFs are rendered on first request, then stored | **Accepted** | `docs/adr/0026` — the end state is what the queued job would have produced, so moving it to a worker later changes when it runs, not what exists |
| 0027 | Invoice totals round once per line | **Accepted** | `docs/adr/0027` — each line rounds once and the invoice is the sum of rounded lines, so a printed column adds up. Half away from zero rather than half-even: a missing cent on a receipt is read by the person paying it |
| 0028 | A payment is idempotent at the index | **Accepted** | `docs/adr/0028` — unique `(clinicId, idempotencyKey)`, the insert and every balance it moves in one transaction, and each balance moved by a conditional pipeline update. A read before the insert has a window exactly wide enough for the second request |
| 0029 | Stock leaves by one conditional document write | **Accepted** | `docs/adr/0029` — embedded batches make the precondition and the decrement inseparable, so two clinicians cannot both take the last vial. FEFO, with expired stock refused under its own error code because "order more" and "write it off" are different jobs |
| 0030 | At-least-once delivery is made safe by dedupe keys | **Accepted** | `docs/adr/0030` — a unique key built from facts rather than from the attempt, so a retried job loses on the index. Reminders sweep the diary instead of scheduling jobs, so a moved appointment needs nothing kept in step |

### The ones to settle next

0005 and 0006 were settled at the start of Phase 1 — one clinic per installation, and patients
activated by staff invitation — which kept the login screen free of a clinic selector and a public
sign-up page. 0010, 0020 and 0021 were settled at the start of Phase 2: one clinic timezone,
duplicate warnings that need a typed reason to override, and branch fields only once a second
branch exists.

**0009 (Atlas vs self-hosted)** is now the decision with the widest blast radius, and the only thing
standing between the project and a staging environment. It has been promoted by the move to MongoDB. On Postgres it was
close to a pure operations preference. Now it decides whether patient search is fuzzy or
prefix-only, whether point-in-time restore is managed or something we build and rehearse
ourselves, and whether archival has a product behind it. Worth answering in Phase 0 rather than
discovering in Phase 8.

**0004** was settled at the start of Phase 3, because a doctor's own appointment list needs it:
`ASSIGNED` is strict, and a clinic that wants a doctor to read every chart grants `CLINIC` instead.
Phase 4 revisits only whether to add an audited break-the-glass override. The policy engine still
fails closed — an `ASSIGNED` grant on a subject with no registered resolver denies.

---

## 20. Glossary

One word per concept. If a term below appears in code under a different name, the code is wrong.

| Term | Meaning |
|------|---------|
| **Actor** | The authenticated principal performing an action — a user, a system job, or an API client. Carries permissions and scope. |
| **Appointment** | A scheduled future slot. It is *not* the clinical record. |
| **Encounter** | The actual visit and its clinical content. An appointment that is attended produces an encounter; a walk-in produces an encounter with no appointment. |
| **Clinical note** | The SOAP document inside an encounter. Immutable once signed; corrections are addenda. |
| **Patient** | A person receiving care. May or may not have a portal `User`. |
| **User** | A login identity. A user may be a patient, a doctor, staff, an admin, or several at once. |
| **Portal** | One of the four role-oriented areas of the app. |
| **Permission** | A `subject:action` string. The unit of authority. |
| **Scope** | Which rows a permission reaches: `OWN`, `ASSIGNED`, `CLINIC`, `GLOBAL`. |
| **Role** | A named bundle of scoped permissions. A packaging convenience for humans; code never checks roles. |
| **Grant** | One row in `RolePermission` — a permission plus its scope, given to a role. |
| **Scope filter** | The `where` fragment a scope compiles into, so unreachable rows are never loaded. |
| **PHI** | Protected Health Information. Reads of it are audited. |
| **Outbox** | The table domain events are written to inside a business transaction, then relayed to the queue. |
| **Stock movement** | One signed entry in the inventory ledger. `quantityOnHand` is a projection of these, never the source of truth. |
| **Embed** | Store a child inside its parent document. Chosen when the child is always read with the parent, bounded in size, and not queried independently (section 8.2). |
| **Reference** | Store a child in its own collection and keep its id on the parent. The default whenever growth is unbounded or the child is addressed on its own. |
| **Snapshot** | A denormalised copy of another document's display fields, stored alongside the id that remains authoritative. Display-only, refreshed by event (section 8.7). |
| **Projection (data)** | A stored value derived from a ledger — `quantityOnHand`, `invoice.balanceDue`. Always recomputable from its source. |
| **Projection (query)** | The MongoDB sense: the subset of fields a query returns. Used as a security control on the patient portal (section 7.5). |
| **Multikey index** | An index on a field inside an embedded array. What keeps embedded data queryable. |
| **ESR** | Equality, Sort, Range — the required key order for a compound index (section 8.14). |
| **Working set** | Indexes plus frequently-accessed documents. MongoDB performs well while it fits in RAM and degrades gradually once it does not, which is why it is monitored from Phase 0. |
| **Replica set** | The MongoDB cluster form required for transactions and change streams. Runs in development and CI too, not only in production. |

---

*This document is living. When an implementation decision contradicts it, update this file in
the same PR — an architecture document that has drifted from the code is worse than none, because
it is trusted and wrong.*
