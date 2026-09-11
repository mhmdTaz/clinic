import { describe, expect, it } from 'vitest'
import { isValidId, newId } from '../id'

describe('ids', () => {
  it('generates valid, unique cuid2 ids', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newId()))
    expect(ids.size).toBe(500)
    for (const id of ids) expect(isValidId(id)).toBe(true)
  })

  it('is not sequential, so record volume cannot be inferred from an id', () => {
    const a = newId()
    const b = newId()
    expect(a).not.toBe(b)
    // A 24-hex ObjectId would share a long timestamp prefix; cuid2 must not.
    expect(a.slice(0, 8)).not.toBe(b.slice(0, 8))
  })

  it('rejects malformed values', () => {
    expect(isValidId('507f1f77bcf86cd799439011')).toBe(false) // ObjectId hex, leading digit
    expect(isValidId('too-short')).toBe(false) // wrong length and a hyphen
    expect(isValidId('ABCDEFGHIJKLMNOPQRSTUVWX')).toBe(false) // uppercase
    expect(isValidId('')).toBe(false)
    expect(isValidId(42)).toBe(false)
    expect(isValidId(null)).toBe(false)
  })

  it('cannot distinguish a hex string that happens to start with a letter', () => {
    // Documented limitation rather than a false promise: 24 hex chars beginning a-f
    // are a valid cuid2 shape. Nothing security-relevant depends on this check.
    expect(isValidId('a07f1f77bcf86cd799439011')).toBe(true)
  })
})
