# ADR-0010 — One timezone for the whole clinic

- **Status:** Accepted
- **Date:** 2026-09-11
- **Decided by:** the product owner, on recommendation

## Context

Working hours, holidays and — from Phase 3 — appointment slots are wall-clock times: "we open at
09:00". Turning them into instants needs a timezone. The clinic document has one, and the branch
schema has an optional override, so the question was whether each branch may keep its own.

ADR-0005 puts one clinic in each installation. A clinic's branches are, in practice, in one city
or one country, and the region this product is built for does not straddle timezones.

## Decision

The clinic's IANA timezone applies to every branch. Branches do not have a timezone of their own,
and the settings screen does not offer one. The `timezone` field on the branch schema stays,
unused, so that a per-branch override is an addition later rather than a migration.

All instants are stored in UTC. Calendar dates — a holiday, a date of birth — are stored as
`YYYY-MM-DD` strings, never as instants, and "today" is always computed in the clinic's timezone.

## Consequences

- Slot computation in Phase 3 reads one timezone from the clinic document already in the request.
- Changing the clinic's timezone shifts every working hour with it. The settings screen says so.
- A clinic that opens a branch across a timezone boundary needs this revisited, and the field
  that allows it already exists.
