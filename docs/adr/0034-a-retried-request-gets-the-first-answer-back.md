# ADR-0034 — A retried request gets the first answer back

**Status:** accepted · Phase 10 · keeps the promise §9.2 makes about `Idempotency-Key`

## Context

§9.2 says an `Idempotency-Key` header is honoured on every POST that moves money or creates a
booking. Until Phase 10 nothing read the header. A payment was idempotent by a key in its body
(ADR-0028); a booking relied on the slot hold.

Those guards stop a **double effect**. They do not give a retry the **right answer**. A patient on a
weak signal books, the response is lost, and the app retries: the slot hold refuses the retry
`SLOT_TAKEN`. Nobody was double-booked — and the patient is told somebody else took the time they
in fact hold, so they book another. Phase 9's app had to read the patient's diary after every
`SLOT_TAKEN` to tell the two apart. The `idempotencyKeys` collection that §6 lists and §15 gives a
TTL had never been built.

## Decision

**A key is claimed before the handler runs, and the response the handler produced is stored and
sent again to a retry.** Built in `@clinic/core/idempotency` and applied by `withApi` to routes that
declare `idempotent: true`: booking (staff, self-service, walk-in), rescheduling, cancelling,
recording a payment and refunding one.

- **Optional.** A request without the header behaves exactly as before. The domain guards stay
  where they are.
- **Scoped to the sender.** A key is unique per clinic, per user, per method and path. Somebody
  else's key — guessed or leaked — reaches nothing of theirs.
- **Claimed after authentication, the permission check and body validation.** A request refused at
  the door was not an attempt at the work, and must not use up the key the corrected request will
  be sent with.
- **The same request is the same body.** The body is fingerprinted as JSON with its keys sorted, so a
  retry re-serialised in another order is still the same request.
- **Four outcomes for a key already recorded,** compared body-first:
  - a different body → `422 IDEMPOTENCY_KEY_REUSED`, even while the first runs — answering with the
    first request's appointment would tell somebody they booked a time they did not choose;
  - finished → the stored status and body, with `idempotent-replayed: true`;
  - still running → `409 IDEMPOTENCY_KEY_IN_USE`, `Retry-After: 1`;
  - running, but its 60-second lease has lapsed → the retry takes the key over (by a compare-and-set
    on a claim token) and runs.
- **An answer is kept; a failure is not.** A success, and a refusal the domain made (`SLOT_TAKEN`,
  `BEYOND_HORIZON`), are stored: the same request would get the same answer. A server error releases
  the key, so the retry runs again rather than being told about a fault that may have passed.
- **Recording the answer cannot fail the request.** The work is done by then. If storing the answer
  fails, that is logged and the response goes out: an error here would make the client retry, and
  after the lease the retry would do the work twice.
- **A day, then gone,** by a TTL index. A retry a day later is a new request.

## Why

**The retrier needs the answer, not a refusal.** Every alternative that stops the double effect
without replaying the response leaves the client unable to tell "you already did this" from
"somebody else did".

**A unique index is the claim.** The insert either wins or it does not, across every instance of
the stateless app server (§2.1). A read-then-write has a window exactly as wide as the double tap it
exists for — the same reasoning as ADR-0028.

**Released on a server error, because the guards are still there.** If a 5xx came after the work
committed, the retry runs into the slot hold or the payment index and is refused, which is the
behaviour before this ADR — never a second booking or charge.

## Consequences

**Stored responses hold PHI for a day.** An appointment's detail sits in `idempotencyKeys` beside the
appointment itself, in the same database under the same protection (§16.1), and expires.

**A replay is the answer to the request, not the current state.** A retry of a booking that has
since been cancelled gets the booking's original `201`. That is what the request was; the next read
shows what is true now.

**A request that runs longer than the lease can run twice.** No booking or payment comes near sixty
seconds, and the domain guards stand behind it if one ever does.

**The mobile app's workaround is gone.** `isOwnBooking` and the diary read after `SLOT_TAKEN` were
removed; the parity suite proves over HTTP that a retried booking returns the same appointment.

## Alternatives considered

**A key in every body, as ADR-0028 does for payments.** It works, and payments keep it. But it puts
a transport concern into every contract, and it is not what §9.2 promised a client.

**Redis.** Already present for rate limits. But a claim must survive a restart for exactly as long
as a client may retry, which is a TTL index's job, and a replayed booking must never depend on a
cache that may evict it.

**`409` for any repeat, without replay.** Simpler, and it leaves the client where Phase 9 found it:
refused, and unable to tell whether its own request went through.
