import { describe, expect, it } from 'vitest'
import { env } from '@clinic/config'
import { localDateIn } from '@clinic/contracts'
import { DoctorModel, newId } from '@clinic/db'
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
import { createService, getInvoice } from '../../billing'
import { openEncounter } from '../../clinical'
import { registerPatient } from '../../patients'
import { authenticateAccessToken, login } from '../../session'
import {
  acceptTreatmentPlan,
  addToothRecord,
  billPlanItem,
  cancelTreatmentPlan,
  completeToothRecord,
  createTreatmentPlan,
  getTreatmentPlan,
  listOverduePlans,
  listTreatmentPlans,
  listTreatments,
  presentTreatmentPlan,
  updateTreatment,
  updateTreatmentPlan,
  voidToothRecord,
} from '../index'

const clinicId = () => env().CLINIC_ID
const today = () => localDateIn('Asia/Beirut', new Date())

async function portalDoctor(): Promise<Actor> {
  const account = await createUser({ role: 'doctor', firstName: 'Rana', lastName: 'Haddad' })
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

async function newPatient(
  staff: Actor,
  phone = `+961 3 ${100000 + Math.floor(Math.random() * 900000)}`,
) {
  const registered = await registerPatient(staff, {
    firstName: 'Lina',
    lastName: `Khoury${newId().slice(0, 8)}`,
    dateOfBirth: '1979-06-02',
    gender: null,
    nationalId: null,
    bloodType: 'UNKNOWN',
    contact: { phone, email: null },
    address: { line1: null, city: null, country: null },
    emergencyContacts: [],
    adminNotes: null,
    duplicateOverride: null,
    inviteToPortal: false,
  })
  return registered.patient
}

/** Prices a treatment through the price list, or takes its price away (`price` null). */
async function priceTreatment(admin: Actor, code: string, price: string | null): Promise<string> {
  const treatment = (await listTreatments(admin)).find((candidate) => candidate.code === code)!
  const service =
    price === null
      ? null
      : await createService(admin, {
          name: `${treatment.name} ${newId().slice(0, 6)}`,
          description: null,
          price,
          taxRatePercent: '0',
          durationMinutes: 60,
          isActive: true,
        })
  await updateTreatment(admin, treatment.id, { ...treatment, serviceId: service?.id ?? null })
  return treatment.id
}

const plannedOn = async (actor: Actor, patientId: string, treatmentId: string, fdi: string) =>
  addToothRecord(actor, patientId, {
    teeth: [{ fdi, role: null }],
    surfaces: [],
    treatmentId,
    status: 'PLANNED',
    encounterId: null,
    performedOn: null,
    doctorId: null,
    notes: null,
  })

const done = { encounterId: null, performedOn: null, doctorId: null, notes: null }

describe('treatment plans', () => {
  it('prices a plan from the price list, follows the chart, and bills done work once', async () => {
    const { actor: admin } = await signedInActor({ role: 'admin' })
    const { actor: staff } = await signedInActor({ role: 'staff' })
    const doctor = await portalDoctor()
    const crownId = await priceTreatment(admin, 'CROWN_PFM', '420.00')
    const veneerId = await priceTreatment(admin, 'VENEER', null)

    const patient = await newPatient(staff)
    const encounter = await openEncounter(doctor, {
      patientId: patient.id,
      appointmentId: null,
      encounterType: 'PROCEDURE',
      chiefComplaint: 'Crown on the upper molar',
    })
    const crown = await plannedOn(doctor, patient.id, crownId, '16')
    const veneer = await plannedOn(doctor, patient.id, veneerId, '11')

    const input = {
      title: 'Upper restorations',
      phases: [{ name: 'Crown' }, { name: 'Veneer' }],
      items: [
        { toothRecordId: crown.id, phase: 0, quantity: null, unitPrice: null, discount: '20.00' },
        { toothRecordId: veneer.id, phase: 1, quantity: null, unitPrice: null, discount: '0' },
      ],
      notes: null,
    }
    // A veneer the clinic has no price for has to be priced by the plan.
    expect(await failureDetails(createTreatmentPlan(staff, patient.id, input))).toEqual([
      { field: 'items.1.unitPrice', issue: 'PRICE_REQUIRED' },
    ])

    input.items[1]!.unitPrice = '300.00' as never
    const plan = await createTreatmentPlan(staff, patient.id, input)
    expect(plan.status).toBe('DRAFT')
    expect(plan.items.map((item) => [item.description, item.gross, item.lineTotal])).toEqual([
      ['Porcelain-fused-to-metal crown — 16', '420.00', '400.00'],
      ['Veneer — 11', '300.00', '300.00'],
    ])
    expect([plan.subtotal, plan.discountTotal, plan.total, plan.remaining]).toEqual([
      '720.00',
      '20.00',
      '700.00',
      '700.00',
    ])

    await presentTreatmentPlan(doctor, plan.id)
    const agreed = await acceptTreatmentPlan(staff, plan.id, {
      signedBy: 'Lina Khoury',
      signatureFileId: null,
    })
    expect(agreed.status).toBe('ACCEPTED')
    expect(agreed.decision).toMatchObject({
      signedBy: 'Lina Khoury',
      recordedBy: { id: staff.userId },
    })

    // The crown is done in today's visit; the plan hears about it from the chart.
    const completion = await completeToothRecord(doctor, crown.id, {
      ...done,
      encounterId: encounter.id,
    })
    let now = await getTreatmentPlan(staff, plan.id)
    expect(now.status).toBe('ACCEPTED')
    expect(now.items[0]).toMatchObject({
      state: 'DONE',
      doneOn: today(),
      completedByRecordId: completion.id,
      completedInEncounterId: encounter.id,
    })
    expect(now.remaining).toBe('300.00')

    // Billed at the agreed price, discount and all — once.
    expect(
      await outcome(billPlanItem(doctor, plan.id, now.items[0]!.id, { encounterId: encounter.id })),
    ).toBe('FORBIDDEN')
    expect(
      await outcome(billPlanItem(staff, plan.id, now.items[1]!.id, { encounterId: encounter.id })),
    ).toBe('NOT_DONE')
    const bill = await billPlanItem(staff, plan.id, now.items[0]!.id, { encounterId: encounter.id })
    expect(bill.billed).toBe('400.00')
    const invoice = await getInvoice(staff, bill.invoiceId)
    expect(invoice.lines.at(-1)).toMatchObject({
      description: 'Porcelain-fused-to-metal crown — 16',
      unitPrice: '420.00',
      discount: '20.00',
      lineTotal: '400.00',
    })
    expect(
      await outcome(billPlanItem(staff, plan.id, now.items[0]!.id, { encounterId: encounter.id })),
    ).toBe('ALREADY_BILLED')
    now = await getTreatmentPlan(staff, plan.id)
    expect(now.items[0]!.billed).toMatchObject({ invoiceId: bill.invoiceId })

    // The last item done finishes the plan; voiding that work reopens it.
    const veneerDone = await completeToothRecord(doctor, veneer.id, done)
    expect((await getTreatmentPlan(staff, plan.id)).status).toBe('COMPLETED')
    await voidToothRecord(doctor, veneerDone.id, { reason: 'Charted on the wrong tooth.' })
    now = await getTreatmentPlan(staff, plan.id)
    expect(now.status).toBe('ACCEPTED')
    expect(now.items[1]!.state).toBe('OPEN')
  })

  it('takes only open planned work, and the same work into one agreed plan', async () => {
    const { actor: admin } = await signedInActor({ role: 'admin' })
    const { actor: staff } = await signedInActor({ role: 'staff' })
    const doctor = await portalDoctor()
    const crownId = await priceTreatment(admin, 'CROWN_PFM', '420.00')
    const patient = await newPatient(staff)
    await openEncounter(doctor, {
      patientId: patient.id,
      appointmentId: null,
      encounterType: 'PROCEDURE',
      chiefComplaint: 'Check-up',
    })
    const crown = await plannedOn(doctor, patient.id, crownId, '26')
    const existing = await addToothRecord(doctor, patient.id, {
      teeth: [{ fdi: '36', role: null }],
      surfaces: [],
      treatmentId: crownId,
      status: 'EXISTING',
      encounterId: null,
      performedOn: null,
      doctorId: null,
      notes: null,
    })
    const item = (toothRecordId: string, phase = 0) => ({
      toothRecordId,
      phase,
      quantity: null,
      unitPrice: null,
      discount: '0',
    })
    const plan = (items: Array<ReturnType<typeof item>>) => ({
      title: 'Option',
      phases: [{ name: 'All at once' }],
      items,
      notes: null,
    })

    expect(
      await failureDetails(
        createTreatmentPlan(
          staff,
          patient.id,
          plan([item(existing.id), item(crown.id, 3), item(crown.id)]),
        ),
      ),
    ).toEqual([
      { field: 'items.1.phase', issue: 'NO_SUCH_PHASE' },
      { field: 'items.2.toothRecordId', issue: 'DUPLICATE_ITEM' },
    ])
    expect(
      await failureDetails(createTreatmentPlan(staff, patient.id, plan([item(existing.id)]))),
    ).toEqual([{ field: 'items.0.toothRecordId', issue: 'NOT_PLANNED' }])

    // Two options for the same crown may be drafted; only one can be agreed to.
    const first = await createTreatmentPlan(staff, patient.id, plan([item(crown.id)]))
    const second = await createTreatmentPlan(staff, patient.id, plan([item(crown.id)]))
    await presentTreatmentPlan(staff, second.id)
    const edited = await updateTreatmentPlan(staff, second.id, {
      ...plan([item(crown.id)]),
      title: 'Option B',
    })
    expect([edited.status, edited.presentedAt]).toEqual(['DRAFT', null])

    await acceptTreatmentPlan(staff, first.id, { signedBy: 'Lina Khoury', signatureFileId: null })
    expect(
      await outcome(
        acceptTreatmentPlan(staff, second.id, { signedBy: 'L', signatureFileId: null }),
      ),
    ).toBe('ALREADY_AGREED')
    expect(await outcome(updateTreatmentPlan(staff, first.id, plan([item(crown.id)])))).toBe(
      'PLAN_STATE',
    )

    // Voiding the planned crown drops it; with nothing done, the plan is not "completed".
    await voidToothRecord(doctor, crown.id, { reason: 'Decided against a crown.' })
    const dropped = await getTreatmentPlan(staff, first.id)
    expect([dropped.status, dropped.items[0]!.state, dropped.progress]).toEqual([
      'ACCEPTED',
      'DROPPED',
      { done: 0, open: 0, dropped: 1 },
    ])
    const cancelled = await cancelTreatmentPlan(staff, first.id, { reason: 'Nothing left to do.' })
    expect(cancelled.cancelled).toMatchObject({ reason: 'Nothing left to do.' })

    const plans = await everyPage((page) => listTreatmentPlans(staff, patient.id, page))
    expect(plans.map((p) => p.status).sort()).toEqual(['CANCELLED', 'DRAFT'])
  })

  it('lists agreed plans left undone for the front desk to phone, and not for a doctor', async () => {
    const { actor: admin } = await signedInActor({ role: 'admin' })
    const { actor: staff } = await signedInActor({ role: 'staff' })
    const doctor = await portalDoctor()
    const crownId = await priceTreatment(admin, 'CROWN_PFM', '420.00')
    const patient = await newPatient(staff, '+961 3 555 010')
    await openEncounter(doctor, {
      patientId: patient.id,
      appointmentId: null,
      encounterType: 'PROCEDURE',
      chiefComplaint: 'Check-up',
    })
    const crown = await plannedOn(doctor, patient.id, crownId, '46')
    const plan = await createTreatmentPlan(staff, patient.id, {
      title: 'Crown on 46',
      phases: [{ name: 'Crown' }],
      items: [
        { toothRecordId: crown.id, phase: 0, quantity: null, unitPrice: null, discount: '0' },
      ],
      notes: null,
    })
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)
    await acceptTreatmentPlan(
      staff,
      plan.id,
      { signedBy: 'Lina Khoury', signatureFileId: null },
      sixtyDaysAgo,
    )

    const overdue = await everyPage((page) =>
      listOverduePlans(staff, { ...page, olderThanDays: 30, unbooked: true }),
    )
    expect(overdue.find((row) => row.planId === plan.id)).toMatchObject({
      title: 'Crown on 46',
      patient: { id: patient.id, phone: '+961 3 555 010' },
      openItems: 1,
      totalItems: 1,
      remaining: '420.00',
      nextAppointmentAt: null,
    })
    const recent = await everyPage((page) =>
      listOverduePlans(staff, { ...page, olderThanDays: 90, unbooked: true }),
    )
    expect(recent.some((row) => row.planId === plan.id)).toBe(false)

    // A doctor reads only their own patients' charts, so is not handed the clinic's recall list.
    expect(
      await outcome(listOverduePlans(doctor, { limit: 10, olderThanDays: 30, unbooked: true })),
    ).toBe('FORBIDDEN')
  })

  it('keeps plans from a patient, who does not hold the chart', async () => {
    const { actor: staff } = await signedInActor({ role: 'staff' })
    const { actor: patient } = await signedInActor({ role: 'patient' })
    const someone = await newPatient(staff)
    expect(await outcome(listTreatmentPlans(patient, someone.id, { limit: 10 }))).toBe('FORBIDDEN')
  })
})
