import { SLOT_GRID_MINUTES } from '@clinic/config'
import type {
  AppointmentDetail,
  BookAppointmentRequest,
  BookOwnAppointmentRequest,
} from '@clinic/contracts'
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../../errors'
import { runInTransaction } from '../../../transaction'
import { assertCan, type Actor } from '../../access'
import { getSchedulingFacts, type SchedulingFacts } from '../../clinic'
import { findDoctorForScheduling, type DoctorSchedulingFacts } from '../../doctors'
import { findPatientForScheduling, type PatientSchedulingFacts } from '../../patients'
import {
  addMinutes,
  bookingRefusal,
  bookingWindowOf,
  computeSlots,
  gridCellIds,
  localMoment,
  sitsOnGrid,
} from '../../scheduling'
import {
  appointmentRepository,
  isSlotTaken,
  type StoredAppointment,
} from '../infrastructure/appointment.repository'
import { toAppointmentDetail } from './directory'
import { appointmentResource } from './scope'

export interface PreparedBooking {
  clinic: SchedulingFacts
  doctor: DoctorSchedulingFacts
  patient: PatientSchedulingFacts
  startsAt: Date
  endsAt: Date
  durationMinutes: number
}

/**
 * Everything a booking must be true about before the write: the people exist and are active,
 * the time sits on the grid, and the doctor actually works then.
 *
 * What it deliberately does not check is whether the slot is free. Two requests can both find
 * it free and both be right at the moment they look; the reservation documents settle that in
 * the storage engine (ADR-0013).
 */
export async function prepareBooking(
  actor: Actor,
  input: {
    doctorId: string
    patientId: string
    startsAt: string
    durationMinutes?: number
    branchId?: string | null
  },
): Promise<PreparedBooking> {
  const startsAt = new Date(input.startsAt)
  if (Number.isNaN(startsAt.getTime())) {
    throw new ValidationError('That is not a time.', [{ field: 'startsAt', issue: 'INVALID_DATE' }])
  }

  const [clinic, doctor, patient] = await Promise.all([
    getSchedulingFacts(actor.clinicId, input.branchId ?? null),
    findDoctorForScheduling(actor.clinicId, input.doctorId),
    findPatientForScheduling(actor.clinicId, input.patientId),
  ])
  if (!doctor) throw new NotFoundError('Doctor')
  if (!patient) throw new NotFoundError('Patient')
  if (!doctor.isActive) {
    throw new BusinessRuleError('DOCTOR_NOT_ACTIVE', 'That doctor is no longer seeing patients.')
  }
  if (!patient.isActive) {
    throw new BusinessRuleError('PATIENT_ARCHIVED', 'That patient record is archived.')
  }

  const durationMinutes = input.durationMinutes ?? doctor.defaultSlotMinutes
  const endsAt = addMinutes(startsAt, durationMinutes)

  if (!sitsOnGrid(startsAt, durationMinutes)) {
    throw new ValidationError('Appointments sit on five-minute boundaries.', [
      { field: 'startsAt', issue: 'NOT_ON_THE_BOOKING_GRID' },
    ])
  }
  if (!worksThen(clinic, doctor, startsAt, durationMinutes)) {
    throw new BusinessRuleError('OUTSIDE_AVAILABILITY', 'The doctor does not work at that time.')
  }

  return { clinic, doctor, patient, startsAt, endsAt, durationMinutes }
}

/** Whether the whole appointment fits inside a working block on a day the clinic is open. */
function worksThen(
  clinic: SchedulingFacts,
  doctor: DoctorSchedulingFacts,
  startsAt: Date,
  durationMinutes: number,
): boolean {
  const date = localMoment(startsAt, clinic.timezone).date
  const [day] = computeSlots({
    from: date,
    to: date,
    timeZone: clinic.timezone,
    blocks: doctor.availability,
    timeOff: doctor.timeOff,
    closedDates: clinic.closedDates,
    busy: [],
    durationMinutes,
    notBefore: new Date(0),
    // Staff book on the hour or at ten past; the grid is the only alignment required.
    stepMinutes: SLOT_GRID_MINUTES,
  })
  return Boolean(day?.slots.some((slot) => slot.startsAt.getTime() === startsAt.getTime()))
}

