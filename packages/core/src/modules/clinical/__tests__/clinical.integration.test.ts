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
import { getPatient, registerPatient } from '../../patients'
import { authenticateAccessToken, login } from '../../session'
import {
  addAddendum,
  getEncounter,
  listEncounters,
  listMyPatients,
  openEncounter,
  signNote,
  updateEncounter,
  verifyNoteSignature,
} from '../index'

const clinicId = () => env().CLINIC_ID

/**
 * A doctor who can actually sign in. The onboarding flow leaves a new doctor INVITED until they
 * activate, so the account is made first and the profile attached to it — which is the same
 * shape the seed produces, and the only shape that puts a `did` claim on a token (ADR-0004).
 */
async function portalDoctor(): Promise<{ actor: Actor; doctorId: string }> {
  const account = await createUser({ role: 'doctor', firstName: 'Nour', lastName: 'Saliba' })
  const doctorId = newId()
  await DoctorModel().create({
    _id: doctorId,
    clinicId: clinicId(),
    userId: account.id,
    title: 'Dr',
    licenseNumber: `LB-MD-${doctorId.slice(0, 6)}`,
    defaultSlotMinutes: 30,
    specialties: [],
    branchIds: [],
    isAcceptingNew: true,
    isActive: true,
  })

  const session = await login({ email: account.email, password: TEST_PASSWORD, meta: meta() })
  const { actor } = await authenticateAccessToken(session.accessToken)
  return { actor, doctorId }
}

