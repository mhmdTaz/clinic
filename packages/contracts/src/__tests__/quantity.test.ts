import { describe, expect, it } from 'vitest'
import {
  addQuantities,
  compareQuantities,
  displayQuantity,
  isNegativeQuantity,
  isZeroQuantity,
  multiplyQuantity,
  negateQuantity,
  normalizeQuantity,
  subtractQuantities,
  zeroQuantity,
} from '../quantity'
import { addAmounts, multiplyAmount } from '../money'

describe('counting stock', () => {
  it('writes every quantity the same way, to three places', () => {
    expect(zeroQuantity()).toBe('0.000')
    expect(addQuantities('2')).toBe('2.000')
    expect(normalizeQuantity('2')).toBe('2.000')
    expect(normalizeQuantity('0.5')).toBe('0.500')
  })

  it('refuses more precision than a clinic counts by', () => {
    expect(normalizeQuantity('1.2345')).toBeNull()
    // Trailing zeros are not extra precision: "1.5000" is still a half.
    expect(normalizeQuantity('1.5000')).toBe('1.500')
    expect(normalizeQuantity('lots')).toBeNull()
    expect(normalizeQuantity('-1')).toBeNull()
  })

  /** The reason none of this goes through a float: a stock level is a running total. */
  it('does not drift the way repeated float arithmetic would', () => {
    expect(0.1 + 0.2).not.toBe(0.3)
    expect(addQuantities('0.1', '0.2')).toBe('0.300')

    // A hundred half-vials is fifty vials, exactly.
    let total = zeroQuantity()
    for (let index = 0; index < 100; index += 1) total = addQuantities(total, '0.5')
    expect(total).toBe('50.000')

    // And taking them back out lands exactly on zero, not on 7.105427357601002e-15.
    for (let index = 0; index < 100; index += 1) total = subtractQuantities(total, '0.5')
    expect(total).toBe('0.000')
    expect(isZeroQuantity(total)).toBe(true)
  })

  it('adds, subtracts, multiplies and compares', () => {
    expect(addQuantities('1.5', '2.25')).toBe('3.750')
    expect(subtractQuantities('10', '2.5')).toBe('7.500')
    expect(multiplyQuantity('3', '12')).toBe('36.000')
    expect(multiplyQuantity('0.5', '3')).toBe('1.500')
    expect(compareQuantities('2', '2.000')).toBe(0)
    expect(compareQuantities('1.999', '2')).toBe(-1)
    expect(compareQuantities('2.001', '2')).toBe(1)
  })

  it('turns a quantity into its outward movement', () => {
    expect(negateQuantity('2.5')).toBe('-2.500')
    expect(isNegativeQuantity(negateQuantity('2.5'))).toBe(true)
    expect(negateQuantity('0')).toBe('0.000')
    expect(isNegativeQuantity('0.000')).toBe(false)
  })

  it('shows a person what they would have written', () => {
    expect(displayQuantity('2.000')).toBe('2')
    expect(displayQuantity('2.500')).toBe('2.5')
    expect(displayQuantity('0.250')).toBe('0.25')
    expect(displayQuantity('0.000')).toBe('0')
    expect(displayQuantity('12')).toBe('12')
  })

  it('refuses to count something that is not a number', () => {
    expect(() => addQuantities('two')).toThrow()
    expect(() => multiplyQuantity('1', '')).toThrow()
  })
})

describe('stock and money share one engine', () => {
  /**
   * Both vocabularies sit on the same scaled-bigint primitives, so a quantity multiplied into a
   * price is exact end to end — which is what a consumption line on an invoice is.
   */
  it('prices a fractional quantity exactly', () => {
    const used = normalizeQuantity('1.5')
    expect(used).toBe('1.500')
    expect(multiplyAmount('USD', '19.99', used ?? '0')).toBe('29.99')

    // Three lots of a third of a bottle is one bottle, and priced as one bottle.
    const third = normalizeQuantity('0.333') ?? '0'
    expect(addQuantities(third, third, third)).toBe('0.999')
    expect(addAmounts('USD', '33.33', '33.33', '33.33')).toBe('99.99')
  })
})
