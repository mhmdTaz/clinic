# ADR-0029 — Stock leaves the shelf by one conditional document write, and consumption is FEFO

- **Status:** Accepted
- **Date:** 2026-09-15
- **Context:** Sections 8.2 and 8.11, use cases A7, S10 and D15, Phase 6

## Context

Taking stock out has to do two things together: decrement the item's total and decrement the
specific batch it came from. If those can be separated by another writer, two clinicians reaching
for the last vial at the same moment both get it, and the shelf goes negative — or, worse, the
total and the batches disagree and nobody can say which is right.

There is a second question underneath it. A withdrawal of five may span three batches, and
_which_ batches it comes from is a real clinical decision, not an implementation detail.

### How stock could move

1. **Read the item, check there is enough, then write.** The window between the read and the
   write is exactly wide enough for the other clinician. This is the oversell bug.
2. **A transaction around a read and a write.** MongoDB transactions give snapshot isolation, not
   serialisability: the classic write-skew shape survives it, which is the same reason ADR-0013
   uses reservation documents for booking rather than a transaction.
3. **One conditional update whose filter carries the preconditions.**

### Which batch goes first

1. **FIFO** — oldest delivery first. Simple, and it throws away the box that was about to expire.
2. **FEFO** — first to expire, first out.
3. **Let the caller always choose.** Correct when somebody is standing at the shelf holding a
   particular box; tedious and error-prone as a default.

## Decision

**Option 3 for the write, FEFO for the choice, with a named batch as an override.**

Batches are **embedded in the item document** (section 8.2's rule applied: bounded, always read
with the item, meaningless apart from it). Because both live in one document, a withdrawal is a
single `updateOne` whose filter asserts every precondition:

```ts
{ clinicId, _id: itemId,
  quantityOnHand: { $gte: total },
  $and: allocations.map((a) => ({
    batches: { $elemMatch: { _id: a.batchId, quantity: { $gte: a.quantity } } },
  })) }
```

with `$inc` decrements applied through `arrayFilters`. MongoDB's document-level concurrency
control means the precondition and the decrement cannot be separated by another writer. No
read-then-write, no transaction needed for the stock move itself, and no oversell.

Allocation is FEFO: batches that expire soonest go first, undated stock last, and **expired
batches are never allocated** — a vial that went out of date yesterday is still counted but is
not something to put into a patient. When there is not enough, the domain distinguishes
`INSUFFICIENT_STOCK` from `STOCK_EXPIRED`, because "order more" and "write off what you have"
are different jobs. A caller may name a batch to override the order; the expiry and quantity
checks still apply.

`stockMovements` is the truth and `quantityOnHand` is its projection, exactly as `refunds` is the
truth behind `payments.refundedAmount` (ADR-0028). Every movement carries `balanceAfter`, so
explaining a number is one row rather than a replay of the history — and `reconcileItem` sums the
whole ledger and compares, so the claim is checkable rather than merely asserted.

**Consumption during a visit runs in a transaction**, because it spans three documents: the item,
the ledger and the invoice. That is Phase 6's exit criterion, and a crash between any two of them
would leave stock gone with nothing to show for it, or a patient billed for something still on
the shelf.

## Consequences

- Two simultaneous withdrawals of the last vial resolve with exactly one winner. The integration
  test fires both together rather than in sequence, so it really races.
- The embedded array has to stay bounded. Depleted batches are pruned after every withdrawal, and
  section 8.11's monthly archive job for long-expired batches is still the plan; the validator
  caps the array at 500 entries as a backstop.
- FEFO means the _displayed_ stock level can exceed what is actually usable: an item holding
  nothing but expired batches reports its count and refuses every withdrawal. That is honest —
  the stock is there, it simply cannot be used — and the expired alert and the distinct error
  code are what turn it into an action.
- A doctor holds `inventory:consume` but not `inventory:adjust`. Recording what a visit used and
  correcting a count are different authorities, and a new permission key is cheaper than a
  clinic granting adjust rights to everyone who gives an injection.
- `billToEncounter` performs **no permission check**. It is not an authority anybody exercises:
  the doctor decides what was used, the catalogue decides the item is billable, and the invoice
  line is the bookkeeping consequence. Gating it on `invoice:create` would mean a doctor could
  use a vial but not have the clinic charge for it, which is not a rule anybody asked for.
- Appending those lines to an existing draft is a `$push` plus an `$inc`, and it is correct only
  because ADR-0027 rounds per line: a line's contribution to every total is exactly its own
  figures, so nothing has to be recomputed from its neighbours and two concurrent appends both
  land.
