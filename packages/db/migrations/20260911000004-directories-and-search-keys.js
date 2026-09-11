/**
 * Phase 2: the patient and doctor directories, the specialty vocabulary, search keys on
 * users, calendar-date holidays, and the permissions Phase 2 adds to the system roles.
 *
 * The key functions below are a frozen copy of @clinic/config's text-keys as they were when
 * this migration was written. A migration must replay identically forever, so it does not
 * import code that may change after it.
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

function nameKey(value) {
  if (typeof value !== 'string') return null
  const key = value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
  return key === '' ? null : key
}

function emailKey(value) {
  if (typeof value !== 'string') return null
  const key = value.trim().toLowerCase()
  return key === '' ? null : key
}

const stringId = { bsonType: 'string' }
const nullableString = { bsonType: ['string', 'null'] }
const nullableDate = { bsonType: ['date', 'null'] }
const calendarDate = { bsonType: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' }

const CLINIC_VALIDATOR = {
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
      holidays: {
        bsonType: 'array',
        maxItems: 200,
        items: {
          bsonType: 'object',
          required: ['date', 'name'],
          properties: {
            date: calendarDate,
            name: { bsonType: 'string' },
            branchId: nullableString,
          },
        },
      },
      isActive: { bsonType: 'bool' },
    },
  },
}

/** The 0001 validator, restored on the way down. */
const CLINIC_VALIDATOR_BEFORE = {
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
}

/** Permissions added to the catalogue in Phase 2, granted to the system roles that need them. */
const NEW_GRANTS = [
  { role: 'admin', key: 'specialty:manage', scope: 'CLINIC' },
  { role: 'admin', key: 'user:reset_password', scope: 'CLINIC' },
  { role: 'staff', key: 'specialty:manage', scope: 'CLINIC' },
]

const USER_SEARCH_INDEXES = ['user_search_name', 'user_search_first_name', 'user_search_email']

