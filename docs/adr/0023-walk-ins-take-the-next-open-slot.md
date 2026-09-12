# ADR-0023 — A walk-in takes the next open slot, not the current minute

- **Status:** Accepted
- **Date:** 2026-09-12
- **Context:** Sections 3 (S5) and 8.7, Phase 3; builds on ADR-0013

## Context

A patient arrives at 10:07 without an appointment. The diary offers 10:00 and 10:20, because
appointments sit on a five-minute grid and that grid is what makes double-booking impossible: the
booking writes one reservation document per grid cell, and a second booking for any overlapping
cell fails on a unique `_id` (ADR-0013).

Recording the walk-in "at 10:07" would mean writing an appointment that sits off the grid. That is
one line of code and the end of the guarantee — off-grid appointments overlap grid ones silently,
the reservation documents stop describing the diary, and the concurrency test still passes because
it only exercises the grid path.

Three ways out were considered:

1. **Off-grid appointments for walk-ins.** Honest about when the person arrived; quietly ends the
   double-booking guarantee for everyone.
2. **Overbooking: a second appointment on a slot already taken.** Real clinics do this, but it
   needs its own rules — how many, whose consent, what the doctor's column looks like — and those
   are clinic policy, not a scheduling detail.
3. **The next open slot.** The walk-in becomes an ordinary appointment on an ordinary slot.

## Decision

A walk-in is booked into **the doctor's next open slot today** and **checked in immediately**,
because the patient is standing at the desk. It carries `source: WALK_IN`, so it is never confused
with a booking someone planned.

- No time is sent by the client. The server computes the doctor's open times from now to the end
  of the clinic's today and takes the first. This is the same computation the calendar shows, so
  the front desk and the server cannot disagree about what is free.
- If two desks register walk-ins at the same moment, one loses the reservation race and is given
  the slot after it — up to three candidates — rather than an error about a time nobody chose.
- If the doctor has nothing left today, the answer is `NO_SLOT_TODAY` and the front desk books a
  later appointment or picks another doctor. It is not a failure the desk has to interpret.
- The **waiting room** is then a query, not a new concept: today's appointments with status
  `CHECKED_IN`, which is equally true of a walk-in and of someone who arrived early for a 3pm.

## Consequences

- The grid invariant holds for every appointment in the system. There is exactly one way an
  appointment comes to exist, and one way time is reserved.
- The recorded start time is the slot, not the moment of arrival. `checkedInAt` records when they
  actually got there, so the two questions — when were they seen, when did they arrive — are both
  answerable, and waiting time is the difference.
- A clinic that genuinely wants to overbook needs a decision of its own. This ADR does not close
  that door; it declines to open it by accident.
- `source: WALK_IN` is a validator change (migration `20260912000006`), not a new collection.
