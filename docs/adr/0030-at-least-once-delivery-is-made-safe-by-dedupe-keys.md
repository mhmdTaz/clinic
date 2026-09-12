# ADR-0030 — At-least-once delivery is made safe by dedupe keys, and reminders are swept rather than scheduled

- **Status:** Accepted
- **Date:** 2026-09-16
- **Context:** Sections 8.12, 13.4 and 13.5, use cases P9, S11, D16, Phase 7

## Context

Phase 7 brought the worker that Phases 4, 5 and 6 each deferred something to. Two questions had
to be settled before anything could be delivered.

### How a job that runs twice stays safe

Every queue in the world offers at-least-once delivery. A job **will** run twice — a handler that
times out after the work succeeded, a broker that redelivers, a resume token that replays an
event already handled. For notifications the second run is not a wasted cycle, it is a second
email to a patient at seven in the morning.

1. **Exactly-once delivery.** Does not exist in a distributed system, and pretending otherwise
   means discovering the truth in production.
2. **Remember what was sent.** A `sentNotifications` table read before each send: read-then-write,
   with a window between the read and the send exactly wide enough for the duplicate.
3. **Let the database refuse the duplicate.**

### How reminders know when to fire

Reminders are due at fixed offsets before an appointment — and an appointment can be moved.

1. **Schedule a job per reminder at booking time.** Then every reschedule has to find and move
   two jobs, every cancellation has to find and remove them, and every path that forgets sends a
   reminder for an appointment that is no longer there. Silently, and only for the patients
   affected.
2. **Sweep the diary on a tick.**

## Decision

**Option 3 for duplicates, option 2 for scheduling.**

Every notification carries a `dedupeKey` with a unique index on `(clinicId, dedupeKey)`. The key
is built **from facts and never from the attempt** — `reminder:<appointmentId>:24`,
`ticket.replied:<messageId>`, `invoice.issued:<invoiceId>` — and combined with the recipient, so
one event telling three people is three notifications and one retry is none. A handler that runs
again computes the same key, loses on the index, and is told so rather than erroring. This is
ADR-0028's shape, applied to the other place in the system where doing the work twice is worse
than not doing it.

Reminders are found by a sweep that reads the diary every few minutes for appointments whose
reminder is due about now. An appointment that moved is simply found in its new window; one that
was cancelled is not found at all. Nothing has to be kept in step, because nothing was scheduled.

Offsets are **elapsed hours from the appointment's instant**, so "24 hours before" means 24 hours
even across a daylight-saving change — which is what somebody being reminded understands by it.
Only the rendering is zoned, in the clinic's own timezone, so the time in the message is the time
on the clinic's wall.

The relay is a change stream on `outboxEvents` with a stored resume token, backed by a slower
sweep over anything still unprocessed. **The stream is the fast path; the sweep is the
guarantee.** Both reaching the same event is the ordinary case, which is why `markProcessed` is a
conditional update and why every handler is idempotent.

## Consequences

- A reminder job can retry, overlap itself, or run on two workers at once, and the patient gets
  one message. The tests fire two sweeps **together** rather than in sequence, so they race.
- The sweep costs one indexed query per offset per tick — four queries a minute for a clinic of
  any size — against the alternative's permanent obligation to keep scheduled jobs in step with a
  mutable diary. That trade is only obvious once you have seen the second one drift.
- A notification's in-app row is written before the email is attempted, and **an email failure
  does not fail the notification**. The row is the record; a dead SMTP server should not cost
  somebody the reminder they would have seen in the app. The channel is marked FAILED and the
  caller carries on.
- Preferences are stored as **exceptions rather than a full matrix**, so adding a notification
  type later needs no migration over every user, and a changed default actually reaches people
  who never opened the screen. Some types are locked: a cancelled appointment is not a marketing
  message, and somebody who turned it off would turn up to a closed door.
- `outboxEvents` is deliberately **not tenant-guarded and not audited**. The relay reads across
  every clinic because it is infrastructure rather than a clinic's data, and an event is a record
  _of_ an audited change — auditing it would double every entry.
- Processed events and read notifications are reclaimed by **TTL indexes**, not by nightly jobs.
  Work the database does for us cannot silently stop running (section 8.16).
- The worker is a separate app, and the boundary rules held it to the same standard as the web
  app: `apps/**` may not import the driver, so the change stream lives in the outbox repository
  and `connect`/`disconnect` are re-exported from the composition root.