export const up = async (db) => {
  // ── patients ──────────────────────────────────────────────────────────────
  await ensureCollection(db, 'patients', {
    $jsonSchema: {
      bsonType: 'object',
      required: ['_id', 'clinicId', 'medicalRecordNo', 'firstName', 'lastName', 'bloodType'],
      properties: {
        _id: stringId,
        clinicId: { bsonType: 'string' },
        userId: nullableString,
        medicalRecordNo: { bsonType: 'string', pattern: '^MRN-[0-9]{6,}$' },
        firstName: { bsonType: 'string', minLength: 1 },
        lastName: { bsonType: 'string', minLength: 1 },
        dateOfBirth: { bsonType: ['string', 'null'], pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' },
        gender: { enum: ['FEMALE', 'MALE', 'OTHER', 'UNDISCLOSED', null] },
        bloodType: { enum: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'UNKNOWN'] },
        emergencyContacts: { bsonType: 'array', maxItems: 5 },
        isActive: { bsonType: 'bool' },
        deletedAt: nullableDate,
      },
    },
  })
  const patients = db.collection('patients')
  await patients.createIndex(
    { clinicId: 1, medicalRecordNo: 1 },
    { unique: true, name: 'patient_mrn_unique', partialFilterExpression: { deletedAt: null } },
  )
  await patients.createIndex(
    { clinicId: 1, 'search.lastName': 1, 'search.firstName': 1, dateOfBirth: 1 },
    { name: 'patient_name_dob' },
  )
  await patients.createIndex({ clinicId: 1, 'search.firstName': 1 }, { name: 'patient_first_name' })
  await patients.createIndex({ clinicId: 1, 'search.phone': 1 }, { name: 'patient_phone' })
  await patients.createIndex(
    { clinicId: 1, 'search.nationalId': 1 },
    { name: 'patient_national_id' },
  )
  await patients.createIndex({ clinicId: 1, 'search.email': 1 }, { name: 'patient_email' })
  await patients.createIndex({ clinicId: 1, userId: 1 }, { name: 'patient_user' })
  await patients.createIndex(
    { userId: 1, clinicId: 1 },
    {
      unique: true,
      name: 'patient_user_unique',
      partialFilterExpression: { userId: { $type: 'string' }, deletedAt: null },
    },
  )

  // ── doctors ───────────────────────────────────────────────────────────────
  await ensureCollection(db, 'doctors', {
    $jsonSchema: {
      bsonType: 'object',
      required: ['_id', 'clinicId', 'userId', 'defaultSlotMinutes'],
      properties: {
        _id: stringId,
        clinicId: { bsonType: 'string' },
        userId: { bsonType: 'string' },
        consultationFee: { bsonType: ['decimal', 'null'] },
        defaultSlotMinutes: { enum: [10, 15, 20, 30, 45, 60] },
        yearsOfExperience: { bsonType: ['int', 'long', 'double', 'null'], minimum: 0 },
        specialties: { bsonType: 'array', maxItems: 5 },
        branchIds: { bsonType: 'array' },
        isActive: { bsonType: 'bool' },
        deletedAt: nullableDate,
      },
    },
  })
  const doctors = db.collection('doctors')
  await doctors.createIndex({ clinicId: 1, isActive: 1 }, { name: 'doctor_active' })
  await doctors.createIndex(
    { clinicId: 1, userId: 1 },
    { unique: true, name: 'doctor_user_unique', partialFilterExpression: { deletedAt: null } },
  )
  await doctors.createIndex({ clinicId: 1, 'specialties.id': 1 }, { name: 'doctor_specialty' })

  // ── specialties ───────────────────────────────────────────────────────────
  await ensureCollection(db, 'specialties', {
    $jsonSchema: {
      bsonType: 'object',
      required: ['_id', 'clinicId', 'name'],
      properties: {
        _id: stringId,
        clinicId: { bsonType: 'string' },
        name: { bsonType: 'string', minLength: 1 },
        isActive: { bsonType: 'bool' },
      },
    },
  })
  await db
    .collection('specialties')
    .createIndex({ clinicId: 1, 'search.name': 1 }, { unique: true, name: 'specialty_name_unique' })

  // ── users: search keys, backfilled for accounts that already exist ─────────
  const users = db.collection('users')
  for await (const user of users.find(
    {},
    { projection: { firstName: 1, lastName: 1, email: 1 } },
  )) {
    await users.updateOne(
      { _id: user._id },
      {
        $set: {
          'search.firstName': nameKey(user.firstName),
          'search.lastName': nameKey(user.lastName),
          'search.email': emailKey(user.email),
        },
      },
    )
  }
  await users.createIndex(
    { clinicId: 1, 'search.lastName': 1, 'search.firstName': 1 },
    { name: 'user_search_name' },
  )
  await users.createIndex(
    { clinicId: 1, 'search.firstName': 1 },
    { name: 'user_search_first_name' },
  )
  await users.createIndex({ clinicId: 1, 'search.email': 1 }, { name: 'user_search_email' })

  // ── clinics: holidays are calendar-date strings from now on ────────────────
  await db.command({
    collMod: 'clinics',
    validator: CLINIC_VALIDATOR,
    validationLevel: 'strict',
    validationAction: 'error',
  })

  // ── roles: grant the new permissions, and move every session onto them ────
  let changed = 0
  for (const grant of NEW_GRANTS) {
    const result = await db
      .collection('roles')
      .updateMany(
        { key: grant.role, isSystem: true, 'permissions.key': { $ne: grant.key } },
        { $push: { permissions: { key: grant.key, scope: grant.scope } } },
      )
    changed += result.modifiedCount
  }
  if (changed > 0) await db.collection('clinics').updateMany({}, { $inc: { permissionVersion: 1 } })
}

export const down = async (db) => {
  let changed = 0
  for (const grant of NEW_GRANTS) {
    const result = await db
      .collection('roles')
      .updateMany(
        { key: grant.role, isSystem: true },
        { $pull: { permissions: { key: grant.key } } },
      )
    changed += result.modifiedCount
  }
  if (changed > 0) await db.collection('clinics').updateMany({}, { $inc: { permissionVersion: 1 } })

  await db.command({
    collMod: 'clinics',
    validator: CLINIC_VALIDATOR_BEFORE,
    validationLevel: 'strict',
    validationAction: 'error',
  })

  const users = db.collection('users')
  const indexes = await users.indexes()
  for (const name of USER_SEARCH_INDEXES) {
    if (indexes.some((index) => index.name === name)) await users.dropIndex(name)
  }
  await users.updateMany({}, { $unset: { search: '' } })

  for (const name of ['specialties', 'doctors', 'patients']) {
    const existing = await db.listCollections({ name }).toArray()
    if (existing.length > 0) await db.collection(name).drop()
  }
}
