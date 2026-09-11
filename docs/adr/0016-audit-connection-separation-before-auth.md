# ADR-0016 — The audit connection is separated before authentication exists

- **Status:** Accepted
- **Date:** 2026-09-11

## Context

Section 11.5 requires that the application be unable to modify audit history: the
audit writer holds `insert`+`find` on `auditLogs` and nothing else, on its own
connection, while the main application user has no privileges on the collection.

MongoDB enforces that with authentication. Running a replica set **with** auth
requires a keyfile for internal member authentication, mounted with `chmod 400`
and `mongodb` ownership — which is unreliable to reproduce on Windows bind mounts
and would make `docker compose up` fragile on the primary development machine.

## Decision

Local development runs `mongod` without authentication. The migration that creates
the restricted `clinicAuditWriter` role detects this and skips with an explicit
warning rather than failing.

**The separation is structural in code regardless:** `getAuditConnection()` is a
distinct Mongoose connection reading `MONGODB_AUDIT_URI`, wired from day one. In
staging and production those are different credentials; locally they happen to be
the same URI. Moving to real privilege separation is a configuration change, not a
refactor.

## Consequences

- Locally, the privilege separation is **not enforced** — an audit entry could be
  modified by a developer with a mongosh session. This is acceptable for disposable
  development data and unacceptable anywhere else.
- Staging and production **must** run with auth and must set
  `MONGODB_AUDIT_PASSWORD`; the migration throws if auth is on and it is missing.
- Phase 8 adds the hash chain and off-box shipping (section 11.5 layers 3 and 4).
- Revisit if development moves to Linux/WSL by default, where the keyfile is easy.
