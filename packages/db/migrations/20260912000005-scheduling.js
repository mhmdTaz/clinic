/**
 * Phase 3: appointments and the slot reservations that settle booking races (ADR-0013), plus
 * the week and the time off now embedded in a doctor's profile.
 *
 * No permission grants here: the scheduling keys have been in the catalogue and in the seeded
 * roles since Phase 1, so a clinic migrated this far already holds them.
 */

async function ensureCollection(db, name, validator) {
  const existing = await db.listCollections({ name }).toArray()
  if (existing.length === 0) {
    await db.createCollection(name, {
      validator,
      validationLevel: 'strict',
      validationAction: 'error',
    })
  } else {
    await db.command({
      collMod: name,
      validator,
      validationLevel: 'strict',
      validationAction: 'error',
    })
  }
}

const stringId = { bsonType: 'string' }
const nullableString = { bsonType: ['string', 'null'] }
const nullableDate = { bsonType: ['date', 'null'] }
const wholeNumber = { bsonType: ['int', 'long', 'double'] }
const calendarDate = { bsonType: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' }
const clockTime = { bsonType: 'string', pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' }

const APPOINTMENT_STATUSES = [
  'SCHEDULED',
  'CHECKED_IN',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
]

/** The doctors validator as Phase 3 leaves it: the week and the time off are part of it. */
const DOCTOR_VALIDATOR = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['_id', 'clinicId', 'userId', 'defaultSlotMinutes'],
    properties: {
      _id: stringId,
      clinicId: { bsonType: 'string' },
      userId: { bsonType: 'string' },
      consultationFee: { bsonType: ['decimal', 'null'] },
      defaultSlotMinutes: { enum: [10, 15, 20, 30, 45, 60] },
      yearsOfExperience: { bsonType: ['int', 'long', 'double', 'null'], minimum: 0 },
      specialties: { bsonType: 'array', maxItems: 5 },
      branchIds: { bsonType: 'array' },
      availability: {
        bsonType: 'array',
        maxItems: 35,
        items: {
          bsonType: 'object',
          required: ['dayOfWeek', 'startsAt', 'endsAt'],
          properties: {
            dayOfWeek: { bsonType: ['int', 'long', 'double'], minimum: 0, maximum: 6 },
            startsAt: clockTime,
            endsAt: clockTime,
          },
        },
      },
      timeOff: {
        bsonType: 'array',
        maxItems: 200,
        items: {
          bsonType: 'object',
          required: ['id', 'startDate', 'endDate'],
          properties: {
            id: { bsonType: 'string' },
            startDate: calendarDate,
            endDate: calendarDate,
            reason: nullableString,
          },
        },
      },
      isActive: { bsonType: 'bool' },
      deletedAt: nullableDate,
    },
  },
}

/** The doctors validator as Phase 2 left it, so `down` restores exactly that. */
const DOCTOR_VALIDATOR_BEFORE = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['_id', 'clinicId', 'userId', 'defaultSlotMinutes'],
    properties: {
      _id: stringId,
      clinicId: { bsonType: 'string' },
      userId: { bsonType: 'string' },
      consultationFee: { bsonType: ['decimal', 'null'] },
      defaultSlotMinutes: { enum: [10, 15, 20, 30, 45, 60] },
      yearsOfExperience: { bsonType: ['int', 'long', 'double', 'null'], minimum: 0 },
      specialties: { bsonType: 'array', maxItems: 5 },
      branchIds: { bsonType: 'array' },
      isActive: { bsonType: 'bool' },
      deletedAt: nullableDate,
    },
  },
}

export const up = async (db) => {
  // ── appointments ──────────────────────────────────────────────────────────
  await ensureCollection(db, 'appointments', {
    $jsonSchema: {
      bsonType: 'object',
      required: [
        '_id',
        'clinicId',
        'number',
        'patientId',
        'doctorId',
        'startsAt',
        'endsAt',
        'durationMinutes',
        'status',
        'source',
      ],
      properties: {
        _id: stringId,
        clinicId: { bsonType: 'string' },
        branchId: nullableString,
        number: { bsonType: 'string', pattern: '^APT-[0-9]{6,}$' },
        patientId: { bsonType: 'string' },
        doctorId: { bsonType: 'string' },
        startsAt: { bsonType: 'date' },
        endsAt: { bsonType: 'date' },
        durationMinutes: wholeNumber,
        status: { enum: APPOINTMENT_STATUSES },
        source: { enum: ['STAFF', 'PATIENT'] },
        statusHistory: { bsonType: 'array', maxItems: 50 },
        deletedAt: nullableDate,
      },
    },
  })
  const appointments = db.collection('appointments')
  await appointments.createIndex({ clinicId: 1, startsAt: 1 }, { name: 'appointment_calendar' })
  await appointments.createIndex(
    { clinicId: 1, doctorId: 1, startsAt: 1 },
    { name: 'appointment_doctor' },
  )
  await appointments.createIndex(
    { clinicId: 1, patientId: 1, startsAt: -1 },
    { name: 'appointment_patient' },
  )
  await appointments.createIndex(
    { clinicId: 1, status: 1, startsAt: 1 },
    { name: 'appointment_status' },
  )
  await appointments.createIndex(
    { clinicId: 1, number: 1 },
    { unique: true, name: 'appointment_number_unique' },
  )

  // ── slot reservations (ADR-0013) ──────────────────────────────────────────
  await ensureCollection(db, 'slotReservations', {
    $jsonSchema: {
      bsonType: 'object',
      required: ['_id', 'clinicId', 'doctorId', 'appointmentId', 'cellStartsAt'],
      properties: {
        _id: stringId,
        clinicId: { bsonType: 'string' },
        doctorId: { bsonType: 'string' },
        appointmentId: { bsonType: 'string' },
        cellStartsAt: { bsonType: 'date' },
        expiresAt: nullableDate,
      },
    },
  })
  const reservations = db.collection('slotReservations')
  // Provisional holds only: a null expiresAt is never collected.
  await reservations.createIndex(
    { expiresAt: 1 },
    { expireAfterSeconds: 0, name: 'slot_reservation_ttl' },
  )
  await reservations.createIndex(
    { clinicId: 1, appointmentId: 1 },
    { name: 'slot_reservation_appointment' },
  )

  // ── doctors: the week and the time off ────────────────────────────────────
  await ensureCollection(db, 'doctors', DOCTOR_VALIDATOR)
}

export const down = async (db) => {
  for (const name of ['appointments', 'slotReservations']) {
    const existing = await db.listCollections({ name }).toArray()
    if (existing.length > 0) await db.collection(name).drop()
  }
  await ensureCollection(db, 'doctors', DOCTOR_VALIDATOR_BEFORE)
  await db.collection('doctors').updateMany({}, { $unset: { availability: '', timeOff: '' } })
}
