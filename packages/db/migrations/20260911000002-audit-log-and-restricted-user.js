/**
 * The auditLogs collection and the restricted database user that writes to it
 * (ARCHITECTURE.md sections 8.13 and 11.5).
 *
 * MongoDB has no table triggers outside Atlas, so "the app cannot modify history"
 * is enforced by CREDENTIALS rather than by a grant on a shared session: the audit
 * writer gets its own user with insert+find on auditLogs and nothing else, and the
 * application's main user gets no privileges on the collection at all.
 *
 * Local development runs mongod WITHOUT auth (a replica set with auth needs a
 * keyfile, which is painful to mount correctly on Windows), so createUser is
 * skipped there with a clear message. The separation is structural in code either
 * way — see docs/adr/0016.
 */

const AUDIT_ROLE = 'clinicAuditWriter'

async function authIsEnabled(db) {
  try {
    // With auth off this returns the parameter; with auth on and no privileges it throws.
    const result = await db.admin().command({ getParameter: 1, authenticationMechanisms: 1 })
    const users = await db
      .admin()
      .command({ usersInfo: 1 })
      .catch(() => null)
    return Boolean(result) && users !== null && Array.isArray(users.users) && users.users.length > 0
  } catch {
    return true // command refused => auth is on and we lack rights; assume enabled
  }
}

export const up = async (db) => {
  const name = 'auditLogs'
  const validator = {
    $jsonSchema: {
      bsonType: 'object',
      required: ['_id', 'clinicId', 'occurredAt', 'action', 'category', 'expiresAt'],
      properties: {
        _id: { bsonType: 'string' },
        clinicId: { bsonType: 'string' },
        occurredAt: { bsonType: 'date' },
        action: { bsonType: 'string', minLength: 1 },
        category: {
          enum: [
            'AUTH',
            'ACCESS_CONTROL',
            'CLINICAL',
            'FINANCIAL',
            'INVENTORY',
            'ADMIN',
            'FILE',
            'SUPPORT',
            'SYSTEM',
          ],
        },
        severity: { enum: ['INFO', 'NOTICE', 'WARNING', 'CRITICAL'] },
        outcome: { enum: ['SUCCESS', 'FAILURE', 'DENIED'] },
        // Per-document retention: 7y clinical/financial, 2y auth/system (section 11.6).
        expiresAt: { bsonType: 'date' },
      },
    },
  }

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

  const col = db.collection(name)
  await col.createIndex({ clinicId: 1, occurredAt: -1 }, { name: 'audit_clinic_time' })
  await col.createIndex({ clinicId: 1, 'actor.id': 1, occurredAt: -1 }, { name: 'audit_actor' })
  await col.createIndex(
    { clinicId: 1, 'entity.type': 1, 'entity.id': 1, occurredAt: -1 },
    { name: 'audit_entity' },
  )
  await col.createIndex({ clinicId: 1, action: 1, occurredAt: -1 }, { name: 'audit_action' })
  await col.createIndex({ clinicId: 1, severity: 1, occurredAt: -1 }, { name: 'audit_severity' })
  // One TTL index expresses BOTH retention classes, because expiry is per document.
  await col.createIndex({ expiresAt: 1 }, { name: 'audit_ttl', expireAfterSeconds: 0 })

  if (!(await authIsEnabled(db))) {
    console.warn(
      '[migration] mongod is running without authentication — skipping creation of the ' +
        `restricted "${AUDIT_ROLE}" user. This is expected for local development. ` +
        'Staging and production MUST run with auth so the privilege separation is real.',
    )
    return
  }

  const password = process.env.MONGODB_AUDIT_PASSWORD
  if (!password) {
    throw new Error(
      'MONGODB_AUDIT_PASSWORD must be set when authentication is enabled, so the audit ' +
        'writer can be created with its own credentials.',
    )
  }

  await db
    .command({
      createRole: AUDIT_ROLE,
      privileges: [
        {
          resource: { db: db.databaseName, collection: 'auditLogs' },
          actions: ['insert', 'find'], // deliberately no update, no remove
        },
      ],
      roles: [],
    })
    .catch((e) => {
      if (!/already exists/i.test(e.message)) throw e
    })

  await db
    .command({
      createUser: 'clinic_audit',
      pwd: password,
      roles: [{ role: AUDIT_ROLE, db: db.databaseName }],
    })
    .catch((e) => {
      if (!/already exists/i.test(e.message)) throw e
    })
}

export const down = async (db) => {
  const existing = await db.listCollections({ name: 'auditLogs' }).toArray()
  if (existing.length > 0) await db.collection('auditLogs').drop()
  await db.command({ dropUser: 'clinic_audit' }).catch(() => {})
  await db.command({ dropRole: AUDIT_ROLE }).catch(() => {})
}
