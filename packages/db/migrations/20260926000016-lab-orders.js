/**
 * Phase 13: lab work and voice charting.
 *
 * One collection, `lab_orders`, and one notification type, LAB_WORK_LATE — the notifications
 * validator pins the enum, so a new type is a migration or the first alert fails to insert.
 * Voice charting is a feature flag on the clinic and needs nothing here. No new permissions: lab
 * work is read and written under the chart's own.
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
const calendarDate = { bsonType: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' }
const nullableCalendarDate = {
  bsonType: ['string', 'null'],
  pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$',
}
const personRef = {
  bsonType: ['object', 'null'],
  properties: { id: nullableString, name: nullableString },
}
const fdiTooth = { bsonType: 'string', pattern: '^([1-4][1-8]|[5-8][1-5])$' }

const LAB_ORDER_STATUSES = ['SENT', 'RECEIVED', 'FITTED', 'REMAKE', 'CANCELLED']
const DENTAL_SYMBOLS = [
  'CROWN',
  'ROOT_CANAL',
  'FILLING',
  'IMPLANT',
  'EXTRACTION',
  'MISSING',
  'BRIDGE',
  'DENTURE',
  'VENEER',
  'SEALANT',
  'CARIES',
  'FRACTURE',
  'IMPACTED',
  'OTHER',
]
const NEW_NOTIFICATION_TYPE = 'LAB_WORK_LATE'

const LAB_ORDER_VALIDATOR = {
  $jsonSchema: {
    bsonType: 'object',
    required: [
      '_id',
      'clinicId',
      'patientId',
      'patient',
      'toothRecordIds',
      'labName',
      'sentOn',
      'dueOn',
      'status',
    ],
    properties: {
      _id: stringId,
      clinicId: { bsonType: 'string' },
      patientId: { bsonType: 'string' },
      patient: {
        bsonType: 'object',
        required: ['name', 'medicalRecordNo'],
        properties: { name: { bsonType: 'string' }, medicalRecordNo: { bsonType: 'string' } },
      },
      toothRecordIds: { bsonType: 'array', minItems: 1, maxItems: 16, items: stringId },
      teeth: { bsonType: 'array', maxItems: 32, items: fdiTooth },
      work: {
        bsonType: 'array',
        maxItems: 16,
        items: {
          bsonType: 'object',
          required: ['name', 'symbol'],
          properties: { name: { bsonType: 'string' }, symbol: { enum: DENTAL_SYMBOLS } },
        },
      },
      labName: { bsonType: 'string', minLength: 1 },
      sentOn: calendarDate,
      dueOn: calendarDate,
      status: { enum: LAB_ORDER_STATUSES },
      notes: nullableString,
      history: {
        bsonType: 'array',
        items: {
          bsonType: 'object',
          required: ['status', 'at'],
          properties: {
            status: { enum: LAB_ORDER_STATUSES },
            at: { bsonType: 'date' },
            by: personRef,
            note: nullableString,
            dueOn: nullableCalendarDate,
          },
        },
      },
      createdBy: personRef,
      deletedAt: nullableDate,
    },
  },
}

async function setNotificationTypes(db, change) {
  const notifications = await db.listCollections({ name: 'notifications' }).toArray()
  const schema = notifications[0]?.options?.validator?.$jsonSchema
  if (!schema?.properties?.type?.enum) return
  await db.command({
    collMod: 'notifications',
    validator: {
      $jsonSchema: {
        ...schema,
        properties: { ...schema.properties, type: { enum: change(schema.properties.type.enum) } },
      },
    },
    validationLevel: 'strict',
    validationAction: 'error',
  })
}

export const up = async (db) => {
  await ensureCollection(db, 'lab_orders', LAB_ORDER_VALIDATOR)
  const orders = db.collection('lab_orders')
  await orders.createIndex(
    { clinicId: 1, patientId: 1, createdAt: -1 },
    { name: 'lab_order_patient' },
  )
  await orders.createIndex({ clinicId: 1, status: 1, dueOn: 1 }, { name: 'lab_order_board' })
  await orders.createIndex({ clinicId: 1, toothRecordIds: 1 }, { name: 'lab_order_record' })

  await setNotificationTypes(db, (types) =>
    types.includes(NEW_NOTIFICATION_TYPE) ? types : [...types, NEW_NOTIFICATION_TYPE],
  )
}

export const down = async (db) => {
  await setNotificationTypes(db, (types) => types.filter((type) => type !== NEW_NOTIFICATION_TYPE))
  const existing = await db.listCollections({ name: 'lab_orders' }).toArray()
  if (existing.length > 0) await db.collection('lab_orders').drop()
}
