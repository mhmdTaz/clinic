# ADR-0022 — Patients book inside a window; staff are not limited

- **Status:** Accepted
- **Date:** 2026-09-12
- **Context:** Sections 3 (P5) and 8.7, Phase 3

## Context

Self-service booking needs limits a clinic can set: how far ahead a patient may book, how close
to the appointment they may still book, and how late they may cancel or reschedule themselves.
Hard-coding them would be wrong in both directions — a dentist and a physiotherapist do not run
the same notice period.

## Decision

Three settings on the clinic, with defaults that suit a small clinic:

| Setting                   | Default | Meaning                                                  |
| ------------------------- | ------- | -------------------------------------------------------- |
| `bookingHorizonDays`      | 60      | How far ahead a patient may book                         |
| `minimumNoticeHours`      | 2       | How close to the start a patient may still book          |
| `cancellationCutoffHours` | 24      | After this, a patient may no longer cancel or reschedule |

The rules apply to **patient self-service only**. Staff booking on the phone are not limited: the
clinic is talking to the patient, and a rule that blocks the front desk is a rule people work
around by inventing fake records.

A refusal names the clinic's phone number, so the patient can do what the screen will not.

## Consequences

- The window is business logic in `scheduling`, checked server-side on every self-service booking
  and cancellation; the UI hides what it would refuse, but the server is the control.
- Changing a setting takes effect on the next request, like every other clinic setting.
- Waitlists and auto-fill (S17, deferred) build on the same window rather than replacing it.
