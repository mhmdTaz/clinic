import { describe, expect, it } from 'vitest'
import { AUDIT_CATEGORIES } from '@clinic/config'
import {
  captureAction,
  captureCategory,
  captureSeverity,
  modelSlug,
} from '../domain/capture-mapping'
import { RETENTION_YEARS, expiresAtFor } from '../domain/retention'

describe('retention', () => {
  it('defines a period for every category', () => {
    for (const category of AUDIT_CATEGORIES) expect(RETENTION_YEARS[category]).toBeGreaterThan(0)
  })

  it('keeps clinical and financial entries 7 years, authentication 2', () => {
    const at = new Date('2026-09-11T10:00:00Z')
    expect(expiresAtFor('CLINICAL', at).toISOString()).toBe('2033-09-11T10:00:00.000Z')
    expect(expiresAtFor('FINANCIAL', at).toISOString()).toBe('2033-09-11T10:00:00.000Z')
    expect(expiresAtFor('AUTH', at).toISOString()).toBe('2028-09-11T10:00:00.000Z')
  })

  it('counts calendar years, so leap days never shorten a period', () => {
    // 7 years of 365-day multiples would land two days early here.
    expect(expiresAtFor('CLINICAL', new Date('2028-03-01T00:00:00Z')).toISOString()).toBe(
      '2035-03-01T00:00:00.000Z',
    )
  })

  it('rolls 29 February forward to 1 March, erring on the side of keeping the entry', () => {
    expect(expiresAtFor('AUTH', new Date('2028-02-29T12:00:00Z')).toISOString()).toBe(
      '2030-03-01T12:00:00.000Z',
    )
  })
})

describe('capture mapping', () => {
  it('turns model names into action slugs', () => {
    expect(modelSlug('User')).toBe('user')
    expect(modelSlug('PasswordResetToken')).toBe('password_reset_token')
    expect(captureAction('Role', 'updated')).toBe('role.updated')
  })

  it('files role changes under ACCESS_CONTROL at NOTICE', () => {
    expect(captureCategory('Role')).toBe('ACCESS_CONTROL')
    expect(captureSeverity('Role', 'updated')).toBe('NOTICE')
  })

  it('files an unmapped model under a 7-year category, never a 2-year one', () => {
    expect(RETENTION_YEARS[captureCategory('SomeFutureClinicalModel')]).toBe(7)
  })

  it('raises deletions to NOTICE', () => {
    expect(captureSeverity('User', 'updated')).toBe('INFO')
    expect(captureSeverity('User', 'deleted')).toBe('NOTICE')
  })
})
