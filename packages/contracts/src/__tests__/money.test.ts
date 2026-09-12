import { describe, expect, it } from 'vitest'
import {
  addAmounts,
  compareAmounts,
  currencyDigits,
  isNegativeAmount,
  isPayableAmount,
  isZeroAmount,
  multiplyAmount,
  normalizeAmount,
  percentOf,
  subtractAmounts,
  zeroAmount,
} from '../money'

describe('currency precision', () => {
  it('knows how many minor digits a currency has', () => {
    expect(currencyDigits('USD')).toBe(2)
    expect(currencyDigits('KWD')).toBe(3)
    expect(currencyDigits('LBP')).toBe(0)
  })

  it('writes zero the way the currency writes it', () => {
    expect(zeroAmount('USD')).toBe('0.00')
    expect(zeroAmount('KWD')).toBe('0.000')
    expect(zeroAmount('LBP')).toBe('0')
  })

  it('refuses an amount with more decimals than the currency has', () => {
    expect(normalizeAmount('45', 'USD')).toBe('45.00')
    expect(normalizeAmount('45.5', 'USD')).toBe('45.50')
    expect(normalizeAmount('45.005', 'USD')).toBeNull()
    // Trailing zeros are not extra precision: "45.500" is still fifty cents.
    expect(normalizeAmount('45.500', 'USD')).toBe('45.50')
    expect(normalizeAmount('45.005', 'KWD')).toBe('45.005')
    expect(normalizeAmount('45.5', 'LBP')).toBeNull()
  })
})

describe('exact arithmetic', () => {
  /** The reason none of this is done with numbers. */
  it('adds the amounts a float would get wrong', () => {
    expect(0.1 + 0.2).not.toBe(0.3)
    expect(addAmounts('USD', '0.10', '0.20')).toBe('0.30')
    expect(addAmounts('USD', '0.01', '0.02', '0.03', '0.04')).toBe('0.10')
  })

  it('adds, subtracts and compares', () => {
    expect(addAmounts('USD', '19.99', '0.01')).toBe('20.00')
    expect(subtractAmounts('USD', '20.00', '19.99')).toBe('0.01')
    expect(addAmounts('USD')).toBe('0.00')
    expect(compareAmounts('10.00', '10')).toBe(0)
    expect(compareAmounts('9.99', '10.00')).toBe(-1)
    expect(compareAmounts('10.01', '10.00')).toBe(1)
  })

  it('multiplies by a fractional quantity without drifting', () => {
    expect(multiplyAmount('USD', '40.00', '3')).toBe('120.00')
    expect(multiplyAmount('USD', '33.33', '3')).toBe('99.99')
    expect(multiplyAmount('USD', '40.00', '1.5')).toBe('60.00')
    expect(multiplyAmount('USD', '0.07', '3')).toBe('0.21')
  })

  it('takes a percentage the way a tax line does', () => {
    expect(percentOf('USD', '100.00', '8.25')).toBe('8.25')
    expect(percentOf('USD', '45.00', '11')).toBe('4.95')
    expect(percentOf('USD', '0.00', '11')).toBe('0.00')
    expect(percentOf('LBP', '1000000', '11')).toBe('110000')
  })

  it('rounds half away from zero, so a half-cent goes up rather than to the nearest even', () => {
    // 10.005 at 2 places: banker's rounding would give 10.00, which reads as a missing cent.
    expect(percentOf('USD', '100.05', '10')).toBe('10.01')
    expect(multiplyAmount('USD', '0.015', '1')).toBe('0.02')
  })

  it('keeps a negative amount negative — a refund is not an absence of money', () => {
    expect(subtractAmounts('USD', '10.00', '15.00')).toBe('-5.00')
    expect(isNegativeAmount('-5.00')).toBe(true)
    expect(isNegativeAmount('0.00')).toBe(false)
    expect(isZeroAmount('0')).toBe(true)
    expect(isZeroAmount('0.00')).toBe(true)
  })

  it('refuses to do arithmetic on something that is not a number', () => {
    expect(() => addAmounts('USD', 'ten')).toThrow()
    expect(() => addAmounts('USD', '')).toThrow()
    expect(() => multiplyAmount('USD', '10.00', 'lots')).toThrow()
  })
})

describe('what may be charged or paid', () => {
  it('accepts a well-formed amount and refuses the rest', () => {
    expect(isPayableAmount('45.00', 'USD')).toBe(true)
    expect(isPayableAmount('0', 'USD')).toBe(true)
    expect(isPayableAmount('45.005', 'USD')).toBe(false)
    expect(isPayableAmount('-5.00', 'USD')).toBe(false)
    expect(isPayableAmount('abc', 'USD')).toBe(false)
  })
})

describe('a whole invoice adds up', () => {
  /**
   * The property the invoice totals rest on. Each line is rounded once, and the invoice is the
   * sum of rounded lines — so what is printed beside each line adds to what is printed at the
   * bottom, for every combination of odd prices, fractional quantities and awkward tax rates.
   */
  it('sums rounded lines to the same total, whatever the rates', () => {
    const lines = [
      { unitPrice: '33.33', quantity: '3', discount: '0.00', tax: '8.25' },
      { unitPrice: '19.99', quantity: '1.5', discount: '2.50', tax: '11' },
      { unitPrice: '0.07', quantity: '17', discount: '0.00', tax: '0' },
      { unitPrice: '250.00', quantity: '1', discount: '37.50', tax: '5.5' },
    ]

    const computed = lines.map((line) => {
      const gross = multiplyAmount('USD', line.unitPrice, line.quantity)
      const net = subtractAmounts('USD', gross, line.discount)
      const tax = percentOf('USD', net, line.tax)
      return { gross, discount: line.discount, net, tax, total: addAmounts('USD', net, tax) }
    })

    const subtotal = addAmounts('USD', ...computed.map((line) => line.gross))
    const discountTotal = addAmounts('USD', ...computed.map((line) => line.discount))
    const taxTotal = addAmounts('USD', ...computed.map((line) => line.tax))
    const total = addAmounts('USD', subtractAmounts('USD', subtotal, discountTotal), taxTotal)

    expect(total).toBe(addAmounts('USD', ...computed.map((line) => line.total)))
  })
})
