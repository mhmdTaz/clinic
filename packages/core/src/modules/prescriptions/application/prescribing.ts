import { localDateIn } from '@clinic/contracts'
import type {
  DownloadLink,
  IssuePrescriptionRequest,
  Prescription,
  PrescriptionListQuery,
} from '@clinic/contracts'
import { BusinessRuleError, ForbiddenError, NotFoundError } from '../../../errors'
import { recordAudit } from '../../audit'
import { assertCan, careRelationship, type Actor } from '../../access'
import { getClinicLetterhead } from '../../clinic'
import { findEncounterOwner } from '../../clinical'
import { findDoctorForScheduling } from '../../doctors'
import { findPatientForScheduling } from '../../patients'
import { getDownloadLink, storeGeneratedFile } from '../../files'

import { renderPrescriptionPdf } from '../infrastructure/pdf-renderer'
import {
  prescriptionRepository,
  type StoredPrescription,
} from '../infrastructure/prescription.repository'
import { prescriptionResource } from './scope'

export function toPrescription(prescription: StoredPrescription): Prescription {
  return {
    id: prescription.id,
    number: prescription.number,
    encounterId: prescription.encounterId,
    patient: {
      id: prescription.patientId,
      name: prescription.patient.name,
      medicalRecordNo: prescription.patient.medicalRecordNo,
    },
    doctor: {
      id: prescription.doctorId,
      name: prescription.doctor.name,
      licenseNumber: prescription.doctor.licenseNumber,
    },
    issuedAt: prescription.issuedAt.toISOString(),
    validUntil: prescription.validUntil,
    notes: prescription.notes,
    items: prescription.items,
    pdfFileId: prescription.pdfFileId,
    issuedBy: prescription.issuedBy,
  }
}

/**
 * Writing a prescription (D8). It hangs off the visit it was written during, which is what makes
 * a medication list answerable later: every drug on it can be traced to the consultation that
 * produced it and the doctor who put their name to it.
 */
export async function issuePrescription(
  actor: Actor,
  encounterId: string,
  input: IssuePrescriptionRequest,
  now: Date = new Date(),
): Promise<Prescription> {
  const encounter = await findEncounterOwner(actor.clinicId, encounterId)
  if (!encounter) throw new NotFoundError('Encounter')

  await assertCan(
    actor,
    'prescription:issue',
    prescriptionResource(actor, {
      id: null,
      patientId: encounter.patientId,
      doctorId: encounter.doctorId,
    }),
  )
  if (encounter.status === 'CANCELLED') {
    throw new BusinessRuleError('ENCOUNTER_CANCELLED', 'That visit was cancelled.')
  }

  const [patient, doctor] = await Promise.all([
    findPatientForScheduling(actor.clinicId, encounter.patientId),
    findDoctorForScheduling(actor.clinicId, encounter.doctorId),
  ])
  if (!patient) throw new NotFoundError('Patient')
  if (!doctor) throw new NotFoundError('Doctor')

  const prescription = await prescriptionRepository.create({
    clinicId: actor.clinicId,
    number: await prescriptionRepository.nextNumber(actor.clinicId),
    encounterId,
    patientId: patient.id,
    doctorId: doctor.id,
    patient: { name: patient.name, medicalRecordNo: patient.medicalRecordNo },
    doctor: { name: doctor.name, licenseNumber: doctor.licenseNumber },
    issuedAt: now,
    validUntil: input.validUntil,
    notes: input.notes,
    items: input.items,
    issuedBy: { id: actor.userId, name: actor.displayName },
  })

  await recordAudit({
    action: 'prescription.issued',
    category: 'CLINICAL',
    severity: 'NOTICE',
    clinicId: actor.clinicId,
    entity: { type: 'Prescription', id: prescription.id },
    metadata: {
      number: prescription.number,
      patientId: prescription.patientId,
      encounterId,
      items: prescription.items.length,
    },
  })

  return toPrescription(prescription)
}

