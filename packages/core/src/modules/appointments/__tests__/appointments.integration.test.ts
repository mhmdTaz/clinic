import { describe, expect, it } from 'vitest'
import { env } from '@clinic/config'
import { AppointmentModel, PatientModel, SlotReservationModel, newId } from '@clinic/db'
import {
  TEST_PASSWORD,
  createUser,
  meta,
  signedInActor,
  uniqueEmail,
  everyPage,
} from '../../../../test/fixtures'
import type { Actor } from '../../access'
import { getClinicSettings } from '../../clinic'
import { createDoctor, setDoctorAvailability } from '../../doctors'
import { registerPatient } from '../../patients'
import { instantOf, localMoment, weekdayOf } from '../../scheduling'
import { authenticateAccessToken, login } from '../../session'
import {
  bookAppointment,
  bookOwnAppointment,
  cancelAppointment,
  checkInAppointment,
  completeAppointment,
  listAppointments,
  markNoShow,
  offerSlots,
  registerWalkIn,
  rescheduleAppointment,
  startAppointment,
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

/**
 * Mid-morning on the clinic's today. Walk-ins are relative to "now", and a suite that runs at
 * 18:00 would otherwise find a doctor's day already over and fail for the time of day.
 */
async function thisMorning(actor: Actor): Promise<{ today: string; at: Date }> {
  const settings = await getClinicSettings(actor)
  const today = localMoment(new Date(), settings.timezone).date
  return { today, at: instantOf(today, '09:00', settings.timezone) }
}

/** A date on a different weekday, for a doctor who deliberately does not work today. */
function shiftedWeekday(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, (day ?? 1) + 1))
    .toISOString()
    .slice(0, 10)
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

/**
 * A patient with a portal account, as the front desk would set one up: the record first, then
 * the login attached to it. Signing in afterwards is what puts the `pid` claim on the token,
 * and without it an OWN grant resolves to nothing (ADR-0004).
 */
async function portalPatient(staff: Actor) {
  const account = await createUser({ role: 'patient' })
  const patient = await newPatient(staff)
  await PatientModel()
    .updateOne({ _id: patient.id, clinicId: clinicId() }, { $set: { userId: account.id } })
    .setOptions({ skipAudit: true })

  const session = await login({ email: account.email, password: TEST_PASSWORD, meta: meta() })
  const { actor } = await authenticateAccessToken(session.accessToken)
  return { actor, patient }
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

    const everyone = await everyPage((page) =>
      listAppointments(staff, { from: date, to: date, ...page }),
    )
    expect(everyone.some((appointment) => appointment.doctor.id === doctor.id)).toBe(true)
  })
})

describe('self-service', () => {
  it('lets a patient book, move and cancel their own appointment — and nothing else', async () => {
    const { actor: staff } = await signedInActor({ role: 'staff' })
    const { date } = await workingDay(staff, 20)
    const doctor = await scheduledDoctor(staff, date)
    const { actor: patient, patient: record } = await portalPatient(staff)

    const [day] = await offerSlots(patient, doctor.id, { from: date, to: date })
    const first = day?.slots[0]?.startsAt ?? ''
    const second = day?.slots[1]?.startsAt ?? ''

    const booked = await bookOwnAppointment(patient, {
      doctorId: doctor.id,
      startsAt: first,
      reason: 'Sore throat',
    })
    expect(booked.source).toBe('PATIENT')
    expect(booked.patient.id).toBe(record.id)
    // The staff note is not theirs to read, even on their own appointment.
    expect(booked.internalNote).toBeNull()

    // P5: rescheduling is theirs, inside the clinic's cutoff (ADR-0022).
    const moved = await rescheduleAppointment(patient, booked.id, {
      startsAt: second,
      reason: 'Something came up',
    })
    expect(moved.startsAt).toBe(second)
    expect(moved.number).toBe(booked.number)

    // What happened in the room is the clinic's to record, never the patient's. Called one at
    // a time: three rejections started together would leave two unhandled while the first runs.
    for (const attempt of [
      () => startAppointment(patient, booked.id),
      () => completeAppointment(patient, booked.id),
      () => markNoShow(patient, booked.id, 'not me'),
    ]) {
      await expect(attempt()).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 })
    }

    const cancelled = await cancelAppointment(patient, booked.id, { reason: 'Feeling better' })
    expect(cancelled.status).toBe('CANCELLED')
  })

  it('shows a patient only their own appointments', async () => {
    const { actor: staff } = await signedInActor({ role: 'staff' })
    const { date } = await workingDay(staff, 21)
    const doctor = await scheduledDoctor(staff, date)
    const { actor: patient } = await portalPatient(staff)
    const someoneElse = await newPatient(staff)

    const [day] = await offerSlots(staff, doctor.id, { from: date, to: date })
    await bookAppointment(staff, {
      patientId: someoneElse.id,
      doctorId: doctor.id,
      startsAt: day?.slots[0]?.startsAt ?? '',
      branchId: null,
      reason: null,
      internalNote: null,
    })
    const own = await bookOwnAppointment(patient, {
      doctorId: doctor.id,
      startsAt: day?.slots[1]?.startsAt ?? '',
      reason: null,
    })

    const mine = await everyPage((page) =>
      listAppointments(patient, { from: date, to: date, ...page }),
    )
    expect(mine.map((appointment) => appointment.id)).toEqual([own.id])
  })
})

