/**
 * Phase 12: treatment plans (ADR-0036).
 *
 * One collection, `treatment_plans`: planned work from the tooth chart, in phases, priced, and
 * the patient's answer. No new permissions — a plan is part of the chart and is read and written
 * under `dental:read` and `dental:write`, and putting done work on an invoice asks for
 * `invoice:create` as any other bill does — so no role changes and the permission version stays.
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
const decimal = { bsonType: 'decimal' }
const nullableCalendarDate = {
  bsonType: ['string', 'null'],
  pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$',
}
const personRef = {
  bsonType: ['object', 'null'],
  properties: { id: nullableString, name: nullableString },
}
const fdiTooth = { bsonType: 'string', pattern: '^([1-4][1-8]|[5-8][1-5])$' }

const TREATMENT_PLAN_STATUSES = [
  'DRAFT',
  'PRESENTED',
  'ACCEPTED',
  'DECLINED',
  'COMPLETED',
  'CANCELLED',
]
const TOOTH_SURFACES = ['M', 'D', 'O', 'I', 'B', 'L']
const TOOTH_ROLES = ['ABUTMENT', 'PONTIC', 'DENTURE_TOOTH']
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

const TREATMENT_PLAN_VALIDATOR = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['_id', 'clinicId', 'patientId', 'title', 'status', 'phases', 'items', 'currency'],
    properties: {
      _id: stringId,
      clinicId: { bsonType: 'string' },
      patientId: { bsonType: 'string' },
      title: { bsonType: 'string', minLength: 1 },
      status: { enum: TREATMENT_PLAN_STATUSES },
      phases: {
        bsonType: 'array',
        minItems: 1,
        maxItems: 6,
        items: { bsonType: 'string', minLength: 1 },
      },
      items: {
        bsonType: 'array',
        minItems: 1,
        maxItems: 40,
        items: {
          bsonType: 'object',
          required: [
            '_id',
            'toothRecordId',
            'phase',
            'treatment',
            'description',
            'quantity',
            'unitPrice',
            'gross',
            'net',
            'tax',
            'lineTotal',
          ],
          properties: {
            _id: stringId,
            toothRecordId: { bsonType: 'string' },
            phase: wholeNumber,
            teeth: {
              bsonType: 'array',
              maxItems: 16,
              items: {
                bsonType: 'object',
                required: ['fdi'],
                properties: { fdi: fdiTooth, role: { enum: [...TOOTH_ROLES, null] } },
              },
            },
            surfaces: { bsonType: 'array', maxItems: 5, items: { enum: TOOTH_SURFACES } },
            treatment: {
              bsonType: 'object',
              required: ['id', 'code', 'name', 'symbol'],
              properties: {
                id: { bsonType: 'string' },
                code: { bsonType: 'string' },
                name: { bsonType: 'string' },
                symbol: { enum: DENTAL_SYMBOLS },
              },
            },
            serviceId: nullableString,
            description: { bsonType: 'string', minLength: 1 },
            quantity: decimal,
            unitPrice: decimal,
            discount: decimal,
            taxRatePercent: decimal,
            gross: decimal,
            net: decimal,
            tax: decimal,
            lineTotal: decimal,
            state: { enum: ['OPEN', 'DONE', 'DROPPED'] },
            doneOn: nullableCalendarDate,
            completedByRecordId: nullableString,
            completedInEncounterId: nullableString,
            billedInvoiceId: nullableString,
            billedInvoiceNumber: nullableString,
            billedAt: nullableDate,
          },
        },
      },
      openItems: wholeNumber,
      currency: { bsonType: 'string', pattern: '^[A-Z]{3}$' },
      subtotal: decimal,
      discountTotal: decimal,
      taxTotal: decimal,
      total: decimal,
      notes: nullableString,
      createdBy: personRef,
      presentedAt: nullableDate,
      decidedAt: nullableDate,
      acceptedAt: nullableDate,
      decisionRecordedBy: personRef,
      signedBy: nullableString,
      signatureFileId: nullableString,
      declineReason: nullableString,
      cancelledAt: nullableDate,
      cancelledBy: personRef,
      cancelReason: nullableString,
      deletedAt: nullableDate,
    },
  },
}

export const up = async (db) => {
  await ensureCollection(db, 'treatment_plans', TREATMENT_PLAN_VALIDATOR)
  const plans = db.collection('treatment_plans')
  await plans.createIndex(
    { clinicId: 1, patientId: 1, createdAt: -1 },
    { name: 'treatment_plan_patient' },
  )
  await plans.createIndex(
    { clinicId: 1, 'items.toothRecordId': 1 },
    { name: 'treatment_plan_record' },
  )
  await plans.createIndex(
    { clinicId: 1, status: 1, openItems: 1, acceptedAt: 1 },
    { name: 'treatment_plan_recall' },
  )
}

export const down = async (db) => {
  const existing = await db.listCollections({ name: 'treatment_plans' }).toArray()
  if (existing.length > 0) await db.collection('treatment_plans').drop()
}
