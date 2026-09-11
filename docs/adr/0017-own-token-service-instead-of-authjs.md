# ADR-0017 — Own token service instead of Auth.js

- **Status:** Accepted
- **Date:** 2026-09-11
- **Supersedes:** the Auth row of ARCHITECTURE.md section 3

## Context

Section 3 named Auth.js (NextAuth v5) with a credentials provider. Sections 9.1 and 10 then
required a 15-minute access token; revocable, per-device refresh tokens; one token usable both as
a web cookie and as a mobile `Authorization: Bearer` header; permission changes taking effect on
the next request; and account lockout with rate limiting.

Measured against those requirements at the start of Phase 1, Auth.js fell short in four ways:

1. The credentials provider supports only its JWT session strategy — no refresh-token rotation
   and no per-device revocation.
2. Its session token is an encrypted JWE shaped around its own cookie handling, not something a
   mobile app can send as a Bearer token. The mobile API would need a second authentication path.
3. Reissuing a token when grants change (section 7.7) means working through its `jwt` callback's
   update trigger, from inside the framework.
4. It places authentication in `apps/web` — the framework layer that section 2.4 keeps business
   logic out of.

## Decision

Authentication is part of `@clinic/core` and imports no framework:

- **`identity`** — credential verification (argon2id), lockout, the password policy, refresh-token
  sessions with rotation and reuse detection, password resets and invitations.
- **`session`** — composes `identity` with `access` into a signed-in session, issuing HS256 access
  tokens through `jose` with the algorithm pinned.
- **`apps/web`** adds only what is genuinely about HTTP: cookies, redirects and the `withApi` wrapper.

## Consequences

- One verification path. The cookie and the Bearer header carry the same token and both reach
  `authenticateAccessToken()`.
- Security-critical code is ours to maintain. It is built only from standard primitives — `jose`,
  `@node-rs/argon2`, Web Crypto — and covered by unit tests plus live tests for lockout, reuse
  detection, the rotation grace window, single-use reset links and immediate sign-out.
- OIDC or SSO becomes another way to reach `openSession()`, not a replacement for it.
- An independent security review of `packages/core/src/modules/identity` and `session` belongs on
  the Phase 8 hardening checklist.