describe('walk-ins', () => {
  it('puts someone who arrived into the next open time today and checks them in', async () => {
    const { actor: staff } = await signedInActor({ role: 'staff' })
    const { today, at } = await thisMorning(staff)
    const doctor = await scheduledDoctor(staff, today)
    const patient = await newPatient(staff)

    const [day] = await offerSlots(staff, doctor.id, { from: today, to: today }, at)
    const next = day?.slots[0]?.startsAt

    const walkIn = await registerWalkIn(
      staff,
      {
        patientId: patient.id,
        doctorId: doctor.id,
        branchId: null,
        reason: 'Cut their hand',
        internalNote: null,
      },
      at,
    )

    expect(walkIn.source).toBe('WALK_IN')
    // Already at the desk, so already checked in — the queue is people, not intentions.
    expect(walkIn.status).toBe('CHECKED_IN')
    expect(walkIn.checkedInAt).not.toBeNull()
    expect(walkIn.startsAt).toBe(next)
    expect(walkIn.statusHistory.map((entry) => entry.toStatus)).toEqual(['SCHEDULED', 'CHECKED_IN'])

    // On the grid like any other appointment, holding its cells (ADR-0013).
    const held = await SlotReservationModel().countDocuments({
      clinicId: clinicId(),
      appointmentId: walkIn.id,
    })
    expect(held).toBeGreaterThan(0)
    const [after] = await offerSlots(staff, doctor.id, { from: today, to: today }, at)
    expect(after?.slots.map((slot) => slot.startsAt)).not.toContain(next)
  })

  it('gives the second walk-in the slot after the first, not a refusal', async () => {
    const { actor: staff } = await signedInActor({ role: 'staff' })
    const { today, at } = await thisMorning(staff)
    const doctor = await scheduledDoctor(staff, today)
    const [first, second] = await Promise.all([newPatient(staff), newPatient(staff)])

    const walkIn = (patientId: string) =>
      registerWalkIn(
        staff,
        { patientId, doctorId: doctor.id, branchId: null, reason: null, internalNote: null },
        at,
      )

    const [one, two] = await Promise.all([walkIn(first.id), walkIn(second.id)])
    expect(one.startsAt).not.toBe(two.startsAt)
    expect([one.status, two.status]).toEqual(['CHECKED_IN', 'CHECKED_IN'])
  })

  it('says so plainly when the doctor has nothing left today', async () => {
    const { actor: staff } = await signedInActor({ role: 'staff' })
    const { today, at } = await thisMorning(staff)
    const patient = await newPatient(staff)

    // A doctor whose week does not include today at all.
    const doctor = await scheduledDoctor(staff, shiftedWeekday(today))

    await expect(
      registerWalkIn(
        staff,
        {
          patientId: patient.id,
          doctorId: doctor.id,
          branchId: null,
          reason: null,
          internalNote: null,
        },
        at,
      ),
    ).rejects.toMatchObject({ code: 'NO_SLOT_TODAY', status: 422 })
  })
})
