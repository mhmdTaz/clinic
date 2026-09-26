/**
 * Phase 11: the tooth chart (ADR-0035).
 *
 * Three collections: `tooth_records`, the event log every mark on a tooth is a row of;
 * `dental_treatments`, the clinic's list of what can be charted and how it is drawn; and
 * `dental_quick_picks`, the one-tap presets. Patients gain the dentition their chart draws, and a
 * stored file can name the teeth it shows.
 *
 * The permissions are new keys, so a clinic migrated this far does not hold them yet: they are
 * granted here and the clinic's permission version moves, as in Phase 2. Staff are given write on
 * purpose — in a dental practice the front desk charts the visit after the dentist dictates it.
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
const nullableWholeNumber = { bsonType: ['int', 'long', 'double', 'null'] }
const calendarDate = { bsonType: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' }
const nullableCalendarDate = {
  bsonType: ['string', 'null'],
  pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$',
}
const personRef = {
  bsonType: ['object', 'null'],
  properties: { id: nullableString, name: nullableString },
}

/** FDI: quadrants 1–4 with positions 1–8, or 5–8 with positions 1–5 (ISO 3950). */
const fdiTooth = { bsonType: 'string', pattern: '^([1-4][1-8]|[5-8][1-5])$' }

const TOOTH_RECORD_STATUSES = ['CONDITION', 'PLANNED', 'COMPLETED', 'EXISTING']
const TOOTH_SURFACES = ['M', 'D', 'O', 'I', 'B', 'L']
const DENTITIONS = ['PERMANENT', 'PRIMARY', 'MIXED']
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
const DENTAL_SCOPES = ['TOOTH', 'SURFACE', 'SPAN', 'ARCH']
const TOOTH_ROLES = ['ABUTMENT', 'PONTIC', 'DENTURE_TOOTH']

const FILE_STATUSES = ['PENDING', 'SCANNING', 'CLEAN', 'INFECTED', 'FAILED']
const FILE_OWNER_TYPES = ['PATIENT', 'ENCOUNTER', 'PRESCRIPTION']
const FILE_CATEGORIES = [
  'LAB_RESULT',
  'IMAGING',
  'REFERRAL',
  'CONSENT',
  'PRESCRIPTION',
  'INSURANCE',
  'OTHER',
]

const NEW_GRANTS = [
  { role: 'admin', key: 'dental:read', scope: 'CLINIC' },
  { role: 'admin', key: 'dental:write', scope: 'CLINIC' },
  { role: 'admin', key: 'dental:configure', scope: 'CLINIC' },
  { role: 'staff', key: 'dental:read', scope: 'CLINIC' },
  { role: 'staff', key: 'dental:write', scope: 'CLINIC' },
  { role: 'doctor', key: 'dental:read', scope: 'ASSIGNED' },
  { role: 'doctor', key: 'dental:write', scope: 'ASSIGNED' },
]

// ── patients ──────────────────────────────────────────────────────────────────

const PATIENT_PROPERTIES = {
  _id: stringId,
  clinicId: { bsonType: 'string' },
  userId: nullableString,
  medicalRecordNo: { bsonType: 'string', pattern: '^MRN-[0-9]{6,}$' },
  firstName: { bsonType: 'string', minLength: 1 },
  lastName: { bsonType: 'string', minLength: 1 },
  dateOfBirth: nullableCalendarDate,
  gender: { enum: ['FEMALE', 'MALE', 'OTHER', 'UNDISCLOSED', null] },
  bloodType: { enum: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'UNKNOWN'] },
  emergencyContacts: { bsonType: 'array', maxItems: 5 },
  allergies: {
    bsonType: 'array',
    maxItems: 50,
    items: {
      bsonType: 'object',
      required: ['_id', 'substance'],
      properties: {
        _id: stringId,
        substance: { bsonType: 'string', minLength: 1 },
        reaction: nullableString,
        severity: { enum: ['MILD', 'MODERATE', 'SEVERE', 'UNKNOWN'] },
        notedAt: nullableDate,
      },
    },
  },
  chronicConditions: {
    bsonType: 'array',
    maxItems: 50,
    items: {
      bsonType: 'object',
      required: ['_id', 'description'],
      properties: {
        _id: stringId,
        code: nullableString,
        description: { bsonType: 'string', minLength: 1 },
        diagnosedAt: nullableCalendarDate,
        resolvedAt: nullableCalendarDate,
      },
    },
  },
  isActive: { bsonType: 'bool' },
  deletedAt: nullableDate,
}