async function write(
  actor: Actor,
  prepared: PreparedBooking,
  meta: {
    source: 'STAFF' | 'PATIENT'
    reason: string | null
    internalNote: string | null
    branchId: string | null
  },
): Promise<StoredAppointment> {
  const number = await appointmentRepository.nextNumber(actor.clinicId)
  const createdBy = { id: actor.userId, name: actor.displayName }

  return runInTransaction(async (tx) => {
    const appointment = await appointmentRepository.create(
      {
        clinicId: actor.clinicId,
        branchId: meta.branchId,
        number,
        patientId: prepared.patient.id,
        doctorId: prepared.doctor.id,
        patient: {
          name: prepared.patient.name,
          medicalRecordNo: prepared.patient.medicalRecordNo,
          phone: prepared.patient.phone,
        },
        doctor: { name: prepared.doctor.name },
        startsAt: prepared.startsAt,
        endsAt: prepared.endsAt,
        durationMinutes: prepared.durationMinutes,
        source: meta.source,
        reason: meta.reason,
        internalNote: meta.internalNote,
        createdBy,
      },
      tx,
    )

    try {
      await appointmentRepository.reserve(
        {
          clinicId: actor.clinicId,
          doctorId: prepared.doctor.id,
          appointmentId: appointment.id,
          cellIds: gridCellIds(prepared.doctor.id, prepared.startsAt, prepared.endsAt),
        },
        tx,
      )
    } catch (error) {
      // The appointment above rolls back with the transaction, so the loser writes nothing —
      // not even an audit entry, which waits for the commit (section 11.3).
      if (isSlotTaken(error)) {
        throw new ConflictError('SLOT_TAKEN', 'That slot was just booked by someone else.')
      }
      throw error
    }

    return appointment
  })
}

/** The front desk books for a patient (S5). No window applies: the clinic is on the phone. */
export async function bookAppointment(
  actor: Actor,
  input: BookAppointmentRequest,
): Promise<AppointmentDetail> {
  await assertCan(actor, 'appointment:create')
  const prepared = await prepareBooking(actor, input)
  const appointment = await write(actor, prepared, {
    source: 'STAFF',
    reason: input.reason,
    internalNote: input.internalNote,
    branchId: input.branchId,
  })
  return toAppointmentDetail(appointment, { includeInternalNote: true })
}

/** A patient books their own appointment (P5), inside the clinic's window (ADR-0022). */
export async function bookOwnAppointment(
  actor: Actor,
  input: BookOwnAppointmentRequest,
  now: Date = new Date(),
): Promise<AppointmentDetail> {
  if (!actor.patientId) throw new ForbiddenError('appointment:create')
  await assertCan(
    actor,
    'appointment:create',
    appointmentResource(actor, { id: null, doctorId: input.doctorId, patientId: actor.patientId }),
  )

  const prepared = await prepareBooking(actor, {
    doctorId: input.doctorId,
    patientId: actor.patientId,
    startsAt: input.startsAt,
  })

  const refusal = bookingRefusal(
    prepared.startsAt,
    bookingWindowOf(prepared.clinic.bookingSettings),
    now,
  )
  if (refusal === 'TOO_SOON') {
    throw new BusinessRuleError(
      'TOO_SOON',
      'That is too soon to book online. Please call the clinic.',
    )
  }
  if (refusal === 'BEYOND_HORIZON') {
    throw new BusinessRuleError('BEYOND_HORIZON', 'That is further ahead than booking opens.')
  }

  const appointment = await write(actor, prepared, {
    source: 'PATIENT',
    reason: input.reason,
    internalNote: null,
    branchId: null,
  })
  // A patient never sees the staff note, and there is none on a booking they made.
  return toAppointmentDetail(appointment, { includeInternalNote: false })
}
