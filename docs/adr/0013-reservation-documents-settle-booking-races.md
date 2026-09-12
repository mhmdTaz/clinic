# ADR-0013 — Reservation documents settle booking races

- **Status:** Accepted
- **Date:** 2026-09-12
- **Context:** Section 8.7, Phase 3 exit criterion

## Context

The relational design took a transactional advisory lock on `(doctorId, day)`. MongoDB has no
advisory locks, and a transaction aborts on a write conflict to the **same document**, not on a
phantom read. Two concurrent bookings can both run an overlap query, both find the slot free,
both insert their own appointment, and both commit. A direct port of the Postgres logic would be
silently broken under exactly the load it exists to survive — and it would pass a code review,
because the bug is in what MongoDB does not do.

## Decision

Booking writes one **reservation document per five-minute grid cell** the appointment covers, in
the same transaction as the appointment itself. The `_id` is deterministic:
`${doctorId}:${cellStartISO}`. A second booking for any overlapping cell fails on the unique
`_id` with a duplicate-key error, which the use case maps to `SLOT_TAKEN` (409).

Cancelling or rescheduling deletes the reservations by `appointmentId`. Provisional holds carry
`expiresAt`, and a TTL index reclaims them without a sweeper.

## Consequences

- The storage engine decides the race, so it holds across application instances, with no lock
  service and no read-then-write window.
- Correctness is proven by firing simultaneous bookings at one slot and asserting exactly one
  appointment and one 409 — not by reading the code.
- An hour of appointment costs at most twelve small documents. The grid is one constant; moving
  it changes cost and the smallest bookable increment together.
- Availability itself stays **computed, never stored**. Reservations settle conflicts; they are
  not a schedule.