const PATIENT_REQUIRED = [
  '_id',
  'clinicId',
  'medicalRecordNo',
  'firstName',
  'lastName',
  'bloodType',
]

const PATIENT_VALIDATOR = {
  $jsonSchema: {
    bsonType: 'object',
    required: PATIENT_REQUIRED,
    properties: { ...PATIENT_PROPERTIES, dentition: { enum: DENTITIONS } },
  },
}

/** As Phase 4 left it, so `down` restores exactly that. */
const PATIENT_VALIDATOR_BEFORE = {
  $jsonSchema: { bsonType: 'object', required: PATIENT_REQUIRED, properties: PATIENT_PROPERTIES },
}

// ── files ─────────────────────────────────────────────────────────────────────

const FILE_PROPERTIES = {
  _id: stringId,
  clinicId: { bsonType: 'string' },
  owner: {
    bsonType: 'object',
    required: ['type', 'id'],
    properties: { type: { enum: FILE_OWNER_TYPES }, id: { bsonType: 'string' } },
  },
  patientId: nullableString,
  category: { enum: FILE_CATEGORIES },
  storageKey: { bsonType: 'string', minLength: 1 },
  bucket: { bsonType: 'string' },
  fileName: { bsonType: 'string', minLength: 1 },
  mimeType: { bsonType: 'string' },
  sizeBytes: nullableWholeNumber,
  checksumSha256: nullableString,
  description: nullableString,
  status: { enum: FILE_STATUSES },
  scanResult: nullableString,
  isPatientVisible: { bsonType: 'bool' },
  confirmedAt: nullableDate,
  deletedAt: nullableDate,
}

const FILE_REQUIRED = ['_id', 'clinicId', 'owner', 'storageKey', 'bucket', 'fileName', 'mimeType']

const FILE_VALIDATOR = {
  $jsonSchema: {
    bsonType: 'object',
    required: FILE_REQUIRED,
    properties: {
      ...FILE_PROPERTIES,
      teeth: { bsonType: 'array', maxItems: 32, items: fdiTooth },
    },
  },
}

const FILE_VALIDATOR_BEFORE = {
  $jsonSchema: { bsonType: 'object', required: FILE_REQUIRED, properties: FILE_PROPERTIES },
}

// ── the chart ─────────────────────────────────────────────────────────────────

const TOOTH_RECORD_VALIDATOR = {
  $jsonSchema: {
    bsonType: 'object',
    required: [
      '_id',
      'clinicId',
      'patientId',
      'teeth',
      'treatmentId',
      'treatment',
      'status',
      'performedOn',
    ],
    properties: {
      _id: stringId,
      clinicId: { bsonType: 'string' },
      patientId: { bsonType: 'string' },
      encounterId: nullableString,
      teeth: {
        bsonType: 'array',
        minItems: 1,
        maxItems: 16,
        items: {
          bsonType: 'object',
          required: ['fdi'],
          properties: { fdi: fdiTooth, role: { enum: [...TOOTH_ROLES, null] } },
        },
      },
      surfaces: { bsonType: 'array', maxItems: 5, items: { enum: TOOTH_SURFACES } },
      treatmentId: { bsonType: 'string' },
      treatment: {
        bsonType: 'object',
        required: ['code', 'name', 'symbol', 'scope'],
        properties: {
          code: { bsonType: 'string', minLength: 1 },
          name: { bsonType: 'string', minLength: 1 },
          symbol: { enum: DENTAL_SYMBOLS },
          scope: { enum: DENTAL_SCOPES },
        },
      },
      status: { enum: TOOTH_RECORD_STATUSES },
      completesRecordId: nullableString,
      notes: nullableString,
      performedOn: calendarDate,
      doctorId: nullableString,
      doctor: personRef,
      recordedBy: personRef,
      voidedAt: nullableDate,
      voidedBy: personRef,
      voidReason: nullableString,
      deletedAt: nullableDate,
    },
  },
}

