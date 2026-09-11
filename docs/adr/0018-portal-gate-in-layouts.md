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
- A newly granted portal works on the next request: the layout sees the stale token and renews it
  through the refresh route.
- The layout runs one permission check per portal page render — a check the navigation needed
  anyway.
