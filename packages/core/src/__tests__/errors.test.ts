import { describe, expect, it } from 'vitest'
import { ConflictError, ForbiddenError, NotFoundError, isDomainError } from '../errors'

describe('domain errors', () => {
  it('carries a stable code and an HTTP status', () => {
    expect(new NotFoundError('Clinic c1').code).toBe('NOT_FOUND')
    expect(new NotFoundError('Clinic c1').status).toBe(404)
    expect(new ForbiddenError('patient:read').status).toBe(403)
  })

  it('lets a conflict declare its own domain-specific code', () => {
    const e = new ConflictError('APPOINTMENT_SLOT_TAKEN', 'That slot was just booked.')
    expect(e.code).toBe('APPOINTMENT_SLOT_TAKEN')
    expect(e.status).toBe(409)
  })

  it('is recognisable at the interface boundary', () => {
    expect(isDomainError(new NotFoundError('x'))).toBe(true)
    expect(isDomainError(new Error('plain'))).toBe(false)
  })

  it('names the missing permission without leaking the resource', () => {
    expect(new ForbiddenError('encounter:read').message).toBe('Missing permission: encounter:read')
  })
})
