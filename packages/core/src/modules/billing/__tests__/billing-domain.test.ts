import { describe, expect, it } from 'vitest'
import { addAmounts } from '@clinic/contracts'
import type { InvoiceLineInput } from '@clinic/contracts'
import { computeLine, computeTotals, lineDiscountExceedsGross } from '../domain/totals'
import {
  canIssue,
  canVoid,
  isEditable,
  isOverdue,
  isPayable,
  paymentStatusAfterRefund,
  statusAfterBalance,
} from '../domain/invoice'
import { allocationsBalance, unwindAllocations, type Allocation } from '../domain/allocation'

const line = (overrides: Partial<InvoiceLineInput> = {}): InvoiceLineInput => ({
  serviceId: null,
  description: 'Consultation',
  quantity: '1',
  unitPrice: '100.00',
  discount: '0',
  taxRatePercent: '0',
  ...overrides,
})

describe('a line', () => {
  it('multiplies, discounts, then taxes — in that order', () => {
    const computed = computeLine(
      line({ quantity: '2', unitPrice: '50.00', discount: '10.00', taxRatePercent: '11' }),
      'USD',
    )
    expect(computed.gross).toBe('100.00')
    expect(computed.net).toBe('90.00')
    // Tax is on the discounted amount: 11% of 90, not of 100.
    expect(computed.tax).toBe('9.90')
    expect(computed.lineTotal).toBe('99.90')
  })

  it('handles a fractional quantity without drifting', () => {
    const computed = computeLine(line({ quantity: '1.5', unitPrice: '19.99' }), 'USD')
    expect(computed.gross).toBe('29.99') // 29.985, rounded away from zero
    expect(computed.lineTotal).toBe('29.99')
  })

  it('writes zero tax as the currency writes zero', () => {
    expect(computeLine(line(), 'USD').tax).toBe('0.00')
    expect(computeLine(line({ unitPrice: '100' }), 'LBP').tax).toBe('0')
  })

  it('spots a discount larger than the line it is on', () => {
    expect(lineDiscountExceedsGross(line({ discount: '100.00' }), 'USD')).toBe(false)
    expect(lineDiscountExceedsGross(line({ discount: '100.01' }), 'USD')).toBe(true)
  })
})

describe('an invoice', () => {
  /**
   * The property ADR-0027 exists for. Rounding once per line and summing the rounded lines is
   * what makes the figures beside the lines add up to the figure at the bottom — the single
   * most common billing bug, and the one a patient always spots.
   */
  it('sums its rounded lines to exactly its printed total', () => {
    const totals = computeTotals(
      [
        line({ unitPrice: '33.33', quantity: '3', taxRatePercent: '8.25' }),
        line({ unitPrice: '19.99', quantity: '1.5', discount: '2.50', taxRatePercent: '11' }),
        line({ unitPrice: '0.07', quantity: '17' }),
        line({ unitPrice: '250.00', discount: '37.50', taxRatePercent: '5.5' }),
      ],
      'USD',
    )

    expect(totals.total).toBe(addAmounts('USD', ...totals.lines.map((row) => row.lineTotal)))

    // Worked through by hand, so the property above cannot pass by agreeing with itself:
    //   99.99 + 8.25 tax               = 108.24
    //   29.99 - 2.50 + 3.02 tax        =  30.51   (29.985 rounds up, half away from zero)
    //    1.19                          =   1.19
    //  250.00 - 37.50 + 11.69 tax      = 224.19
    expect(totals.lines.map((row) => row.lineTotal)).toEqual(['108.24', '30.51', '1.19', '224.19'])
    expect(totals.subtotal).toBe('381.17')
    expect(totals.discountTotal).toBe('40.00')
    expect(totals.taxTotal).toBe('22.96')
    expect(totals.total).toBe('364.13')
  })

  it('totals an empty invoice as zero, in the currency’s own shape', () => {
    expect(computeTotals([], 'USD').total).toBe('0.00')
    expect(computeTotals([], 'KWD').total).toBe('0.000')
  })

  it('is editable only while it is a draft', () => {
    expect(isEditable('DRAFT')).toBe(true)
    expect(canIssue('DRAFT')).toBe(true)
    for (const status of ['ISSUED', 'PARTIALLY_PAID', 'PAID', 'VOID'] as const) {
      expect(isEditable(status)).toBe(false)
      expect(canIssue(status)).toBe(false)
    }
  })

  it('can be voided before money has moved, and not after', () => {
    expect(canVoid('DRAFT')).toBe(true)
    expect(canVoid('ISSUED')).toBe(true)
    // Refund first: an invoice with money on it cannot simply disappear.
    expect(canVoid('PARTIALLY_PAID')).toBe(false)
    expect(canVoid('PAID')).toBe(false)
  })

  it('takes a payment only when it is issued and still owes something', () => {
    expect(isPayable('ISSUED')).toBe(true)
    expect(isPayable('PARTIALLY_PAID')).toBe(true)
    expect(isPayable('DRAFT')).toBe(false)
    expect(isPayable('PAID')).toBe(false)
    expect(isPayable('VOID')).toBe(false)
  })

  it('lands in the status its balance implies', () => {
    expect(statusAfterBalance('0.00', '100.00')).toBe('PAID')
    expect(statusAfterBalance('40.00', '60.00')).toBe('PARTIALLY_PAID')
    // A refund that took everything back leaves it issued and unpaid, not partially paid.
    expect(statusAfterBalance('100.00', '0.00')).toBe('ISSUED')
  })

  describe('being overdue', () => {
    it('is a question about today, never a stored state', () => {
      expect(isOverdue('ISSUED', '2026-09-10', '2026-09-12')).toBe(true)
      expect(isOverdue('ISSUED', '2026-09-12', '2026-09-12')).toBe(false)
      expect(isOverdue('PARTIALLY_PAID', '2026-09-10', '2026-09-12')).toBe(true)
    })

    it('does not apply to a bill nobody has been asked to pay, or has already paid', () => {
      expect(isOverdue('DRAFT', '2026-01-01', '2026-09-12')).toBe(false)
      expect(isOverdue('PAID', '2026-01-01', '2026-09-12')).toBe(false)
      expect(isOverdue('VOID', '2026-01-01', '2026-09-12')).toBe(false)
      expect(isOverdue('ISSUED', null, '2026-09-12')).toBe(false)
    })
  })
})

