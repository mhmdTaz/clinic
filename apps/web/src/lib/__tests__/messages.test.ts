import { describe, expect, it } from 'vitest'
import {
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
import { countryOptions } from '@/lib/format/regions'
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

describe('country options', () => {
  it('lists real countries by name, and none of the pseudo-regions', () => {
    const options = countryOptions('en')
    expect(options.find((option) => option.value === 'LB')?.label).toBe('Lebanon')
    expect(options.some((option) => ['EU', 'UN', 'ZZ'].includes(option.value))).toBe(false)
  })
})
