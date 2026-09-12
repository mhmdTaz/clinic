import { beforeAll, describe, expect, it } from 'vitest'
import { env } from '@clinic/config'
import {
  ClinicModel,
  AppointmentModel,
  DoctorModel,
  NotificationModel,
  PatientModel,
  RoleModel,
  UserModel,
  newId,
} from '@clinic/db'
import { SYSTEM_ROLES } from '@clinic/core/access'
import { sweepReminders } from '../src/jobs/reminders'

/**
 * **Phase 7's second exit criterion**: reminders fire correctly across timezones, and are not
 * duplicated when a job retries.
 *
 * The clinic here is in Asia/Beirut — deliberately not UTC, and deliberately a zone with
 * daylight saving, so "24 hours before" being *elapsed* hours rather than wall-clock hours is
 * something the tests can actually see.
 */

const clinicId = () => env().CLINIC_ID
const TIMEZONE = 'Asia/Beirut'

/**
 * Record and appointment numbers are digits by validator (`^MRN-[0-9]{6,}$`), so the test has to
 * mint them the way the counters do rather than slicing an id.
 */
let sequence = 100_000
const nextNumber = (prefix: string) => `${prefix}-${(sequence += 1)}`

let patientUserId = ''
let patientId = ''
let doctorId = ''

