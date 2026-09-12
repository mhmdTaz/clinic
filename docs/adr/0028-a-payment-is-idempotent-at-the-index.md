# ADR-0028 — A payment is made idempotent by a unique index, not by a prior read

- **Status:** Accepted
- **Date:** 2026-09-14
- **Context:** Section 8.10, use case S8, Phase 5

## Context

Taking money is the one place in this system where doing the work twice is worse than not doing it
at all. A cashier double-clicks; a phone loses signal and the browser retries a request the server
actually completed; a proxy replays. Each of those can present the same payment twice, and the
naive implementation takes the money twice.

Phase 5's exit criterion states it plainly: **a double-clicked payment creates one row.**

Three ways to get there.

1. **Disable the button while the request is in flight.** Stops the double-click and nothing else:
   not the retry after a timeout, not two tabs, not the mobile app, not a replayed request. It is
   a courtesy, not a guarantee.
2. **Look the payment up before inserting it.** Read-then-write, with a window between the read
   and the insert that is exactly wide enough for the second request to pass through. Under the
   concurrency this is meant to survive — two requests in flight at once — it fails.
3. **Let the database refuse the duplicate.**

Recording a payment is also the system's only genuinely multi-document write: it inserts a payment
and moves one or more invoice balances.

## Decision

The third, with a transaction around the whole thing.

Every `POST /api/v1/billing/payments` carries an `idempotencyKey` minted by the client. The
`payments` collection has a unique index on `(clinicId, idempotencyKey)`. The insert and every
invoice balance it moves run inside one transaction:

- if the insert succeeds, each allocation is applied and the transaction commits;
- if the insert loses on the unique index, the transaction unwinds and the caller is handed the
  payment that already exists — the same id, the same number, the same response.

Each invoice balance moves by a **conditional aggregation-pipeline update**: the filter carries
`status: { $in: ['ISSUED', 'PARTIALLY_PAID'] }` and `balanceDue: { $gte: amount }`, and the new
status is computed inside the pipeline from the document's own current values. Nothing about the
outcome is decided from a value read earlier.

The key is minted when the payment dialog opens and re-minted when the amount changes, so a second
payment of a different amount is a second payment rather than a swallowed repeat of the first.

A fast-path lookup by key runs before the transaction opens. It is a courtesy for the common case —
the second request arriving after the first has committed — not the guard.

## Consequences

- The guarantee holds against a double-click, a retry, two tabs, the mobile app and a replay,
  because it does not depend on anything the client does. Both the integration test and the
  Playwright journey fire the two requests **together** rather than in sequence, so the second
  really does race the first and really does have to lose on the index.
- `balanceDue: { $gte: amount }` in the filter makes overpayment structurally impossible: an
  allocation larger than what is owed matches no document at all rather than driving a balance
  negative. The use case checks the same thing first, so the common mistake comes back as a
  sentence rather than as a rolled-back transaction.
- Transactions require a replica set. This was already a hard requirement of Phase 0 (section 8.10)
  and is why local development and CI both run `mongod --replSet rs0` with an init step.
- A payment number is allocated before the transaction opens, from the counters collection, which
  is not transactional. In the rare true race the losing request burns a number, leaving a gap in
  the receipt sequence. Invoice numbers, which are the ones an auditor follows, are unaffected —
  every invoice ever numbered still exists, voided if abandoned.
- Refunding is the mirror and is transactional for the same reason: the refund row, the payment's
  refunded total and every invoice balance it reverses move together or not at all. Which invoices
  a refund comes off is decided in the domain — the last one the payment settled gives it back
  first — so the split is deterministic, testable, and explainable at the desk.