export async function listPrescriptions(
  actor: Actor,
  query: PrescriptionListQuery,
  now: Date = new Date(),
): Promise<Prescription[]> {
  await assertCan(actor, 'prescription:read')
  const scope = actor.permissions.get('prescription:read')

  const filter: { patientId?: string; doctorId?: string; encounterId?: string; activeOn?: string } =
    { encounterId: query.encounterId }

  if (scope === 'OWN') {
    if (!actor.patientId) throw new ForbiddenError('prescription:read')
    filter.patientId = actor.patientId
  } else if (scope === 'ASSIGNED') {
    if (!actor.doctorId) throw new ForbiddenError('prescription:read')
    // Strict, like every other ASSIGNED row: what this doctor prescribed (ADR-0004).
    filter.doctorId = actor.doctorId
    if (query.patientId) {
      const treats = await careRelationship().hasTreated(
        actor.clinicId,
        actor.doctorId,
        query.patientId,
      )
      if (!treats) throw new ForbiddenError('prescription:read')
      filter.patientId = query.patientId
    }
  } else if (scope === 'CLINIC' || scope === 'GLOBAL') {
    filter.patientId = query.patientId
  } else {
    throw new ForbiddenError('prescription:read')
  }

  if (query.active) {
    const clinic = await getClinicLetterhead(actor.clinicId)
    filter.activeOn = localDateIn(clinic.timezone, now)
  }

  const prescriptions = await prescriptionRepository.list(actor.clinicId, filter)
  return prescriptions.map(toPrescription)
}

export async function getPrescription(actor: Actor, prescriptionId: string): Promise<Prescription> {
  const facts = await prescriptionRepository.findAccessFacts(actor.clinicId, prescriptionId)
  if (!facts) throw new NotFoundError('Prescription')
  await assertCan(actor, 'prescription:read', prescriptionResource(actor, facts))

  const prescription = await prescriptionRepository.findById(actor.clinicId, prescriptionId)
  if (!prescription) throw new NotFoundError('Prescription')
  return toPrescription(prescription)
}

/**
 * The printable copy (D8, P7), rendered on first request and then stored (ADR-0026).
 *
 * The end state is the one the queued job in section 13.5 would have produced — a file in the
 * store, its id on the prescription — so moving this to a worker later changes when it runs,
 * not what exists afterwards.
 */
export async function getPrescriptionPdf(
  actor: Actor,
  prescriptionId: string,
): Promise<DownloadLink> {
  const facts = await prescriptionRepository.findAccessFacts(actor.clinicId, prescriptionId)
  if (!facts) throw new NotFoundError('Prescription')
  await assertCan(actor, 'prescription:read', prescriptionResource(actor, facts))

  if (facts.pdfFileId) return getDownloadLink(actor, facts.pdfFileId)

  const prescription = await prescriptionRepository.findById(actor.clinicId, prescriptionId)
  if (!prescription) throw new NotFoundError('Prescription')
  const clinic = await getClinicLetterhead(actor.clinicId)

  const body = await renderPrescriptionPdf({
    clinicName: clinic.name,
    clinicContact: [clinic.phone, clinic.email].filter(Boolean).join('  ·  ') || null,
    number: prescription.number,
    issuedOn: localDateIn(clinic.timezone, prescription.issuedAt),
    validUntil: prescription.validUntil,
    patient: prescription.patient,
    doctor: prescription.doctor,
    notes: prescription.notes,
    items: prescription.items,
  })

  const file = await storeGeneratedFile({
    clinicId: actor.clinicId,
    ownerType: 'PRESCRIPTION',
    ownerId: prescription.id,
    patientId: prescription.patientId,
    category: 'PRESCRIPTION',
    fileName: `${prescription.number}.pdf`,
    mimeType: 'application/pdf',
    body,
    // A patient's own prescription is theirs to read (P7).
    isPatientVisible: true,
    generatedBy: { id: actor.userId, name: actor.displayName },
  })

  // Another request may have rendered it first; whichever id wins is the one that is served.
  const attached = await prescriptionRepository.attachPdf(actor.clinicId, prescriptionId, file.id)
  return getDownloadLink(actor, attached ?? file.id)
}