async function seedClinic(): Promise<void> {
  await ClinicModel().findOneAndUpdate(
    { _id: clinicId() },
    {
      $set: {
        name: 'Reminder Clinic',
        timezone: TIMEZONE,
        currency: 'USD',
        locale: 'en',
        isActive: true,
      },
      $setOnInsert: { permissionVersion: 1, branches: [], holidays: [] },
    },
    { upsert: true },
  )

  const patientRole = SYSTEM_ROLES.find((role) => role.key === 'patient')
  const roleId = newId()
  await RoleModel().findOneAndUpdate(
    { clinicId: clinicId(), key: 'patient' },
    {
      $set: {
        name: 'Patient',
        priority: 10,
        isSystem: true,
        isDefault: true,
        permissions: (patientRole?.grants ?? []).map(({ key, scope }) => ({ key, scope })),
      },
      $setOnInsert: { _id: roleId, clinicId: clinicId(), key: 'patient' },
    },
    { upsert: true, new: true },
  )
  const role = await RoleModel().findOne({ clinicId: clinicId(), key: 'patient' }).lean()

  patientUserId = newId()
  await UserModel().create({
    _id: patientUserId,
    clinicId: clinicId(),
    email: `reminders-${patientUserId.slice(0, 8)}@clinic.local`,
    firstName: 'Lina',
    lastName: 'Aziz',
    status: 'ACTIVE',
    roles: [{ roleId: role?._id ?? roleId }],
    passwordHash: 'x',
  })

  patientId = newId()
  await PatientModel().create({
    _id: patientId,
    clinicId: clinicId(),
    userId: patientUserId,
    medicalRecordNo: nextNumber('MRN'),
    firstName: 'Lina',
    lastName: 'Aziz',
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
}

/** An appointment at an exact instant, with everything a reminder needs snapshotted on it. */
async function appointmentAt(startsAt: Date): Promise<string> {
  const id = newId()
  await AppointmentModel().create({
    _id: id,
    clinicId: clinicId(),
    number: nextNumber('APT'),
    patientId,
    doctorId,
    patient: { name: 'Lina Aziz', medicalRecordNo: 'MRN-000001', phone: null },
    doctor: { name: 'Dr Nabil Saad' },
    startsAt,
    endsAt: new Date(startsAt.getTime() + 30 * 60_000),
    durationMinutes: 30,
    status: 'SCHEDULED',
    source: 'STAFF',
  })
  return id
}

const remindersFor = (appointmentId: string) =>
  NotificationModel().countDocuments({
    clinicId: clinicId(),
    type: 'APPOINTMENT_REMINDER',
    'entity.id': appointmentId,
  })

beforeAll(async () => {
  await seedClinic()
})

describe('appointment reminders', () => {
  it('sends one a day before and one two hours before', async () => {
    // 14:00 Beirut on a summer day — 11:00 UTC, because Beirut is UTC+3 in July.
    const startsAt = new Date('2027-07-15T11:00:00Z')
    const appointmentId = await appointmentAt(startsAt)

    // A day before, to the minute.
    const dayBefore = await sweepReminders(new Date(startsAt.getTime() - 24 * 3_600_000))
    expect(dayBefore.sent).toBe(1)
    expect(await remindersFor(appointmentId)).toBe(1)

    // Two hours before.
    const twoHoursBefore = await sweepReminders(new Date(startsAt.getTime() - 2 * 3_600_000))
    expect(twoHoursBefore.sent).toBe(1)
    // Two reminders now, because they are different offsets and therefore different keys.
    expect(await remindersFor(appointmentId)).toBe(2)
  })

  /** The exit criterion, stated plainly. */
  it('does not send twice when the job retries', async () => {
    const startsAt = new Date('2027-08-03T09:00:00Z')
    const appointmentId = await appointmentAt(startsAt)
    const dueAt = new Date(startsAt.getTime() - 24 * 3_600_000)

    const first = await sweepReminders(dueAt)
    expect(first.sent).toBe(1)

    // The retry: same facts, same key, no second notification. The job does not know it already
    // succeeded — the unique index does.
    const retry = await sweepReminders(dueAt)
    expect(retry.sent).toBe(0)
    expect(retry.alreadySent).toBe(1)

    expect(await remindersFor(appointmentId)).toBe(1)
  })

  it('does not send twice when two sweeps overlap', async () => {
    const startsAt = new Date('2027-08-04T09:00:00Z')
    const appointmentId = await appointmentAt(startsAt)
    const dueAt = new Date(startsAt.getTime() - 24 * 3_600_000)

    // Both in flight at once, which is what a slow tick overlapping the next one looks like.
    const [left, right] = await Promise.all([sweepReminders(dueAt), sweepReminders(dueAt)])

    expect(left.sent + right.sent).toBe(1)
    expect(await remindersFor(appointmentId)).toBe(1)
  })

  it('leaves an appointment alone until its reminder is due', async () => {
    const startsAt = new Date('2027-09-20T09:00:00Z')
    const appointmentId = await appointmentAt(startsAt)

    // Three days out: outside every window.
    await sweepReminders(new Date(startsAt.getTime() - 72 * 3_600_000))
    expect(await remindersFor(appointmentId)).toBe(0)

    // And after it has started, there is nothing left to remind anybody about.
    await sweepReminders(new Date(startsAt.getTime() + 3_600_000))
    expect(await remindersFor(appointmentId)).toBe(0)
  })

  it('says nothing about a cancelled appointment', async () => {
    const startsAt = new Date('2027-10-05T09:00:00Z')
    const appointmentId = await appointmentAt(startsAt)
    await AppointmentModel().updateOne(
      { clinicId: clinicId(), _id: appointmentId },
      { $set: { status: 'CANCELLED' } },
    )

    const result = await sweepReminders(new Date(startsAt.getTime() - 24 * 3_600_000))
    expect(result.sent).toBe(0)
    expect(await remindersFor(appointmentId)).toBe(0)
  })

  describe('across timezones', () => {
    /**
     * The bit that is easy to get wrong. Beirut goes from UTC+3 to UTC+2 on the last Sunday in
     * October, so an appointment the morning after the change is 24 *elapsed* hours from a
     * moment that was a different wall-clock time the day before.
     *
     * Subtracting 24 hours from the instant is what "a day before" means to somebody being
     * reminded, and it is what this asserts. Subtracting a calendar day in local time — the
     * obvious-looking alternative — would fire an hour late.
     */
    it('measures the offset in elapsed hours, not wall-clock hours', async () => {
      // 2027-10-31 09:00 Beirut. The clocks went back at 03:00 that morning, so Beirut is UTC+2
      // and this is 07:00 UTC.
      const startsAt = new Date('2027-10-31T07:00:00Z')
      const appointmentId = await appointmentAt(startsAt)

      // 24 elapsed hours earlier is 2027-10-30 07:00 UTC — which was 10:00 in Beirut, an hour
      // later on the clock than the appointment itself. That is correct.
      const dueAt = new Date(startsAt.getTime() - 24 * 3_600_000)
      const result = await sweepReminders(dueAt)

      expect(result.sent).toBe(1)
      expect(await remindersFor(appointmentId)).toBe(1)
    })

    /** And the message says the clinic's time, not the server's. */
    it('writes the appointment time in the clinic’s own timezone', async () => {
      const startsAt = new Date('2027-07-20T11:00:00Z') // 14:00 in Beirut
      const appointmentId = await appointmentAt(startsAt)

      await sweepReminders(new Date(startsAt.getTime() - 2 * 3_600_000))

      const notification = await NotificationModel()
        .findOne({
          clinicId: clinicId(),
          type: 'APPOINTMENT_REMINDER',
          'entity.id': appointmentId,
        })
        .lean()

      expect(notification).not.toBeNull()
      // 14:00 Beirut, not 11:00 UTC — the hour the patient will turn up at.
      expect(notification?.body).toContain('14:00')
      expect(notification?.body).not.toContain('11:00')
    })
  })

  it('records which channels it went out on', async () => {
    const startsAt = new Date('2027-11-10T09:00:00Z')
    const appointmentId = await appointmentAt(startsAt)
    await sweepReminders(new Date(startsAt.getTime() - 24 * 3_600_000))

    const notification = await NotificationModel()
      .findOne({ clinicId: clinicId(), 'entity.id': appointmentId })
      .lean()

    // In-app and email by default, and the in-app row is delivered the moment it is written.
    const channels = (notification?.channels ?? []).map((entry) => entry.channel)
    expect(channels).toContain('IN_APP')
    expect(channels).toContain('EMAIL')
    const inApp = (notification?.channels ?? []).find((entry) => entry.channel === 'IN_APP')
    expect(inApp?.status).toBe('SENT')
  })
})
