import { MongoClient, type Document, type Filter } from 'mongodb'
import { E2E } from '../e2e.env'

let client: MongoClient | null = null

async function database() {
  if (!client) {
    client = new MongoClient(E2E.mongoUri)
    await client.connect()
  }
  return client.db(E2E.database)
}

/**
 * The newest audit entry matching `filter` in the e2e clinic. Polls briefly: automatically
 * captured entries are written asynchronously, just after the response.
 */
export async function findAuditEntry(filter: Filter<Document>): Promise<Document | null> {
  const auditLogs = (await database()).collection('auditLogs')
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const entry = await auditLogs.findOne(
      { clinicId: E2E.clinicId, ...filter },
      { sort: { occurredAt: -1 } },
    )
    if (entry) return entry
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return null
}

/**
 * How many audit entries match `filter` in the e2e clinic, read once. To prove an entry was
 * NOT written, first wait for one written by the same request with findAuditEntry.
 */
export async function countAuditEntries(filter: Filter<Document>): Promise<number> {
  const auditLogs = (await database()).collection('auditLogs')
  return auditLogs.countDocuments({ clinicId: E2E.clinicId, ...filter })
}

/** The e2e clinic's permission version — the `pv` every current access token carries. */
export async function clinicPermissionVersion(): Promise<number> {
  const clinics = (await database()).collection<{ _id: string; permissionVersion: number }>(
    'clinics',
  )
  const clinic = await clinics.findOne({ _id: E2E.clinicId })
  if (!clinic) throw new Error(`clinic ${E2E.clinicId} is not seeded`)
  return clinic.permissionVersion
}

export async function closeDatabase(): Promise<void> {
  await client?.close()
  client = null
}

/** The seeded clinic's only doctor profile. */
export async function seededDoctorId(): Promise<string> {
  const doctors = (await database()).collection<{ _id: string }>('doctors')
  const doctor = await doctors.findOne({ clinicId: E2E.clinicId })
  if (!doctor) throw new Error('no doctor is seeded')
  return doctor._id
}

/** A seeded patient by family name — the journeys name people, not ids. */
export async function seededPatientId(lastName: string): Promise<string> {
  const patients = (await database()).collection<{ _id: string }>('patients')
  const patient = await patients.findOne({ clinicId: E2E.clinicId, lastName })
  if (!patient) throw new Error(`no patient named ${lastName} is seeded`)
  return patient._id
}

/** Appointments still holding a doctor's time at that instant — the double-booking check. */
export async function countAppointmentsAt(doctorId: string, startsAt: string): Promise<number> {
  const appointments = (await database()).collection('appointments')
  return appointments.countDocuments({
    clinicId: E2E.clinicId,
    doctorId,
    startsAt: new Date(startsAt),
    status: { $in: ['SCHEDULED', 'CHECKED_IN', 'IN_PROGRESS'] },
  })
}
