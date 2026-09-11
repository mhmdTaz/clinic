import { describe, expect, it } from 'vitest'
import { currencyDigits, normalizeAmount } from '../domain/money'

describe('currencyDigits', () => {
  it('knows the minor units of the currencies a clinic here bills in', () => {
    expect(currencyDigits('USD')).toBe(2)
    expect(currencyDigits('LBP')).toBe(0)
    expect(currencyDigits('KWD')).toBe(3)
  })
})

describe('normalizeAmount', () => {
  it('writes an amount to exactly the currency’s digits', () => {
    expect(normalizeAmount('45', 'USD')).toBe('45.00')
    expect(normalizeAmount('45.5', 'USD')).toBe('45.50')
    expect(normalizeAmount('007.10', 'USD')).toBe('7.10')
    expect(normalizeAmount('150000', 'LBP')).toBe('150000')
    expect(normalizeAmount('1.250', 'KWD')).toBe('1.250')
  })

  it('accepts trailing zeros but refuses digits the currency does not have', () => {
    expect(normalizeAmount('45.500', 'USD')).toBe('45.50')
    expect(normalizeAmount('45.005', 'USD')).toBeNull()
    expect(normalizeAmount('150000.50', 'LBP')).toBeNull()
  })

  it('refuses anything that is not a plain decimal', () => {
    expect(normalizeAmount('-5', 'USD')).toBeNull()
    expect(normalizeAmount('1e3', 'USD')).toBeNull()
  })
})
