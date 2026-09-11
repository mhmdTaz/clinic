import { describe, expect, it } from 'vitest'
import {
  ClinicProfileInput,
  LocalDate,
  PatientInput,
  SetHolidaysRequest,
  SetWorkingHoursRequest,
  SlotMinutes,
  issueCode,
  localDateIn,
  overlappingHours,
} from '../index'

const codesOf = (result: {
  success: boolean
  error?: { issues: Parameters<typeof issueCode>[0][] }
}) => (result.success ? [] : (result.error?.issues ?? []).map((issue) => issueCode(issue)))

describe('issueCode', () => {
  it('passes a rule’s own code through', () => {
    expect(codesOf(LocalDate.safeParse('2026-02-30'))).toEqual(['INVALID_DATE'])
  })

  it('turns zod’s English into codes a form can translate', () => {
    const result = PatientInput.safeParse({
      firstName: '',
      lastName: 'x'.repeat(81),
      contact: { phone: null, email: 'not-an-email' },
      address: {},
    })
    expect(codesOf(result)).toEqual(
      expect.arrayContaining(['REQUIRED', 'TOO_LONG', 'INVALID_EMAIL']),
    )
  })
})

describe('calendar dates', () => {
  it('accepts real dates only', () => {
    expect(LocalDate.safeParse('2024-02-29').success).toBe(true)
    expect(LocalDate.safeParse('2025-02-29').success).toBe(false)
    expect(LocalDate.safeParse('17/04/1990').success).toBe(false)
  })

  it('knows that late evening in Beirut is already tomorrow there', () => {
    const lateUtc = new Date('2026-09-11T22:30:00Z')
    expect(localDateIn('UTC', lateUtc)).toBe('2026-09-11')
    expect(localDateIn('Asia/Beirut', lateUtc)).toBe('2026-09-12')
  })
})

describe('working hours', () => {
  it('finds overlapping blocks on the same day, and only those', () => {
    expect(
      overlappingHours([
        { dayOfWeek: 1, opensAt: '09:00', closesAt: '13:00' },
        { dayOfWeek: 1, opensAt: '12:00', closesAt: '17:00' },
        { dayOfWeek: 2, opensAt: '12:00', closesAt: '17:00' },
        { dayOfWeek: 1, opensAt: '17:00', closesAt: '19:00' },
      ]),
    ).toEqual([0, 1])
  })

  it('rejects a block that closes before it opens', () => {
    const result = SetWorkingHoursRequest.safeParse({
      workingHours: [{ dayOfWeek: 3, opensAt: '17:00', closesAt: '09:00' }],
    })
    expect(codesOf(result)).toEqual(['CLOSES_BEFORE_OPENS'])
  })
})

describe('holidays', () => {
  it('refuses the same date twice for the same place', () => {
    const result = SetHolidaysRequest.safeParse({
      holidays: [
        { date: '2026-12-25', name: 'Christmas', branchId: null },
        { date: '2026-12-25', name: 'Christmas Day', branchId: '' },
      ],
    })
    expect(codesOf(result)).toEqual(['DUPLICATE_HOLIDAY'])
  })
})

describe('clinic profile', () => {
  it('stores emptied optional fields as null and validates what is left', () => {
    const parsed = ClinicProfileInput.parse({
      name: ' Demo Clinic ',
      legalName: '  ',
      taxId: null,
      contact: { email: '', phone: '+961 1 000 000' },
      address: { line1: '12 Rue Verdun', line2: '', city: 'Beirut', country: 'lb' },
      timezone: 'Asia/Beirut',
      currency: 'USD',
      locale: 'en',
    })
    expect(parsed.name).toBe('Demo Clinic')
    expect(parsed.legalName).toBeNull()
    expect(parsed.contact.email).toBeNull()
    expect(parsed.address.country).toBe('LB')
  })

  it('rejects an unknown timezone and a made-up country', () => {
    const result = ClinicProfileInput.safeParse({
      name: 'Clinic',
      legalName: null,
      taxId: null,
      contact: { email: null, phone: null },
      address: { line1: null, line2: null, city: null, country: 'QQ' },
      timezone: 'Mars/Olympus_Mons',
      currency: 'USD',
      locale: 'en',
    })
    expect(codesOf(result)).toEqual(expect.arrayContaining(['INVALID_TIMEZONE', 'INVALID_COUNTRY']))
  })
})

describe('slot minutes', () => {
  it('accepts a select’s text value on the grid and nothing off it', () => {
    expect(SlotMinutes.parse('30')).toBe(30)
    expect(SlotMinutes.safeParse(25).success).toBe(false)
  })
})
