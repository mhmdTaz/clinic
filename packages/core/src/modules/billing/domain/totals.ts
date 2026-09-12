import {
  addAmounts,
  isNegativeAmount,
  multiplyAmount,
  percentOf,
  subtractAmounts,
  zeroAmount,
} from '@clinic/contracts'
import type { InvoiceLineInput } from '@clinic/contracts'

/**
 * What an invoice adds up to (section 8.10).
 *
 * The rule that matters is where the rounding happens: **each line is rounded once, and the
 * invoice is the sum of rounded lines** (ADR-0027). Rounding the lines and then re-deriving the
 * total from unrounded intermediates can leave the printed lines a cent short of the printed
 * total, which is the single most common billing bug and the one a patient always spots.
 *
 * Every value here is a decimal string and every operation is exact integer arithmetic; nothing
 * passes through a JS number on the way (section 9.2).
 */
export interface ComputedLine {
  serviceId: string | null
  inventoryItemId: string | null
  description: string
  quantity: string
  unitPrice: string
  discount: string
  taxRatePercent: string
  /** unitPrice x quantity, before the discount. */
  gross: string
  /** gross - discount. */
  net: string
  tax: string
  /** net + tax. */
  lineTotal: string
}

export interface ComputedTotals {
  lines: ComputedLine[]
  subtotal: string
  discountTotal: string
  taxTotal: string
  total: string
}

/**
 * One line, rounded once at the end of its own chain.
 *
 * Tax is taken on the discounted amount, not the gross: a discount reduces what was actually
 * charged, and every tax authority taxes what was charged.
 */
export function computeLine(line: InvoiceLineInput, currency: string): ComputedLine {
  const gross = multiplyAmount(currency, line.unitPrice, line.quantity)
  const net = subtractAmounts(currency, gross, line.discount)
  const tax = percentOf(currency, net, line.taxRatePercent)
  return {
    serviceId: line.serviceId,
    inventoryItemId: null,
    description: line.description,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    discount: line.discount,
    taxRatePercent: line.taxRatePercent,
    gross,
    net,
    tax,
    lineTotal: addAmounts(currency, net, tax),
  }
}

export function computeTotals(lines: InvoiceLineInput[], currency: string): ComputedTotals {
  const computed = lines.map((line) => computeLine(line, currency))
  const subtotal = addAmounts(currency, ...computed.map((line) => line.gross))
  const discountTotal = addAmounts(currency, ...computed.map((line) => line.discount))
  const taxTotal = addAmounts(currency, ...computed.map((line) => line.tax))
  return {
    lines: computed,
    subtotal,
    discountTotal,
    taxTotal,
    // Identical, by construction, to the sum of the lineTotals — which is the property the
    // invoice rests on and the one the tests pin down.
    total: addAmounts(currency, subtractAmounts(currency, subtotal, discountTotal), taxTotal),
  }
}

/** A discount bigger than the line it sits on would invoice a negative amount. */
export function lineDiscountExceedsGross(line: InvoiceLineInput, currency: string): boolean {
  return isNegativeAmount(computeLine(line, currency).net)
}

export const emptyTotals = (currency: string): ComputedTotals => ({
  lines: [],
  subtotal: zeroAmount(currency),
  discountTotal: zeroAmount(currency),
  taxTotal: zeroAmount(currency),
  total: zeroAmount(currency),
})