describe('a payment’s allocations', () => {
  const allocations: Allocation[] = [
    { invoiceId: 'i1', invoiceNumber: 'INV-2026-000001', amount: '30.00' },
    { invoiceId: 'i2', invoiceNumber: 'INV-2026-000002', amount: '70.00' },
  ]

  it('must account for the whole payment', () => {
    expect(allocationsBalance('100.00', allocations, 'USD')).toBe(true)
    expect(allocationsBalance('100.01', allocations, 'USD')).toBe(false)
    expect(allocationsBalance('100', allocations, 'USD')).toBe(true)
  })

  /**
   * A refund unwinds from the end: the last invoice the money settled gives it back first.
   * Deterministic, explainable at the desk, and free of the fractions of cents a proportional
   * split would produce.
   */
  it('unwinds from the last invoice settled', () => {
    expect(unwindAllocations(allocations, '0.00', '20.00', 'USD')).toEqual([
      { invoiceId: 'i2', invoiceNumber: 'INV-2026-000002', amount: '20.00' },
    ])
  })

  it('spills into the earlier invoice once the last one is exhausted', () => {
    expect(unwindAllocations(allocations, '0.00', '85.00', 'USD')).toEqual([
      { invoiceId: 'i1', invoiceNumber: 'INV-2026-000001', amount: '15.00' },
      { invoiceId: 'i2', invoiceNumber: 'INV-2026-000002', amount: '70.00' },
    ])
  })

  it('picks up where an earlier refund left off', () => {
    // 70 already came back off i2; the next 20 must come off i1, not off i2 a second time.
    expect(unwindAllocations(allocations, '70.00', '20.00', 'USD')).toEqual([
      { invoiceId: 'i1', invoiceNumber: 'INV-2026-000001', amount: '20.00' },
    ])
  })

  it('returns the whole payment across both invoices', () => {
    expect(unwindAllocations(allocations, '0.00', '100.00', 'USD')).toEqual([
      { invoiceId: 'i1', invoiceNumber: 'INV-2026-000001', amount: '30.00' },
      { invoiceId: 'i2', invoiceNumber: 'INV-2026-000002', amount: '70.00' },
    ])
  })

  it('never gives back more than an allocation holds, however much is asked for', () => {
    const unwound = unwindAllocations(allocations, '0.00', '500.00', 'USD')
    expect(addAmounts('USD', ...unwound.map((row) => row.amount))).toBe('100.00')
  })

  it('reads the payment’s own status off what has come back', () => {
    expect(paymentStatusAfterRefund('100.00', '0.00')).toBe('COMPLETED')
    expect(paymentStatusAfterRefund('100.00', '40.00')).toBe('PARTIALLY_REFUNDED')
    expect(paymentStatusAfterRefund('100.00', '100.00')).toBe('REFUNDED')
  })
})
