import {
  addAmounts,
  compareAmounts,
  isZeroAmount,
  subtractAmounts,
  zeroAmount,
} from '@clinic/contracts'

/** What a payment settled, or what a refund took back off. */
export interface Allocation {
  invoiceId: string
  invoiceNumber: string | null
  amount: string
}

/** A payment must be fully accounted for: what was taken equals what it settled. */
export function allocationsBalance(
  amount: string,
  allocations: Array<{ amount: string }>,
  currency: string,
): boolean {
  const allocated = addAmounts(currency, ...allocations.map((a) => a.amount))
  return compareAmounts(allocated, amount) === 0
}

/**
 * Which invoices a refund comes back off, and how much from each.
 *
 * A refund unwinds the payment's allocations from the end: the last invoice the money settled
 * gives it back first. It is the same semantics as undo, it is deterministic, and it is the one
 * a cashier can explain at the desk — "we took it back off the visit we applied it to last".
 * Splitting proportionally instead would produce fractions of cents that have to be rounded
 * somewhere, and a rounding rule nobody can see is a rounding rule nobody can check.
 *
 * `alreadyRefunded` is how much of this payment came back in earlier refunds. Passing it in,
 * rather than tracking per-allocation remainders on the payment, keeps the payment document a
 * record of what happened and leaves the arithmetic here where it can be tested.
 */
export function unwindAllocations(
  allocations: Allocation[],
  alreadyRefunded: string,
  refunding: string,
  currency: string,
): Allocation[] {
  const before = takeFromEnd(allocations, alreadyRefunded, currency)
  const after = takeFromEnd(allocations, addAmounts(currency, alreadyRefunded, refunding), currency)

  const unwound: Allocation[] = []
  allocations.forEach((allocation, index) => {
    const amount = subtractAmounts(currency, after[index] ?? '0', before[index] ?? '0')
    if (!isZeroAmount(amount)) {
      unwound.push({
        invoiceId: allocation.invoiceId,
        invoiceNumber: allocation.invoiceNumber,
        amount,
      })
    }
  })
  return unwound
}

/**
 * How much each allocation gives up when `amount` is consumed from the last one backwards.
 * Returned in the allocations' own order, so the caller can subtract one run from another.
 */
function takeFromEnd(allocations: Allocation[], amount: string, currency: string): string[] {
  const taken = allocations.map(() => zeroAmount(currency))
  let remaining = amount

  for (let index = allocations.length - 1; index >= 0; index -= 1) {
    if (compareAmounts(remaining, '0') <= 0) break
    const available = allocations[index]?.amount ?? zeroAmount(currency)
    const take = compareAmounts(remaining, available) < 0 ? remaining : available
    taken[index] = take
    remaining = subtractAmounts(currency, remaining, take)
  }

  return taken
}