const DENTAL_TREATMENT_VALIDATOR = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['_id', 'clinicId', 'code', 'name', 'symbol', 'scope'],
    properties: {
      _id: stringId,
      clinicId: { bsonType: 'string' },
      code: { bsonType: 'string', pattern: '^[A-Z0-9_]{1,32}$' },
      name: { bsonType: 'string', minLength: 1 },
      symbol: { enum: DENTAL_SYMBOLS },
      scope: { enum: DENTAL_SCOPES },
      serviceId: nullableString,
      sortOrder: wholeNumber,
      isActive: { bsonType: 'bool' },
    },
  },
}

const DENTAL_QUICK_PICK_VALIDATOR = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['_id', 'clinicId', 'name', 'items'],
    properties: {
      _id: stringId,
      clinicId: { bsonType: 'string' },
      doctorId: nullableString,
      name: { bsonType: 'string', minLength: 1 },
      items: {
        bsonType: 'array',
        minItems: 1,
        maxItems: 10,
        items: {
          bsonType: 'object',
          required: ['treatmentId', 'status'],
          properties: {
            treatmentId: { bsonType: 'string' },
            surfaces: { bsonType: 'array', maxItems: 5, items: { enum: TOOTH_SURFACES } },
            status: { enum: TOOTH_RECORD_STATUSES },
          },
        },
      },
      sortOrder: wholeNumber,
      isActive: { bsonType: 'bool' },
    },
  },
}

const NEW_COLLECTIONS = ['tooth_records', 'dental_treatments', 'dental_quick_picks']
const FILE_TEETH_INDEX = 'file_teeth'

export const up = async (db) => {
  await ensureCollection(db, 'tooth_records', TOOTH_RECORD_VALIDATOR)
  const records = db.collection('tooth_records')
  await records.createIndex(
    { clinicId: 1, patientId: 1, performedOn: 1, createdAt: 1 },
    { name: 'tooth_record_chart' },
  )
  await records.createIndex(
    { clinicId: 1, patientId: 1, 'teeth.fdi': 1 },
    { name: 'tooth_record_tooth' },
  )
  await records.createIndex(
    { clinicId: 1, encounterId: 1 },
    { name: 'tooth_record_visit', sparse: true },
  )
  await records.createIndex(
    { clinicId: 1, status: 1, performedOn: 1 },
    { name: 'tooth_record_status' },
  )

  await ensureCollection(db, 'dental_treatments', DENTAL_TREATMENT_VALIDATOR)
  const treatments = db.collection('dental_treatments')
  await treatments.createIndex(
    { clinicId: 1, code: 1 },
    { unique: true, name: 'dental_treatment_code_unique' },
  )
  await treatments.createIndex(
    { clinicId: 1, isActive: 1, sortOrder: 1 },
    { name: 'dental_treatment_list' },
  )

  await ensureCollection(db, 'dental_quick_picks', DENTAL_QUICK_PICK_VALIDATOR)
  await db
    .collection('dental_quick_picks')
    .createIndex(
      { clinicId: 1, isActive: 1, doctorId: 1, sortOrder: 1 },
      { name: 'dental_quick_pick_list' },
    )

  await ensureCollection(db, 'patients', PATIENT_VALIDATOR)

  await ensureCollection(db, 'files', FILE_VALIDATOR)
  await db
    .collection('files')
    .createIndex({ clinicId: 1, patientId: 1, teeth: 1 }, { name: FILE_TEETH_INDEX })

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

  const files = db.collection('files')
  const indexes = await files.indexes()
  if (indexes.some((index) => index.name === FILE_TEETH_INDEX))
    await files.dropIndex(FILE_TEETH_INDEX)
  await ensureCollection(db, 'files', FILE_VALIDATOR_BEFORE)
  await files.updateMany({}, { $unset: { teeth: '' } })

  await ensureCollection(db, 'patients', PATIENT_VALIDATOR_BEFORE)
  await db.collection('patients').updateMany({}, { $unset: { dentition: '' } })

  for (const name of NEW_COLLECTIONS) {
    const existing = await db.listCollections({ name }).toArray()
    if (existing.length > 0) await db.collection(name).drop()
  }
}
