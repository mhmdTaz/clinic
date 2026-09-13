/**
 * Phase 10: `idempotencyKeys` (§9.2).
 *
 * §6 lists this collection and §15 gives it a TTL; neither existed. §9.2 promised that an
 * `Idempotency-Key` header is honoured on every POST that moves money or creates a booking, and
 * only payments kept that promise — by a key in the body, which answers "was this done?" but not
 * "what did it answer?". A retried booking was refused `SLOT_TAKEN` by its own first attempt.
 *
 * One row per (clinic, scope, key). The unique index is the claim: two concurrent requests with
 * the same key race on the insert, and exactly one wins. The TTL index is the whole of the cleanup.
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

export const up = async (db) => {
  await ensureCollection(db, 'idempotencyKeys', {
    $jsonSchema: {
      bsonType: 'object',
      required: ['_id', 'clinicId', 'scope', 'key', 'fingerprint', 'state', 'expiresAt'],
      properties: {
        _id: { bsonType: 'string' },
        clinicId: { bsonType: 'string' },
        scope: { bsonType: 'string', maxLength: 300 },
        // What a client may send: long enough for a UUID, short enough that nothing absurd is kept.
        key: { bsonType: 'string', minLength: 8, maxLength: 128 },
        fingerprint: { bsonType: 'string' },
        claimToken: { bsonType: ['string', 'null'] },
        state: { enum: ['IN_FLIGHT', 'DONE'] },
        lockedUntil: { bsonType: ['date', 'null'] },
        responseStatus: { bsonType: ['int', 'long', 'double', 'null'] },
        responseBody: {},
        expiresAt: { bsonType: 'date' },
      },
    },
  })

  const keys = db.collection('idempotencyKeys')
  await keys.createIndex(
    { clinicId: 1, scope: 1, key: 1 },
    { unique: true, name: 'idempotency_claim' },
  )
  await keys.createIndex({ expiresAt: 1 }, { name: 'idempotency_ttl', expireAfterSeconds: 0 })
}

export const down = async (db) => {
  const existing = await db.listCollections({ name: 'idempotencyKeys' }).toArray()
  if (existing.length > 0) await db.collection('idempotencyKeys').drop()
}
