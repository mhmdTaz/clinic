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

## Addendum, Phase 4 — a row that names no doctor

Clinical records made the rule meet a case it did not cover. An encounter names its doctor, so
`ASSIGNED` is decided by comparing one field. A **patient** row names no doctor at all. Read
literally, a doctor holding `patient:read` at `ASSIGNED` could open nobody, and the doctor portal
would have no charts in it.

The answer is to keep the strictness where it was actually aimed:

- **A patient is reachable when the doctor is named on one of that patient's visits.** That is
  "my patients" (D3), and it is answered by a query against encounters, not by widening a grant.
- **The chart's contents stay strict, row by row.** A colleague's note on the same patient is
  still out of reach. Being able to open the patient is not being able to read everything ever
  written about them — which is precisely the distinction that made chart-wide scope the wrong
  answer above.

Authorisation asks the question and visits answer it, and the two modules never import each
other: `access` declares a `CareRelationship` port, `clinical` implements it, and the composition
root wires them together. Until it does, the port denies.

The doctor's directory follows the same logic. `patient:read` at `ASSIGNED` is refused the
clinic-wide directory, and the doctor portal gets its own "my patients" list instead — the same
rule, asked the right way round.
