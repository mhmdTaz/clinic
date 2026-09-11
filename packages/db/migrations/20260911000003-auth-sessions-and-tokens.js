/**
 * Collections behind sign-in (ARCHITECTURE.md section 10): refresh-token sessions,
 * activation invitations and password-reset tokens.
 *
 * All three store only a SHA-256 hash of their token — exactly 64 hex characters,
 * which the validator enforces so a raw token can never be written by mistake — and
 * all three expire themselves through a TTL index rather than a cleanup job.
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

const tokenHash = { bsonType: 'string', minLength: 64, maxLength: 64 }
const nullableDate = { bsonType: ['date', 'null'] }

export const up = async (db) => {
  await ensureCollection(db, 'refreshTokens', {
    $jsonSchema: {
      bsonType: 'object',
      required: ['_id', 'clinicId', 'userId', 'familyId', 'tokenHash', 'expiresAt'],
      properties: {
        _id: { bsonType: 'string' },
        clinicId: { bsonType: 'string' },
        userId: { bsonType: 'string' },
        familyId: { bsonType: 'string' },
        tokenHash,
        expiresAt: { bsonType: 'date' },
        rotatedAt: nullableDate,
        revokedAt: nullableDate,
      },
    },
  })
  const refreshTokens = db.collection('refreshTokens')
  await refreshTokens.createIndex(
    { tokenHash: 1 },
    { unique: true, name: 'refresh_token_hash_unique' },
  )
  await refreshTokens.createIndex(
    { clinicId: 1, userId: 1, revokedAt: 1 },
    { name: 'refresh_token_user' },
  )
  await refreshTokens.createIndex({ familyId: 1 }, { name: 'refresh_token_family' })
  await refreshTokens.createIndex(
    { expiresAt: 1 },
    { name: 'refresh_token_ttl', expireAfterSeconds: 0 },
  )

  await ensureCollection(db, 'invitations', {
    $jsonSchema: {
      bsonType: 'object',
      required: ['_id', 'clinicId', 'userId', 'email', 'tokenHash', 'expiresAt'],
      properties: {
        _id: { bsonType: 'string' },
        clinicId: { bsonType: 'string' },
        userId: { bsonType: 'string' },
        email: { bsonType: 'string' },
        tokenHash,
        expiresAt: { bsonType: 'date' },
        acceptedAt: nullableDate,
        revokedAt: nullableDate,
      },
    },
  })
  const invitations = db.collection('invitations')
  await invitations.createIndex({ tokenHash: 1 }, { unique: true, name: 'invitation_hash_unique' })
  await invitations.createIndex(
    { clinicId: 1, userId: 1, acceptedAt: 1 },
    { name: 'invitation_user' },
  )
  await invitations.createIndex({ expiresAt: 1 }, { name: 'invitation_ttl', expireAfterSeconds: 0 })

  await ensureCollection(db, 'passwordResetTokens', {
    $jsonSchema: {
      bsonType: 'object',
      required: ['_id', 'clinicId', 'userId', 'tokenHash', 'expiresAt'],
      properties: {
        _id: { bsonType: 'string' },
        clinicId: { bsonType: 'string' },
        userId: { bsonType: 'string' },
        tokenHash,
        expiresAt: { bsonType: 'date' },
        usedAt: nullableDate,
        supersededAt: nullableDate,
      },
    },
  })
  const resetTokens = db.collection('passwordResetTokens')
  await resetTokens.createIndex({ tokenHash: 1 }, { unique: true, name: 'reset_token_hash_unique' })
  await resetTokens.createIndex({ clinicId: 1, userId: 1, usedAt: 1 }, { name: 'reset_token_user' })
  await resetTokens.createIndex(
    { expiresAt: 1 },
    { name: 'reset_token_ttl', expireAfterSeconds: 0 },
  )

  // Phase 0's soft-delete plugin declared { deletedAt: 1 }, and Mongoose built it outside
  // any migration. Indexes are owned by migrations now (autoIndex is off), so a database
  // created in Phase 0 drops the stray and matches a fresh one exactly.
  const userIndexes = await db.collection('users').indexes()
  if (userIndexes.some((index) => index.name === 'deletedAt_1')) {
    await db.collection('users').dropIndex('deletedAt_1')
  }
}

export const down = async (db) => {
  for (const name of ['passwordResetTokens', 'invitations', 'refreshTokens']) {
    const existing = await db.listCollections({ name }).toArray()
    if (existing.length > 0) await db.collection(name).drop()
  }
}
