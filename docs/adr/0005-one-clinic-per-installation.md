# ADR-0005 — One clinic per installation

- **Status:** Accepted
- **Date:** 2026-09-11
- **Decided by:** the product owner, on recommendation

## Context

The system was described as "a system for a clinic", with an administrator editing "clinic
details" — both singular. Emails are unique per clinic, not globally, so the same person can
hold accounts at two clinics. If one installation hosted several clinics, a form asking only for
an email and a password could not tell which account was meant: login would need a clinic
selector or a per-clinic address.

## Decision

Each installation serves exactly one clinic, named by the `CLINIC_ID` environment variable.
Login, token refresh, password reset and account activation all resolve the clinic from it, and
an access token whose clinic differs from the installation's is rejected.

## Consequences

- Login needs no clinic selector and no per-clinic hostname.
- Nothing about tenancy was removed. Every document still carries `clinicId`, every index still
  leads with it, and the tenant guard still refuses a query without it. Serving many clinics later
  means resolving the clinic from the request — a hostname, most likely — where `CLINIC_ID` is read
  today, in `packages/core/src/modules/session`. That is an addition, not a migration.
- A deployment with a wrong or missing `CLINIC_ID` fails on its first request with a message naming
  the variable, rather than a 404 that looks like a routing problem.
