import type { DoctorAvailability, SetAvailabilityRequest, TimeOffInput } from '@clinic/contracts'
import { NotFoundError } from '../../../errors'
import { assertCan, type Actor, type PermissionKey } from '../../access'
import { displayNameOf, findUser } from '../../identity'
import { doctorRepository, type StoredDoctor } from '../infrastructure/doctor.repository'
import { doctorResource } from './scope'

/**
 * A doctor's week and days away (D10, S4).
 *
 * They live on the doctor document because slot computation reads them with the profile on
 * every calendar render. A doctor holds `availability:manage` at OWN scope, so they keep their
 * own schedule without being able to rearrange a colleague's.
 */

async function loadFor(
  actor: Actor,
  doctorId: string,
  permission: PermissionKey,
): Promise<StoredDoctor> {
  const doctor = await doctorRepository.findById(actor.clinicId, doctorId)
  if (!doctor) throw new NotFoundError('Doctor')
  await assertCan(actor, permission, doctorResource(actor, doctor.id, doctor.userId))
  return doctor
}

async function toAvailability(doctor: StoredDoctor, clinicId: string): Promise<DoctorAvailability> {
  const account = await findUser(clinicId, doctor.userId)
  return {
    doctorId: doctor.id,
    doctorName: account ? displayNameOf(account) : '',
    slotMinutes: doctor.defaultSlotMinutes,
    blocks: doctor.availability,
    timeOff: doctor.timeOff,
  }
}

export async function getDoctorSchedule(
  actor: Actor,
  doctorId: string,
): Promise<DoctorAvailability> {
  const doctor = await loadFor(actor, doctorId, 'availability:read')
  return toAvailability(doctor, actor.clinicId)
}

/** The week is replaced whole: a schedule is edited as one thing, not block by block. */
export async function setDoctorAvailability(
  actor: Actor,
  doctorId: string,
  input: SetAvailabilityRequest,
): Promise<DoctorAvailability> {
  const doctor = await loadFor(actor, doctorId, 'availability:manage')
  const updated = await doctorRepository.setSchedule(
    actor.clinicId,
    doctor.id,
    { defaultSlotMinutes: input.slotMinutes, availability: input.blocks },
    { id: actor.userId, name: actor.displayName },
  )
  if (!updated) throw new NotFoundError('Doctor')
  return toAvailability(updated, actor.clinicId)
}

export async function addDoctorTimeOff(
  actor: Actor,
  doctorId: string,
  input: TimeOffInput,
): Promise<DoctorAvailability> {
  const doctor = await loadFor(actor, doctorId, 'availability:manage')
  const result = await doctorRepository.addTimeOff(
    actor.clinicId,
    doctor.id,
    { startDate: input.startDate, endDate: input.endDate, reason: input.reason },
    { id: actor.userId, name: actor.displayName },
  )
  if (!result) throw new NotFoundError('Doctor')
  return toAvailability(result.doctor, actor.clinicId)
}

/**
 * Removing time off frees the days again. Appointments already booked into them are left
 * alone: the doctor is back, so there is nothing to undo.
 */
export async function removeDoctorTimeOff(
  actor: Actor,
  doctorId: string,
  timeOffId: string,
): Promise<DoctorAvailability> {
  const doctor = await loadFor(actor, doctorId, 'availability:manage')
  const updated = await doctorRepository.removeTimeOff(actor.clinicId, doctor.id, timeOffId, {
    id: actor.userId,
    name: actor.displayName,
  })
  if (!updated) throw new NotFoundError('Doctor')
  return toAvailability(updated, actor.clinicId)
}

/** What booking needs about a doctor. No permission check: the caller has already authorised. */
export interface DoctorSchedulingFacts {
  id: string
  userId: string
  name: string
  /** Printed on anything the doctor puts their name to, a prescription first of all (D8). */
  licenseNumber: string | null
  isActive: boolean
  defaultSlotMinutes: number
  availability: StoredDoctor['availability']
  timeOff: StoredDoctor['timeOff']
  branchIds: string[]
}

export async function findDoctorForScheduling(
  clinicId: string,
  doctorId: string,
): Promise<DoctorSchedulingFacts | null> {
  const doctor = await doctorRepository.findById(clinicId, doctorId)
  if (!doctor) return null
  const account = await findUser(clinicId, doctor.userId)
  return {
    id: doctor.id,
    userId: doctor.userId,
    name: account ? displayNameOf(account) : '',
    licenseNumber: doctor.licenseNumber,
    isActive: doctor.isActive,
    defaultSlotMinutes: doctor.defaultSlotMinutes,
    availability: doctor.availability,
    timeOff: doctor.timeOff,
    branchIds: doctor.branchIds,
  }
}

/** The doctor profile attached to an account, for the `did` claim on a token. */
export async function findDoctorIdForUser(
  clinicId: string,
  userId: string,
): Promise<string | null> {
  const doctor = await doctorRepository.findByUserId(clinicId, userId)
  return doctor?.id ?? null
}

/**
 * What billing needs about a doctor: the fee an invoice drawn from their consultation starts
 * from (S7). No permission check — the caller has already authorised the invoice itself.
 */
export interface DoctorBillingFacts {
  id: string
  name: string
  consultationFee: string | null
}

export async function findDoctorForBilling(
  clinicId: string,
  doctorId: string,
): Promise<DoctorBillingFacts | null> {
  const doctor = await doctorRepository.findById(clinicId, doctorId)
  if (!doctor) return null
  const account = await findUser(clinicId, doctor.userId)
  return {
    id: doctor.id,
    name: account ? displayNameOf(account) : '',
    consultationFee: doctor.consultationFee,
  }
}
