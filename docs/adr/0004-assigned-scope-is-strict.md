# ADR-0004 — `ASSIGNED` reaches the rows you are named on

- **Status:** Accepted
- **Date:** 2026-09-12
- **Context:** Section 7.5. Open since the original design; needed now, because Phase 3 gives
  doctors their own appointment lists, and needed again before clinical records ship in Phase 4.

## Context

Three readings of `ASSIGNED` were on the table:

- **Strict** — a doctor reaches the rows naming them: their appointments, the encounters they
  conducted.
- **Chart-wide** — being named on one row in a patient's chart opens the whole chart.
- **Break-the-glass** — strict, plus an override anyone may take in an emergency, loudly audited.

Chart-wide is the tempting one, because a doctor seeing a patient usually does want the history.
But it makes the reach of a grant depend on data rather than on the grant: one appointment booked
by the front desk quietly widens what that doctor can read, and nothing in the roles editor shows
it. That is the opposite of permissions being data you can inspect (section 7.2).

## Decision

`ASSIGNED` is **strict**: the scope resolver compares the row against the actor's own doctor
profile, and reaches nothing else.

A clinic that wants a doctor to read every chart grants `CLINIC` instead. That is what the roles
editor is for, and the matrix shows it plainly.

## Consequences

- List endpoints compile the scope to `{ clinicId, doctorId: actor.doctorId }`, served by the
  `{ doctorId, startsAt }` index — no in-memory filtering, no collection scan.
- An actor without a doctor profile resolves `ASSIGNED` to nothing. Never to everything: a
  missing profile must not read as a wildcard.
- A locum covering a colleague sees the appointment once it names them, which is what
  rescheduling onto them does. Standing cover is a `CLINIC` grant.
- Phase 4 revisits only the override. Break-the-glass, if the clinic wants it, arrives as an
  additive audited action, not as a change to what `ASSIGNED` means.
