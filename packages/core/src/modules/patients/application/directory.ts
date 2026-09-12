import type { PatientDetail, PatientListQuery, PatientSummary } from '@clinic/contracts'
import { NotFoundError } from '../../../errors'
import type { Page } from '../../../pagination'
import { assertCan, type Actor } from '../../access'
import { findUser, type AuthUser } from '../../identity'
import { parsePatientQuery } from '../domain/records'
import { patientRepository, type StoredPatient } from '../infrastructure/patient.repository'
import { patientListScope, patientResource } from './scope'

const iso = (date: Date | null) => (date ? date.toISOString() : null)

export function toPatientSummary(patient: StoredPatient): PatientSummary {
  return {
    id: patient.id,
    medicalRecordNo: patient.medicalRecordNo,
    firstName: patient.firstName,
    lastName: patient.lastName,
    dateOfBirth: patient.dateOfBirth,
    gender: patient.gender,
    phone: patient.contact.phone,
    email: patient.contact.email,
    isActive: patient.isActive,
    hasPortalAccount: patient.userId !== null,
    updatedAt: iso(patient.updatedAt),
  }
}

export function toPatientDetail(patient: StoredPatient, account: AuthUser | null): PatientDetail {
  return {
    id: patient.id,
    medicalRecordNo: patient.medicalRecordNo,
    firstName: patient.firstName,
    lastName: patient.lastName,
    dateOfBirth: patient.dateOfBirth,
    gender: patient.gender,
    nationalId: patient.nationalId,
    bloodType: patient.bloodType,
    contact: patient.contact,
    address: patient.address,
    emergencyContacts: patient.emergencyContacts,
    adminNotes: patient.adminNotes,
    isActive: patient.isActive,
    portalAccount: account ? { userId: account.id, status: account.status } : null,
    createdAt: iso(patient.createdAt),
    updatedAt: iso(patient.updatedAt),
    createdBy: patient.createdBy,
  }
}

export async function listPatients(
  actor: Actor,
  query: PatientListQuery,
): Promise<Page<PatientSummary>> {
  const scope = await patientListScope(actor)
  const page = await patientRepository.list(actor.clinicId, {
    query: parsePatientQuery(query.q),
    active: query.status === 'active',
    userId: scope.userId,
    limit: query.limit,
    cursor: query.cursor,
  })
  return { items: page.items.map(toPatientSummary), nextCursor: page.nextCursor }
}

export async function getPatient(actor: Actor, patientId: string): Promise<PatientDetail> {
  // Authorised before the record is read, so a refused request is never logged as a view.
  const facts = await patientRepository.findAccessFacts(actor.clinicId, patientId)
  await assertCan(actor, 'patient:read', patientResource(actor, patientId, facts?.userId ?? null))
  if (!facts) throw new NotFoundError('Patient')

  const patient = await patientRepository.findById(actor.clinicId, patientId)
  if (!patient) throw new NotFoundError('Patient')
  const account = patient.userId ? await findUser(actor.clinicId, patient.userId) : null
  return toPatientDetail(patient, account)
}

/** The patient profile attached to an account, for the `pid` claim on a token (ADR-0004). */
export function findPatientIdForUser(clinicId: string, userId: string): Promise<string | null> {
  return patientRepository.findIdByUserId(clinicId, userId)
}

/** The snapshot an appointment carries (section 8.7). A genuine read of the record, so audited. */
export interface PatientSchedulingFacts {
  id: string
  userId: string | null
  name: string
  medicalRecordNo: string
  phone: string | null
  isActive: boolean
}

export async function findPatientForScheduling(
  clinicId: string,
  patientId: string,
): Promise<PatientSchedulingFacts | null> {
  const patient = await patientRepository.findById(clinicId, patientId)
  if (!patient) return null
  return {
    id: patient.id,
    userId: patient.userId,
    name: `${patient.firstName} ${patient.lastName}`,
    medicalRecordNo: patient.medicalRecordNo,
    phone: patient.contact.phone,
    isActive: patient.isActive,
  }
}
