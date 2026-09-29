import { describe, expect, it } from 'vitest'
import { env } from '@clinic/config'
import { localDateIn } from '@clinic/contracts'
import { DoctorModel, ToothRecordModel, newId } from '@clinic/db'
import {
  TEST_PASSWORD,
  createUser,
  everyPage,
  failureDetails,
  meta,
  outcome,
  signedInActor,
} from '../../../../test/fixtures'
import type { Actor } from '../../access'
import { openEncounter } from '../../clinical'
import { registerPatient } from '../../patients'
import { authenticateAccessToken, login } from '../../session'
import {
  addToothRecord,
  applyQuickPick,
  completeToothRecord,
  createQuickPick,
  getDentalChart,
  listQuickPicks,
  listToothRecords,
  listTreatments,
  setDentition,
  updateTreatment,
  voidToothRecord,
} from '../index'

const clinicId = () => env().CLINIC_ID
const today = () => localDateIn('Asia/Beirut', new Date())

async function portalDoctor(firstName = 'Nabil'): Promise<{ actor: Actor; doctorId: string }> {
  const account = await createUser({ role: 'doctor', firstName, lastName: 'Saad' })
  const doctorId = newId()
  await DoctorModel().create({
    _id: doctorId,
    clinicId: clinicId(),
    userId: account.id,
    title: 'Dr',
    licenseNumber: `LB-DDS-${doctorId.slice(0, 6)}`,
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

async function newPatient(staff: Actor) {
  const registered = await registerPatient(staff, {
    firstName: 'Karim',
    lastName: `Nassar${newId().slice(0, 8)}`,
    dateOfBirth: '1988-02-14',
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

async function visit(doctor: Actor, patientId: string) {
  return openEncounter(doctor, {
    patientId,
    appointmentId: null,
    encounterType: 'PROCEDURE',
    chiefComplaint: 'Broken front tooth',
  })
}

async function treatmentId(actor: Actor, code: string): Promise<string> {
  const found = (await listTreatments(actor)).find((treatment) => treatment.code === code)
  if (!found) throw new Error(`no treatment ${code}`)
  return found.id
}

const base = {
  surfaces: [] as Array<'M' | 'D' | 'O' | 'I' | 'B' | 'L'>,
  encounterId: null,
  performedOn: null,
  doctorId: null,
  notes: null,
}

describe('the tooth chart', () => {
  it('lets the front desk chart what the dentist did, and the dentist read it back next visit', async () => {
    const { actor: staff } = await signedInActor({ role: 'staff' })
    const { actor: doctor, doctorId } = await portalDoctor()
    const patient = await newPatient(staff)
    const encounter = await visit(doctor, patient.id)

    const crown = await addToothRecord(staff, patient.id, {
      ...base,
      teeth: [{ fdi: '11', role: null }],
      treatmentId: await treatmentId(staff, 'CROWN_ZIRCONIA'),
      status: 'COMPLETED',
      encounterId: encounter.id,
      notes: 'Zirconia crown after fracture. Shade A2.',
    })
    // The dentist is the visit's, even though the front desk typed it in.
    expect(crown.doctor?.id).toBe(doctorId)
    expect(crown.recordedBy?.id).toBe(staff.userId)
    expect(crown.performedOn).toBe(today())

    const chart = await getDentalChart(doctor, patient.id)
    expect(chart.dentition).toBe('PERMANENT')
    expect(chart.teeth).toHaveLength(32)
    const eleven = chart.teeth.find((tooth) => tooth.fdi === '11')!
    expect(eleven.marks).toMatchObject([{ symbol: 'CROWN', status: 'COMPLETED' }])
    expect(chart.lastCharted).toEqual({
      performedOn: today(),
      encounterId: encounter.id,
      teeth: ['11'],
    })

    const timeline = await listToothRecords(doctor, patient.id, { tooth: '11', limit: 25 })
    expect(timeline.items.map((record) => record.notes)).toEqual([
      'Zirconia crown after fracture. Shade A2.',
    ])
  })

  it('carries out a plan once, and keeps both rows', async () => {
    const { actor: staff } = await signedInActor({ role: 'staff' })
    const { actor: doctor } = await portalDoctor()
    const patient = await newPatient(staff)
    await visit(doctor, patient.id)

    const plan = await addToothRecord(doctor, patient.id, {
      ...base,
      teeth: [{ fdi: '16', role: null }],
      treatmentId: await treatmentId(doctor, 'CROWN_PFM'),
      status: 'PLANNED',
    })
    const done = await completeToothRecord(doctor, plan.id, {
      encounterId: null,
      performedOn: null,
      doctorId: null,
      notes: 'Fitted.',
    })
    expect(done).toMatchObject({ status: 'COMPLETED', completesRecordId: plan.id })

    expect(
      await outcome(
        completeToothRecord(doctor, plan.id, {
          encounterId: null,
          performedOn: null,
          doctorId: null,
          notes: null,
        }),
      ),
    ).toBe('ALREADY_COMPLETED')

    const rows = await everyPage((page) =>
      listToothRecords(doctor, patient.id, { ...page, tooth: '16' }),
    )
    expect(rows.find((row) => row.id === plan.id)?.completedByRecordId).toBe(done.id)

    const chart = await getDentalChart(doctor, patient.id)
    const sixteen = chart.teeth.find((tooth) => tooth.fdi === '16')!
    expect(sixteen.marks.map((mark) => mark.status)).toEqual(['COMPLETED'])
  })

  it('voids a mistake once, and leaves it out of the picture but on the record', async () => {
    const { actor: staff } = await signedInActor({ role: 'staff' })
    const patient = await newPatient(staff)
    const wrong = await addToothRecord(staff, patient.id, {
      ...base,
      teeth: [{ fdi: '26', role: null }],
      surfaces: ['O'],
      treatmentId: await treatmentId(staff, 'CARIES'),
      status: 'CONDITION',
    })
    const voided = await voidToothRecord(staff, wrong.id, { reason: 'Charted on 26, meant 27.' })
    expect(voided.voided).toMatchObject({ reason: 'Charted on 26, meant 27.' })
    expect(await outcome(voidToothRecord(staff, wrong.id, { reason: 'Again.' }))).toBe(
      'RECORD_VOIDED',
    )

    const chart = await getDentalChart(staff, patient.id)
    expect(chart.teeth.find((tooth) => tooth.fdi === '26')!.marks).toEqual([])
    const all = await listToothRecords(staff, patient.id, { includeVoided: true, limit: 25 })
    expect(all.items.map((row) => row.id)).toContain(wrong.id)
    const live = await listToothRecords(staff, patient.id, { limit: 25 })
    expect(live.items.map((row) => row.id)).not.toContain(wrong.id)
  })

  it('refuses rows that make no sense, naming the field', async () => {
    const { actor: staff } = await signedInActor({ role: 'staff' })
    const { actor: doctor } = await portalDoctor()
    const patient = await newPatient(staff)
    const other = await newPatient(staff)
    const othersVisit = await visit(doctor, other.id)
    const filling = await treatmentId(staff, 'FILLING_COMPOSITE')

    expect(
      await failureDetails(
        addToothRecord(staff, patient.id, {
          ...base,
          teeth: [{ fdi: '11', role: null }],
          surfaces: ['O'],
          treatmentId: filling,
          status: 'COMPLETED',
        }),
      ),
    ).toEqual([{ field: 'surfaces', issue: 'NO_OCCLUSAL_ON_FRONT_TOOTH' }])

    expect(
      await failureDetails(
        addToothRecord(staff, patient.id, {
          ...base,
          teeth: [{ fdi: '55', role: null }],
          surfaces: ['O'],
          treatmentId: filling,
          status: 'COMPLETED',
        }),
      ),
    ).toEqual([{ field: 'teeth', issue: 'NOT_IN_DENTITION' }])

    expect(
      await failureDetails(
        addToothRecord(staff, patient.id, {
          ...base,
          teeth: [{ fdi: '36', role: null }],
          surfaces: ['O'],
          treatmentId: filling,
          status: 'COMPLETED',
          encounterId: othersVisit.id,
        }),
      ),
    ).toEqual([{ field: 'encounterId', issue: 'NOT_THIS_PATIENTS_VISIT' }])

    expect(
      await failureDetails(
        addToothRecord(staff, patient.id, {
          ...base,
          teeth: [{ fdi: '36', role: null }],
          surfaces: ['O'],
          treatmentId: filling,
          status: 'COMPLETED',
          performedOn: '2999-01-01',
        }),
      ),
    ).toEqual([{ field: 'performedOn', issue: 'IN_THE_FUTURE' }])
  })

  it('opens the chart to a dentist who has treated the patient, and to nobody else', async () => {
    const { actor: staff } = await signedInActor({ role: 'staff' })
    const { actor: treating } = await portalDoctor('Nabil')
    const { actor: stranger } = await portalDoctor('Hadi')
    const { actor: patientActor } = await signedInActor({ role: 'patient' })
    const patient = await newPatient(staff)
    await visit(treating, patient.id)

    expect(await outcome(getDentalChart(treating, patient.id))).toBe('RESOLVED')
    expect(await outcome(getDentalChart(stranger, patient.id))).toBe('FORBIDDEN')
    // The portal chart is a later phase: a patient holds no dental grant yet.
    expect(await outcome(getDentalChart(patientActor, patient.id))).toBe('FORBIDDEN')
  })

  it('applies a quick-pick as one write, or not at all', async () => {
    const { actor: admin } = await signedInActor({ role: 'admin' })
    const { actor: staff } = await signedInActor({ role: 'staff' })
    const patient = await newPatient(staff)
    const pick = await createQuickPick(admin, {
      name: `RCT and crown ${newId().slice(0, 4)}`,
      items: [
        { treatmentId: await treatmentId(admin, 'ROOT_CANAL'), surfaces: [], status: 'COMPLETED' },
        {
          treatmentId: await treatmentId(admin, 'CROWN_ZIRCONIA'),
          surfaces: [],
          status: 'PLANNED',
        },
      ],
      sortOrder: 0,
      isActive: true,
    })
    expect((await listQuickPicks(staff)).map((p) => p.id)).toContain(pick.id)

    const rows = await applyQuickPick(staff, patient.id, pick.id, {
      teeth: [{ fdi: '46', role: null }],
      encounterId: null,
      performedOn: null,
      doctorId: null,
      notes: null,
    })
    expect(rows.map((row) => [row.treatment.code, row.status])).toEqual([
      ['ROOT_CANAL', 'COMPLETED'],
      ['CROWN_ZIRCONIA', 'PLANNED'],
    ])

    // A tooth-level preset on two teeth is refused before anything is written.
    const before = await ToothRecordModel()
      .countDocuments({ clinicId: clinicId(), patientId: patient.id })
      .setOptions({ skipAudit: true })
    expect(
      await outcome(
        applyQuickPick(staff, patient.id, pick.id, {
          teeth: [
            { fdi: '36', role: null },
            { fdi: '37', role: null },
          ],
          encounterId: null,
          performedOn: null,
          doctorId: null,
          notes: null,
        }),
      ),
    ).toBe('VALIDATION_FAILED')
    const after = await ToothRecordModel()
      .countDocuments({ clinicId: clinicId(), patientId: patient.id })
      .setOptions({ skipAudit: true })
    expect(after).toBe(before)
  })

  it('draws a child’s teeth, and both sets while they change over', async () => {
    const { actor: staff } = await signedInActor({ role: 'staff' })
    const patient = await newPatient(staff)
    const mixed = await setDentition(staff, patient.id, { dentition: 'MIXED' })
    expect(mixed.dentition).toBe('MIXED')
    expect(mixed.teeth).toHaveLength(52)

    const sealed = await addToothRecord(staff, patient.id, {
      ...base,
      teeth: [{ fdi: '75', role: null }],
      surfaces: ['O'],
      treatmentId: await treatmentId(staff, 'SEALANT'),
      status: 'COMPLETED',
    })
    expect(sealed.teeth).toEqual([{ fdi: '75', role: null }])
  })

  it('keeps what a treatment draws fixed once it exists', async () => {
    const { actor: admin } = await signedInActor({ role: 'admin' })
    const crown = (await listTreatments(admin)).find((t) => t.code === 'CROWN_ZIRCONIA')!
    expect(
      await failureDetails(updateTreatment(admin, crown.id, { ...crown, symbol: 'VENEER' })),
    ).toEqual([{ field: 'symbol', issue: 'FIXED' }])

    const renamed = await updateTreatment(admin, crown.id, {
      ...crown,
      name: 'Zirconia crown (monolithic)',
    })
    expect(renamed.name).toBe('Zirconia crown (monolithic)')
    await updateTreatment(admin, crown.id, { ...crown })
  })
})
