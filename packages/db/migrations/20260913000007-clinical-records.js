/**
 * Phase 4: the clinical record. Encounters with their embedded note, vitals and diagnoses;
 * prescriptions as their own collection; stored files; and the allergies and chronic conditions
 * that make the chart banner cost nothing to render (sections 8.6, 8.8, 8.9).
 *
 * The signed-note guard lives here as well as in the repository. The repository's conditional
 * update is the mechanism; this validator is the belt to that brace (section 8.15) — a note that
 * is SIGNED must carry a signature, and no write can leave it half-signed.
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
const nullableDecimal = { bsonType: ['decimal', 'null'] }
const nullableWholeNumber = { bsonType: ['int', 'long', 'double', 'null'] }
const nullableCalendarDate = {
  bsonType: ['string', 'null'],
  pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$',
}

const ENCOUNTER_STATUSES = ['OPEN', 'COMPLETED', 'CANCELLED']
const ENCOUNTER_TYPES = ['CONSULTATION', 'FOLLOW_UP', 'PROCEDURE', 'EMERGENCY', 'TELEHEALTH']
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

/** The patients validator with the clinical history Phase 4 embeds. */
const PATIENT_VALIDATOR = {
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
    },
  },
}

/** The patients validator as Phase 2 left it, so `down` restores exactly that. */
const PATIENT_VALIDATOR_BEFORE = {
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
      dateOfBirth: nullableCalendarDate,
      gender: { enum: ['FEMALE', 'MALE', 'OTHER', 'UNDISCLOSED', null] },
      bloodType: { enum: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'UNKNOWN'] },
      emergencyContacts: { bsonType: 'array', maxItems: 5 },
      isActive: { bsonType: 'bool' },
      deletedAt: nullableDate,
    },
  },
}

