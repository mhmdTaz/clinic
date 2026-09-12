/**
 * Phase 9: the devices a clinic pushes to (§9.4).
 *
 * Two things, and the second is the reason the first is safe to add.
 *
 * **`deviceTokens`**, keyed uniquely on the **token** rather than on the user. A push token
 * belongs to an app installation, and an installation changes hands: registering an existing
 * token reassigns it to whoever is signed in now, so a phone passed to a colleague stops buzzing
 * with the previous owner's appointments. Keyed on (user, device) instead, that row would be left
 * behind — and the person holding the phone would have no way to find it.
 *
 * **The notification channel enum gains `PUSH`.** The validator pins that enum, so without this
 * the first push-enabled notification would fail to insert — the delivery failing precisely when
 * the feature is switched on, which is the worst possible moment to discover a migration was
 * missed. (ARCHITECTURE §9.4 said `NotificationChannel.PUSH` was "already in the enum". It was
 * not; a plan can say that, an implementation has to settle it.)
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

const nullableString = { bsonType: ['string', 'null'] }
const nullableDate = { bsonType: ['date', 'null'] }

export const up = async (db) => {
  // ── deviceTokens ──────────────────────────────────────────────────────────
  await ensureCollection(db, 'deviceTokens', {
    $jsonSchema: {
      bsonType: 'object',
      required: ['_id', 'clinicId', 'userId', 'token', 'platform'],
      properties: {
        _id: { bsonType: 'string' },
        clinicId: { bsonType: 'string' },
        userId: { bsonType: 'string' },
        // Long enough to be a real address, short enough that nothing absurd is stored.
        token: { bsonType: 'string', minLength: 8, maxLength: 256 },
        platform: { enum: ['ios', 'android', 'web'] },
        deviceName: nullableString,
        appVersion: nullableString,
        lastSeenAt: nullableDate,
        failedAt: nullableDate,
        failureReason: nullableString,
      },
    },
  })

  const devices = db.collection('deviceTokens')
  // One row per token, whoever it currently belongs to. The uniqueness is what makes
  // registration an upsert rather than a source of duplicates.
  await devices.createIndex({ clinicId: 1, token: 1 }, { unique: true, name: 'device_token' })
  // "Your devices", newest first.
  await devices.createIndex({ clinicId: 1, userId: 1, lastSeenAt: -1 }, { name: 'device_owner' })

  // ── notifications: one more channel ───────────────────────────────────────
  const notifications = await db.listCollections({ name: 'notifications' }).toArray()
  const schema = notifications[0]?.options?.validator?.$jsonSchema
  const channelEnum = schema?.properties?.channels?.items?.properties?.channel?.enum

  if (channelEnum && !channelEnum.includes('PUSH')) {
    await db.command({
      collMod: 'notifications',
      validator: {
        $jsonSchema: {
          ...schema,
          properties: {
            ...schema.properties,
            channels: {
              ...schema.properties.channels,
              items: {
                ...schema.properties.channels.items,
                properties: {
                  ...schema.properties.channels.items.properties,
                  channel: { enum: [...channelEnum, 'PUSH'] },
                },
              },
            },
          },
        },
      },
      validationLevel: 'strict',
      validationAction: 'error',
    })
  }
}

export const down = async (db) => {
  const existing = await db.listCollections({ name: 'deviceTokens' }).toArray()
  if (existing.length > 0) await db.collection('deviceTokens').drop()

  // The channel enum is left widened. Narrowing it would refuse an update to any notification
  // already carrying a PUSH channel, which is a migration that fails on the data it created.
}
