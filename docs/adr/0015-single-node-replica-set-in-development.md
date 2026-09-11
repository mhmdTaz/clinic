# ADR-0015 — MongoDB runs as a replica set everywhere, including development

- **Status:** Accepted
- **Date:** 2026-09-11

## Context

MongoDB transactions (ARCHITECTURE.md section 8.10) and change streams
(section 13.4) both require a replica set. A standalone `mongod` accepts ordinary
reads and writes perfectly well and fails only those two paths — so a standalone
development environment looks healthy right up until the first payment or the
first outbox relay, and the failure surfaces in staging rather than on a laptop.

## Decision

`docker-compose.yml` runs `mongod --replSet rs0` with a one-shot `mongo-init`
container that calls `rs.initiate()` idempotently. The Mongo healthcheck asserts
`rs.status().ok === 1` rather than a plain ping, so `docker compose up --wait`
does not report healthy until the replica set is genuinely initiated.

CI starts the same compose file rather than a GitHub `services:` block, which
cannot run `rs.initiate()`. Using the identical file means CI cannot drift from
the local stack.

`pnpm db:verify` proves a commit, a rollback and a change-stream event on demand,
and runs in CI on every push.

**Port 27018, not 27017.** The container listens on the same port it publishes,
because a replica set advertises its own member address: with a host/container
port mismatch, the driver would discover `localhost:27017` and connect to whatever
else is running there. Using a non-default port also means this stack cannot
collide with another MongoDB already on the machine — which it did, on the first
attempt.

## Consequences

- Slightly slower first start (one extra container).
- Developers get transactional behaviour identical to production.
- The health endpoint reports `down` for a standalone topology rather than `up`,
  because reporting it healthy would be a lie the first booking exposes.