export const up = async (db) => {
  // ── encounters ────────────────────────────────────────────────────────────
  await ensureCollection(db, 'encounters', {
    $jsonSchema: {
      bsonType: 'object',
      required: ['_id', 'clinicId', 'number', 'patientId', 'doctorId', 'status'],
      properties: {
        _id: stringId,
        clinicId: { bsonType: 'string' },
        number: { bsonType: 'string', pattern: '^ENC-[0-9]{6,}$' },
        patientId: { bsonType: 'string' },
        doctorId: { bsonType: 'string' },
        appointmentId: nullableString,
        encounterType: { enum: ENCOUNTER_TYPES },
        chiefComplaint: nullableString,
        startedAt: { bsonType: 'date' },
        endedAt: nullableDate,
        status: { enum: ENCOUNTER_STATUSES },
        note: {
          bsonType: 'object',
          required: ['status'],
          properties: {
            subjective: nullableString,
            objective: nullableString,
            assessment: nullableString,
            plan: nullableString,
            isPatientVisible: { bsonType: 'bool' },
            status: { enum: ['DRAFT', 'SIGNED'] },
            signedAt: nullableDate,
            signatureHash: nullableString,
            addenda: { bsonType: 'array', maxItems: 100 },
          },
        },
        vitals: {
          bsonType: 'object',
          properties: {
            heightCm: nullableDecimal,
            weightKg: nullableDecimal,
            temperatureC: nullableDecimal,
            systolicMmHg: nullableWholeNumber,
            diastolicMmHg: nullableWholeNumber,
            heartRateBpm: nullableWholeNumber,
            respiratoryRate: nullableWholeNumber,
            oxygenSaturation: nullableWholeNumber,
            bloodGlucose: nullableDecimal,
            recordedAt: nullableDate,
          },
        },
        diagnoses: {
          bsonType: 'array',
          maxItems: 20,
          items: {
            bsonType: 'object',
            required: ['_id', 'code', 'description'],
            properties: {
              _id: stringId,
              code: { bsonType: 'string', minLength: 1 },
              codeSystem: { enum: ['ICD10'] },
              description: { bsonType: 'string', minLength: 1 },
              isPrimary: { bsonType: 'bool' },
              isChronic: { bsonType: 'bool' },
              notes: nullableString,
            },
          },
        },
        deletedAt: nullableDate,
      },
    },
  })
  const encounters = db.collection('encounters')
  await encounters.createIndex(
    { clinicId: 1, patientId: 1, startedAt: -1 },
    { name: 'encounter_chart' },
  )
  await encounters.createIndex(
    { clinicId: 1, doctorId: 1, startedAt: -1 },
    { name: 'encounter_doctor' },
  )
  await encounters.createIndex({ clinicId: 1, startedAt: -1 }, { name: 'encounter_recent' })
  await encounters.createIndex({ clinicId: 1, 'diagnoses.code': 1 }, { name: 'encounter_icd10' })
  await encounters.createIndex(
    { clinicId: 1, appointmentId: 1 },
    { name: 'encounter_appointment', sparse: true },
  )
  await encounters.createIndex(
    { clinicId: 1, number: 1 },
    { unique: true, name: 'encounter_number_unique' },
  )

  // ── prescriptions ─────────────────────────────────────────────────────────
  await ensureCollection(db, 'prescriptions', {
    $jsonSchema: {
      bsonType: 'object',
      required: ['_id', 'clinicId', 'number', 'encounterId', 'patientId', 'doctorId'],
      properties: {
        _id: stringId,
        clinicId: { bsonType: 'string' },
        number: { bsonType: 'string', pattern: '^RX-[0-9]{6,}$' },
        encounterId: { bsonType: 'string' },
        patientId: { bsonType: 'string' },
        doctorId: { bsonType: 'string' },
        issuedAt: { bsonType: 'date' },
        validUntil: nullableCalendarDate,
        notes: nullableString,
        items: {
          bsonType: 'array',
          minItems: 1,
          maxItems: 20,
          items: {
            bsonType: 'object',
            required: ['_id', 'drugName', 'dosage', 'frequency'],
            properties: {
              _id: stringId,
              drugName: { bsonType: 'string', minLength: 1 },
              strength: nullableString,
              form: nullableString,
              dosage: { bsonType: 'string', minLength: 1 },
              frequency: { bsonType: 'string', minLength: 1 },
              durationDays: nullableWholeNumber,
              quantity: nullableWholeNumber,
              instructions: nullableString,
              isRefillable: { bsonType: 'bool' },
            },
          },
        },
        pdfFileId: nullableString,
        deletedAt: nullableDate,
      },
    },
  })
  const prescriptions = db.collection('prescriptions')
  await prescriptions.createIndex(
    { clinicId: 1, patientId: 1, issuedAt: -1 },
    { name: 'prescription_patient' },
  )
  await prescriptions.createIndex(
    { clinicId: 1, encounterId: 1 },
    { name: 'prescription_encounter' },
  )
  await prescriptions.createIndex(
    { clinicId: 1, patientId: 1, validUntil: -1 },
    { name: 'prescription_active' },
  )
  await prescriptions.createIndex(
    { clinicId: 1, number: 1 },
    { unique: true, name: 'prescription_number_unique' },
  )

  // ── files ─────────────────────────────────────────────────────────────────
  await ensureCollection(db, 'files', {
    $jsonSchema: {
      bsonType: 'object',
      required: ['_id', 'clinicId', 'owner', 'storageKey', 'bucket', 'fileName', 'mimeType'],
      properties: {
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
      },
    },
  })
  const files = db.collection('files')
  // One object, one row: a storage key cannot be claimed by a second file document.
  await files.createIndex({ storageKey: 1 }, { unique: true, name: 'file_storage_key_unique' })
  await files.createIndex(
    { clinicId: 1, 'owner.type': 1, 'owner.id': 1, createdAt: -1 },
    { name: 'file_owner' },
  )
  await files.createIndex({ clinicId: 1, patientId: 1, createdAt: -1 }, { name: 'file_vault' })
  await files.createIndex({ clinicId: 1, category: 1, createdAt: -1 }, { name: 'file_category' })
  await files.createIndex({ status: 1, createdAt: 1 }, { name: 'file_pending_sweep' })

  // ── patients: the chart banner ────────────────────────────────────────────
  await ensureCollection(db, 'patients', PATIENT_VALIDATOR)
}

export const down = async (db) => {
  for (const name of ['encounters', 'prescriptions', 'files']) {
    const existing = await db.listCollections({ name }).toArray()
    if (existing.length > 0) await db.collection(name).drop()
  }
  await ensureCollection(db, 'patients', PATIENT_VALIDATOR_BEFORE)
  await db
    .collection('patients')
    .updateMany({}, { $unset: { allergies: '', chronicConditions: '' } })
}
