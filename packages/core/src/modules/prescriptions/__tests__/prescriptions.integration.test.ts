import { describe, expect, it } from 'vitest'
import { env } from '@clinic/config'
import { DoctorModel, PatientModel, newId } from '@clinic/db'
import {
  TEST_PASSWORD,
  createUser,
  meta,
  signedInActor,
  everyPage,
} from '../../../../test/fixtures'
import type { Actor } from '../../access'
import { openEncounter, signNote, updateEncounter } from '../../clinical'
import { registerPatient } from '../../patients'
import { authenticateAccessToken, login } from '../../session'
import { getPrescription, getPrescriptionPdf, issuePrescription, listPrescriptions } from '../index'

const clinicId = () => env().CLINIC_ID

async function portalDoctor(): Promise<Actor> {
  const account = await createUser({ role: 'doctor', firstName: 'Karim', lastName: 'Chami' })
  await DoctorModel().create({
    _id: newId(),
    clinicId: clinicId(),
    userId: account.id,
    title: 'Dr',
    licenseNumber: 'LB-MD-55501',
    defaultSlotMinutes: 30,
    specialties: [],
    branchIds: [],
    isAcceptingNew: true,
    isActive: true,
  })
  const session = await login({ email: account.email, password: TEST_PASSWORD, meta: meta() })
  return (await authenticateAccessToken(session.accessToken)).actor
}

async function portalPatient(staff: Actor) {
  const account = await createUser({ role: 'patient', firstName: 'Maya', lastName: 'Rizk' })
  const registered = await registerPatient(staff, {
    firstName: 'Maya',
    lastName: `Rizk${newId().slice(0, 8)}`,
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
  await PatientModel()
    .updateOne(
      { _id: registered.patient.id, clinicId: clinicId() },
      { $set: { userId: account.id } },
    )
    .setOptions({ skipAudit: true })
  const session = await login({ email: account.email, password: TEST_PASSWORD, meta: meta() })
  const { actor } = await authenticateAccessToken(session.accessToken)
  return { actor, patient: registered.patient }
}

const ITEM = {
  drugName: 'Amoxicillin',
  strength: '500 mg',
  form: 'capsule',
  dosage: 'One capsule',
  frequency: 'Three times a day',
  durationDays: 7,
  quantity: 21,
  instructions: 'Take with food.',
  isRefillable: false,
}

async function signedVisit(doctor: Actor, patientId: string) {
  const opened = await openEncounter(doctor, {
    patientId,
    appointmentId: null,
    encounterType: 'CONSULTATION',
    chiefComplaint: 'Chest infection',
  })
  await updateEncounter(doctor, opened.id, {
    note: { subjective: 'Productive cough.', objective: null, assessment: null, plan: null },
  })
  await signNote(doctor, opened.id, { signature: 'Dr Karim Chami' })
  return opened.id
}

describe('prescribing', () => {
  it('writes a prescription against the visit, and prints it on request', async () => {
    const { actor: staff } = await signedInActor({ role: 'staff' })
    const doctor = await portalDoctor()
    const { actor: patientActor, patient } = await portalPatient(staff)
    const encounterId = await signedVisit(doctor, patient.id)

    const issued = await issuePrescription(doctor, encounterId, {
      items: [ITEM],
      validUntil: '2027-01-31',
      notes: 'Complete the course.',
    })
    expect(issued.number).toMatch(/^RX-\d{6}$/)
    expect(issued.items).toHaveLength(1)
    expect(issued.doctor.licenseNumber).toBe('LB-MD-55501')
    // Nothing is rendered until someone asks for it (ADR-0026).
    expect(issued.pdfFileId).toBeNull()

    const link = await getPrescriptionPdf(doctor, issued.id)
    const downloaded = await fetch(link.url)
    expect(downloaded.status).toBe(200)
    const bytes = new Uint8Array(await downloaded.arrayBuffer())
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-')
    expect(link.fileName).toBe(`${issued.number}.pdf`)

    // Rendered once: a second request serves the file that already exists.
    expect((await getPrescription(doctor, issued.id)).pdfFileId).not.toBeNull()
    const again = await getPrescriptionPdf(doctor, issued.id)
    expect(again.fileName).toBe(link.fileName)

    // And it is the patient's own document to read (P7).
    const mine = await everyPage((page) => listPrescriptions(patientActor, page))
    expect(mine.map((prescription) => prescription.id)).toEqual([issued.id])
    expect((await getPrescriptionPdf(patientActor, issued.id)).fileName).toBe(link.fileName)
  })

  it('keeps a prescription away from a patient it was not written for', async () => {
    const { actor: staff } = await signedInActor({ role: 'staff' })
    const doctor = await portalDoctor()
    const { patient } = await portalPatient(staff)
    const { actor: someoneElse } = await portalPatient(staff)

    const encounterId = await signedVisit(doctor, patient.id)
    const issued = await issuePrescription(doctor, encounterId, {
      items: [ITEM],
      validUntil: null,
      notes: null,
    })

    await expect(getPrescription(someoneElse, issued.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    })
    expect(await listPrescriptions(someoneElse, {})).toEqual({ items: [], nextCursor: null })
  })

  it('lists only what a patient is still meant to be taking', async () => {
    const { actor: staff } = await signedInActor({ role: 'staff' })
    const doctor = await portalDoctor()
    const { actor: patientActor, patient } = await portalPatient(staff)
    const encounterId = await signedVisit(doctor, patient.id)

    const expired = await issuePrescription(doctor, encounterId, {
      items: [ITEM],
      validUntil: '2020-01-01',
      notes: null,
    })
    const current = await issuePrescription(doctor, encounterId, {
      items: [ITEM],
      validUntil: null,
      notes: null,
    })

    const active = await everyPage((page) =>
      listPrescriptions(patientActor, { active: true, ...page }),
    )
    expect(active.map((prescription) => prescription.id)).toEqual([current.id])
    const all = await everyPage((page) => listPrescriptions(patientActor, page))
    expect(all.map((prescription) => prescription.id).sort()).toEqual(
      [expired.id, current.id].sort(),
    )
  })
})
