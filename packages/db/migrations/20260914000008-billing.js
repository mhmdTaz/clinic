/**
 * Phase 5: money. The service catalogue, invoices with their embedded price-snapshot lines,
 * payments with the allocations that settle those invoices, and refunds as their own ledger
 * (section 8.10).
 *
 * Two guards live here as well as in the repositories, because money is the one place where a
 * second line of defence earns its keep (section 8.15):
 *
 *  - `payments` has a unique index on (clinicId, idempotencyKey). A double-clicked button loses
 *    on the index, not on a prior read, so there is no window in which two payments exist.
 *  - the invoice validator refuses a VOIDed invoice that carries no reason. A financial document
 *    that vanished without a stated cause is not a state the database should be able to hold.
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
const decimal = { bsonType: 'decimal' }
const nullableDecimal = { bsonType: ['decimal', 'null'] }
const nullableWholeNumber = { bsonType: ['int', 'long', 'double', 'null'] }
const nullableCalendarDate = {
  bsonType: ['string', 'null'],
  pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$',
}

const INVOICE_STATUSES = ['DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'VOID']
const PAYMENT_METHODS = ['CASH', 'CARD', 'TRANSFER', 'INSURANCE']
const PAYMENT_STATUSES = ['COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED']

const personRef = {
  bsonType: ['object', 'null'],
  properties: { id: nullableString, name: nullableString },
}

const allocations = {
  bsonType: 'array',
  items: {
    bsonType: 'object',
    required: ['invoiceId', 'amount'],
    properties: {
      invoiceId: { bsonType: 'string' },
      invoiceNumber: nullableString,
      amount: decimal,
    },
  },
}

const patientSnapshot = {
  bsonType: 'object',
  required: ['name', 'medicalRecordNo'],
  properties: {
    name: { bsonType: 'string' },
    medicalRecordNo: { bsonType: 'string' },
  },
}

const currency = { bsonType: 'string', minLength: 3, maxLength: 3 }

export const up = async (db) => {
  // ── services ──────────────────────────────────────────────────────────────
  await ensureCollection(db, 'services', {
    $jsonSchema: {
      bsonType: 'object',
      required: ['_id', 'clinicId', 'name', 'price'],
      properties: {
        _id: stringId,
        clinicId: { bsonType: 'string' },
        name: { bsonType: 'string', minLength: 1 },
        search: { bsonType: ['object', 'null'], properties: { name: nullableString } },
        description: nullableString,
        price: decimal,
        taxRatePercent: nullableDecimal,
        durationMinutes: nullableWholeNumber,
        isActive: { bsonType: 'bool' },
      },
    },
  })
  const services = db.collection('services')
  await services.createIndex(
    { clinicId: 1, 'search.name': 1 },
    { unique: true, name: 'service_name_unique' },
  )
  await services.createIndex({ clinicId: 1, isActive: 1, name: 1 }, { name: 'service_list' })

  // ── invoices ──────────────────────────────────────────────────────────────
  await ensureCollection(db, 'invoices', {
    $jsonSchema: {
      bsonType: 'object',
      required: ['_id', 'clinicId', 'number', 'patientId', 'status', 'currency', 'total'],
      properties: {
        _id: stringId,
        clinicId: { bsonType: 'string' },
        branchId: nullableString,
        number: { bsonType: 'string', minLength: 1 },
        patientId: { bsonType: 'string' },
        patient: patientSnapshot,
        encounterId: nullableString,
        status: { enum: INVOICE_STATUSES },
        issuedAt: nullableDate,
        dueAt: nullableCalendarDate,
        lines: {
          bsonType: 'array',
          maxItems: 50,
          items: {
            bsonType: 'object',
            required: ['_id', 'description', 'quantity', 'unitPrice', 'lineTotal'],
            properties: {
              _id: stringId,
              serviceId: nullableString,
              inventoryItemId: nullableString,
              description: { bsonType: 'string', minLength: 1 },
              quantity: decimal,
              unitPrice: decimal,
              discount: nullableDecimal,
              taxRatePercent: nullableDecimal,
              gross: decimal,
              net: decimal,
              tax: decimal,
              lineTotal: decimal,
            },
          },
        },
        currency,
        subtotal: decimal,
        discountTotal: decimal,
        taxTotal: decimal,
        total: decimal,
        amountPaid: decimal,
        balanceDue: decimal,
        notes: nullableString,
        pdfFileId: nullableString,
        voidedAt: nullableDate,
        voidReason: nullableString,
        voidedBy: personRef,
        createdBy: personRef,
      },
      // A void with no reason is not a void, it is a disappearance.
      anyOf: [
        { properties: { status: { enum: ['DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID'] } } },
        {
          properties: { status: { enum: ['VOID'] } },
          required: ['voidedAt', 'voidReason'],
        },
      ],
    },
  })
  const invoices = db.collection('invoices')
  await invoices.createIndex(
    { clinicId: 1, number: 1 },
    { unique: true, name: 'invoice_number_unique' },
  )
  await invoices.createIndex({ clinicId: 1, status: 1, issuedAt: -1 }, { name: 'invoice_status' })
  await invoices.createIndex(
    { clinicId: 1, patientId: 1, createdAt: -1 },
    { name: 'invoice_patient' },
  )
  await invoices.createIndex({ clinicId: 1, balanceDue: 1 }, { name: 'invoice_outstanding' })
  await invoices.createIndex(
    { clinicId: 1, encounterId: 1 },
    { sparse: true, name: 'invoice_encounter' },
  )
  await invoices.createIndex({ clinicId: 1, issuedAt: -1 }, { name: 'invoice_issued' })

  // ── payments ──────────────────────────────────────────────────────────────
  await ensureCollection(db, 'payments', {
    $jsonSchema: {
      bsonType: 'object',
      required: [
        '_id',
        'clinicId',
        'number',
        'patientId',
        'amount',
        'currency',
        'method',
        'idempotencyKey',
      ],
      properties: {
        _id: stringId,
        clinicId: { bsonType: 'string' },
        branchId: nullableString,
        number: { bsonType: 'string', minLength: 1 },
        patientId: { bsonType: 'string' },
        patient: patientSnapshot,
        amount: decimal,
        refundedAmount: decimal,
        currency,
        method: { enum: PAYMENT_METHODS },
        status: { enum: PAYMENT_STATUSES },
        reference: nullableString,
        note: nullableString,
        receivedAt: { bsonType: 'date' },
        receivedBy: personRef,
        allocations,
        idempotencyKey: { bsonType: 'string', minLength: 1 },
        pdfFileId: nullableString,
      },
    },
  })
  const payments = db.collection('payments')
  // The double-click guard: the second insert loses here, not on a prior read (ADR-0028).
  await payments.createIndex(
    { clinicId: 1, idempotencyKey: 1 },
    { unique: true, name: 'payment_idempotency_unique' },
  )
  await payments.createIndex(
    { clinicId: 1, number: 1 },
    { unique: true, name: 'payment_number_unique' },
  )
  await payments.createIndex({ clinicId: 1, receivedAt: -1 }, { name: 'payment_day' })
  await payments.createIndex(
    { clinicId: 1, patientId: 1, receivedAt: -1 },
    { name: 'payment_patient' },
  )
  await payments.createIndex(
    { clinicId: 1, 'allocations.invoiceId': 1 },
    { name: 'payment_by_invoice' },
  )

  // ── refunds ───────────────────────────────────────────────────────────────
  await ensureCollection(db, 'refunds', {
    $jsonSchema: {
      bsonType: 'object',
      required: ['_id', 'clinicId', 'paymentId', 'patientId', 'amount', 'currency', 'reason'],
      properties: {
        _id: stringId,
        clinicId: { bsonType: 'string' },
        paymentId: { bsonType: 'string' },
        paymentNumber: nullableString,
        patientId: { bsonType: 'string' },
        amount: decimal,
        currency,
        reason: { bsonType: 'string', minLength: 1 },
        allocations,
        refundedAt: { bsonType: 'date' },
        refundedBy: personRef,
      },
    },
  })
  const refunds = db.collection('refunds')
  await refunds.createIndex({ clinicId: 1, refundedAt: -1 }, { name: 'refund_day' })
  await refunds.createIndex({ clinicId: 1, paymentId: 1 }, { name: 'refund_payment' })
  await refunds.createIndex(
    { clinicId: 1, patientId: 1, refundedAt: -1 },
    { name: 'refund_patient' },
  )
}

export const down = async (db) => {
  for (const name of ['services', 'invoices', 'payments', 'refunds']) {
    const existing = await db.listCollections({ name }).toArray()
    if (existing.length > 0) await db.collection(name).drop()
  }
}
