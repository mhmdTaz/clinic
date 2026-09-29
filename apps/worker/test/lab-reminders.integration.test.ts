import { beforeAll, describe, expect, it } from 'vitest'
import { env } from '@clinic/config'
import {
  AppointmentModel,
  ClinicModel,
  DoctorModel,
  LabOrderModel,
  NotificationModel,
  PatientModel,
  RoleModel,
  UserModel,
  newId,
} from '@clinic/db'
import { sweepLabReminders } from '../src/jobs/lab-reminders'

/**
 * Phase 13: the front desk hears, a day ahead, about lab work that is not back for a patient who
 * is coming in — once, however often the sweep runs — and a doctor who reads only their own
 * patients' charts does not.
 */

const clinicId = () => env().CLINIC_ID

let sequence = 300_000
const nextNumber = (prefix: string) => `${prefix}-${(sequence += 1)}`

let deskUserId = ''
let doctorUserId = ''
let patientId = ''
let doctorId = ''

async function member(key: string, grants: Array<{ key: string; scope: string }>) {
  await RoleModel().findOneAndUpdate(
    { clinicId: clinicId(), key },
    {
      $set: { name: key, priority: 50, isSystem: false, isDefault: false, permissions: grants },
      $setOnInsert: { _id: newId(), clinicId: clinicId(), key },
    },
    { upsert: true },
  )
  const role = await RoleModel().findOne({ clinicId: clinicId(), key }).lean()
  const userId = newId()
  await UserModel().create({
    _id: userId,
    clinicId: clinicId(),
    email: `lab-${key}-${userId.slice(0, 8)}@clinic.local`,
    firstName: key,
    lastName: 'Person',
    status: 'ACTIVE',
    roles: [{ roleId: role!._id }],
    passwordHash: 'x',
  })
  return userId
}

beforeAll(async () => {
  await ClinicModel().findOneAndUpdate(
    { _id: clinicId() },
    {
      $set: {
        name: 'Lab Clinic',
        timezone: 'Asia/Beirut',
        currency: 'USD',
        locale: 'en',
        isActive: true,
        'featureFlags.dental': true,
        'featureFlags.labOrders': true,
      },
      $setOnInsert: { permissionVersion: 1, branches: [], holidays: [] },
    },
    { upsert: true },
  )
  deskUserId = await member('lab-desk', [{ key: 'dental:write', scope: 'CLINIC' }])
  doctorUserId = await member('lab-dentist', [{ key: 'dental:write', scope: 'ASSIGNED' }])

  patientId = newId()
  await PatientModel().create({
    _id: patientId,
    clinicId: clinicId(),
    medicalRecordNo: nextNumber('MRN'),
    firstName: 'Omar',
    lastName: 'Haddad',
    bloodType: 'UNKNOWN',
    isActive: true,
  })
  doctorId = newId()
  await DoctorModel().create({
    _id: doctorId,
    clinicId: clinicId(),
    userId: newId(),
    title: 'Dr',
    defaultSlotMinutes: 30,
    specialties: [],
    branchIds: [],
    isAcceptingNew: true,
    isActive: true,
  })
})

async function appointmentAt(startsAt: Date): Promise<string> {
  const id = newId()
  await AppointmentModel().create({
    _id: id,
    clinicId: clinicId(),
    number: nextNumber('APT'),
    patientId,
    doctorId,
    patient: { name: 'Omar Haddad', medicalRecordNo: 'MRN-300000', phone: null },
    doctor: { name: 'Dr Nabil Saad' },
    startsAt,
    endsAt: new Date(startsAt.getTime() + 30 * 60_000),
    durationMinutes: 30,
    status: 'SCHEDULED',
    source: 'STAFF',
  })
  return id
}

async function orderAtLab(status: 'SENT' | 'RECEIVED' = 'SENT'): Promise<string> {
  const id = newId()
  await LabOrderModel().create({
    _id: id,
    clinicId: clinicId(),
    patientId,
    patient: { name: 'Omar Haddad', medicalRecordNo: 'MRN-300000' },
    toothRecordIds: [newId()],
    teeth: ['16'],
    work: [{ name: 'Zirconia crown', symbol: 'CROWN' }],
    labName: 'Beirut Dental Lab',
    sentOn: '2027-06-01',
    dueOn: '2027-06-10',
    status,
    history: [{ status, at: new Date(), by: null, note: null, dueOn: '2027-06-10' }],
  })
  return id
}

const noticesFor = (orderId: string, userId?: string) =>
  NotificationModel().countDocuments({
    clinicId: clinicId(),
    type: 'LAB_WORK_LATE',
    'entity.id': orderId,
    ...(userId ? { userId } : {}),
  })

describe('late lab work', () => {
  it('tells the front desk a day ahead, once, and not a doctor', async () => {
    const startsAt = new Date('2027-06-15T08:00:00Z')
    await appointmentAt(startsAt)
    const order = await orderAtLab()
    const dayBefore = new Date(startsAt.getTime() - 24 * 3_600_000)

    const first = await sweepLabReminders(dayBefore)
    expect(first.sent).toBeGreaterThanOrEqual(1)
    expect(await noticesFor(order, deskUserId)).toBe(1)
    expect(await noticesFor(order, doctorUserId)).toBe(0)

    const retry = await sweepLabReminders(dayBefore)
    expect(retry.sent).toBe(0)
    expect(await noticesFor(order, deskUserId)).toBe(1)
  })

  it('says nothing about work that is back, or before the day', async () => {
    const startsAt = new Date('2027-06-20T08:00:00Z')
    await appointmentAt(startsAt)
    const back = await orderAtLab('RECEIVED')

    await sweepLabReminders(new Date(startsAt.getTime() - 24 * 3_600_000))
    expect(await noticesFor(back)).toBe(0)

    const early = await orderAtLab()
    await sweepLabReminders(new Date(startsAt.getTime() - 72 * 3_600_000))
    expect(await noticesFor(early)).toBe(0)
  })
})
