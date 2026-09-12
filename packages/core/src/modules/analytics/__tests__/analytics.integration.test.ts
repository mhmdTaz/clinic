import { describe, expect, it } from 'vitest'
import { env } from '@clinic/config'
import { localDateIn } from '@clinic/contracts'
import { newId } from '@clinic/db'
import { failureDetails, outcome, signedInActor, uniqueEmail } from '../../../../test/fixtures'
import type { Actor } from '../../access'
import {
  bookAppointment,
  checkInAppointment,
  completeAppointment,
  markNoShow,
  offerSlots,
  startAppointment,
} from '../../appointments'
import { createInvoice, issueInvoice, recordPayment } from '../../billing'
import { getClinicFacts } from '../../clinic'
import { weekdayOf } from '../../scheduling'
import { createDoctor, setDoctorAvailability } from '../../doctors'
import { registerPatient } from '../../patients'
import { getAnalyticsOverview } from '../index'

const clinicId = () => env().CLINIC_ID

async function adminActor(): Promise<Actor> {
  return (await signedInActor({ role: 'admin' })).actor
}

async function staffActor(): Promise<Actor> {
  return (await signedInActor({ role: 'staff' })).actor
}

async function today(): Promise<string> {
  const clinic = await getClinicFacts(clinicId())
  return localDateIn(clinic.timezone)
}

async function aPatient(staff: Actor) {
  const { patient } = await registerPatient(staff, {
    firstName: 'Nadia',
    lastName: `Stat${newId().slice(0, 8)}`,
    dateOfBirth: null,
    gender: null,
    nationalId: null,
    bloodType: 'UNKNOWN',
    contact: { phone: null, email: null },
    address: { line1: null, city: null, country: null },
    emergencyContacts: [],
    adminNotes: null,
    duplicateOverride: null,
    inviteToPortal: false,
  })
  return patient
}

