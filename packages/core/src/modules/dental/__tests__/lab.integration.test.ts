import { describe, expect, it } from 'vitest'
import { env } from '@clinic/config'
import { localDateIn } from '@clinic/contracts'
import { ClinicModel, DoctorModel, newId } from '@clinic/db'
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
  changeLabOrderStatus,
  createLabOrder,
  labWorkAtLabFor,
  listLabOrders,
  listPatientLabOrders,
  listTreatments,
  openLabOrdersFor,
  setVoiceCharting,
  voidToothRecord,
} from '../index'

const clinicId = () => env().CLINIC_ID
const today = () => localDateIn('Asia/Beirut', new Date())
const shift = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)

async function portalDoctor(): Promise<Actor> {
  const account = await createUser({ role: 'doctor', firstName: 'Hadi', lastName: 'Nasr' })
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
  return (await authenticateAccessToken(session.accessToken)).actor
}

async function newPatient(staff: Actor) {
  const registered = await registerPatient(staff, {
    firstName: 'Maya',
    lastName: `Sfeir${newId().slice(0, 8)}`,
    dateOfBirth: '1990-01-20',
    gender: null,
    nationalId: null,
    bloodType: 'UNKNOWN',
    contact: { phone: `+961 70 ${100000 + Math.floor(Math.random() * 900000)}`, email: null },
    address: { line1: null, city: null, country: null },
    emergencyContacts: [],
    adminNotes: null,
    duplicateOverride: null,
    inviteToPortal: false,
  })
  return registered.patient
}

async function plannedCrown(doctor: Actor, patientId: string, fdi: string) {
  const crown = (await listTreatments(doctor)).find((t) => t.code === 'CROWN_ZIRCONIA')!
  return addToothRecord(doctor, patientId, {
    teeth: [{ fdi, role: null }],
    surfaces: [],
    treatmentId: crown.id,
    status: 'PLANNED',
    encounterId: null,
    performedOn: null,
    doctorId: null,
    notes: null,
  })
}