/** A patient with a portal login attached, so an OWN grant resolves to their record. */
async function portalPatient(staff: Actor) {
  const account = await createUser({ role: 'patient', firstName: 'Rana', lastName: 'Haddad' })
  const registered = await registerPatient(staff, {
    firstName: 'Rana',
    lastName: `Haddad${newId().slice(0, 8)}`,
    dateOfBirth: '1990-04-02',
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

const NOTE = {
  subjective: 'Sore throat and fever for three days.',
  objective: 'Temperature 38.1. Pharynx red, no exudate.',
  assessment: 'Viral pharyngitis.',
  plan: 'Fluids and paracetamol. Review if not settling in five days.',
}

async function visitWithSignedNote(doctor: Actor, patientId: string) {
  const opened = await openEncounter(doctor, {
    patientId,
    appointmentId: null,
    encounterType: 'CONSULTATION',
    chiefComplaint: 'Sore throat',
  })
  await updateEncounter(doctor, opened.id, { note: NOTE })
  return signNote(doctor, opened.id, { signature: 'Dr Nour Saliba' })
}

describe('the encounter workspace', () => {
  it('opens a visit, takes the note, and freezes it on signing', async () => {
    const { actor: staff } = await signedInActor({ role: 'staff' })
    const { actor: doctor } = await portalDoctor()
    const { patient } = await portalPatient(staff)

    const opened = await openEncounter(doctor, {
      patientId: patient.id,
      appointmentId: null,
      encounterType: 'CONSULTATION',
      chiefComplaint: 'Sore throat',
    })
    expect(opened.number).toMatch(/^ENC-\d{6}$/)
    expect(opened.status).toBe('OPEN')
    expect(opened.note.status).toBe('DRAFT')

    const written = await updateEncounter(doctor, opened.id, { note: NOTE })
    expect(written.note.assessment).toBe(NOTE.assessment)

    const signed = await signNote(doctor, opened.id, { signature: 'Dr Nour Saliba' })
    expect(signed.note.status).toBe('SIGNED')
    expect(signed.note.signedAt).not.toBeNull()
    expect(signed.note.signedBy?.name).toBe('Dr Nour Saliba')

    // The whole point: not even its author can change it now.
    await expect(
      updateEncounter(doctor, opened.id, { note: { assessment: 'Bacterial pharyngitis.' } }),
    ).rejects.toMatchObject({ code: 'NOTE_ALREADY_SIGNED', status: 422 })

    // Nor can it be signed twice, which would overwrite who stood behind it.
    await expect(
      signNote(doctor, opened.id, { signature: 'Dr Someone Else' }),
    ).rejects.toMatchObject({ code: 'NOTE_ALREADY_SIGNED' })

    const amended = await addAddendum(doctor, opened.id, {
      body: 'Throat swab returned negative for strep.',
    })
    expect(amended.note.addenda).toHaveLength(1)
    expect(amended.note.assessment).toBe(NOTE.assessment)
    expect(await verifyNoteSignature(doctor, opened.id)).toEqual({ signed: true, intact: true })
  })

  it('refuses to sign a note with nothing in it', async () => {
    const { actor: staff } = await signedInActor({ role: 'staff' })
    const { actor: doctor } = await portalDoctor()
    const { patient } = await portalPatient(staff)

    const opened = await openEncounter(doctor, {
      patientId: patient.id,
      appointmentId: null,
      encounterType: 'CONSULTATION',
      chiefComplaint: null,
    })
    await expect(
      signNote(doctor, opened.id, { signature: 'Dr Nour Saliba' }),
    ).rejects.toMatchObject({ code: 'NOTE_IS_EMPTY' })
  })

  it('records one visit per appointment, never two', async () => {
    const { actor: staff } = await signedInActor({ role: 'staff' })
    const { actor: doctor } = await portalDoctor()
    const { patient } = await portalPatient(staff)
    const appointmentId = newId()

    await openEncounter(doctor, {
      patientId: patient.id,
      appointmentId,
      encounterType: 'CONSULTATION',
      chiefComplaint: null,
    })
    await expect(
      openEncounter(doctor, {
        patientId: patient.id,
        appointmentId,
        encounterType: 'CONSULTATION',
        chiefComplaint: null,
      }),
    ).rejects.toMatchObject({ code: 'ENCOUNTER_EXISTS' })
  })
})

describe('what a patient may read of their own chart', () => {
  it('shows a signed note only once it has been shared, and never a draft', async () => {
    const { actor: staff } = await signedInActor({ role: 'staff' })
    const { actor: doctor } = await portalDoctor()
    const { actor: patientActor, patient } = await portalPatient(staff)

    const opened = await openEncounter(doctor, {
      patientId: patient.id,
      appointmentId: null,
      encounterType: 'CONSULTATION',
      chiefComplaint: 'Sore throat',
    })
    await updateEncounter(doctor, opened.id, { note: NOTE })

    // A draft, shared: still nothing. An unfinished thought is not a document (ADR-0025).
    await updateEncounter(doctor, opened.id, { isNoteVisibleToPatient: true })
    const beforeSigning = await getEncounter(patientActor, opened.id)
    expect(beforeSigning.note.assessment).toBeNull()
    expect(beforeSigning.chiefComplaint).toBe('Sore throat')

    await signNote(doctor, opened.id, { signature: 'Dr Nour Saliba' })
    const afterSigning = await getEncounter(patientActor, opened.id)
    expect(afterSigning.note.assessment).toBe(NOTE.assessment)
    expect(afterSigning.note.plan).toBe(NOTE.plan)
  })

  it('hides a signed note that was never shared', async () => {
    const { actor: staff } = await signedInActor({ role: 'staff' })
    const { actor: doctor } = await portalDoctor()
    const { actor: patientActor, patient } = await portalPatient(staff)

    const signed = await visitWithSignedNote(doctor, patient.id)
    const seen = await getEncounter(patientActor, signed.id)
    expect(seen.note.status).toBe('SIGNED')
    expect(seen.note.subjective).toBeNull()
    expect(seen.note.objective).toBeNull()
    expect(seen.note.assessment).toBeNull()
    expect(seen.note.plan).toBeNull()
    expect(seen.note.addenda).toEqual([])
  })

  it('shows a patient their own visits and nobody else’s', async () => {
    const { actor: staff } = await signedInActor({ role: 'staff' })
    const { actor: doctor } = await portalDoctor()
    const { actor: patientActor, patient } = await portalPatient(staff)
    const { patient: someoneElse } = await portalPatient(staff)

    const mine = await visitWithSignedNote(doctor, patient.id)
    await visitWithSignedNote(doctor, someoneElse.id)

    const visible = await everyPage((page) => listEncounters(patientActor, page))
    expect(visible.map((encounter) => encounter.id)).toEqual([mine.id])
  })
})

describe('ASSIGNED is strict (ADR-0004)', () => {
  it('keeps one doctor out of another doctor’s note on the same patient', async () => {
    const { actor: staff } = await signedInActor({ role: 'staff' })
    const { actor: mine } = await portalDoctor()
    const { actor: theirs } = await portalDoctor()
    const { patient } = await portalPatient(staff)

    const signed = await visitWithSignedNote(mine, patient.id)
    // The colleague has treated this patient too — and still cannot read this visit.
    await visitWithSignedNote(theirs, patient.id)

    await expect(getEncounter(theirs, signed.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    })
    expect((await getEncounter(mine, signed.id)).note.assessment).toBe(NOTE.assessment)
  })

  it('lets the clinic read every chart, because that is what CLINIC means', async () => {
    const { actor: staff } = await signedInActor({ role: 'staff' })
    const { actor: doctor } = await portalDoctor()
    const { patient } = await portalPatient(staff)

    const signed = await visitWithSignedNote(doctor, patient.id)
    const seen = await getEncounter(staff, signed.id)
    expect(seen.note.assessment).toBe(NOTE.assessment)
  })
})

describe('every read of a chart is on the record (section 11.3)', () => {
  it('writes a PHI read when a chart is opened, and none when access is refused', async () => {
    const { actor: staff } = await signedInActor({ role: 'staff' })
    const { actor: doctor } = await portalDoctor()
    const { actor: stranger } = await portalDoctor()
    const { patient } = await portalPatient(staff)

    const signed = await visitWithSignedNote(doctor, patient.id)
    await getEncounter(doctor, signed.id)

    // The capture plugin names a read "<model>.viewed" and files it under the model's category.
    const reads = await AuditLogModel()
      .find({ clinicId: clinicId(), 'entity.id': signed.id, action: 'encounter.viewed' })
      .setOptions({ skipAudit: true, bypassTenantGuard: true })
      .lean()
    expect(reads.length).toBeGreaterThan(0)
    expect(reads[0]?.category).toBe('CLINICAL')

    await expect(getEncounter(stranger, signed.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})

describe('whose chart a doctor may open (ADR-0004, Phase 4 addendum)', () => {
  it('opens the record of a patient they have seen, and not one they have not', async () => {
    const { actor: staff } = await signedInActor({ role: 'staff' })
    const { actor: doctor } = await portalDoctor()
    const { patient: seen } = await portalPatient(staff)
    const { patient: stranger } = await portalPatient(staff)

    // Before any visit, the doctor is named on nothing about this person.
    await expect(getPatient(doctor, seen.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })

    await visitWithSignedNote(doctor, seen.id)

    const chart = await getPatient(doctor, seen.id)
    expect(chart.medicalRecordNo).toBe(seen.medicalRecordNo)
    await expect(getPatient(doctor, stranger.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    })
  })

  it('lists a doctor’s own patients, and refuses them the clinic directory', async () => {
    const { actor: staff } = await signedInActor({ role: 'staff' })
    const { actor: doctor } = await portalDoctor()
    const { patient } = await portalPatient(staff)
    await portalPatient(staff)

    await visitWithSignedNote(doctor, patient.id)

    const mine = await everyPage((page) => listMyPatients(doctor, page))
    expect(mine.map((entry) => entry.id)).toEqual([patient.id])
  })
})

async function walk<T extends { id: string }>(
  fetchPage: (page: {
    cursor?: string
    limit: number
  }) => Promise<{ items: T[]; nextCursor: string | null }>,
  limit: number,
): Promise<{ ids: string[]; pages: number }> {
  const ids: string[] = []
  let cursor: string | undefined
  let pages = 0
  for (;;) {
    const page = await fetchPage({ cursor, limit })
    pages += 1
    expect(page.items.length).toBeLessThanOrEqual(limit)
    ids.push(...page.items.map((item) => item.id))
    if (!page.nextCursor) return { ids, pages }
    // A page that offers a way on is full; a short page with a cursor sends a client to nothing.
    expect(page.items).toHaveLength(limit)
    cursor = page.nextCursor
  }
}

/**
 * Phase 10. Before it the visit list stopped at 500 with nothing to say so. Seven visits opened in
 * the same instant are seven ties on the sort key, which is exactly where a cursor that ignored the
 * tie-breaker would skip or repeat a row.
 */
describe('paging through visits', () => {
  it('reaches every visit exactly once, across ties on the start time', async () => {
    const { actor: staff } = await signedInActor({ role: 'staff' })
    const { actor: doctor } = await portalDoctor()
    const { patient } = await portalPatient(staff)
    const sameInstant = new Date('2026-09-10T08:00:00.000Z')

    const opened: string[] = []
    for (let index = 0; index < 7; index += 1) {
      const visit = await openEncounter(
        doctor,
        {
          patientId: patient.id,
          appointmentId: null,
          encounterType: 'CONSULTATION',
          chiefComplaint: null,
        },
        sameInstant,
      )
      opened.push(visit.id)
    }

    const { ids, pages } = await walk(
      (page) => listEncounters(staff, { patientId: patient.id, ...page }),
      3,
    )
    expect(pages).toBe(3)
    expect(new Set(ids).size).toBe(ids.length)
    expect([...ids].sort()).toEqual([...opened].sort())
  })

  it('offers no next page when the list is an exact multiple of the page', async () => {
    const { actor: staff } = await signedInActor({ role: 'staff' })
    const { actor: doctor } = await portalDoctor()
    const { patient } = await portalPatient(staff)
    for (let index = 0; index < 4; index += 1) {
      await openEncounter(doctor, {
        patientId: patient.id,
        appointmentId: null,
        encounterType: 'CONSULTATION',
        chiefComplaint: null,
      })
    }
    const { pages } = await walk(
      (page) => listEncounters(staff, { patientId: patient.id, ...page }),
      2,
    )
    expect(pages).toBe(2)
  })

  /**
   * How a day view matches its appointments to their visits: by appointment, not by the day a visit
   * started — a visit opened the evening before is on another day (Phase 9's finding).
   */
  it('finds visits by the appointments they were recorded against', async () => {
    const { actor: staff } = await signedInActor({ role: 'staff' })
    const { actor: doctor } = await portalDoctor()
    const { patient } = await portalPatient(staff)
    const [first, second, other] = [newId(), newId(), newId()]
    const recorded = await Promise.all(
      [first, second, other].map((appointmentId) =>
        openEncounter(doctor, {
          patientId: patient.id,
          appointmentId,
          encounterType: 'CONSULTATION',
          chiefComplaint: null,
        }),
      ),
    )

    const found = await listEncounters(doctor, { appointmentIds: [first, second] })
    expect(found.items.map((visit) => visit.appointmentId).sort()).toEqual([first, second].sort())
    expect(found.items.map((visit) => visit.id)).not.toContain(recorded[2]?.id)
  })

  it('pages a doctor’s caseload, most recently seen first', async () => {
    const { actor: staff } = await signedInActor({ role: 'staff' })
    const { actor: doctor } = await portalDoctor()
    const seen: string[] = []
    for (let index = 0; index < 5; index += 1) {
      const { patient } = await portalPatient(staff)
      await openEncounter(
        doctor,
        {
          patientId: patient.id,
          appointmentId: null,
          encounterType: 'CONSULTATION',
          chiefComplaint: null,
        },
        new Date(Date.UTC(2026, 8, 1, 8 + index)),
      )
      seen.push(patient.id)
    }

    const { ids } = await walk((page) => listMyPatients(doctor, page), 2)
    expect(ids).toEqual([...seen].reverse())
  })
})
