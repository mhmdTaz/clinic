/**
 * Creates the collections the walking skeleton needs, with their indexes and
 * $jsonSchema validators (ARCHITECTURE.md sections 8.5 and 8.15).
 *
 * The validator is the second line of defence behind Mongoose: it rejects writes
 * from anything that is not the application — a mongosh session, an import script.
 */

/** Create the collection with a validator, or update the validator if it exists. */
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

const stringId = { bsonType: 'string', description: 'cuid2, not an ObjectId (section 8.3)' }

export const up = async (db) => {
  await ensureCollection(db, 'clinics', {
    $jsonSchema: {
      bsonType: 'object',
      required: ['_id', 'name', 'timezone', 'currency', 'locale', 'permissionVersion'],
      properties: {
        _id: stringId,
        name: { bsonType: 'string', minLength: 1 },
        timezone: { bsonType: 'string' },
        currency: { bsonType: 'string', minLength: 3, maxLength: 3 },
        locale: { bsonType: 'string' },
        permissionVersion: { bsonType: 'int' },
        branches: { bsonType: 'array' },
        holidays: { bsonType: 'array' },
        isActive: { bsonType: 'bool' },
      },
    },
  })
  await db.collection('clinics').createIndex({ isActive: 1 }, { name: 'clinic_active' })

  await ensureCollection(db, 'roles', {
    $jsonSchema: {
      bsonType: 'object',
      required: ['_id', 'clinicId', 'key', 'name'],
      properties: {
        _id: stringId,
        clinicId: { bsonType: 'string' },
        key: { bsonType: 'string', minLength: 1 },
        name: { bsonType: 'string', minLength: 1 },
        isSystem: { bsonType: 'bool' },
        priority: { bsonType: 'int' },
        permissions: {
          bsonType: 'array',
          items: {
            bsonType: 'object',
            required: ['key', 'scope'],
            properties: {
              key: { bsonType: 'string' },
              scope: { enum: ['OWN', 'ASSIGNED', 'CLINIC', 'GLOBAL'] },
            },
          },
        },
      },
    },
  })
  await db
    .collection('roles')
    .createIndex({ clinicId: 1, key: 1 }, { unique: true, name: 'role_key_unique' })
  await db.collection('roles').createIndex({ clinicId: 1, priority: -1 }, { name: 'role_priority' })

  await ensureCollection(db, 'users', {
    $jsonSchema: {
      bsonType: 'object',
      required: ['_id', 'clinicId', 'email', 'firstName', 'lastName', 'status'],
      properties: {
        _id: stringId,
        clinicId: { bsonType: 'string' },
        // Deliberately loose: a backstop against garbage written outside the app, not
        // the real email rule. Zod validates properly at the API boundary.
        email: { bsonType: 'string', pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$' },
        firstName: { bsonType: 'string', minLength: 1 },
        lastName: { bsonType: 'string', minLength: 1 },
        status: { enum: ['INVITED', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED'] },
        preferredPortal: { enum: ['admin', 'staff', 'doctor', 'patient', null] },
        roles: { bsonType: 'array' },
        deletedAt: { bsonType: ['date', 'null'] },
      },
    },
  })
  // partialFilterExpression is what makes unique-plus-soft-delete work: a deactivated
  // user must not reserve their email address forever.
  await db.collection('users').createIndex(
    { clinicId: 1, email: 1 },
    {
      unique: true,
      name: 'user_email_unique',
      collation: { locale: 'en', strength: 2 },
      partialFilterExpression: { deletedAt: null },
    },
  )
  await db.collection('users').createIndex({ clinicId: 1, status: 1 }, { name: 'user_status' })
  await db.collection('users').createIndex({ 'roles.roleId': 1 }, { name: 'user_roles' })

  await db.collection('counters').createIndex({ _id: 1 }, { name: 'counter_id' })
}

export const down = async (db) => {
  for (const name of ['users', 'roles', 'clinics', 'counters']) {
    const existing = await db.listCollections({ name }).toArray()
    if (existing.length > 0) await db.collection(name).drop()
  }
}
