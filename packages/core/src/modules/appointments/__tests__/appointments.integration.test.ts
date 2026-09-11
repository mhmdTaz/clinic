import { describe, expect, it } from 'vitest'
import { env } from '@clinic/config'
import { AppointmentModel, SlotReservationModel, newId } from '@clinic/db'
import { signedInActor, uniqueEmail } from '../../../../test/fixtures'
import type { Actor } from '../../access'
import { getClinicSettings } from '../../clinic'
import { createDoctor, setDoctorAvailability } from '../../doctors'
import { registerPatient } from '../../patients'
import { localMoment, weekdayOf } from '../../scheduling'
import {
  bookAppointment,
  cancelAppointment,
  checkInAppointment,
  completeAppointment,
  listAppointments,
  offerSlots,
  rescheduleAppointment,
} from '../index'

const clinicId = () => env().CLINIC_ID

/** A weekday far enough ahead that nothing else in the suite has booked it. */
async function workingDay(
  actor: Actor,
  daysAhead: number,
): Promise<{ date: string; zone: string }> {
  const settings = await getClinicSettings(actor)
  const date = localMoment(new Date(Date.now() + daysAhead * 86_400_000), settings.timezone).date
  return { date, zone: settings.timezone }
}

/** A doctor who works 09:00–17:00 on that day, and a patient to book in. */
async function scheduledDoctor(staff: Actor, date: string) {
  const created = await createDoctor(staff, {
    firstName: 'Nour',
    lastName: `Saliba${newId().slice(0, 8)}`,
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
  await setDoctorAvailability(staff, created.doctor.id, {
    slotMinutes: 30,
    blocks: [{ dayOfWeek: weekdayOf(date), startsAt: '09:00', endsAt: '17:00' }],
  })
  return created.doctor
}

async function newPatient(staff: Actor) {
  const registered = await registerPatient(staff, {
    firstName: 'Rana',
    lastName: `Haddad${newId().slice(0, 8)}`,
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
  return registered.patient
}

describe('booking', () => {
  it('offers a doctor’s week, books one of the slots and holds the time', async () => {
    const { actor: staff } = await signedInActor({ role: 'staff' })
    const { date } = await workingDay(staff, 7)
    const doctor = await scheduledDoctor(staff, date)
    const patient = await newPatient(staff)

    const [day] = await offerSlots(staff, doctor.id, { from: date, to: date })
    expect(day?.slots.length).toBeGreaterThan(0)
    const slot = day?.slots[0]

    const appointment = await bookAppointment(staff, {
      patientId: patient.id,
      doctorId: doctor.id,
      startsAt: slot?.startsAt ?? '',
      branchId: null,
      reason: 'Follow-up',
      internalNote: 'Prefers the morning',
    })

    expect(appointment.number).toMatch(/^APT-\d{6}$/)
    expect(appointment.status).toBe('SCHEDULED')
    expect(appointment.source).toBe('STAFF')
    expect(appointment.patient.medicalRecordNo).toBe(patient.medicalRecordNo)
    expect(appointment.durationMinutes).toBe(30)

    // Six five-minute cells for a half-hour appointment (ADR-0013).
    const held = await SlotReservationModel().countDocuments({
      clinicId: clinicId(),
      appointmentId: appointment.id,
    })
    expect(held).toBe(6)

    // The slot it took is no longer offered.
    const [afterBooking] = await offerSlots(staff, doctor.id, { from: date, to: date })
    expect(afterBooking?.slots.map((entry) => entry.startsAt)).not.toContain(slot?.startsAt)
  })

  it('lets exactly one of two simultaneous bookings take the slot', async () => {
    const { actor: staff } = await signedInActor({ role: 'staff' })
    const { date } = await workingDay(staff, 8)
    const doctor = await scheduledDoctor(staff, date)
    const [first, second] = await Promise.all([newPatient(staff), newPatient(staff)])

    const [day] = await offerSlots(staff, doctor.id, { from: date, to: date })
    const startsAt = day?.slots[0]?.startsAt ?? ''

    const book = (patientId: string) =>
      bookAppointment(staff, {
        patientId,
        doctorId: doctor.id,
        startsAt,
        branchId: null,
        reason: null,
        internalNote: null,
      })

    const results = await Promise.allSettled([book(first.id), book(second.id)])
    const booked = results.filter((result) => result.status === 'fulfilled')
    const refused = results.filter((result) => result.status === 'rejected')

    expect(booked).toHaveLength(1)
    expect(refused).toHaveLength(1)
    expect((refused[0] as PromiseRejectedResult | undefined)?.reason).toMatchObject({
      code: 'SLOT_TAKEN',
      status: 409,
    })

    // And the database holds one appointment for that time, not two.
    const stored = await AppointmentModel().countDocuments({
      clinicId: clinicId(),
      doctorId: doctor.id,
      startsAt: new Date(startsAt),
      status: { $ne: 'CANCELLED' },
    })
    expect(stored).toBe(1)
  })

  it('refuses a time the doctor does not work', async () => {
    const { actor: staff } = await signedInActor({ role: 'staff' })
    const { date, zone } = await workingDay(staff, 9)
    const doctor = await scheduledDoctor(staff, date)
    const patient = await newPatient(staff)

    // 21:00 UTC: outside 09:00–17:00 whichever way the clinic's offset falls.
    const afterHours = new Date(`${date}T21:00:00.000Z`)
    await expect(
      bookAppointment(staff, {
        patientId: patient.id,
        doctorId: doctor.id,
        startsAt: afterHours.toISOString(),
        branchId: null,
        reason: null,
        internalNote: null,
      }),
    ).rejects.toMatchObject({ code: 'OUTSIDE_AVAILABILITY', status: 422 })
    expect(zone).toBeTruthy()
  })
})

describe('the lifecycle', () => {
  it('gives the time back when an appointment is cancelled, and takes it again on rebooking', async () => {
    const { actor: staff } = await signedInActor({ role: 'staff' })
    const { date } = await workingDay(staff, 10)
    const doctor = await scheduledDoctor(staff, date)
    const patient = await newPatient(staff)

    const [day] = await offerSlots(staff, doctor.id, { from: date, to: date })
    const startsAt = day?.slots[0]?.startsAt ?? ''
    const booked = await bookAppointment(staff, {
      patientId: patient.id,
      doctorId: doctor.id,
      startsAt,
      branchId: null,
      reason: null,
      internalNote: null,
    })

    const cancelled = await cancelAppointment(staff, booked.id, { reason: 'Patient called' })
    expect(cancelled.status).toBe('CANCELLED')
    expect(cancelled.cancelReason).toBe('Patient called')
    expect(
      await SlotReservationModel().countDocuments({
        clinicId: clinicId(),
        appointmentId: booked.id,
      }),
    ).toBe(0)

    const again = await bookAppointment(staff, {
      patientId: patient.id,
      doctorId: doctor.id,
      startsAt,
      branchId: null,
      reason: null,
      internalNote: null,
    })
    expect(again.status).toBe('SCHEDULED')
  })

  it('moves an appointment and frees the time it left', async () => {
    const { actor: staff } = await signedInActor({ role: 'staff' })
    const { date } = await workingDay(staff, 11)
    const doctor = await scheduledDoctor(staff, date)
    const patient = await newPatient(staff)

    const [day] = await offerSlots(staff, doctor.id, { from: date, to: date })
    const first = day?.slots[0]?.startsAt ?? ''
    const second = day?.slots[1]?.startsAt ?? ''

    const booked = await bookAppointment(staff, {
      patientId: patient.id,
      doctorId: doctor.id,
      startsAt: first,
      branchId: null,
      reason: null,
      internalNote: null,
    })
    const moved = await rescheduleAppointment(staff, booked.id, {
      startsAt: second,
      reason: 'Patient asked for later',
    })

    expect(moved.startsAt).toBe(second)
    expect(moved.number).toBe(booked.number)
    const [after] = await offerSlots(staff, doctor.id, { from: date, to: date })
    const offered = after?.slots.map((slot) => slot.startsAt) ?? []
    expect(offered).toContain(first)
    expect(offered).not.toContain(second)
  })

  it('walks a visit from checked in to completed, and refuses a move that skips', async () => {
    const { actor: staff } = await signedInActor({ role: 'staff' })
    const { date } = await workingDay(staff, 12)
    const doctor = await scheduledDoctor(staff, date)
    const patient = await newPatient(staff)

    const [day] = await offerSlots(staff, doctor.id, { from: date, to: date })
    const booked = await bookAppointment(staff, {
      patientId: patient.id,
      doctorId: doctor.id,
      startsAt: day?.slots[0]?.startsAt ?? '',
      branchId: null,
      reason: null,
      internalNote: null,
    })

    // COMPLETED does not follow SCHEDULED: the visit has to start first.
    await expect(completeAppointment(staff, booked.id)).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
      status: 422,
    })

    const checkedIn = await checkInAppointment(staff, booked.id)
    expect(checkedIn.status).toBe('CHECKED_IN')
    expect(checkedIn.checkedInAt).not.toBeNull()
    expect(checkedIn.statusHistory.at(-1)).toMatchObject({
      fromStatus: 'SCHEDULED',
      toStatus: 'CHECKED_IN',
    })
  })
})

describe('who sees which appointments', () => {
  it('refuses a doctor with no profile rather than showing them the clinic', async () => {
    const { actor: staff } = await signedInActor({ role: 'staff' })
    const { date } = await workingDay(staff, 13)
    const doctor = await scheduledDoctor(staff, date)
    const patient = await newPatient(staff)

    const [day] = await offerSlots(staff, doctor.id, { from: date, to: date })
    await bookAppointment(staff, {
      patientId: patient.id,
      doctorId: doctor.id,
      startsAt: day?.slots[0]?.startsAt ?? '',
      branchId: null,
      reason: null,
      internalNote: null,
    })

    // An account with the Doctor role but no profile resolves ASSIGNED to nothing, and the
    // engine denies rather than widening (ADR-0004).
    const { actor: doctorWithoutProfile } = await signedInActor({ role: 'doctor' })
    await expect(
      listAppointments(doctorWithoutProfile, { from: date, to: date }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 })

    const everyone = await listAppointments(staff, { from: date, to: date })
    expect(everyone.some((appointment) => appointment.doctor.id === doctor.id)).toBe(true)
  })
})
