/**
 * Phase 7: asking for help, and being told things (sections 8.12, 13.4).
 *
 * Support tickets with their conversation embedded, the transactional outbox the relay watches,
 * the relay's own resume cursor, and notifications.
 *
 * Three guards live here as well as in the code:
 *
 *  - `notifications` has a unique index on (clinicId, dedupeKey). A reminder job that retries
 *    after a timeout it actually survived loses on the index rather than sending twice — the
 *    same shape as a payment's idempotency key (ADR-0028, ADR-0030).
 *  - two TTL indexes reclaim what would otherwise be nightly jobs: processed outbox events and
 *    read notifications. Work the database does for us cannot silently stop running (8.16).
 *  - the ticket validator refuses a message with no body, because an empty reply in a thread is
 *    indistinguishable from a bug.
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

const TICKET_STATUSES = ['OPEN', 'IN_PROGRESS', 'PENDING', 'RESOLVED', 'CLOSED']
const TICKET_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT']
const TICKET_CATEGORIES = ['APPOINTMENT', 'BILLING', 'MEDICAL_RECORDS', 'TECHNICAL', 'OTHER']
const NOTIFICATION_CHANNELS = ['IN_APP', 'EMAIL']
const NOTIFICATION_STATUSES = ['PENDING', 'SENT', 'FAILED']
const NOTIFICATION_TYPES = [
  'APPOINTMENT_CONFIRMED',
  'APPOINTMENT_REMINDER',
  'APPOINTMENT_CANCELLED',
  'INVOICE_ISSUED',
  'PAYMENT_RECEIVED',
  'TICKET_REPLY',
  'TICKET_ASSIGNED',
  'STOCK_LOW',
]

const personRef = {
  bsonType: ['object', 'null'],
  properties: { id: nullableString, name: nullableString },
}

export const up = async (db) => {
  // ── supportTickets ────────────────────────────────────────────────────────
  await ensureCollection(db, 'supportTickets', {
    $jsonSchema: {
      bsonType: 'object',
      required: ['_id', 'clinicId', 'number', 'subject', 'requester'],
      properties: {
        _id: stringId,
        clinicId: { bsonType: 'string' },
        number: { bsonType: 'string', minLength: 1 },
        subject: { bsonType: 'string', minLength: 1 },
        category: { enum: TICKET_CATEGORIES },
        priority: { enum: TICKET_PRIORITIES },
        status: { enum: TICKET_STATUSES },
        requester: {
          bsonType: 'object',
          required: ['id', 'name', 'role'],
          properties: {
            id: { bsonType: 'string' },
            name: { bsonType: 'string' },
            role: { bsonType: 'string' },
          },
        },
        assignee: personRef,
        messages: {
          bsonType: 'array',
          maxItems: 500,
          items: {
            bsonType: 'object',
            required: ['_id', 'body'],
            properties: {
              _id: stringId,
              author: personRef,
              // An empty reply in a thread is indistinguishable from a bug.
              body: { bsonType: 'string', minLength: 1 },
              isInternal: { bsonType: 'bool' },
              fileIds: { bsonType: 'array', items: { bsonType: 'string' } },
              createdAt: { bsonType: 'date' },
            },
          },
        },
        firstReplyAt: nullableDate,
        resolvedAt: nullableDate,
        closedAt: nullableDate,
        lastMessageAt: nullableDate,
        deletedAt: nullableDate,
      },
    },
  })
  const tickets = db.collection('supportTickets')
  await tickets.createIndex({ clinicId: 1, number: 1 }, { unique: true, name: 'ticket_number' })
  await tickets.createIndex(
    { clinicId: 1, status: 1, priority: -1, lastMessageAt: -1 },
    { name: 'ticket_inbox' },
  )
  await tickets.createIndex({ clinicId: 1, 'assignee.id': 1, status: 1 }, { name: 'ticket_mine' })
  await tickets.createIndex(
    { clinicId: 1, 'requester.id': 1, createdAt: -1 },
    { name: 'ticket_requester' },
  )

  // ── outboxEvents ──────────────────────────────────────────────────────────
  await ensureCollection(db, 'outboxEvents', {
    $jsonSchema: {
      bsonType: 'object',
      required: ['_id', 'clinicId', 'eventName'],
      properties: {
        _id: stringId,
        clinicId: { bsonType: 'string' },
        eventName: { bsonType: 'string', minLength: 1 },
        payload: { bsonType: ['object', 'null'] },
        occurredAt: { bsonType: 'date' },
        processedAt: nullableDate,
        attempts: { bsonType: ['int', 'long', 'double'] },
        lastError: nullableString,
        expiresAt: nullableDate,
      },
    },
  })
  const outbox = db.collection('outboxEvents')
  // The backstop sweep's query: still unprocessed, oldest first.
  await outbox.createIndex({ processedAt: 1, occurredAt: 1 }, { name: 'outbox_pending' })
  // Processed events reclaim themselves rather than needing a nightly job (8.16).
  await outbox.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'outbox_ttl' })
  await outbox.createIndex(
    { clinicId: 1, eventName: 1, occurredAt: -1 },
    { name: 'outbox_by_event' },
  )

  // ── streamCursors ─────────────────────────────────────────────────────────
  // Where the relay left off. One document; no validator, because a resume token is an opaque
  // blob whose shape belongs to the driver rather than to us.
  const existingCursors = await db.listCollections({ name: 'streamCursors' }).toArray()
  if (existingCursors.length === 0) await db.createCollection('streamCursors')

  // ── notifications ─────────────────────────────────────────────────────────
  await ensureCollection(db, 'notifications', {
    $jsonSchema: {
      bsonType: 'object',
      required: ['_id', 'clinicId', 'userId', 'type', 'title', 'body', 'dedupeKey'],
      properties: {
        _id: stringId,
        clinicId: { bsonType: 'string' },
        userId: { bsonType: 'string' },
        type: { enum: NOTIFICATION_TYPES },
        title: { bsonType: 'string', minLength: 1 },
        body: { bsonType: 'string', minLength: 1 },
        href: nullableString,
        entity: {
          bsonType: ['object', 'null'],
          properties: { type: nullableString, id: nullableString },
        },
        channels: {
          bsonType: 'array',
          items: {
            bsonType: 'object',
            required: ['channel'],
            properties: {
              channel: { enum: NOTIFICATION_CHANNELS },
              status: { enum: NOTIFICATION_STATUSES },
              sentAt: nullableDate,
              error: nullableString,
            },
          },
        },
        isRead: { bsonType: 'bool' },
        readAt: nullableDate,
        dedupeKey: { bsonType: 'string', minLength: 1 },
        expiresAt: nullableDate,
      },
    },
  })
  const notifications = db.collection('notifications')
  // One notification per thing that happened, however many times a job runs (ADR-0030).
  await notifications.createIndex(
    { clinicId: 1, dedupeKey: 1 },
    { unique: true, name: 'notification_dedupe' },
  )
  await notifications.createIndex({ clinicId: 1, userId: 1, createdAt: -1 }, { name: 'bell' })
  await notifications.createIndex({ clinicId: 1, userId: 1, isRead: 1 }, { name: 'unread_count' })
  await notifications.createIndex(
    { expiresAt: 1 },
    { expireAfterSeconds: 0, name: 'notification_ttl' },
  )
}

export const down = async (db) => {
  for (const name of ['supportTickets', 'outboxEvents', 'streamCursors', 'notifications']) {
    const existing = await db.listCollections({ name }).toArray()
    if (existing.length > 0) await db.collection(name).drop()
  }
}
