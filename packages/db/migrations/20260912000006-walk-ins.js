/**
 * Walk-ins (ADR-0023). A third booking source beside STAFF and PATIENT, so a patient who
 * arrives without an appointment is recorded as what they are rather than as a phone booking.
 *
 * The validator is the only thing that has to move: a walk-in is an ordinary appointment on an
 * ordinary slot, and every index it needs already exists.
 */

const APPOINTMENT_STATUSES = [
  'SCHEDULED',
  'CHECKED_IN',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
]

const stringId = { bsonType: 'string' }
const nullableString = { bsonType: ['string', 'null'] }
const nullableDate = { bsonType: ['date', 'null'] }
const wholeNumber = { bsonType: ['int', 'long', 'double'] }

const appointmentValidator = (sources) => ({
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
      source: { enum: sources },
      statusHistory: { bsonType: 'array', maxItems: 50 },
      deletedAt: nullableDate,
    },
  },
})

async function setValidator(db, sources) {
  await db.command({
    collMod: 'appointments',
    validator: appointmentValidator(sources),
    validationLevel: 'strict',
    validationAction: 'error',
  })
}

export const up = async (db) => {
  await setValidator(db, ['STAFF', 'PATIENT', 'WALK_IN'])
}

export const down = async (db) => {
  // Anything already recorded as a walk-in was a real visit; calling it a staff booking keeps
  // the row readable rather than leaving it unwritable under the narrower validator.
  await db
    .collection('appointments')
    .updateMany({ source: 'WALK_IN' }, { $set: { source: 'STAFF' } })
  await setValidator(db, ['STAFF', 'PATIENT'])
}
