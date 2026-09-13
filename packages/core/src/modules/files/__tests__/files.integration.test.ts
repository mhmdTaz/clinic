import { describe, expect, it } from 'vitest'
import { env } from '@clinic/config'
import { AuditLogModel, DoctorModel, PatientModel, newId } from '@clinic/db'
import {
  TEST_PASSWORD,
  createUser,
  meta,
  signedInActor,
  everyPage,
} from '../../../../test/fixtures'
import type { Actor } from '../../access'
import { openEncounter } from '../../clinical'
import { registerPatient } from '../../patients'
import { authenticateAccessToken, login } from '../../session'
import {
  confirmUpload,
  deleteFile,
  getDownloadLink,
  listFiles,
  presignUpload,
  updateFile,
} from '../index'

const clinicId = () => env().CLINIC_ID
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x25, 0xc4, 0xe5])

async function portalPatient(staff: Actor) {
  const account = await createUser({ role: 'patient', firstName: 'Lina', lastName: 'Aoun' })
  const registered = await registerPatient(staff, {
    firstName: 'Lina',
    lastName: `Aoun${newId().slice(0, 8)}`,
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

async function portalDoctor(): Promise<Actor> {
  const account = await createUser({ role: 'doctor', firstName: 'Samir', lastName: 'Fares' })
  await DoctorModel().create({
    _id: newId(),
    clinicId: clinicId(),
    userId: account.id,
    title: 'Dr',
    defaultSlotMinutes: 30,
    specialties: [],
    branchIds: [],
    isAcceptingNew: true,
    isActive: true,
  })
  const session = await login({ email: account.email, password: TEST_PASSWORD, meta: meta() })
  return (await authenticateAccessToken(session.accessToken)).actor
}

/** The client's half of section 12.1: a PUT straight to storage, with the signed headers. */
async function uploadTo(url: string, headers: Record<string, string>): Promise<number> {
  const response = await fetch(url, { method: 'PUT', headers, body: PDF })
  return response.status
}

async function uploadedFile(
  actor: Actor,
  patientId: string,
  options: { isPatientVisible?: boolean; fileName?: string } = {},
) {
  const presigned = await presignUpload(actor, {
    ownerType: 'PATIENT',
    ownerId: patientId,
    category: 'LAB_RESULT',
    fileName: options.fileName ?? 'blood-panel.pdf',
    mimeType: 'application/pdf',
    sizeBytes: PDF.byteLength,
    isPatientVisible: options.isPatientVisible ?? false,
    description: null,
  })
  expect(await uploadTo(presigned.uploadUrl, presigned.headers)).toBe(200)
  return confirmUpload(actor, presigned.fileId, { checksumSha256: null })
}

describe('uploading a document', () => {
  it('hands out a presigned URL, takes the bytes, and confirms what storage actually holds', async () => {
    const { actor: staff } = await signedInActor({ role: 'staff' })
    const { patient } = await portalPatient(staff)

    const presigned = await presignUpload(staff, {
      ownerType: 'PATIENT',
      ownerId: patient.id,
      category: 'LAB_RESULT',
      fileName: 'Blood panel (March).pdf',
      mimeType: 'application/pdf',
      sizeBytes: PDF.byteLength,
      isPatientVisible: false,
      description: 'Full blood count',
    })
    expect(presigned.uploadUrl).toContain('clinics/')
    expect(presigned.headers['content-type']).toBe('application/pdf')

    // Nothing is downloadable while the upload is unconfirmed — there may be no bytes at all.
    await expect(getDownloadLink(staff, presigned.fileId)).rejects.toMatchObject({
      code: 'FILE_NOT_AVAILABLE',
    })

    expect(await uploadTo(presigned.uploadUrl, presigned.headers)).toBe(200)
    const confirmed = await confirmUpload(staff, presigned.fileId, { checksumSha256: null })

    expect(confirmed.status).toBe('CLEAN')
    // The local adapter scans nothing and says so, rather than claiming a clean bill of health.
    expect(confirmed.scanResult).toContain('no scanner configured')
    expect(confirmed.sizeBytes).toBe(PDF.byteLength)

    const link = await getDownloadLink(staff, presigned.fileId)
    expect(link.fileName).toBe('Blood panel (March).pdf')
    const fetched = await fetch(link.url)
    expect(fetched.status).toBe(200)
    expect(new Uint8Array(await fetched.arrayBuffer())).toEqual(PDF)
  })

  it('refuses to confirm an upload that never arrived', async () => {
    const { actor: staff } = await signedInActor({ role: 'staff' })
    const { patient } = await portalPatient(staff)

    const presigned = await presignUpload(staff, {
      ownerType: 'PATIENT',
      ownerId: patient.id,
      category: 'REFERRAL',
      fileName: 'nothing.pdf',
      mimeType: 'application/pdf',
      sizeBytes: PDF.byteLength,
      isPatientVisible: false,
      description: null,
    })
    await expect(
      confirmUpload(staff, presigned.fileId, { checksumSha256: null }),
    ).rejects.toMatchObject({ code: 'UPLOAD_NOT_FOUND' })
  })

  it('confirms once, and says so the second time', async () => {
    const { actor: staff } = await signedInActor({ role: 'staff' })
    const { patient } = await portalPatient(staff)
    const file = await uploadedFile(staff, patient.id)

    await expect(confirmUpload(staff, file.id, { checksumSha256: null })).rejects.toMatchObject({
      code: 'UPLOAD_ALREADY_CONFIRMED',
    })
  })

  /**
   * A presigned PUT does not bind the content type — storage takes whatever is sent, which was
   * tested rather than assumed. So the declaration is checked on confirm, against the bytes.
   */
  it('rejects a file that is not what it was uploaded as', async () => {
    const { actor: staff } = await signedInActor({ role: 'staff' })
    const { patient } = await portalPatient(staff)

    const presigned = await presignUpload(staff, {
      ownerType: 'PATIENT',
      ownerId: patient.id,
      category: 'IMAGING',
      fileName: 'scan.png',
      mimeType: 'image/png',
      sizeBytes: PDF.byteLength,
      isPatientVisible: false,
      description: null,
    })
    // Storage accepts the PUT: it has no opinion about what the bytes are.
    expect(await uploadTo(presigned.uploadUrl, presigned.headers)).toBe(200)

    await expect(
      confirmUpload(staff, presigned.fileId, { checksumSha256: null }),
    ).rejects.toMatchObject({ code: 'UPLOAD_REJECTED' })

    // And it is left marked, not merely unconfirmed: the difference matters to the sweep.
    const rejected = await AuditLogModel()
      .find({ clinicId: clinicId(), 'entity.id': presigned.fileId, action: 'file.rejected' })
      .setOptions({ skipAudit: true, bypassTenantGuard: true })
      .lean()
    expect(rejected).toHaveLength(1)
    await expect(getDownloadLink(staff, presigned.fileId)).rejects.toMatchObject({
      code: 'FILE_NOT_AVAILABLE',
    })
  })
})

describe('who can see a document', () => {
  it('shows a patient only what was shared with them', async () => {
    const { actor: staff } = await signedInActor({ role: 'staff' })
    const { actor: patientActor, patient } = await portalPatient(staff)

    const hidden = await uploadedFile(staff, patient.id, { fileName: 'internal-referral.pdf' })
    const shared = await uploadedFile(staff, patient.id, {
      isPatientVisible: true,
      fileName: 'blood-panel.pdf',
    })

    const vault = await everyPage((page) => listFiles(patientActor, page))
    expect(vault.map((file) => file.id)).toEqual([shared.id])

    // Named directly, an unshared document is still out of reach.
    await expect(getDownloadLink(patientActor, hidden.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    })
    expect((await getDownloadLink(patientActor, shared.id)).fileName).toBe('blood-panel.pdf')
  })

  it('keeps one patient out of another patient’s vault', async () => {
    const { actor: staff } = await signedInActor({ role: 'staff' })
    const { actor: patientActor } = await portalPatient(staff)
    const { patient: someoneElse } = await portalPatient(staff)

    const theirs = await uploadedFile(staff, someoneElse.id, { isPatientVisible: true })
    await expect(getDownloadLink(patientActor, theirs.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    expect(await listFiles(patientActor, {})).toEqual({ items: [], nextCursor: null })
  })

  it('records who downloaded what, and who shared it', async () => {
    const { actor: staff } = await signedInActor({ role: 'staff' })
    const { patient } = await portalPatient(staff)
    const file = await uploadedFile(staff, patient.id)

    await updateFile(staff, file.id, { isPatientVisible: true })
    await getDownloadLink(staff, file.id)

    const entries = await AuditLogModel()
      .find({ clinicId: clinicId(), 'entity.id': file.id })
      .setOptions({ skipAudit: true, bypassTenantGuard: true })
      .lean()
    const actions = entries.map((entry) => entry.action)
    expect(actions).toContain('file.uploaded')
    expect(actions).toContain('file.shared_with_patient')
    expect(actions).toContain('file.downloaded')
  })

  it('keeps a deleted document out of the vault without destroying it', async () => {
    const { actor: admin } = await signedInActor({ role: 'admin' })
    const { patient } = await portalPatient(admin)
    const file = await uploadedFile(admin, patient.id)

    await deleteFile(admin, file.id)
    expect(await listFiles(admin, { patientId: patient.id })).toEqual({
      items: [],
      nextCursor: null,
    })
  })
})

describe('a doctor reaching documents', () => {
  /**
   * A chart names the patient; a visit names itself. Both are ways of asking an ASSIGNED
   * question, and the encounter's own attachments must not need a patient id the screen
   * showing them does not have.
   */
  it('reaches the attachments on their own visit, and not on a colleague’s', async () => {
    const { actor: staff } = await signedInActor({ role: 'staff' })
    const mine = await portalDoctor()
    const theirs = await portalDoctor()
    const { patient } = await portalPatient(staff)

    const encounter = await openEncounter(mine, {
      patientId: patient.id,
      appointmentId: null,
      encounterType: 'CONSULTATION',
      chiefComplaint: null,
    })

    const presigned = await presignUpload(mine, {
      ownerType: 'ENCOUNTER',
      ownerId: encounter.id,
      category: 'LAB_RESULT',
      fileName: 'swab.pdf',
      mimeType: 'application/pdf',
      sizeBytes: PDF.byteLength,
      isPatientVisible: false,
      description: null,
    })
    expect(await uploadTo(presigned.uploadUrl, presigned.headers)).toBe(200)
    await confirmUpload(mine, presigned.fileId, { checksumSha256: null })

    const attached = await everyPage((page) =>
      listFiles(mine, { ownerType: 'ENCOUNTER', ownerId: encounter.id, ...page }),
    )
    expect(attached.map((file) => file.id)).toEqual([presigned.fileId])

    await expect(
      listFiles(theirs, { ownerType: 'ENCOUNTER', ownerId: encounter.id }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 })

    // And an unbounded question is still refused: a narrow grant cannot answer "everything".
    await expect(listFiles(mine, {})).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})
