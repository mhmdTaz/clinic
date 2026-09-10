# Clinic Management Platform — Architecture & Scaffold (v1)

> **Status:** Proposed · **Version:** 1.0 · **Date:** 2026-09-11 · **Owner:** @mhmdTaz
>
> This document is the blueprint for the platform. It defines the folder structure, module
> boundaries, permission model, data model, API surface, auth flow, audit strategy, file
> storage, and the phased delivery plan for v1. **No application code exists yet** — this
> document is what the code will be built against.
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
8. [Data model (Prisma schema sketch)](#8-data-model-prisma-schema-sketch)
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
| **Every table carries `clinicId`** (except global lookups), and every query filters on it. | Multi-clinic and multi-branch are schema decisions, not features. Adding a tenant column later is a migration nightmare. |
| **Indexes are designed with the query, in the same PR.** | An unindexed `WHERE clinicId = ? AND startsAt BETWEEN ? AND ?` is the calendar's death. |
| **Slow work goes to a queue,** never inside the request: PDF generation, email, SMS, image processing, exports. | Keeps p99 latency flat and lets workers scale independently of web. |
| **Writes emit domain events** through a transactional outbox. | New consumers (notifications, analytics, webhooks) are added without touching the writer. |
| **The audit log is append-only and partitionable.** | It will become the largest table in the system by an order of magnitude. |

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
| **The database is reached only through repositories** owned by the module. No stray `prisma.*` calls in UI code. | |

---

## 3. Technology stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Language | **TypeScript** (strict, `noUncheckedIndexedAccess`) | One language across web, API, jobs, and the future React Native app; types cross the wire through shared contracts. |
| Web framework | **Next.js (App Router)** | Server Components keep PHI-heavy pages off the client, Route Handlers give us the REST API in the same deployment, and one codebase hosts both the UI and the mobile API. |
| UI | **Tailwind CSS + shadcn/ui** (Radix primitives) | shadcn is *copied in*, not depended on, so we own and restyle the components. Radix supplies accessibility (keyboard nav, focus traps, ARIA) that a clinical tool genuinely needs. |
| Data | **PostgreSQL 16 + Prisma** | Relational integrity is non-negotiable for medical and billing data. Prisma gives typed queries, a real migration history, and `$extends` — which is how audit logging is implemented (section 11). |
| Auth | **Auth.js (NextAuth v5)** | Credentials provider for v1; the session callback is where roles and permissions are attached. Adapter-based, so OIDC/SSO can be added later without touching call sites. |
| Validation | **Zod** | Single source of truth for API contracts, form validation, and generated OpenAPI. |
| Server state | **TanStack Query** | Cache, invalidation, optimistic updates. The same hooks package is reused by React Native. |
| Files | **S3-compatible** (MinIO in dev, S3 or R2 in prod) | Presigned uploads keep large files off the app server entirely. |
| Cache / queue | **Redis + BullMQ** | Permission cache, rate limiting, and the background job queue. |
| Email / SMS | Providers behind a `NotificationChannel` interface | Resend/SES and Twilio are adapters, not architecture. |
| Testing | **Vitest** (unit) · **Playwright** (E2E) · **Testcontainers** (integration on real Postgres) | |
| Monorepo | **pnpm workspaces + Turborepo** | Content-hashed task caching; `packages/core` is consumed by web today and by React Native later. |
| Observability | **Pino** logs · **OpenTelemetry** traces · **Sentry** errors | Structured logs carry a `requestId` that also appears on every audit row. |
| Containers | Docker Compose (dev) · Dockerfile (prod) | `docker compose up` gives Postgres, Redis, MinIO and Mailpit in one command. |

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
│  ├─ db/                           # Prisma schema, migrations, seeds, client extensions
│  ├─ ui/                           # design system: primitives, DataTable, AutoForm, tokens
│  ├─ events/                       # domain event names, payload schemas, in-proc bus + outbox
│  ├─ config/                       # env parsing (zod), feature flags, constants
│  └─ testing/                      # factories, fixtures, in-memory fakes, test db helpers
│
├─ docs/
│  ├─ adr/                          # architecture decision records, one file per decision
│  └─ runbooks/                     # on-call: restore a backup, rotate a key, replay the outbox
├─ docker-compose.yml               # postgres · redis · minio · mailpit
├─ turbo.json
└─ pnpm-workspace.yaml
```

### 4.1 Dependency direction

Dependencies point **inward only**. Nothing in `core` knows that a web app exists.

```
  apps/web ──┐
  apps/worker├──▶ packages/core ──▶ packages/db ──▶ PostgreSQL
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
│  └─ appointment.repository.ts   # the only place Prisma is touched for this module
├─ policies/
│  └─ appointment.policy.ts       # can this actor do this to this row? (section 7.5)
└─ __tests__/
```

`index.ts` exports use cases, domain types, and the module's event names — **never** repositories,
never Prisma types, never anything from `infrastructure/`.

```ts
// packages/core/src/modules/appointments/index.ts
export { bookAppointment }       from './application/book-appointment'
export { cancelAppointment }     from './application/cancel-appointment'
export { listAppointments }      from './application/list-appointments'
export type { Appointment, AppointmentStatus } from './domain/appointment'
export { APPOINTMENT_EVENTS }    from './events'
// NOT exported: AppointmentRepository, PrismaAppointment, internal helpers
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
```

| Allowed | Forbidden |
|---------|-----------|
| `appointments` imports `scheduling` to check slot availability | `scheduling` importing `appointments` (would be a cycle) |
| `billing` imports `inventory` to price consumed items | `inventory` importing `billing` — it emits `stock.consumed` instead |
| Anything imports `access` for permission checks | `access` importing any feature module |
| `notifications` subscribes to `appointment.booked` | `appointments` importing `notifications` directly |

### 5.3 How boundaries are enforced

Three mechanisms, from cheapest to strongest:

1. **`eslint-plugin-boundaries`** — declares element types (`module-public`, `module-internal`,
   `app`) and the legal edges between them. A cross-module deep import fails `pnpm lint`.
2. **`dependency-cruiser`** in CI — validates the graph in 5.2, forbids cycles, and forbids
   `next/*` or `react` appearing anywhere under `packages/core`.
3. **Package manifests** — `packages/core/package.json` does not list `next` or `react` as
   dependencies at all, so those imports cannot resolve even if lint is bypassed.

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
| **Interface** | `apps/web/src/app/**` (route handlers, server components) | contracts, core use cases | business rules, SQL |
| **Application** (use cases) | `core/.../application/` | domain, repositories, policies, event bus | HTTP objects, React, Prisma types |
| **Domain** | `core/.../domain/` | nothing but other domain code | I/O of any kind |
| **Infrastructure** | `core/.../infrastructure/` | Prisma, S3 SDK, Redis | business rules |

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

  return db.transaction(async (tx) => {
    // Advisory lock on (doctorId, day) — the double-booking race, closed at the DB level
    await tx.lockDoctorDay(input.doctorId, slot.day)
    if (await appointmentRepo.overlaps(tx, input.doctorId, slot)) {
      throw new AppointmentSlotTakenError(slot)
    }
    const appointment = await appointmentRepo.create(tx, { ...input, status: 'SCHEDULED' })
    await statusHistoryRepo.record(tx, appointment.id, null, 'SCHEDULED', actor.id)
    await outbox.emit(tx, 'appointment.booked', { appointmentId: appointment.id })
    return appointment
  })
}
```

Three properties worth naming:

- **`assertCan` is the first line.** Authorisation is not the route's job; a background job or the
  mobile API calling the same use case gets the same check.
- **The event is written inside the transaction** (transactional outbox), so a booked appointment
  can never exist without its reminder being scheduled, and vice versa.
- **Nothing here is Next.js-aware**, so `apps/worker` and a future gRPC or GraphQL surface can
  call it unchanged.

### 6.2 Testing per layer

| Layer | Test type | Tooling | Speed |
|-------|-----------|---------|-------|
| Domain | Pure unit — no mocks needed | Vitest | milliseconds |
| Application | Use case against in-memory fakes and a real Postgres for repo tests | Vitest + Testcontainers | seconds |
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

For **list** endpoints, the same scope is compiled into a `where` fragment rather than filtering
in memory — permission checks must never load rows the actor cannot see:

```ts
// modules/encounters/policies/encounter.policy.ts
export function encounterScopeFilter(actor: Actor, scope: Scope): Prisma.EncounterWhereInput {
  switch (scope) {
    case 'GLOBAL':   return {}
    case 'CLINIC':   return { clinicId: actor.clinicId }
    case 'ASSIGNED': return { clinicId: actor.clinicId, doctorId: actor.doctorId }
    case 'OWN':      return { clinicId: actor.clinicId, patientId: actor.patientId,
                              isPatientVisible: true }
  }
}
```

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

Resolving permissions is a three-table join, so it is cached — but a revoked permission must not
survive in a stale session.

- Effective permissions are computed at login and cached in Redis under
  `perm:v{permVersion}:{userId}` with a 15-minute TTL.
- The JWT carries a `permVersion` claim. Any change to a role, grant, or user-role assignment
  bumps `Clinic.permissionVersion`.
- On each request, `withApi` compares the token's `permVersion` against the clinic's current
  value; a mismatch forces a re-resolve and re-issues the token.

Net effect: **permission changes take effect on the affected user's next request**, without
either polling or waiting for a session to expire.

---

## 8. Data model (Prisma schema sketch)

Illustrative, not final — it fixes the entities, relationships and the conventions every table
follows. Exact column types are settled during Phase 0.

### 8.1 Conventions applied to every table

| Convention | Detail |
|-----------|--------|
| **Primary keys** | `cuid()` — non-guessable (an incrementing patient id leaks patient volume and invites IDOR probing) and safely generated client-side for offline mobile writes. |
| **Tenancy** | Every non-global table has `clinicId` with an index; every repository method takes `clinicId` as a required argument. |
| **Timestamps** | `createdAt`, `updatedAt` on everything. |
| **Soft delete** | `deletedAt` on clinical, financial and identity tables. Medical and financial records are **never** hard-deleted; a Prisma extension excludes soft-deleted rows by default. |
| **Attribution** | `createdById`, `updatedById` on mutable business tables — cheap provenance without querying the audit log. |
| **Money** | `Decimal @db.Decimal(12, 2)` plus a `currency` column. **Never `Float`.** All arithmetic happens in `Decimal`. |
| **Time** | All instants stored UTC as `timestamptz`. The clinic's IANA timezone lives on `Clinic`; conversion happens at the edges only. |
| **Enums** | Postgres enums for closed technical sets (statuses). Lookup **tables** for anything the clinic should be able to edit (services, specialties, ticket categories). |

### 8.2 Identity and access

```prisma
model Clinic {
  id                String   @id @default(cuid())
  name              String
  legalName         String?
  taxId             String?
  logoFileId        String?
  email             String?
  phone             String?
  addressLine1      String?
  addressLine2      String?
  city              String?
  country           String?
  timezone          String   @default("UTC")     // IANA, e.g. "Asia/Beirut"
  currency          String   @default("USD")     // ISO-4217
  locale            String   @default("en")
  permissionVersion Int      @default(1)         // bumped on any RBAC change (section 7.7)
  featureFlags      Json     @default("{}")
  isActive          Boolean  @default(true)
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  branches     Branch[]
  users        User[]
  roles        Role[]
  workingHours ClinicWorkingHour[]
  holidays     ClinicHoliday[]
}

model Branch {
  id        String  @id @default(cuid())
  clinicId  String
  name      String
  phone     String?
  address   String?
  timezone  String?                              // falls back to the clinic timezone
  isActive  Boolean @default(true)
  clinic    Clinic  @relation(fields: [clinicId], references: [id])
  @@index([clinicId, isActive])
}

model ClinicWorkingHour {
  id         String  @id @default(cuid())
  clinicId   String
  branchId   String?
  dayOfWeek  Int                                  // 0 = Sunday
  opensAt    String                               // "09:00" local to the branch
  closesAt   String
  @@unique([clinicId, branchId, dayOfWeek])
}

model ClinicHoliday {
  id       String   @id @default(cuid())
  clinicId String
  branchId String?
  date     DateTime @db.Date
  name     String
  @@index([clinicId, date])
}

model User {
  id                 String     @id @default(cuid())
  clinicId           String
  email              String
  phone              String?
  passwordHash       String?                      // null while an invite is pending
  firstName          String
  lastName           String
  avatarFileId       String?
  locale             String?
  status             UserStatus @default(INVITED)
  emailVerifiedAt    DateTime?
  lastLoginAt        DateTime?
  failedLoginCount   Int        @default(0)
  lockedUntil        DateTime?
  mfaSecret          String?                      // encrypted at rest
  mfaEnabledAt       DateTime?
  mustChangePassword Boolean    @default(false)
  deletedAt          DateTime?
  createdAt          DateTime   @default(now())
  updatedAt          DateTime   @updatedAt

  roles          UserRole[]
  doctorProfile  Doctor?
  patientProfile Patient?
  staffProfile   StaffProfile?

  @@unique([clinicId, email])                     // email unique per clinic, not globally
  @@index([clinicId, status])
}

enum UserStatus { INVITED ACTIVE SUSPENDED DEACTIVATED }
```

```prisma
model Role {
  id          String   @id @default(cuid())
  clinicId    String
  key         String                              // "admin" | "staff" | "doctor" | "patient" | custom
  name        String
  description String?
  isSystem    Boolean  @default(false)            // seeded roles cannot be deleted
  isDefault   Boolean  @default(false)            // auto-assigned to self-registering patients
  priority    Int      @default(0)                // highest priority decides the landing portal
  createdAt   DateTime @default(now())

  permissions RolePermission[]
  users       UserRole[]
  @@unique([clinicId, key])
}

model Permission {
  id       String  @id @default(cuid())
  key      String  @unique                        // "appointment:create" — matches the catalogue
  group    String                                 // drives the admin matrix grouping
  label    String
  isPhi    Boolean @default(false)                // reads of this subject are audited
  roles    RolePermission[]
}

model RolePermission {
  roleId       String
  permissionId String
  scope        PermissionScope @default(CLINIC)
  role         Role       @relation(fields: [roleId], references: [id], onDelete: Cascade)
  permission   Permission @relation(fields: [permissionId], references: [id], onDelete: Cascade)
  @@id([roleId, permissionId])
}

enum PermissionScope { OWN ASSIGNED CLINIC GLOBAL }

model UserRole {
  userId     String
  roleId     String
  branchId   String?                              // optional: role limited to one branch
  assignedAt DateTime @default(now())
  assignedBy String?
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  role       Role     @relation(fields: [roleId], references: [id], onDelete: Cascade)
  @@id([userId, roleId])
  @@index([roleId])
}

model Invitation {
  id         String    @id @default(cuid())
  clinicId   String
  email      String
  roleId     String
  tokenHash  String    @unique                    // only the hash is stored
  expiresAt  DateTime
  acceptedAt DateTime?
  invitedBy  String
  @@index([clinicId, email])
}

model RefreshToken {                              // mobile / long-lived API sessions
  id         String    @id @default(cuid())
  userId     String
  tokenHash  String    @unique
  deviceName String?
  userAgent  String?
  ipAddress  String?
  expiresAt  DateTime
  revokedAt  DateTime?
  @@index([userId, revokedAt])
}
```

### 8.3 People: patients, doctors, staff

```prisma
model Patient {
  id                String    @id @default(cuid())
  clinicId          String
  userId            String?   @unique             // null = registered by staff, no portal login yet
  medicalRecordNo   String                        // human-facing, per clinic, e.g. "MRN-000142"
  firstName         String
  lastName          String
  dateOfBirth       DateTime? @db.Date
  gender            Gender?
  nationalId        String?
  bloodType         BloodType?
  phone             String?
  email             String?
  addressLine1      String?
  city              String?
  country           String?
  maritalStatus     String?
  occupation        String?
  notes             String?                       // administrative, NOT clinical
  isActive          Boolean   @default(true)
  deletedAt         DateTime?
  createdAt         DateTime  @default(now())
  createdById       String?

  emergencyContacts EmergencyContact[]
  insurances        PatientInsurance[]
  allergies         Allergy[]
  conditions        ChronicCondition[]
  appointments      Appointment[]
  encounters        Encounter[]
  invoices          Invoice[]
  files             FileObject[]

  @@unique([clinicId, medicalRecordNo])
  @@index([clinicId, lastName, firstName])
  @@index([clinicId, phone])                      // duplicate detection on registration
  @@index([clinicId, nationalId])
}

enum Gender { MALE FEMALE OTHER UNDISCLOSED }
enum BloodType { A_POS A_NEG B_POS B_NEG AB_POS AB_NEG O_POS O_NEG UNKNOWN }

model EmergencyContact {
  id           String  @id @default(cuid())
  patientId    String
  name         String
  relationship String
  phone        String
  isPrimary    Boolean @default(false)
  patient      Patient @relation(fields: [patientId], references: [id], onDelete: Cascade)
}

model PatientInsurance {
  id           String    @id @default(cuid())
  patientId    String
  providerName String
  policyNumber String
  holderName   String?
  validFrom    DateTime? @db.Date
  validTo      DateTime? @db.Date
  cardFileId   String?                            // photo of the card in object storage
  isPrimary    Boolean   @default(false)
  @@index([patientId, isPrimary])
}
```

```prisma
model Doctor {
  id                 String    @id @default(cuid())
  clinicId           String
  userId             String    @unique
  licenseNumber      String?
  title              String?                      // "Dr.", "Prof."
  bio                String?
  yearsOfExperience  Int?
  consultationFee    Decimal?  @db.Decimal(12, 2)
  defaultSlotMinutes Int       @default(30)
  isAcceptingNew     Boolean   @default(true)
  isActive           Boolean   @default(true)
  deletedAt          DateTime?

  user         User               @relation(fields: [userId], references: [id])
  specialties  DoctorSpecialty[]
  availability DoctorAvailability[]
  timeOff      DoctorTimeOff[]
  appointments Appointment[]
  encounters   Encounter[]
  @@index([clinicId, isActive])
}

model Specialty {                                 // editable lookup, not an enum
  id       String  @id @default(cuid())
  clinicId String
  name     String
  doctors  DoctorSpecialty[]
  @@unique([clinicId, name])
}

model DoctorSpecialty {
  doctorId    String
  specialtyId String
  @@id([doctorId, specialtyId])
}

model DoctorAvailability {                        // recurring weekly template
  id             String  @id @default(cuid())
  doctorId       String
  branchId       String?
  dayOfWeek      Int
  startTime      String                           // "09:00" local
  endTime        String                           // "17:00"
  slotMinutes    Int?                             // overrides the doctor default
  breakStartTime String?
  breakEndTime   String?
  effectiveFrom  DateTime? @db.Date
  effectiveTo    DateTime? @db.Date
  @@index([doctorId, dayOfWeek])
}

model DoctorTimeOff {                             // one-off blocks: leave, conference, sick
  id        String   @id @default(cuid())
  doctorId  String
  startsAt  DateTime
  endsAt    DateTime
  reason    String?
  isApproved Boolean @default(false)
  @@index([doctorId, startsAt, endsAt])
}

model StaffProfile {
  id         String  @id @default(cuid())
  clinicId   String
  userId     String  @unique
  branchId   String?
  jobTitle   String?
  employeeNo String?
  hiredAt    DateTime? @db.Date
  @@index([clinicId])
}
```

### 8.4 Scheduling and appointments

```prisma
model Service {                                   // the billable catalogue — admin editable
  id              String  @id @default(cuid())
  clinicId        String
  code            String
  name            String
  description     String?
  durationMinutes Int     @default(30)
  price           Decimal @db.Decimal(12, 2)
  taxRatePercent  Decimal @default(0) @db.Decimal(5, 2)
  colorHex        String?                         // calendar colour coding
  isActive        Boolean @default(true)
  @@unique([clinicId, code])
}

model Appointment {
  id              String            @id @default(cuid())
  clinicId        String
  branchId        String?
  patientId       String
  doctorId        String
  serviceId       String?
  startsAt        DateTime                        // UTC
  endsAt          DateTime
  durationMinutes Int
  status          AppointmentStatus @default(SCHEDULED)
  source          AppointmentSource @default(STAFF)
  reason          String?                         // patient-supplied chief complaint
  internalNote    String?                         // staff-only, never shown to the patient
  checkedInAt     DateTime?
  startedAt       DateTime?
  completedAt     DateTime?
  cancelledAt     DateTime?
  cancelledById   String?
  cancelReason    String?
  rescheduledToId String?                         // chain to the replacement appointment
  createdById     String?
  createdAt       DateTime          @default(now())
  updatedAt       DateTime          @updatedAt

  patient   Patient   @relation(fields: [patientId], references: [id])
  doctor    Doctor    @relation(fields: [doctorId], references: [id])
  encounter Encounter?
  history   AppointmentStatusHistory[]

  @@index([clinicId, startsAt])                   // day/week calendar query
  @@index([doctorId, startsAt])                   // doctor column + overlap check
  @@index([patientId, startsAt])                  // patient timeline
  @@index([clinicId, status, startsAt])           // "today's no-shows", dashboards
}

enum AppointmentStatus {
  SCHEDULED CONFIRMED CHECKED_IN IN_PROGRESS COMPLETED CANCELLED NO_SHOW RESCHEDULED
}
enum AppointmentSource { STAFF PATIENT_PORTAL DOCTOR WALK_IN IMPORT }

model AppointmentStatusHistory {
  id            String            @id @default(cuid())
  appointmentId String
  fromStatus    AppointmentStatus?
  toStatus      AppointmentStatus
  reason        String?
  changedById   String?
  changedAt     DateTime          @default(now())
  @@index([appointmentId, changedAt])
}

model AppointmentWaitlist {
  id           String   @id @default(cuid())
  clinicId     String
  patientId    String
  doctorId     String?
  serviceId    String?
  preferredFrom DateTime?
  preferredTo   DateTime?
  notifiedAt   DateTime?
  fulfilledAt  DateTime?
  @@index([clinicId, doctorId, fulfilledAt])
}
```

> **Note on slot generation.** Available slots are **computed**, never stored: the doctor's
> `DoctorAvailability` template, minus `DoctorTimeOff`, minus `ClinicHoliday`, minus existing
> non-cancelled `Appointment` rows, intersected with the clinic's working hours. Materialising a
> slot table would mean regenerating rows on every schedule edit and would be the first thing to
> go stale. The computation is cached in Redis per `(doctorId, date)` and invalidated by the
> `appointment.*` and `availability.*` events.

### 8.5 Clinical records

```prisma
model Encounter {                                 // one visit — the clinical container
  id             String          @id @default(cuid())
  clinicId       String
  patientId      String
  doctorId       String
  appointmentId  String?         @unique          // null for walk-ins
  encounterType  EncounterType   @default(CONSULTATION)
  chiefComplaint String?
  startedAt      DateTime        @default(now())
  endedAt        DateTime?
  status         EncounterStatus @default(OPEN)
  deletedAt      DateTime?

  vitals        Vitals?
  note          ClinicalNote?
  diagnoses     Diagnosis[]
  prescriptions Prescription[]
  labOrders     LabOrder[]
  files         FileObject[]
  itemsUsed     StockMovement[]                   // consumables spent during this visit

  @@index([patientId, startedAt])
  @@index([doctorId, startedAt])
  @@index([clinicId, startedAt])
}

enum EncounterType   { CONSULTATION FOLLOW_UP EMERGENCY PROCEDURE TELEHEALTH }
enum EncounterStatus { OPEN COMPLETED CANCELLED }

model ClinicalNote {                              // SOAP, signed then immutable
  id              String     @id @default(cuid())
  encounterId     String     @unique
  subjective      String?
  objective       String?
  assessment      String?
  plan            String?
  isPatientVisible Boolean   @default(false)      // gate for the patient portal
  status          NoteStatus @default(DRAFT)
  signedAt        DateTime?
  signedById      String?
  signatureHash   String?                         // hash of the content at signing time
  addenda         NoteAddendum[]
}

enum NoteStatus { DRAFT SIGNED AMENDED }

model NoteAddendum {                              // corrections after signing are appended
  id        String   @id @default(cuid())
  noteId    String
  body      String
  authorId  String
  createdAt DateTime @default(now())
  @@index([noteId, createdAt])
}

model Vitals {
  id                String   @id @default(cuid())
  encounterId       String   @unique
  heightCm          Decimal? @db.Decimal(5, 1)
  weightKg          Decimal? @db.Decimal(5, 2)
  temperatureC      Decimal? @db.Decimal(4, 1)
  systolicMmHg      Int?
  diastolicMmHg     Int?
  heartRateBpm      Int?
  respiratoryRate   Int?
  oxygenSaturation  Int?
  bloodGlucose      Decimal? @db.Decimal(6, 2)
  recordedAt        DateTime @default(now())
  recordedById      String?
}

model Diagnosis {
  id          String  @id @default(cuid())
  encounterId String
  code        String                              // ICD-10, e.g. "J06.9"
  codeSystem  String  @default("ICD10")
  description String
  isPrimary   Boolean @default(false)
  isChronic   Boolean @default(false)
  notes       String?
  @@index([encounterId])
  @@index([code])
}

model ChronicCondition {                          // patient-level, survives across encounters
  id          String    @id @default(cuid())
  patientId   String
  code        String?
  description String
  diagnosedAt DateTime? @db.Date
  resolvedAt  DateTime? @db.Date
  @@index([patientId])
}

model Allergy {                                   // surfaced as a banner on every chart
  id        String          @id @default(cuid())
  patientId String
  substance String
  reaction  String?
  severity  AllergySeverity @default(UNKNOWN)
  notedAt   DateTime        @default(now())
  @@index([patientId])
}

enum AllergySeverity { MILD MODERATE SEVERE LIFE_THREATENING UNKNOWN }

model Prescription {
  id          String   @id @default(cuid())
  clinicId    String
  encounterId String
  patientId   String
  doctorId    String
  issuedAt    DateTime @default(now())
  validUntil  DateTime?
  notes       String?
  pdfFileId   String?                             // generated asynchronously by the worker
  items       PrescriptionItem[]
  @@index([patientId, issuedAt])
}

model PrescriptionItem {
  id             String  @id @default(cuid())
  prescriptionId String
  drugName       String
  strength       String?                          // "500 mg"
  form           String?                          // "tablet"
  dosage         String                           // "1 tablet"
  frequency      String                           // "twice daily"
  durationDays   Int?
  quantity       Int?
  instructions   String?                          // "after food"
  isRefillable   Boolean @default(false)
}

model LabOrder {
  id           String         @id @default(cuid())
  clinicId     String
  encounterId  String
  patientId    String
  panelName    String
  status       LabOrderStatus @default(ORDERED)
  orderedAt    DateTime       @default(now())
  resultFileId String?
  resultNotes  String?
  reviewedAt   DateTime?
  reviewedById String?
  @@index([patientId, orderedAt])
}

enum LabOrderStatus { ORDERED COLLECTED RESULTED REVIEWED CANCELLED }
```

### 8.6 Files

One `FileObject` table for all uploads, attached to any entity through a polymorphic
`(ownerType, ownerId)` pair. The alternative — `PatientFile`, `EncounterFile`, `TicketFile` —
duplicates the presign, scan, quota and audit logic once per table.

```prisma
model FileObject {
  id           String         @id @default(cuid())
  clinicId     String
  ownerType    FileOwnerType                     // PATIENT | ENCOUNTER | TICKET | USER | INVOICE ...
  ownerId      String
  category     String?                           // "lab-result" | "scan" | "consent" | "receipt"
  storageKey   String         @unique            // S3 object key — never exposed to the client
  bucket       String
  fileName     String                            // original name, for the download header
  mimeType     String
  sizeBytes    Int
  checksumSha256 String?
  status       FileStatus     @default(PENDING)  // PENDING → CLEAN (or INFECTED / FAILED)
  scanResult   String?
  isPatientVisible Boolean    @default(false)    // gate for the patient portal
  uploadedById String
  deletedAt    DateTime?
  createdAt    DateTime       @default(now())

  @@index([clinicId, ownerType, ownerId])
  @@index([clinicId, category, createdAt])
}

enum FileOwnerType { PATIENT ENCOUNTER PRESCRIPTION LAB_ORDER TICKET USER CLINIC INVOICE INVENTORY_ITEM }
enum FileStatus    { PENDING CLEAN INFECTED FAILED }
```

### 8.7 Billing

```prisma
model Invoice {
  id            String        @id @default(cuid())
  clinicId      String
  branchId      String?
  patientId     String
  encounterId   String?
  number        String                            // "INV-2026-000318", sequential per clinic/year
  status        InvoiceStatus @default(DRAFT)
  issuedAt      DateTime?
  dueAt         DateTime?
  subtotal      Decimal       @db.Decimal(12, 2)
  discountTotal Decimal       @default(0) @db.Decimal(12, 2)
  taxTotal      Decimal       @default(0) @db.Decimal(12, 2)
  total         Decimal       @db.Decimal(12, 2)
  amountPaid    Decimal       @default(0) @db.Decimal(12, 2)
  balanceDue    Decimal       @db.Decimal(12, 2)  // stored, not computed on read: it is indexed
  currency      String
  notes         String?
  pdfFileId     String?
  voidedAt      DateTime?
  voidReason    String?
  createdById   String?

  lines    InvoiceLine[]
  payments PaymentAllocation[]

  @@unique([clinicId, number])
  @@index([clinicId, status, issuedAt])
  @@index([patientId, issuedAt])
  @@index([clinicId, balanceDue])                 // outstanding-balance report
}

enum InvoiceStatus { DRAFT ISSUED PARTIALLY_PAID PAID OVERDUE VOID }

model InvoiceLine {
  id              String   @id @default(cuid())
  invoiceId       String
  serviceId       String?
  inventoryItemId String?
  description     String                          // snapshot: prices change, invoices must not
  quantity        Decimal  @db.Decimal(10, 2)
  unitPrice       Decimal  @db.Decimal(12, 2)
  discount        Decimal  @default(0) @db.Decimal(12, 2)
  taxRatePercent  Decimal  @default(0) @db.Decimal(5, 2)
  lineTotal       Decimal  @db.Decimal(12, 2)
  @@index([invoiceId])
}

model Payment {
  id              String        @id @default(cuid())
  clinicId        String
  branchId        String?
  patientId       String
  amount          Decimal       @db.Decimal(12, 2)
  currency        String
  method          PaymentMethod
  status          PaymentStatus @default(COMPLETED)
  reference       String?                         // card auth code, transfer reference
  receivedAt      DateTime      @default(now())
  receivedById    String                          // the staff member who took the money
  note            String?
  refundedAmount  Decimal       @default(0) @db.Decimal(12, 2)
  idempotencyKey  String?       @unique           // a double-clicked "Record payment" is safe

  allocations PaymentAllocation[]
  @@index([clinicId, receivedAt])                 // daily reconciliation
  @@index([patientId, receivedAt])
}

enum PaymentMethod { CASH CARD BANK_TRANSFER INSURANCE ONLINE OTHER }
enum PaymentStatus { PENDING COMPLETED FAILED REFUNDED PARTIALLY_REFUNDED }

model PaymentAllocation {                         // one payment may settle several invoices
  id        String  @id @default(cuid())
  paymentId String
  invoiceId String
  amount    Decimal @db.Decimal(12, 2)
  @@unique([paymentId, invoiceId])
}

model Refund {
  id           String   @id @default(cuid())
  clinicId     String
  paymentId    String
  amount       Decimal  @db.Decimal(12, 2)
  reason       String
  refundedAt   DateTime @default(now())
  refundedById String
  @@index([clinicId, refundedAt])
}
```

### 8.8 Inventory

Stock on hand is a **ledger**, not a counter. `InventoryItem.quantityOnHand` is a cached
projection of `StockMovement` rows, recomputed inside the same transaction as every movement.
A mutable counter with no ledger cannot answer "why is this number wrong", which is the only
question anyone ever asks about inventory.

```prisma
model InventoryItem {
  id             String   @id @default(cuid())
  clinicId       String
  branchId       String?
  sku            String
  name           String
  categoryId     String?
  unit           String                           // "box" | "vial" | "tablet"
  costPrice      Decimal? @db.Decimal(12, 2)
  salePrice      Decimal? @db.Decimal(12, 2)
  quantityOnHand Decimal  @default(0) @db.Decimal(12, 2)   // projection of the ledger
  reorderLevel   Decimal  @default(0) @db.Decimal(12, 2)
  isTracked      Boolean  @default(true)
  isBillable     Boolean  @default(true)
  supplierId     String?
  isActive       Boolean  @default(true)
  deletedAt      DateTime?

  batches   InventoryBatch[]
  movements StockMovement[]

  @@unique([clinicId, sku])
  @@index([clinicId, isActive, name])
  @@index([clinicId, quantityOnHand])             // low-stock widget
}

model InventoryCategory {
  id       String @id @default(cuid())
  clinicId String
  name     String
  @@unique([clinicId, name])
}

model InventoryBatch {
  id          String    @id @default(cuid())
  itemId      String
  batchNumber String
  expiresAt   DateTime? @db.Date
  quantity    Decimal   @db.Decimal(12, 2)
  costPrice   Decimal?  @db.Decimal(12, 2)
  @@index([itemId, expiresAt])                    // expiring-soon widget
}

model StockMovement {
  id           String            @id @default(cuid())
  clinicId     String
  itemId       String
  batchId      String?
  type         StockMovementType
  quantity     Decimal           @db.Decimal(12, 2)   // signed: +in, -out
  balanceAfter Decimal           @db.Decimal(12, 2)   // running total, for cheap auditing
  reason       String?
  encounterId  String?                                // consumption tied to a visit
  purchaseOrderId String?
  performedById String
  occurredAt   DateTime          @default(now())
  @@index([clinicId, itemId, occurredAt])
  @@index([encounterId])
}

enum StockMovementType { PURCHASE CONSUMPTION ADJUSTMENT WASTAGE RETURN TRANSFER_IN TRANSFER_OUT }

model Supplier {
  id          String  @id @default(cuid())
  clinicId    String
  name        String
  contactName String?
  phone       String?
  email       String?
  address     String?
  isActive    Boolean @default(true)
  @@index([clinicId, isActive])
}

model PurchaseOrder {
  id           String   @id @default(cuid())
  clinicId     String
  supplierId   String
  number       String
  status       PurchaseOrderStatus @default(DRAFT)
  orderedAt    DateTime?
  expectedAt   DateTime?
  receivedAt   DateTime?
  total        Decimal  @default(0) @db.Decimal(12, 2)
  lines        PurchaseOrderLine[]
  @@unique([clinicId, number])
}

enum PurchaseOrderStatus { DRAFT ORDERED PARTIALLY_RECEIVED RECEIVED CANCELLED }

model PurchaseOrderLine {
  id               String  @id @default(cuid())
  purchaseOrderId  String
  itemId           String
  quantityOrdered  Decimal @db.Decimal(12, 2)
  quantityReceived Decimal @default(0) @db.Decimal(12, 2)
  unitCost         Decimal @db.Decimal(12, 2)
}
```

### 8.9 Support, notifications, outbox

```prisma
model SupportTicket {
  id           String         @id @default(cuid())
  clinicId     String
  number       String                             // "TKT-001204" — quotable over the phone
  subject      String
  categoryId   String?
  priority     TicketPriority @default(NORMAL)
  status       TicketStatus   @default(OPEN)
  requesterId  String                             // patient OR doctor OR staff — any user
  assigneeId   String?
  firstReplyAt DateTime?                          // SLA measurement
  resolvedAt   DateTime?
  closedAt     DateTime?
  createdAt    DateTime       @default(now())

  messages TicketMessage[]
  @@unique([clinicId, number])
  @@index([clinicId, status, priority, createdAt])
  @@index([assigneeId, status])
  @@index([requesterId, createdAt])
}

enum TicketStatus   { OPEN IN_PROGRESS WAITING_ON_USER RESOLVED CLOSED }
enum TicketPriority { LOW NORMAL HIGH URGENT }

model TicketCategory {
  id       String @id @default(cuid())
  clinicId String
  name     String                                 // "Billing" | "Appointment" | "Technical"
  @@unique([clinicId, name])
}

model TicketMessage {
  id         String   @id @default(cuid())
  ticketId   String
  authorId   String
  body       String
  isInternal Boolean  @default(false)             // staff-only note, invisible to the requester
  createdAt  DateTime @default(now())
  @@index([ticketId, createdAt])
}

model Notification {
  id        String    @id @default(cuid())
  clinicId  String
  userId    String
  type      String                                // "appointment.reminder"
  title     String
  body      String
  linkUrl   String?
  channel   NotificationChannel @default(IN_APP)
  readAt    DateTime?
  sentAt    DateTime?
  createdAt DateTime  @default(now())
  @@index([userId, readAt, createdAt])
}

enum NotificationChannel { IN_APP EMAIL SMS PUSH }

model NotificationPreference {
  id       String  @id @default(cuid())
  userId   String
  type     String
  channel  NotificationChannel
  enabled  Boolean @default(true)
  @@unique([userId, type, channel])
}

model OutboxEvent {                               // transactional outbox (section 13.4)
  id            String    @id @default(cuid())
  clinicId      String
  eventName     String                            // "appointment.booked"
  payload       Json
  occurredAt    DateTime  @default(now())
  processedAt   DateTime?
  attempts      Int       @default(0)
  lastError     String?
  @@index([processedAt, occurredAt])
}

model IdempotencyKey {
  key         String   @id
  userId      String
  endpoint    String
  responseBody Json?
  statusCode  Int?
  createdAt   DateTime @default(now())
  expiresAt   DateTime
}
```

### 8.10 Audit log

```prisma
model AuditLog {
  id           String      @id @default(cuid())
  clinicId     String
  occurredAt   DateTime    @default(now())

  actorId      String?                            // null for system/cron actions
  actorType    ActorType   @default(USER)
  actorLabel   String?                            // denormalised name — survives user deletion
  actorRoles   String[]                           // roles held at the moment of the action
  impersonatorId String?                          // set when an admin was acting "as" someone

  action       String                             // "appointment.cancelled", "patient.viewed"
  category     AuditCategory
  entityType   String?                            // "Appointment"
  entityId     String?
  entityLabel  String?                            // "APT-1042 — Sara K. with Dr Nabil"

  before       Json?                              // changed fields only, PHI-redacted
  after        Json?
  metadata     Json?                              // { reason, ticketId, ... }

  ipAddress    String?
  userAgent    String?
  requestId    String?                            // ties the row to the application log line
  severity     AuditSeverity @default(INFO)
  outcome      AuditOutcome  @default(SUCCESS)    // failures are audited too

  previousHash String?                            // tamper-evident chain (section 11.5)
  hash         String?

  @@index([clinicId, occurredAt])
  @@index([clinicId, actorId, occurredAt])
  @@index([clinicId, entityType, entityId, occurredAt])
  @@index([clinicId, action, occurredAt])
  @@index([clinicId, severity, occurredAt])
}

enum ActorType     { USER SYSTEM API_CLIENT ANONYMOUS }
enum AuditCategory { AUTH ACCESS_CONTROL CLINICAL FINANCIAL INVENTORY ADMIN FILE SUPPORT SYSTEM }
enum AuditSeverity { INFO NOTICE WARNING CRITICAL }
enum AuditOutcome  { SUCCESS FAILURE DENIED }
```

### 8.11 Indexing and growth notes

| Table | Expected growth | Plan |
|-------|-----------------|------|
| `AuditLog` | Largest table by 10x. ~50–200 rows per active user per day. | Range-partition by month from day one; detach and archive to cold storage after the retention window (section 11.6). |
| `Appointment` | ~10k/year per busy doctor | Composite indexes above cover every calendar view. Archive completed rows older than 3 years to a partition. |
| `StockMovement` | High-volume ledger | Partition by year once it passes ~10M rows. |
| `Notification` | High churn | Delete read in-app notifications older than 90 days via a nightly job. |
| `OutboxEvent` | High churn | Delete processed rows older than 7 days via a nightly job. |

Full-text search across patient names, phone numbers and MRNs uses Postgres `pg_trgm` +
`GIN` indexes in v1 — a dedicated search engine is not justified below ~1M patients.

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
GET    /api/v1/patients/{id}                     PATCH  /api/v1/patients/{id}
GET    /api/v1/patients/{id}/timeline            GET    /api/v1/patients/{id}/files
GET    /api/v1/patients/{id}/appointments        GET    /api/v1/patients/{id}/invoices
POST   /api/v1/patients/check-duplicates

GET    /api/v1/doctors                           POST   /api/v1/doctors
GET    /api/v1/doctors/{id}                      PATCH  /api/v1/doctors/{id}
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

GET    /api/v1/admin/clinic                      PATCH  /api/v1/admin/clinic
GET    /api/v1/admin/branches                    POST   /api/v1/admin/branches
GET    /api/v1/admin/users                       POST   /api/v1/admin/users/invite
POST   /api/v1/admin/users/{id}/status           POST   /api/v1/admin/users/{id}/roles
GET    /api/v1/admin/roles                       POST   /api/v1/admin/roles
PUT    /api/v1/admin/roles/{id}/permissions      GET    /api/v1/admin/permissions
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
     ├─ lockedUntil in the future      ─▶ "account locked" + AUTH audit row (DENIED)
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
  Write an AUTH audit row (SUCCESS): actor, ip, userAgent, requestId
```

A user holding several portal permissions (a doctor who owns the clinic) gets a **portal
switcher** in the top bar. The chosen portal is stored on `User.preferredPortal` so the next
login lands where they left off.

### 10.2 Middleware

`apps/web/src/middleware.ts` is intentionally thin — it does session presence and portal
segment gating only. It never queries the database (middleware runs on the edge runtime and must
stay fast); everything it needs is in the JWT.

```ts
const PORTAL_PERMISSION = {
  admin:   'portal.admin:access',
  staff:   'portal.staff:access',
  doctor:  'portal.doctor:access',
  patient: 'portal.patient:access',
} as const

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  if (isPublicPath(pathname)) return NextResponse.next()

  const token = await getToken(req)
  if (!token) return redirectToLogin(req)                 // preserves ?next= for post-login return

  if (token.status !== 'ACTIVE') return redirectTo(req, '/account-suspended')
  if (token.mustChangePassword && pathname !== '/change-password')
    return redirectTo(req, '/change-password')

  const portal = pathname.split('/')[1]
  if (portal in PORTAL_PERMISSION) {
    if (!token.permissions?.[PORTAL_PERMISSION[portal]]) {
      return redirectTo(req, resolveLandingPortal(token))  // bounce to *their* portal, not a 403
    }
  }
  const res = NextResponse.next()
  res.headers.set('x-request-id', crypto.randomUUID())     // correlates logs and audit rows
  return res
}
```

Two deliberate choices:

- **Wrong-portal access redirects rather than 403s.** A patient who bookmarks `/staff` is not an
  attacker, they are lost. Real enforcement is server-side at the use-case layer; middleware is
  navigation.
- **The JWT carries a compact permission map**, not the full catalogue, to keep the cookie small.
  Anything the map cannot answer is resolved server-side.

### 10.3 Session shape

```ts
interface SessionToken {
  sub: string                                  // userId
  clinicId: string
  status: UserStatus
  roles: string[]                              // role keys, for display only
  permissions: Record<PermissionKey, Scope>    // the actual authority
  permVersion: number                          // compared against Clinic.permissionVersion
  doctorId?: string
  patientId?: string
  preferredPortal?: PortalKey
  impersonatorId?: string                      // set during admin "view as"
  iat: number
  exp: number                                  // 15 min access token; refresh extends it
}
```

### 10.4 Password and session policy

| Control | v1 |
|---------|-----|
| Hashing | argon2id, per-user salt, tuned memory cost |
| Password rules | Minimum 12 characters, checked against a common-password list. No forced rotation, no composition rules — both push users toward weaker, written-down passwords. |
| Brute force | Exponential backoff per account plus a per-IP Redis rate limit; `lockedUntil` after 10 failures |
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
| **1. Automatic (Prisma extension)** | Every create / update / delete on an auditable model, with a field-level before/after diff | The safety net. A developer cannot forget to audit a new write, because they never wrote the audit call. |
| **2. Explicit (`audit.record()`)** | Domain events that carry *intent*: login, logout, permission denied, role changed, note signed, invoice voided, file downloaded, impersonation started | The automatic path sees rows change; it cannot see *why*. Intent is what an auditor actually reads. |
| **3. PHI read logging** | Every read of a patient record, encounter, prescription or clinical file | HIPAA-style access logging. Writes alone do not answer "who looked at this patient's file". |

Path 1 without path 2 gives a log nobody can interpret. Path 2 without path 1 gives a log with
holes. Both are required.

### 11.2 Actor context without prop-drilling

The Prisma extension needs to know *who* is acting, but it is called from deep inside
repositories that have no idea a request exists. Passing an actor through every function
signature would poison every API in the codebase. Instead, `AsyncLocalStorage` carries an
ambient request context.

```ts
// packages/core/src/context/request-context.ts
import { AsyncLocalStorage } from 'node:async_hooks'

export interface RequestContext {
  requestId: string
  actorId?: string
  actorType: ActorType
  actorLabel?: string
  actorRoles: string[]
  clinicId: string
  impersonatorId?: string
  ipAddress?: string
  userAgent?: string
}

const storage = new AsyncLocalStorage<RequestContext>()

export const runWithContext = <T>(ctx: RequestContext, fn: () => Promise<T>) =>
  storage.run(ctx, fn)

export const currentContext = () => storage.getStore()
```

`withApi` opens the context for every HTTP request; the BullMQ worker opens one per job with
`actorType: 'SYSTEM'`. Nothing downstream has to thread an actor argument.

### 11.3 The automatic extension

```ts
// packages/db/src/extensions/audit.ts
const AUDITED_MODELS = {
  Patient:       { category: 'CLINICAL',       phiRead: true },
  Encounter:     { category: 'CLINICAL',       phiRead: true },
  ClinicalNote:  { category: 'CLINICAL',       phiRead: true },
  Prescription:  { category: 'CLINICAL',       phiRead: true },
  Appointment:   { category: 'CLINICAL',       phiRead: false },
  Invoice:       { category: 'FINANCIAL',      phiRead: false },
  Payment:       { category: 'FINANCIAL',      phiRead: false },
  StockMovement: { category: 'INVENTORY',      phiRead: false },
  User:          { category: 'ADMIN',          phiRead: false },
  Role:          { category: 'ACCESS_CONTROL', phiRead: false },
  RolePermission:{ category: 'ACCESS_CONTROL', phiRead: false },
  UserRole:      { category: 'ACCESS_CONTROL', phiRead: false },
  FileObject:    { category: 'FILE',           phiRead: false },
} as const

export const auditExtension = Prisma.defineExtension({
  name: 'audit',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const config = AUDITED_MODELS[model]
        if (!config) return query(args)

        const isWrite = /^(create|update|delete|upsert)/.test(operation)
        const before  = isWrite && /^(update|delete)/.test(operation)
          ? await snapshot(model, args.where)
          : null

        const result = await query(args)

        if (isWrite) {
          enqueueAuditRow({
            action: `${camelToDot(model)}.${normaliseOp(operation)}`,
            category: config.category,
            entityType: model,
            entityId: result?.id,
            before: redactPhi(diffOnlyChanged(before, result)),
            after:  redactPhi(diffOnlyChanged(result, before)),
          })
        } else if (config.phiRead && operation.startsWith('find')) {
          enqueueAuditRow({ action: `${camelToDot(model)}.viewed`,
                            category: config.category, entityType: model,
                            entityId: extractId(result), severity: 'INFO' })
        }
        return result
      },
    },
  },
})
```

Four details that matter:

- **Only changed fields are stored.** Persisting whole rows would double the database size and
  make the diff viewer unreadable.
- **`redactPhi`** replaces the *values* of clinical free-text fields with `"[redacted]"` while
  keeping the field names, so the log proves what was touched without duplicating the medical
  record into a second, less-protected table.
- **`enqueueAuditRow` is non-blocking.** Rows are buffered and flushed by the worker. The audit
  write must never sit on the request's critical path.
- **PHI reads log the entity id, not the payload.**

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

1. **Database permissions.** The application connects as a role with `INSERT` and `SELECT` on
   `audit_log` and no `UPDATE` or `DELETE`. A `BEFORE UPDATE OR DELETE` trigger raises an
   exception as a second line of defence.
2. **Hash chain.** Each row stores `hash = sha256(previousHash + canonicalJson(row))`. Altering
   any historical row breaks every subsequent hash. A nightly job verifies the chain and raises a
   `CRITICAL` alert on a mismatch.
3. **Off-box shipping.** Rows are streamed to an append-only external sink (S3 Object Lock or a
   log platform) so a full database compromise cannot erase the trail.

Layer 1 is mandatory in v1. Layers 2 and 3 are Phase 8.

### 11.6 Retention and access

- **Retention:** 7 years for `CLINICAL` and `FINANCIAL` (typical medical-records statutes),
  2 years for `AUTH` and `SYSTEM`. Configurable per clinic; the default errs long.
- **Partitioning:** monthly range partitions on `occurredAt`. Old partitions detach to cold
  storage without a table-wide rewrite.
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
  DATABASE_URL:    z.string().url(),
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
- The same `requestId` appears on the log line, the trace, the Sentry event **and the audit row** —
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

Events are written to `OutboxEvent` **inside the business transaction**, then relayed to BullMQ
by a poller. This is what makes "the appointment was booked but the confirmation email never
sent" — and its mirror image, "an email went out for a booking that rolled back" — impossible.

Consumers are handlers registered in `apps/worker`. Adding "SMS the patient when an invoice is
issued" means adding one handler file. It does not mean editing the billing module.

### 13.5 Background jobs

| Queue | Jobs |
|-------|------|
| `notifications` | Appointment reminders (T-24h, T-2h), booking confirmations, invoice issued, ticket replies, low-stock alerts |
| `documents` | Prescription PDF, invoice PDF, receipt PDF, patient record export |
| `media` | Thumbnails, image optimisation, antivirus scan |
| `maintenance` | Nightly: no-show marking, `OutboxEvent` cleanup, `PENDING` file sweep, expiring-batch scan, audit hash-chain verification, overdue-invoice transition |
| `audit` | Buffered audit-row flush |

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

**`<AutoForm schema={ZodSchema}>`** — renders fields from the Zod schema, validates client-side
with the same schema the server validates with, maps `details[]` from the error envelope back
onto the offending fields, and handles dirty-state guards and optimistic submission.

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
        │ Postgres │ │ Redis  │ │ S3 / R2  │  │ worker x M │  scales on queue depth
        │ (primary)│ │        │ │          │  │ (BullMQ)   │
        └────┬─────┘ └────────┘ └──────────┘  └────────────┘
             │ streaming replication
             ▼
        ┌──────────┐
        │ replica  │  reports, analytics, exports
        └──────────┘
```

### 15.2 What breaks first, and the response

| Pressure point | Symptom | Response | When |
|----------------|---------|----------|------|
| Connection exhaustion | Prisma pool errors under load; serverless makes this worse | **PgBouncer** in transaction mode, tuned pool per instance | Before the second web node |
| Audit log volume | Slow inserts, bloated table, slow explorer queries | Monthly range partitions; async buffered writes; archive detached partitions | Designed in from Phase 0 |
| Report queries competing with the front desk | Calendar feels slow while an admin exports a year of revenue | Route read-only analytics to a **read replica** | ~5k appointments/month |
| Calendar queries | Day view slows as appointments grow | Composite indexes (section 8.4); cached slot computation; archive completed appointments past 3 years | ~100k appointments |
| Patient search | `ILIKE '%name%'` scans | `pg_trgm` GIN indexes; a dedicated search engine only past ~1M patients | ~50k patients |
| Notification fan-out | Reminder batches delay interactive jobs | Separate queues with separate concurrency; dedicated worker deployment | Phase 7 |
| Multi-clinic growth | Noisy-neighbour and blast-radius concerns | `clinicId` is already on every row; add Postgres **RLS** as defence in depth, then shard the largest tenants onto their own database | Multi-tenant SaaS phase |
| A module genuinely outgrowing the monolith | One module dominates CPU or deploy risk | Extract it: it already has a public interface, its own tables and event-based coupling. Replace the in-process call with an HTTP client behind the same `index.ts`. **Callers do not change.** | Only when measured |

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

---

## 16. Security and compliance posture

This system stores **Protected Health Information**. The architecture assumes HIPAA-style and
GDPR-style obligations even where a specific jurisdiction has not yet been chosen — retrofitting
these controls is far more expensive than building with them.

### 16.1 Controls in v1

| Area | Control |
|------|---------|
| Transport | TLS 1.2+ everywhere; HSTS; secure, httpOnly, SameSite cookies |
| At rest | Encrypted database volumes; SSE-KMS on object storage; `mfaSecret` encrypted at the column level |
| Access | Least privilege by default (a new custom role starts with **zero** permissions, not "everything except"); minimum-necessary scoping (section 7.3) |
| Audit | Every write, every privileged read, every denial (section 11) |
| Input | Zod validation at every boundary; Prisma parameterises all queries; no raw SQL with interpolation |
| Output | React escapes by default; strict CSP; `dangerouslySetInnerHTML` is lint-banned |
| CSRF | SameSite cookies plus origin checks on state-changing routes |
| Rate limiting | Per-IP and per-user, aggressive on `/auth/*`, presign, and export |
| Secrets | Never in the repo; managed by the platform's secret store; rotation runbook in `docs/runbooks/` |
| Dependencies | `pnpm audit` and Dependabot in CI; lockfile committed; builds fail on a critical advisory |
| Backups | Nightly full plus continuous WAL archiving; **restores rehearsed quarterly** — an untested backup is a hope, not a backup |
| Sessions | Short access tokens, revocable refresh tokens, visible device list, logout-everywhere |

### 16.2 Data subject rights

The schema supports these deliberately, not incidentally:

- **Access / portability** — `GET /api/v1/patients/{id}/export` produces a machine-readable
  archive of everything held about a patient, generated as a background job.
- **Rectification** — records are editable, and every edit is in the audit log with a diff.
- **Erasure** — *bounded by medical-record retention law.* A patient may request erasure, and the
  system pseudonymises identifying fields while preserving the clinical and financial record for
  the statutory period. `deletedAt` plus a `pseudonymisedAt` marker; the audit trail keeps
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

- pnpm workspaces, Turborepo, TypeScript strict, ESLint + Prettier, `eslint-plugin-boundaries`,
  dependency-cruiser rules from section 5.3
- `docker-compose.yml`: Postgres, Redis, MinIO, Mailpit
- Prisma initialised; `Clinic`, `User`, `Role`, `Permission` migrated; seed script
- `packages/ui` bootstrapped with tokens, theme, and the first shadcn primitives
- `packages/config` env schema; `packages/testing` factories
- CI: lint, typecheck, unit tests, migration check, dependency-graph validation
- One end-to-end vertical slice — health check + a single seeded page — deployed to staging

**Exit criteria:** `pnpm dev` runs the whole stack from a clean clone; CI is green; a boundary
violation fails the build; staging is live.

### Phase 1 — Identity, RBAC, portal shell · ~2 weeks

The spine everything else hangs from. Built first because retrofitting authorisation is the most
expensive mistake available.

- Auth.js credentials provider, argon2id, login / logout / forgot / reset / accept-invite
- Permission catalogue, seeded roles and grants, the policy engine (`can` / `assertCan`)
- Session resolution with the permission map; `permVersion` invalidation
- Middleware, portal routing, landing resolution, portal switcher
- App shell: sidebar, topbar, breadcrumbs, permission-driven navigation
- `withApi` wrapper: auth, permission gate, validation, request context, error mapping
- Audit foundations: request context, the Prisma extension, `AUTH` and `ACCESS_CONTROL` events

**Exit criteria:** four seeded users log in and each lands on the correct portal; a patient
typing `/admin` is redirected; a direct API call without permission returns 403 **and** writes a
`permission.denied` audit row.

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
- Double-booking prevention proven with a concurrent-request test

**Exit criteria:** staff books, reschedules and cancels; a patient books from their portal; two
simultaneous bookings for the same slot produce exactly one appointment and one clean 409.

### Phase 4 — Clinical records and files · ~2.5 weeks

- Encounter lifecycle; the doctor's encounter workspace
- SOAP notes with sign-and-lock and addenda; vitals; ICD-10 diagnoses; allergies and chronic
  conditions with the chart banner
- Prescription builder and async PDF generation
- File storage end to end: presign, confirm, scan, download-url, patient visibility gating
- Patient medical timeline and document vault
- **The `ASSIGNED` scope decision from section 7.5 must be settled before this phase ships.**

**Exit criteria:** a doctor completes and signs an encounter; the note becomes immutable; the
patient sees exactly what was flagged visible and nothing else; every PHI read appears in the
audit log.

### Phase 5 — Billing and payments · ~2 weeks

- Service catalogue and price list; tax configuration; invoice numbering
- Invoice generation from an encounter, including consumed inventory
- Payment recording with idempotency; partial payments; refunds
- Receipt and invoice PDFs; patient statement of account
- Daily reconciliation report

**Exit criteria:** an encounter produces an invoice; a partial payment moves it to
`PARTIALLY_PAID` with a correct balance; a double-clicked payment creates one row; the daily
report reconciles to the cent.

### Phase 6 — Inventory · ~1.5 weeks

- Items, categories, suppliers; batches with expiry
- The stock movement ledger with the `quantityOnHand` projection
- Consumption linked to an encounter and flowing into the invoice
- Low-stock and expiring-soon alerts

**Exit criteria:** consuming an item during a visit decrements stock, writes a ledger row, and
appears on the invoice — all in one transaction, and the ledger explains the balance.

### Phase 7 — Support and notifications · ~1.5 weeks

- Support tickets: patient and doctor submission, staff inbox, assignment, threaded replies with
  internal notes, status and priority
- Notification engine: templates, preferences, in-app centre, email
- Appointment reminders (T-24h, T-2h), booking confirmations, invoice and ticket notifications

**Exit criteria:** a patient opens a ticket and staff replies with both a public and an internal
message; reminders fire correctly across timezones and are not duplicated when a job retries.

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
| Prisma models | PascalCase singular | `Appointment` |
| Database tables | snake_case plural via `@@map` | `appointments` |
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
- [ ] Indexes added for any new query pattern
- [ ] Money in `Decimal`, timestamps in UTC, timezone conversion only at the edge
- [ ] Contract added to `packages/contracts` so mobile can call it

---

## 19. Open decisions (ADR log)

Recorded as `docs/adr/NNNN-title.md` as each is settled.

| # | Decision | Status | Notes |
|---|----------|--------|-------|
| 0001 | Modular monolith over microservices for v1 | **Accepted** | Section 5; revisit only on measured evidence |
| 0002 | Permissions as data with scoped grants | **Accepted** | Section 7 |
| 0003 | Transactional outbox for domain events | **Accepted** | Section 13.4 |
| 0004 | `ASSIGNED` scope: strict, chart-wide, or break-the-glass | **OPEN** | Section 7.5 — needed before Phase 4 |
| 0005 | Single-clinic v1 or multi-tenant SaaS from the start | **OPEN** | Schema supports both; affects onboarding, billing and RLS priority |
| 0006 | Patient self-registration, or invite-only by staff | **OPEN** | Affects identity verification and the `isDefault` role |
| 0007 | Payment provider for online payments | **OPEN** | Deferred with P16; `PaymentGateway` interface reserves the seam |
| 0008 | SMS provider and whether SMS is in v1 at all | **OPEN** | Cost per message drives reminder strategy |
| 0009 | Hosting target (Vercel + managed Postgres, or containers on a VPS/cloud) | **OPEN** | Affects PgBouncer setup and whether the worker is a separate service |
| 0010 | Timezone model: single clinic timezone, or per-branch | **Proposed** | Schema already allows per-branch override |

### The one to settle first

**0005 (single-clinic vs multi-tenant)** has the widest blast radius. The schema is written so
both work — `clinicId` is on every row either way — but it changes onboarding, the login flow
(is there a clinic selector?), billing, and how urgently Postgres RLS is needed. It does not
block Phases 0–2, so it can be answered during Phase 1, but not later.

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

---

*This document is living. When an implementation decision contradicts it, update this file in
the same PR — an architecture document that has drifted from the code is worse than none, because
it is trusted and wrong.*
