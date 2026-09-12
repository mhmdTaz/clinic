import {
  addQuantities,
  compareQuantities,
  isZeroQuantity,
  subtractQuantities,
  zeroQuantity,
} from '@clinic/contracts'

/** A batch as the allocator needs to see it. */
export interface BatchLike {
  id: string
  batchNumber: string | null
  /** A calendar date in the clinic's zone, or null for stock that does not expire. */
  expiresAt: string | null
  quantity: string
}

/** How much to take out of which batch. */
export interface BatchAllocation {
  batchId: string
  batchNumber: string | null
  quantity: string
}

/**
 * Every quantity that leaves this module is written the same way — three places, always. A
 * ledger row that says "2" where its neighbour says "2.000" is the kind of inconsistency that
 * makes a stock report look wrong when it is right.
 */
const normalised = (quantity: string): string => addQuantities(quantity)

export type FefoResult =
  | { ok: true; allocations: BatchAllocation[] }
  | { ok: false; reason: 'INSUFFICIENT_STOCK' | 'STOCK_EXPIRED'; usable: string }

/**
 * Which batches a withdrawal comes out of: **first to expire, first out** (section 8.11).
 *
 * FEFO rather than FIFO because stock that expires soonest is the stock about to become
 * worthless, and a clinic that reaches for the newest box throws the oldest away. Batches with
 * no expiry go last, since dated stock has a deadline and undated stock does not.
 *
 * **Expired batches are never allocated.** A vial that went out of date yesterday is still on
 * the shelf and still counted, but it is not something to put into a patient, so the allocator
 * refuses it and says so distinctly — which is the prompt to write it off rather than a vague
 * complaint about the count. That distinction is the whole reason this returns a result rather
 * than a nullable list.
 *
 * A single withdrawal may span several batches; the last one taken from is usually partial.
 */
export function allocateFefo(batches: BatchLike[], quantity: string, today: string): FefoResult {
  const usable = batches
    .filter((batch) => !isZeroQuantity(batch.quantity))
    .filter((batch) => batch.expiresAt === null || batch.expiresAt >= today)

  const available = addQuantities(...usable.map((batch) => batch.quantity))
  if (compareQuantities(available, quantity) < 0) {
    // Say which kind of shortage it is: "there is none" and "what is left has expired" call for
    // entirely different actions.
    const held = addQuantities(...batches.map((batch) => batch.quantity))
    const reason = compareQuantities(held, quantity) >= 0 ? 'STOCK_EXPIRED' : 'INSUFFICIENT_STOCK'
    return { ok: false, reason, usable: available }
  }

  const ordered = [...usable].sort(byExpiryThenOldest)
  const allocations: BatchAllocation[] = []
  let remaining = quantity

  for (const batch of ordered) {
    if (compareQuantities(remaining, '0') <= 0) break
    const take = compareQuantities(remaining, batch.quantity) < 0 ? remaining : batch.quantity
    allocations.push({
      batchId: batch.id,
      batchNumber: batch.batchNumber,
      quantity: normalised(take),
    })
    remaining = subtractQuantities(remaining, take)
  }

  return { ok: true, allocations }
}

/** Dated stock first, soonest to expire at the front; undated stock last. */
function byExpiryThenOldest(left: BatchLike, right: BatchLike): number {
  if (left.expiresAt === right.expiresAt) return 0
  if (left.expiresAt === null) return 1
  if (right.expiresAt === null) return -1
  // Both are YYYY-MM-DD, so a string comparison is a date comparison.
  return left.expiresAt < right.expiresAt ? -1 : 1
}

/**
 * Taking a named batch rather than letting expiry choose. Somebody at the shelf holding a
 * particular box is better informed than the sort order, so this is allowed — but it is still
 * refused when that box does not hold enough, and an expired one still cannot be used.
 */
export function allocateFromBatch(
  batches: BatchLike[],
  batchId: string,
  quantity: string,
  today: string,
): FefoResult {
  const batch = batches.find((candidate) => candidate.id === batchId)
  if (!batch) return { ok: false, reason: 'INSUFFICIENT_STOCK', usable: zeroQuantity() }
  if (batch.expiresAt !== null && batch.expiresAt < today) {
    return { ok: false, reason: 'STOCK_EXPIRED', usable: zeroQuantity() }
  }
  if (compareQuantities(batch.quantity, quantity) < 0) {
    return { ok: false, reason: 'INSUFFICIENT_STOCK', usable: normalised(batch.quantity) }
  }
  return {
    ok: true,
    allocations: [
      { batchId: batch.id, batchNumber: batch.batchNumber, quantity: normalised(quantity) },
    ],
  }
}

/** The total a set of batches holds, expired stock included — it is still on the shelf. */
export function totalOf(batches: BatchLike[]): string {
  return addQuantities(...batches.map((batch) => batch.quantity))
}
