import { describe, expect, it } from 'vitest'
import { filterHasTenant } from '../plugins/tenant-guard'

describe('filterHasTenant', () => {
  it('accepts a direct clinicId', () => {
    expect(filterHasTenant({ clinicId: 'c1' })).toBe(true)
    expect(filterHasTenant({ _id: 'x', clinicId: 'c1' })).toBe(true)
  })

  it('rejects a filter with no tenant constraint', () => {
    expect(filterHasTenant({})).toBe(false)
    expect(filterHasTenant({ _id: 'x' })).toBe(false)
    expect(filterHasTenant({ email: 'a@b.c', status: 'ACTIVE' })).toBe(false)
    expect(filterHasTenant(undefined)).toBe(false)
    expect(filterHasTenant(null)).toBe(false)
  })

  it('accepts $and when any branch narrows to a clinic', () => {
    expect(filterHasTenant({ $and: [{ status: 'ACTIVE' }, { clinicId: 'c1' }] })).toBe(true)
  })

  it('rejects $and when no branch narrows to a clinic', () => {
    expect(filterHasTenant({ $and: [{ status: 'ACTIVE' }, { email: 'a@b.c' }] })).toBe(false)
  })

  it('requires EVERY $or branch to be scoped', () => {
    // One unscoped branch is enough to escape the tenant — this is the important case.
    expect(filterHasTenant({ $or: [{ clinicId: 'c1' }, { email: 'a@b.c' }] })).toBe(false)
    expect(filterHasTenant({ $or: [{ clinicId: 'c1' }, { clinicId: 'c2' }] })).toBe(true)
  })

  it('treats an empty $or as unscoped rather than vacuously true', () => {
    expect(filterHasTenant({ $or: [] })).toBe(false)
  })

  it('handles nesting', () => {
    expect(filterHasTenant({ $and: [{ $or: [{ clinicId: 'c1' }, { clinicId: 'c2' }] }] })).toBe(
      true,
    )
    expect(filterHasTenant({ $and: [{ $or: [{ clinicId: 'c1' }, { x: 1 }] }] })).toBe(false)
  })
})