describe('the analytics overview', () => {
  it('needs analytics:read — a doctor sees their own day, not the clinic’s books', async () => {
    const { actor: doctor } = await signedInActor({ role: 'doctor' })
    expect(await outcome(getAnalyticsOverview(doctor, {}))).toBe('FORBIDDEN')
  })

  it('defaults to the last 30 days, ending today in the clinic’s timezone', async () => {
    const admin = await adminActor()
    const overview = await getAnalyticsOverview(admin, {})

    expect(overview.range.to).toBe(await today())
    expect(overview.range.days).toBe(30)
    expect(overview.revenue.byDay).toHaveLength(30)
    expect(overview.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('refuses a backwards range rather than quietly swapping the ends', async () => {
    const admin = await adminActor()
    expect(
      await failureDetails(getAnalyticsOverview(admin, { from: '2026-03-31', to: '2026-03-01' })),
    ).toEqual([{ field: 'from', issue: 'RANGE_INVERTED' }])
  })

  it('refuses a range longer than a year', async () => {
    const admin = await adminActor()
    expect(
      await failureDetails(getAnalyticsOverview(admin, { from: '2024-01-01', to: '2026-01-01' })),
    ).toEqual([{ field: 'from', issue: 'RANGE_TOO_LONG' }])
  })

  it('has a point for every day in the range, including the empty ones', async () => {
    const admin = await adminActor()
    const overview = await getAnalyticsOverview(admin, { from: '2026-03-01', to: '2026-03-07' })

    expect(overview.range.days).toBe(7)
    expect(overview.revenue.byDay.map((point) => point.date)).toEqual([
      '2026-03-01',
      '2026-03-02',
      '2026-03-03',
      '2026-03-04',
      '2026-03-05',
      '2026-03-06',
      '2026-03-07',
    ])
    expect(overview.appointments.byDay).toHaveLength(7)
    // A quiet day is a zero, not a gap.
    for (const point of overview.revenue.byDay) expect(point.amount).toMatch(/^-?\d+(\.\d+)?$/)
  })

  it('counts money that arrived, in the clinic’s currency and to its decimal places', async () => {
    const admin = await adminActor()
    const staff = await staffActor()
    const clinic = await getClinicFacts(clinicId())
    const patient = await aPatient(staff)

    const before = await getAnalyticsOverview(admin, {})

    const invoice = await createInvoice(staff, {
      patientId: patient.id,
      encounterId: null,
      branchId: null,
      notes: null,
      lines: [
        {
          serviceId: null,
          description: 'Consultation',
          quantity: '1',
          unitPrice: '120.00',
          discount: '0',
          taxRatePercent: '0',
        },
      ],
    })
    await issueInvoice(staff, invoice.id, { dueAt: null })
    await recordPayment(staff, {
      patientId: patient.id,
      amount: '50.00',
      method: 'CASH',
      reference: null,
      note: null,
      allocations: [{ invoiceId: invoice.id, amount: '50.00' }],
      idempotencyKey: newId(),
    })

    const after = await getAnalyticsOverview(admin, {})

    expect(after.revenue.currency).toBe(clinic.currency)
    expect(Number(after.revenue.collected) - Number(before.revenue.collected)).toBeCloseTo(50, 6)
    expect(Number(after.revenue.invoiced) - Number(before.revenue.invoiced)).toBeCloseTo(120, 6)
    // 120 billed, 50 taken: the 70 still owed is the whole reason both numbers are on the page.
    expect(Number(after.revenue.outstanding) - Number(before.revenue.outstanding)).toBeCloseTo(
      70,
      6,
    )
    // Exact decimals, not floats: two decimal places for a two-decimal currency.
    expect(after.revenue.collected).toMatch(/^-?\d+\.\d{2}$/)
  })

  it('counts visits by outcome, and turns them into rates', async () => {
    const admin = await adminActor()
    const staff = await staffActor()
    const day = await today()
    const doctor = await aDoctor(staff, { on: day })

    const [offered] = await offerSlots(staff, doctor.id, { from: day, to: day })
    const slots = offered?.slots ?? []
    expect(slots.length).toBeGreaterThan(1)

    const one = await bookAppointment(staff, {
      patientId: (await aPatient(staff)).id,
      doctorId: doctor.id,
      branchId: null,
      startsAt: slots[0]?.startsAt ?? '',
      reason: 'Check-up',
      internalNote: null,
    })
    const two = await bookAppointment(staff, {
      patientId: (await aPatient(staff)).id,
      doctorId: doctor.id,
      branchId: null,
      startsAt: slots[1]?.startsAt ?? '',
      reason: 'Check-up',
      internalNote: null,
    })
    // The real lifecycle: an appointment does not jump from scheduled to completed.
    await checkInAppointment(staff, one.id)
    await startAppointment(staff, one.id)
    await completeAppointment(staff, one.id)
    await markNoShow(staff, two.id)

    const overview = await getAnalyticsOverview(admin, { from: day, to: day })

    expect(overview.appointments.total).toBeGreaterThanOrEqual(2)
    expect(overview.appointments.byStatus.COMPLETED).toBeGreaterThanOrEqual(1)
    expect(overview.appointments.byStatus.NO_SHOW).toBeGreaterThanOrEqual(1)
    expect(overview.appointments.completionRate).toBeGreaterThan(0)
    // Rates are one decimal place, never NaN.
    expect(Number.isFinite(overview.appointments.noShowRate)).toBe(true)

    const forDay = overview.appointments.byDay.find((point) => point.date === day)
    expect(forDay?.booked).toBe(overview.appointments.total)
  })

  it('gives a rostered doctor a utilisation, and an unrostered one none', async () => {
    const admin = await adminActor()
    const staff = await staffActor()
    const day = await today()
    const rostered = await aDoctor(staff, { on: day })
    const unrostered = await aDoctor(staff, { on: null })
    const overview = await getAnalyticsOverview(admin, { from: day, to: day })

    const withRoster = overview.doctors.find((row) => row.doctorId === rostered.id)
    const without = overview.doctors.find((row) => row.doctorId === unrostered.id)

    expect(withRoster).toBeDefined()
    expect(withRoster?.availableMinutes).toBeGreaterThan(0)
    expect(typeof withRoster?.utilisationPercent).toBe('number')

    // Not rostered is not "0% utilised": it is a different fact, and it reads as one.
    expect(without?.availableMinutes).toBe(0)
    expect(without?.utilisationPercent).toBeNull()

    // Every doctor has a name, never a bare id — including one who saw nobody.
    for (const row of overview.doctors) expect(row.name).not.toBe(row.doctorId)
  })

  it('splits patients into new and returning, and the two add up', async () => {
    const admin = await adminActor()
    const overview = await getAnalyticsOverview(admin, {})

    expect(overview.patients.newCount + overview.patients.returningCount).toBe(
      overview.patients.seenCount,
    )
    expect(overview.patients.newPercent).toBeGreaterThanOrEqual(0)
    expect(overview.patients.newPercent).toBeLessThanOrEqual(100)
  })
})

/** A doctor, rostered 09:00–17:00 on `on` — or rostered for nothing at all when `on` is null. */
async function aDoctor(staff: Actor, options: { on: string | null }) {
  const { doctor } = await createDoctor(staff, {
    firstName: 'Nour',
    lastName: `Load${newId().slice(0, 8)}`,
    email: uniqueEmail('doctor'),
    phone: null,
    title: 'Dr',
    licenseNumber: null,
    specialtyIds: [],
    consultationFee: null,
    defaultSlotMinutes: 30,
    yearsOfExperience: null,
    bio: null,
    isAcceptingNew: true,
    branchIds: [],
  })

  if (options.on !== null) {
    await setDoctorAvailability(staff, doctor.id, {
      slotMinutes: 30,
      // The whole day rather than office hours: a suite that runs at 16:30 would otherwise find
      // a 09:00-17:00 roster nearly spent and fail for the time of day rather than for a bug.
      blocks: [{ dayOfWeek: weekdayOf(options.on), startsAt: '00:00', endsAt: '23:30' }],
    })
  }

  return doctor
}
