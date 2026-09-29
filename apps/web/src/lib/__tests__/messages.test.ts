import { describe, expect, it } from 'vitest'
import {
  NOTIFICATION_TYPES,
  APPOINTMENT_SOURCES,
  APPOINTMENT_STATUSES,
  BLOOD_TYPES,
  GENDERS,
  PERMISSION_SCOPES,
  USER_STATUSES,
} from '@clinic/config'
import { DUPLICATE_REASONS } from '@clinic/contracts'
import {
  NAVIGATION,
  PERMISSION_GROUPS,
  PERMISSION_KEYS,
  permissionLabelKey,
} from '@clinic/core/access'
import {
  buildBody,
  fieldForPath,
  getPath,
  initialValueOf,
  setPath,
} from '@/components/forms/auto-form-values'
import { ageOn, formatCalendarDate } from '@/lib/format/dates'
import { countryName, countryOptions } from '@/lib/format/regions'
import { isLocked } from '@clinic/core/notifications'
import messages from '../../../messages/en.json'

const text = (path: string) => getPath(messages, path)

/**
 * Section 13.6: a missing key fails the build, not a screen. The permission matrix renders every
 * catalogue entry, so a permission added to the catalogue without a label is caught here.
 */
describe('the English catalogue', () => {
  it('labels every permission and every permission group', () => {
    const missing = [
      ...PERMISSION_KEYS.map(permissionLabelKey),
      ...PERMISSION_GROUPS.map((group) => `permissionGroups.${group}`),
    ].filter((key) => typeof text(key) !== 'string')
    expect(missing).toEqual([])
  })

  it('names every status, scope, gender and duplicate reason a screen can show', () => {
    const missing = [
      ...USER_STATUSES.map((status) => `status.${status}`),
      ...PERMISSION_SCOPES.map((scope) => `scopes.${scope}`),
      ...GENDERS.map((gender) => `genders.${gender}`),
      ...DUPLICATE_REASONS.map((reason) => `duplicateReasons.${reason}`),
      ...APPOINTMENT_STATUSES.map((status) => `scheduling.statuses.${status}`),
      ...APPOINTMENT_SOURCES.map((source) => `scheduling.sources.${source}`),
      'bloodTypes.UNKNOWN',
    ].filter((key) => typeof text(key) !== 'string')
    expect(missing).toEqual([])
    expect(BLOOD_TYPES).toContain('UNKNOWN')
  })

  it('labels every navigation section and item in every portal', () => {
    const keys = Object.values(NAVIGATION).flatMap((sections) =>
      sections.flatMap((section) => [
        section.labelKey,
        ...section.items.map((item) => item.labelKey),
      ]),
    )
    expect(keys.filter((key) => typeof text(key) !== 'string')).toEqual([])
  })
})

describe('form values', () => {
  it('builds a nested body from dotted field names', () => {
    expect(
      buildBody([{ name: 'firstName' }, { name: 'contact.phone' }, { name: 'contact.email' }], {
        firstName: 'Sara',
        'contact.phone': '03 123 456',
        'contact.email': '',
      }),
    ).toEqual({ firstName: 'Sara', contact: { phone: '03 123 456', email: '' } })
  })

  it('starts text controls empty rather than undefined, and lists as arrays', () => {
    expect(initialValueOf('text', { contact: { phone: null } }, 'contact.phone')).toBe('')
    expect(initialValueOf('number', { years: 12 }, 'years')).toBe('12')
    expect(initialValueOf('checkboxes', {}, 'roleIds')).toEqual([])
  })

  it('places an error on the field that owns its path, through an alias when the names differ', () => {
    const fields = ['roleIds', 'contact.email', 'emergencyContacts']
    expect(fieldForPath('roleIds.2', fields)).toBe('roleIds')
    expect(fieldForPath('emergencyContacts.0.phone', fields)).toBe('emergencyContacts')
    expect(fieldForPath('email', fields, { email: 'contact.email' })).toBe('contact.email')
    expect(fieldForPath('(body)', fields)).toBeNull()
  })

  it('does not share nested objects between writes', () => {
    const body: Record<string, unknown> = {}
    setPath(body, 'a.b', 1)
    setPath(body, 'a.c', 2)
    expect(body).toEqual({ a: { b: 1, c: 2 } })
  })
})

describe('calendar dates', () => {
  it('formats a birthday as that day, in any timezone', () => {
    expect(formatCalendarDate('1991-03-14', 'en-US')).toBe('Mar 14, 1991')
  })

  it('counts a birthday only once it has arrived', () => {
    expect(ageOn('1991-03-14', '2026-03-13')).toBe(34)
    expect(ageOn('1991-03-14', '2026-03-14')).toBe(35)
    expect(ageOn('2000-02-29', '2026-02-28')).toBe(25)
  })
})

describe('notices that cannot be switched off', () => {
  // Audit F09: the audit-integrity alert borrowed the cancellation's "closed door".
  it('say why, each in its own words', () => {
    const locked = NOTIFICATION_TYPES.filter(isLocked)
    expect(locked.length).toBeGreaterThan(0)
    const reasons = locked.map((type) => text(`notifications.preferences.alwaysOnBecause.${type}`))
    expect(reasons.every((reason) => typeof reason === 'string')).toBe(true)
    expect(new Set(reasons).size).toBe(reasons.length)
    expect(text('notifications.preferences.alwaysOn')).not.toMatch(/door|appointment/i)
  })
})

describe('country options', () => {
  it('lists real countries by name, and none of the pseudo-regions', () => {
    const options = countryOptions('en')
    expect(options.find((option) => option.value === 'LB')?.label).toBe('Lebanon')
    expect(options.some((option) => ['EU', 'UN', 'ZZ'].includes(option.value))).toBe(false)
  })

  // Audit F04: Germany was offered as DD and DE, Serbia as CS, RS and YU.
  it('offers each country once, under its current code only', () => {
    const options = countryOptions('en')
    const labels = options.map((option) => option.label)
    expect(new Set(labels).size).toBe(labels.length)
    expect(new Set(options.map((option) => option.value)).size).toBe(options.length)
    for (const old of ['DD', 'UK', 'CS', 'YU', 'SU', 'ZR', 'AN']) {
      expect(options.some((option) => option.value === old)).toBe(false)
    }
    expect(options.filter((option) => option.label === 'Germany').map((o) => o.value)).toEqual([
      'DE',
    ])
  })

  it('keeps a retired stored country visible and labelled, rather than silently replacing it', () => {
    const options = countryOptions('en', 'YU', (code) => `${code} (former)`)
    expect(options[0]).toEqual({ value: 'YU', label: 'YU (former)' })
    expect(options.filter((option) => option.value === 'YU')).toHaveLength(1)
    // A current or renamed stored code needs nothing extra: it is already a choice.
    expect(countryOptions('en', 'LB')).toBe(countryOptions('en'))
    expect(countryOptions('en', 'UK')).toBe(countryOptions('en'))
  })

  it('names a stored country without turning a retired code into a current country', () => {
    expect(countryName('LB', 'en')).toBe('Lebanon')
    expect(countryName('UK', 'en')).toBe('United Kingdom')
    expect(countryName('YU', 'en')).toBe('YU')
    expect(countryName('SU', 'en')).toBe('SU')
    expect(countryName('AN', 'en')).toBe('AN')
    expect(countryName(null, 'en')).toBeNull()
  })
})
