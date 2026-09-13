import { describe, expect, it } from 'vitest'
import { env } from '@clinic/config'
import { AuditLogModel, newId } from '@clinic/db'
import { failureDetails, outcome, signedInActor } from '../../../../test/fixtures'
import { flushAudit } from '../../audit'
import {
  createBranch,
  getBookingWindow,
  getClinicProfile,
  getClinicSettings,
  setBranchWorkingHours,
  setClinicHolidays,
  updateBookingWindow,
  updateBranch,
  updateClinicProfile,
} from '../index'

describe('the clinic profile', () => {
  it('saves the profile and records exactly which fields changed', async () => {
    const { actor: admin } = await signedInActor({ role: 'admin' })
    const before = await getClinicSettings(admin)
    const phone = `+961 1 ${newId().replace(/\D/g, '').padEnd(6, '7').slice(0, 6)}`

    const after = await updateClinicProfile(admin, {
      name: before.name,
      legalName: 'Integration Clinic SARL',
      taxId: null,
      contact: { email: 'desk@itest.local', phone },
      address: { line1: '12 Rue Verdun', line2: null, city: 'Beirut', country: 'LB' },
      timezone: 'Asia/Beirut',
      currency: 'USD',
      locale: 'en',
    })
    expect(after.contact.phone).toBe(phone)

    await flushAudit()
    const entry = await AuditLogModel()
      .findOne({
        clinicId: env().CLINIC_ID,
        action: 'clinic.updated',
        'after.contact.phone': phone,
      })
      .lean()
    expect(entry?.metadata).toMatchObject({
      changedPaths: expect.arrayContaining(['contact.phone']),
    })
  })

  it('refuses to be edited by someone who may only read it', async () => {
    const { actor: patient } = await signedInActor({ role: 'patient' })
    const settings = await getClinicSettings(patient)
    expect(
      await outcome(
        updateClinicProfile(patient, {
          ...settings,
          currency: 'USD',
          locale: 'en',
        }),
      ),
    ).toBe('FORBIDDEN')
  })
})

describe('locations (ADR-0021)', () => {
  it('keeps at least one location open', async () => {
    const { actor: admin } = await signedInActor({ role: 'admin' })
    const settings = await createBranch(admin, {
      name: `Keeper ${newId().slice(0, 6)}`,
      phone: null,
      address: null,
    })
    const keeper = settings.branches.at(-1)
    if (!keeper) throw new Error('branch was not created')

    // Close everything else, so the rule is tested against a clinic with one open location.
    for (const branch of settings.branches.filter((b) => b.isActive && b.id !== keeper.id)) {
      await updateBranch(admin, branch.id, { ...branch, isActive: false })
    }

    expect(
      await failureDetails(updateBranch(admin, keeper.id, { ...keeper, isActive: false })),
    ).toEqual([{ field: 'isActive', issue: 'LAST_ACTIVE_BRANCH' }])
  })
})

describe('opening hours', () => {
  it('refuses overlapping blocks on the same day, even from a caller that skipped the form', async () => {
    const { actor: admin } = await signedInActor({ role: 'admin' })
    const [branch] = (await getClinicSettings(admin)).branches.filter((b) => b.isActive)
    if (!branch) throw new Error('no open branch')

    expect(
      await failureDetails(
        setBranchWorkingHours(admin, branch.id, {
          workingHours: [
            { dayOfWeek: 1, opensAt: '09:00', closesAt: '13:00' },
            { dayOfWeek: 1, opensAt: '12:30', closesAt: '17:00' },
          ],
        }),
      ),
    ).toEqual([
      { field: 'workingHours.0.opensAt', issue: 'OVERLAPPING_HOURS' },
      { field: 'workingHours.1.opensAt', issue: 'OVERLAPPING_HOURS' },
    ])

    const saved = await setBranchWorkingHours(admin, branch.id, {
      workingHours: [
        { dayOfWeek: 1, opensAt: '14:00', closesAt: '18:00' },
        { dayOfWeek: 1, opensAt: '08:00', closesAt: '12:00' },
      ],
    })
    expect(saved.branches.find((b) => b.id === branch.id)?.workingHours).toEqual([
      { dayOfWeek: 1, opensAt: '08:00', closesAt: '12:00' },
      { dayOfWeek: 1, opensAt: '14:00', closesAt: '18:00' },
    ])
  })
})

describe('holidays', () => {
  it('refuses a holiday for a location that does not exist', async () => {
    const { actor: admin } = await signedInActor({ role: 'admin' })
    expect(
      await failureDetails(
        setClinicHolidays(admin, {
          holidays: [{ date: '2026-12-25', name: 'Christmas', branchId: 'no-such-branch' }],
        }),
      ),
    ).toEqual([{ field: 'holidays.0.branchId', issue: 'UNKNOWN_BRANCH' }])
  })

  it('counts "upcoming" from today in the clinic’s timezone, not in UTC', async () => {
    const { actor: admin } = await signedInActor({ role: 'admin' })
    await setClinicHolidays(admin, {
      holidays: [
        { date: '2026-12-24', name: 'Christmas Eve', branchId: null },
        { date: '2026-12-25', name: 'Christmas', branchId: null },
      ],
    })

    // 22:30 UTC on the 24th is already the 25th in Beirut.
    const profile = await getClinicProfile(admin, new Date('2026-12-24T22:30:00Z'))
    expect(profile.upcomingHolidays.map((holiday) => holiday.name)).toEqual(['Christmas'])
  })
})

describe('the booking window (ADR-0022)', () => {
  /**
   * The people the window binds are patients, and the settings that hold it were admin-only over
   * the API — so a patient's phone booked blind. The window is its own read now.
   */
  it('is readable by a patient, and says what an admin set', async () => {
    const { actor: admin } = await signedInActor({ role: 'admin' })
    const { actor: patient } = await signedInActor({ role: 'patient' })

    await updateBookingWindow(admin, {
      horizonDays: 45,
      minimumNoticeHours: 4,
      cancellationCutoffHours: 12,
    })
    expect(await getBookingWindow(patient)).toEqual({
      horizonDays: 45,
      minimumNoticeHours: 4,
      cancellationCutoffHours: 12,
    })

    // Put back, so the rest of the suite books under the defaults it expects.
    await updateBookingWindow(admin, {
      horizonDays: 60,
      minimumNoticeHours: 2,
      cancellationCutoffHours: 24,
    })
  })

  it('is refused to somebody with no clinic:read at all', async () => {
    const { actor: nobody } = await signedInActor({ roleIds: [] })
    expect(await outcome(getBookingWindow(nobody))).toBe('FORBIDDEN')
  })
})
