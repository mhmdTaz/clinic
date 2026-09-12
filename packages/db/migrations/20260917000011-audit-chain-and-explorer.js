/**
 * Phase 8: the audit chain head, and the indexes the explorer reads through (sections 11.5, 11.6).
 *
 * Two things happen here.
 *
 * **The chain head gets a collection.** One document per clinic saying where that clinic's audit
 * chain currently ends. It lives beside `auditLogs` and is governed by the same restricted role,
 * because a head the application could rewrite would make the chain worth nothing.
 *
 * **That role gains `update` — on the head only.** This is the one mutable thing in the audit
 * subsystem and it deserves the scrutiny: the head records where the chain *ends*, not what is
 * in it. An attacker who rewrites the head still has to produce, for every entry they altered, a
 * hash that recomputes from its own contents — which is the work the chain exists to make
 * necessary. `auditLogs` itself keeps exactly `insert` and `find`, as it has since migration 2.
 *
 * The explorer's filters ride the indexes migration 2 already created; the two added here are for
 * the combinations it introduced — outcome (every denial, ordered) and the actor dropdown.
 */

const AUDIT_ROLE = 'clinicAuditWriter'

async function authIsEnabled(db) {
  try {
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

/** sha256, hex. Rejecting anything else here means a malformed hash cannot enter the chain. */
const SHA256_HEX = { bsonType: 'string', pattern: '^[0-9a-f]{64}$' }

export const up = async (db) => {
  // ── auditChainHeads ───────────────────────────────────────────────────────
  await ensureCollection(db, 'auditChainHeads', {
    $jsonSchema: {
      bsonType: 'object',
      required: ['_id', 'hash'],
      properties: {
        // The clinic id. One head per clinic: chaining globally would make one clinic's write
        // volume another clinic's write contention.
        _id: { bsonType: 'string' },
        hash: SHA256_HEX,
        entryId: { bsonType: ['string', 'null'] },
        // How many links the chain holds. Handed out by the same compare-and-swap that moves
        // the hash, so it IS the chain's order rather than an approximation of it.
        seq: { bsonType: ['int', 'long', 'double'] },
        updatedAt: { bsonType: ['date', 'null'] },
        // The nightly verifier's bookmark. Not evidence — see the model.
        verifiedAt: { bsonType: ['date', 'null'] },
        verifiedHash: { bsonType: ['string', 'null'] },
        verifiedSeq: { bsonType: ['int', 'long', 'double', 'null'] },
        fullyVerifiedAt: { bsonType: ['date', 'null'] },
      },
    },
  })

  // ── auditLogs: the chain fields ───────────────────────────────────────────
  // Declared so the validator documents them and refuses a malformed hash. The genesis link is
  // 64 zeroes, which matches the same pattern, so the first entry in a clinic needs no exception.
  const audit = await db.listCollections({ name: 'auditLogs' }).toArray()
  if (audit.length > 0) {
    const existing = audit[0].options?.validator?.$jsonSchema
    if (existing) {
      await db.command({
        collMod: 'auditLogs',
        validator: {
          $jsonSchema: {
            ...existing,
            properties: {
              ...existing.properties,
              previousHash: SHA256_HEX,
              hash: SHA256_HEX,
              chainSeq: { bsonType: ['int', 'long', 'double'] },
            },
          },
        },
        validationLevel: 'strict',
        validationAction: 'error',
      })
    }

    const col = db.collection('auditLogs')
    // "Every denial, newest first" — the query a security review opens with.
    await col.createIndex({ clinicId: 1, outcome: 1, occurredAt: -1 }, { name: 'audit_outcome' })
    // The verifier's walk, in the chain's own order.
    //
    // Unique, and that uniqueness is a guard rather than a nicety: two entries at the same
    // position would mean the compare-and-swap failed to do its job, and the index refuses the
    // second write rather than admitting a fork into the log.
    //
    // **Partial, not sparse.** A compound sparse index only skips a document when *every* indexed
    // field is missing, and `clinicId` is always present — so every pre-chain entry would index
    // as `chainSeq: null` and collide with the next one. `partialFilterExpression` is what
    // actually excludes them.
    await col.createIndex(
      { clinicId: 1, chainSeq: 1 },
      {
        name: 'audit_chain_order',
        unique: true,
        partialFilterExpression: { chainSeq: { $exists: true } },
      },
    )
  }

  // ── notifications: one more type ──────────────────────────────────────────
  // The validator pins the enum, so a new notification type is a migration. Without this, the
  // first broken-chain alert would fail to insert — the alert failing exactly when it matters.
  const notifications = await db.listCollections({ name: 'notifications' }).toArray()
  const notificationSchema = notifications[0]?.options?.validator?.$jsonSchema
  if (notificationSchema?.properties?.type?.enum) {
    const types = notificationSchema.properties.type.enum
    if (!types.includes('AUDIT_CHAIN_BROKEN')) {
      await db.command({
        collMod: 'notifications',
        validator: {
          $jsonSchema: {
            ...notificationSchema,
            properties: {
              ...notificationSchema.properties,
              type: { enum: [...types, 'AUDIT_CHAIN_BROKEN'] },
            },
          },
        },
        validationLevel: 'strict',
        validationAction: 'error',
      })
    }
  }

  if (!(await authIsEnabled(db))) {
    console.warn(
      '[migration] mongod is running without authentication — skipping the grant of ' +
        `"update" on auditChainHeads to "${AUDIT_ROLE}". Expected for local development; ` +
        'staging and production MUST run with auth so the privilege separation is real.',
    )
    return
  }

  // grantPrivilegesToRole is additive and idempotent: the same privilege twice is one privilege.
  await db.command({
    grantPrivilegesToRole: AUDIT_ROLE,
    privileges: [
      {
        resource: { db: db.databaseName, collection: 'auditChainHeads' },
        // update, because advancing the head IS a compare-and-swap. Still no remove: a deleted
        // head would restart a clinic's chain at genesis, which is exactly what a verifier
        // must be able to notice.
        actions: ['insert', 'find', 'update'],
      },
    ],
  })
}

export const down = async (db) => {
  const existing = await db.listCollections({ name: 'auditChainHeads' }).toArray()
  if (existing.length > 0) await db.collection('auditChainHeads').drop()

  const audit = await db.listCollections({ name: 'auditLogs' }).toArray()
  if (audit.length > 0) {
    const col = db.collection('auditLogs')
    await col.dropIndex('audit_outcome').catch(() => {})
    await col.dropIndex('audit_chain_order').catch(() => {})
    await col.updateMany({}, { $unset: { chainSeq: '' } }).catch(() => {})
  }

  if (!(await authIsEnabled(db))) return
  await db
    .command({
      revokePrivilegesFromRole: AUDIT_ROLE,
      privileges: [
        {
          resource: { db: db.databaseName, collection: 'auditChainHeads' },
          actions: ['insert', 'find', 'update'],
        },
      ],
    })
    .catch(() => {})
}
