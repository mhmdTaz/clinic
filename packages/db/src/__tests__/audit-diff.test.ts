import { describe, expect, it } from 'vitest'
import { REDACTED, diffDocuments, flatten, unflatten } from '../plugins/audit-diff'

const user = {
  _id: 'u1',
  __v: 0,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  firstName: 'Maya',
  passwordHash: '$argon2id$v=19$very-secret-hash',
  roles: [{ roleId: 'r1' }],
  security: { failedLoginCount: 0, tokenVersion: 0 },
}

describe('diffDocuments', () => {
  it('records a creation with every meaningful field in `after`', () => {
    const diff = diffDocuments(null, user)
    expect(diff.before).toBeNull()
    expect(diff.after).toMatchObject({ firstName: 'Maya', security: { tokenVersion: 0 } })
    expect(diff.changedPaths).toContain('firstName')
  })

  it('always ignores _id, __v and the timestamps', () => {
    const diff = diffDocuments(null, user)
    for (const noise of ['_id', '__v', 'createdAt', 'updatedAt']) {
      expect(diff.changedPaths).not.toContain(noise)
    }
  })

  it('records a deletion with every meaningful field in `before`', () => {
    const diff = diffDocuments(user, null)
    expect(diff.after).toBeNull()
    expect(diff.before).toMatchObject({ firstName: 'Maya' })
  })

  it('records only the fields an update changed, nested back into objects', () => {
    const diff = diffDocuments(user, {
      ...user,
      firstName: 'Leila',
      security: { ...user.security, tokenVersion: 1 },
    })
    expect(diff.changedPaths).toEqual(['firstName', 'security.tokenVersion'])
    expect(diff.before).toEqual({ firstName: 'Maya', security: { tokenVersion: 0 } })
    expect(diff.after).toEqual({ firstName: 'Leila', security: { tokenVersion: 1 } })
  })

  it('finds nothing to record for an identical document', () => {
    expect(diffDocuments(user, structuredClone(user)).changedPaths).toEqual([])
  })

  it('compares dates by value, not by object identity', () => {
    const copy = { ...user, updatedAt: new Date(user.updatedAt.getTime()), joined: new Date(5) }
    expect(diffDocuments({ ...user, joined: new Date(5) }, copy).changedPaths).toEqual([])
  })

  it('treats arrays as a whole', () => {
    const diff = diffDocuments(user, { ...user, roles: [{ roleId: 'r1' }, { roleId: 'r2' }] })
    expect(diff.changedPaths).toEqual(['roles'])
  })

  it('skips ignored bookkeeping paths, by exact path or by prefix', () => {
    const bumped = { ...user, security: { failedLoginCount: 3, tokenVersion: 0 } }
    expect(
      diffDocuments(user, bumped, { ignored: ['security.failedLoginCount'] }).changedPaths,
    ).toEqual([])
    expect(diffDocuments(user, bumped, { ignored: ['security'] }).changedPaths).toEqual([])
  })

  it('does not let an ignored prefix swallow a different field that merely starts with the same letters', () => {
    const diff = diffDocuments(
      { ...user, securityQuestion: 'a' },
      { ...user, securityQuestion: 'b' },
      { ignored: ['security'] },
    )
    expect(diff.changedPaths).toEqual(['securityQuestion'])
  })

  it('records that a sensitive field changed without ever holding its value', () => {
    const diff = diffDocuments(
      user,
      { ...user, passwordHash: '$argon2id$v=19$another-secret-hash' },
      { sensitive: ['passwordHash'] },
    )
    expect(diff.changedPaths).toEqual(['passwordHash'])
    expect(diff.before).toEqual({ passwordHash: REDACTED })
    expect(diff.after).toEqual({ passwordHash: REDACTED })
    expect(JSON.stringify(diff)).not.toContain('secret-hash')
  })

  it('redacts sensitive values on creation too', () => {
    const diff = diffDocuments(null, user, { sensitive: ['passwordHash'] })
    expect(JSON.stringify(diff)).not.toContain('very-secret-hash')
  })

  it('records a removed field as present before and absent after', () => {
    const { firstName: _removed, ...withoutName } = user
    const diff = diffDocuments(user, withoutName)
    expect(diff.changedPaths).toEqual(['firstName'])
    expect(diff.before).toEqual({ firstName: 'Maya' })
    expect(diff.after).toEqual({})
  })
})

describe('flatten and unflatten', () => {
  it('round-trips nested objects', () => {
    const nested = { a: { b: { c: 1 } }, d: [1, 2], e: 'x' }
    expect(unflatten(flatten(nested))).toEqual(nested)
  })

  it('keeps an empty object as a leaf', () => {
    expect(flatten({ settings: {} })).toEqual({ settings: {} })
  })
})
