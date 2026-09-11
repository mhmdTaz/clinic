# ADR-0018 — Portal permissions are checked in layouts, not middleware

- **Status:** Accepted
- **Date:** 2026-09-11
- **Supersedes:** the portal gating in ARCHITECTURE.md section 10.2 as originally sketched

## Context

Section 10.2 originally had the middleware redirect a user away from a portal they lacked, reading
permissions from the JWT. Building it in Phase 1 exposed two problems:

- Middleware cannot reach the database, so it cannot write a `permission.denied` audit entry. A
  patient probing `/admin` — precisely what an audit log exists to reveal — would leave no trace.
- A token's permissions can be up to fifteen minutes old. Someone just granted a portal would be
  bounced away from it by the middleware before the server ever saw the new grant.

## Decision

The middleware checks only whether a valid session exists, or can be refreshed. Each portal's
layout calls `requirePortal()`, which runs `assertCan` against current grants, records any denial
with the request id, IP address and user agent, and then redirects to a portal the user can enter.

## Consequences

- Every portal denial is audited, including those caused by stale bookmarks.
- A newly granted portal works on the next request: a token with stale grants still authenticates,
  the request is authorised against the current grants, and an API call from the browser
  (`TokenRenewal`, rendered by the portal shell) stores the replacement token on the next full page
  load or refresh. Until then each request re-resolves grants from the database.
- The layout runs one permission check per portal page render — a check the navigation needed
  anyway.

## Amendments (Phase 2)

- **Stale tokens no longer go through the refresh route.** Phase 1 redirected a server component's
  stale token to `/api/v1/auth/refresh`. A full page load survives that, but a client refresh or
  soft navigation replays the redirect and loops on a blank page — found when an administrator
  saving permissions made their own token stale.
- **Portal pages await the same gate.** Next.js renders a layout and its page concurrently, so a
  page that only required an actor ran its own permission checks while the layout was redirecting,
  writing a second, misleading `permission.denied`. `requirePortal()` is memoised per request and
  every portal page awaits it before loading data: one check, one redirect, one audit entry.
