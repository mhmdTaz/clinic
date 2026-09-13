# ADR-0032 — The API client is typed from the contracts, not generated from OpenAPI

**Status:** accepted · Phase 9 · amends the pipeline drawn in §9.1

## Context

§9.1 draws the reuse pipeline as:

```
packages/contracts (Zod) ──▶ OpenAPI document ──▶ packages/api-client ──▶ web + mobile
```

Phase 9 needed the client. The OpenAPI document did not exist, so the question was whether to
build it first and generate from it, or to type the client directly against the Zod contracts.

## Decision

**The client imports the contracts directly.** Response types are `z.infer` of the same schema the
route handler validates against, and the client parses responses with that schema at runtime.

The OpenAPI document remains worth publishing, for a different reason than the one §9.1 gives —
see Consequences.

## Why

**A round trip through OpenAPI loses precision.** Zod expresses refinements that JSON Schema
cannot: `AppointmentListQuery` refuses a range whose end precedes its start, `MoneyAmount` is a
decimal string with a currency-dependent scale, `LocalDate` is a calendar day rather than an
instant. A generated client would accept inputs the server then refuses, and the failure would
arrive as a 422 at runtime instead of a red squiggle.

**Codegen puts a build step between a contract change and a compile error.** With a direct import,
renaming a field in `packages/contracts` breaks every caller immediately, in the editor. With
generation, it breaks after somebody remembers to regenerate — and the window in between is
exactly when a mobile build ships against a contract that has moved.

**It was the cheaper experiment, and the experiment was the point.** Phase 9's exit criterion is a
question about whether the API is honest, not a feature. Typing the client directly answered it in
hours and immediately surfaced four wrong assumptions at compile time and one genuine gap at
runtime (see ARCHITECTURE §17, Phase 9). A generator would have answered the same question later
and less precisely.

## Consequences

**The pipeline in §9.1 is one arrow shorter than drawn**, and this ADR is the record of that.
Contracts still are the single source of truth; the client is simply derived from them directly
rather than via a document.

**Runtime validation is now the client's job, and it earns its cost.** A web build is never older
than its server; an app from a store can be months older. A field the server stopped sending
becomes `undefined` three components deep, where it reads as a rendering bug rather than as
version skew. Parsing at the boundary turns it into one error naming the endpoint —
`ContractMismatchError` — and it can be switched off where a payload is large and the two ship
together.

**A third-party integrator still deserves an OpenAPI document.** That is the reason to publish
one, and it is a different reason from generating our own client: an outside consumer has no
access to `packages/contracts`, and "read our TypeScript" is not an integration story. Generating
the document _from_ the contracts (with `zod-to-openapi`) remains the right way to produce it.

_Phase 10:_ published at `/api/v1/openapi.json`. It is generated in `apps/web`
(`src/lib/api/openapi`) rather than in `packages/contracts`, because the paths, permissions and
status codes it adds to the contracts belong to the delivery layer, and the contracts package stays
Zod only. A test reads every `route.ts` and fails when the catalogue the document is built from
misses a route or disagrees with it.

## Alternatives considered

**Generate the client from OpenAPI, as drawn.** The honest version of this needs the document to
be complete and annotated before any client exists, which front-loads work that answers no
question, and delivers weaker types at the end of it.

**Hand-write types and keep them in step by review.** Two sources of truth with a human diff
between them. The first drift would be found by a patient.

**Skip a shared client; let each app call `fetch` itself.** This is what existed before Phase 9,
and it is why the web's `apiFetch` refreshes per request — a behaviour that is fine in a browser
and wrong on a phone, where a dozen queries resume at once and refresh tokens rotate. Two
implementations means two sets of such bugs, found separately.