describe('lab work', () => {
  it('goes to the lab, comes back, is sent back once, and is fitted — all on the record', async () => {
    const { actor: staff } = await signedInActor({ role: 'staff' })
    const doctor = await portalDoctor()
    const patient = await newPatient(staff)
    await openEncounter(doctor, {
      patientId: patient.id,
      appointmentId: null,
      encounterType: 'PROCEDURE',
      chiefComplaint: 'Crown preparation',
    })
    const crown = await plannedCrown(doctor, patient.id, '16')

    const order = await createLabOrder(staff, patient.id, {
      toothRecordIds: [crown.id],
      labName: 'Beirut Dental Lab',
      sentOn: null,
      dueOn: shift(today(), 7),
      notes: 'Shade A2, monolithic.',
    })
    expect(order).toMatchObject({
      status: 'SENT',
      sentOn: today(),
      teeth: ['16'],
      work: [{ name: 'Zirconia crown', symbol: 'CROWN' }],
      overdue: false,
    })
    expect((await openLabOrdersFor(doctor, patient.id)).map((o) => o.id)).toEqual([order.id])
    expect((await labWorkAtLabFor(clinicId(), [patient.id])).map((o) => o.id)).toEqual([order.id])

    // Fitted before it came back is not a thing.
    expect(
      await outcome(
        changeLabOrderStatus(staff, order.id, { status: 'FITTED', dueOn: null, note: null }),
      ),
    ).toBe('LAB_ORDER_STATE')
    await changeLabOrderStatus(staff, order.id, { status: 'RECEIVED', dueOn: null, note: null })
    expect(await labWorkAtLabFor(clinicId(), [patient.id])).toEqual([])

    // It does not fit: back to the lab, with the new date the lab gave.
    expect(
      await failureDetails(
        changeLabOrderStatus(staff, order.id, { status: 'REMAKE', dueOn: null, note: null }),
      ),
    ).toEqual([{ field: 'dueOn', issue: 'REQUIRED' }])
    const remade = await changeLabOrderStatus(staff, order.id, {
      status: 'REMAKE',
      dueOn: shift(today(), 5),
      note: 'Contact too tight on the mesial.',
    })
    expect([remade.status, remade.dueOn]).toEqual(['REMAKE', shift(today(), 5)])

    await changeLabOrderStatus(staff, order.id, { status: 'RECEIVED', dueOn: null, note: null })
    const fitted = await changeLabOrderStatus(doctor, order.id, {
      status: 'FITTED',
      dueOn: null,
      note: null,
    })
    expect(fitted.history.map((entry) => entry.status)).toEqual([
      'SENT',
      'RECEIVED',
      'REMAKE',
      'RECEIVED',
      'FITTED',
    ])
    expect(await openLabOrdersFor(staff, patient.id)).toEqual([])
    const all = await everyPage((page) => listPatientLabOrders(staff, patient.id, page))
    expect(all.map((o) => o.status)).toEqual(['FITTED'])
  })

  it('is sent only for live work on this patient’s chart, and due after it was sent', async () => {
    const { actor: staff } = await signedInActor({ role: 'staff' })
    const doctor = await portalDoctor()
    const patient = await newPatient(staff)
    const other = await newPatient(staff)
    await openEncounter(doctor, {
      patientId: patient.id,
      appointmentId: null,
      encounterType: 'PROCEDURE',
      chiefComplaint: 'Check-up',
    })
    await openEncounter(doctor, {
      patientId: other.id,
      appointmentId: null,
      encounterType: 'PROCEDURE',
      chiefComplaint: 'Check-up',
    })
    const theirs = await plannedCrown(doctor, other.id, '26')
    const voided = await plannedCrown(doctor, patient.id, '36')
    await voidToothRecord(doctor, voided.id, { reason: 'Wrong tooth.' })

    expect(
      await failureDetails(
        createLabOrder(staff, patient.id, {
          toothRecordIds: [theirs.id, voided.id],
          labName: 'Lab',
          sentOn: shift(today(), 1),
          dueOn: today(),
          notes: null,
        }),
      ),
    ).toEqual([
      { field: 'sentOn', issue: 'IN_THE_FUTURE' },
      { field: 'dueOn', issue: 'BEFORE_SENT' },
      { field: 'toothRecordIds.0', issue: 'NOT_FOUND' },
      { field: 'toothRecordIds.1', issue: 'NOT_LAB_WORK' },
    ])
  })

  it('shows late work on the clinic’s board, to the front desk and not to a doctor', async () => {
    const { actor: staff } = await signedInActor({ role: 'staff' })
    const doctor = await portalDoctor()
    const patient = await newPatient(staff)
    await openEncounter(doctor, {
      patientId: patient.id,
      appointmentId: null,
      encounterType: 'PROCEDURE',
      chiefComplaint: 'Crown preparation',
    })
    const crown = await plannedCrown(doctor, patient.id, '46')
    const late = await createLabOrder(staff, patient.id, {
      toothRecordIds: [crown.id],
      labName: 'Slow Lab',
      sentOn: shift(today(), -10),
      dueOn: shift(today(), -2),
      notes: null,
    })
    expect(late.overdue).toBe(true)

    const board = await everyPage((page) => listLabOrders(staff, { ...page, overdue: true }))
    expect(board.find((o) => o.id === late.id)).toMatchObject({
      labName: 'Slow Lab',
      overdue: true,
    })
    expect(await outcome(listLabOrders(doctor, { limit: 10 }))).toBe('FORBIDDEN')

    const cancelled = await changeLabOrderStatus(staff, late.id, {
      status: 'CANCELLED',
      dueOn: null,
      note: 'Patient moved abroad.',
    })
    expect([cancelled.status, cancelled.overdue]).toEqual(['CANCELLED', false])
  })
})

describe('voice charting', () => {
  it('is turned on only by someone who has acknowledged where the audio goes', async () => {
    const { actor: admin } = await signedInActor({ role: 'admin' })
    const { actor: staff } = await signedInActor({ role: 'staff' })

    expect(
      await failureDetails(setVoiceCharting(admin, { enabled: true, acknowledged: false })),
    ).toEqual([{ field: 'acknowledged', issue: 'REQUIRED' }])
    expect(await outcome(setVoiceCharting(staff, { enabled: true, acknowledged: true }))).toBe(
      'FORBIDDEN',
    )

    await setVoiceCharting(admin, { enabled: true, acknowledged: true })
    let clinic = await ClinicModel().findById(clinicId()).lean()
    expect((clinic?.featureFlags as Record<string, boolean> | undefined)?.dentalVoice).toBe(true)

    await setVoiceCharting(admin, { enabled: false, acknowledged: false })
    clinic = await ClinicModel().findById(clinicId()).lean()
    expect((clinic?.featureFlags as Record<string, boolean> | undefined)?.dentalVoice).toBe(false)
  })
})
