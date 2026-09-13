import { EncounterModel, newId, nextFormatted } from '@clinic/db'
import {
  decodeCursor,
  keysetAfter,
  pageFrom,
  sortFor,
  type Page,
  type SortKey,
} from '../../../pagination'
import type { CodeSystem, EncounterStatus, EncounterType, NoteStatus } from '@clinic/config'
import type { PersonRef } from '@clinic/contracts'

/** Mongoose hands back a Decimal128; the record speaks in the decimal strings a clinician typed. */
type Decimalish = { toString(): string } | string | number | null | undefined

const decimal = (value: Decimalish): string | null =>
  value === null || value === undefined ? null : String(value)

const whole = (value: number | null | undefined): number | null => value ?? null

export interface StoredVitals {
  heightCm: string | null
  weightKg: string | null
  temperatureC: string | null
  systolicMmHg: number | null
  diastolicMmHg: number | null
  heartRateBpm: number | null
  respiratoryRate: number | null
  oxygenSaturation: number | null
  bloodGlucose: string | null
  recordedAt: Date | null
  recordedBy: PersonRef | null
}

export interface StoredDiagnosis {
  id: string
  code: string
  codeSystem: CodeSystem
  description: string
  isPrimary: boolean
  isChronic: boolean
  notes: string | null
}

export interface StoredAddendum {
  id: string
  body: string
  author: PersonRef | null
  createdAt: Date | null
}

export interface StoredEncounter {
  id: string
  number: string
  patientId: string
  doctorId: string
  appointmentId: string | null
  patient: { name: string; medicalRecordNo: string; dateOfBirth: string | null }
  doctor: { name: string }
  encounterType: EncounterType
  chiefComplaint: string | null
  startedAt: Date
  endedAt: Date | null
  status: EncounterStatus
  note: {
    subjective: string | null
    objective: string | null
    assessment: string | null
    plan: string | null
    status: NoteStatus
    isPatientVisible: boolean
    signedAt: Date | null
    signedBy: PersonRef | null
    signatureHash: string | null
    addenda: StoredAddendum[]
  }
  vitals: StoredVitals | null
  diagnoses: StoredDiagnosis[]
  createdBy: PersonRef | null
}

interface EncounterRecord {
  _id: string
  number: string
  patientId: string
  doctorId: string
  appointmentId: string | null
  patient: { name: string; medicalRecordNo: string; dateOfBirth: string | null }
  doctor: { name: string }
  encounterType: EncounterType
  chiefComplaint: string | null
  startedAt: Date
  endedAt: Date | null
  status: EncounterStatus
  note?: {
    subjective: string | null
    objective: string | null
    assessment: string | null
    plan: string | null
    status: NoteStatus
    isPatientVisible: boolean
    signedAt: Date | null
    signedBy: PersonRef | null
    signatureHash: string | null
    addenda?: Array<{ _id: string; body: string; author: PersonRef | null; createdAt: Date | null }>
  }
  vitals?: Record<string, Decimalish> & { recordedAt?: Date | null; recordedBy?: PersonRef | null }
  diagnoses?: Array<{
    _id: string
    code: string
    codeSystem: CodeSystem
    description: string
    isPrimary: boolean
    isChronic: boolean
    notes: string | null
  }>
  createdBy: PersonRef | null
}

/** A vitals block where every measurement is empty was never recorded. */
function toVitals(raw: EncounterRecord['vitals']): StoredVitals | null {
  if (!raw || !raw.recordedAt) return null
  return {
    heightCm: decimal(raw.heightCm),
    weightKg: decimal(raw.weightKg),
    temperatureC: decimal(raw.temperatureC),
    systolicMmHg: whole(raw.systolicMmHg as number | null),
    diastolicMmHg: whole(raw.diastolicMmHg as number | null),
    heartRateBpm: whole(raw.heartRateBpm as number | null),
    respiratoryRate: whole(raw.respiratoryRate as number | null),
    oxygenSaturation: whole(raw.oxygenSaturation as number | null),
    bloodGlucose: decimal(raw.bloodGlucose),
    recordedAt: raw.recordedAt ?? null,
    recordedBy: raw.recordedBy ?? null,
  }
}

function toEncounter(doc: EncounterRecord): StoredEncounter {
  const note = doc.note
  return {
    id: doc._id,
    number: doc.number,
    patientId: doc.patientId,
    doctorId: doc.doctorId,
    appointmentId: doc.appointmentId ?? null,
    patient: doc.patient,
    doctor: doc.doctor,
    encounterType: doc.encounterType,
    chiefComplaint: doc.chiefComplaint ?? null,
    startedAt: doc.startedAt,
    endedAt: doc.endedAt ?? null,
    status: doc.status,
    note: {
      subjective: note?.subjective ?? null,
      objective: note?.objective ?? null,
      assessment: note?.assessment ?? null,
      plan: note?.plan ?? null,
      status: note?.status ?? 'DRAFT',
      isPatientVisible: Boolean(note?.isPatientVisible),
      signedAt: note?.signedAt ?? null,
      signedBy: note?.signedBy ?? null,
      signatureHash: note?.signatureHash ?? null,
      addenda: (note?.addenda ?? []).map((entry) => ({
        id: entry._id,
        body: entry.body,
        author: entry.author ?? null,
        createdAt: entry.createdAt ?? null,
      })),
    },
    vitals: toVitals(doc.vitals),
    diagnoses: (doc.diagnoses ?? []).map((entry) => ({
      id: entry._id,
      code: entry.code,
      codeSystem: entry.codeSystem,
      description: entry.description,
      isPrimary: Boolean(entry.isPrimary),
      isChronic: Boolean(entry.isChronic),
      notes: entry.notes ?? null,
    })),
    createdBy: doc.createdBy ?? null,
  }
}

/**
 * Newest visit first, the id breaking ties. `startedAt` is always set, which keyset paging needs:
 * a null in a sort field is compared by type, not value, and rows beyond it would be skipped.
 */
const LIST_ORDER: readonly SortKey[] = [
  { field: 'startedAt', direction: -1, kind: 'date' },
  { field: '_id', direction: -1, kind: 'string' },
]

/**
 * Section 7.5: hidden clinical content is never loaded into application memory and then
 * filtered — it is simply never read. This is that projection.
 */
const WITHOUT_NOTE_CONTENT = {
  'note.subjective': 0,
  'note.objective': 0,
  'note.assessment': 0,
  'note.plan': 0,
  'note.addenda': 0,
} as const

export const encounterRepository = {
  nextNumber(clinicId: string): Promise<string> {
    return nextFormatted(`encounter:${clinicId}`, 'ENC', 6)
  },

  async create(input: {
    clinicId: string
    number: string
    patientId: string
    doctorId: string
    appointmentId: string | null
    patient: { name: string; medicalRecordNo: string; dateOfBirth: string | null }
    doctor: { name: string }
    encounterType: EncounterType
    chiefComplaint: string | null
    startedAt: Date
    createdBy: PersonRef
  }): Promise<StoredEncounter> {
    const doc = await EncounterModel().create({ _id: newId(), ...input, status: 'OPEN' })
    return toEncounter(doc.toObject() as unknown as EncounterRecord)
  },

  async findById(
    clinicId: string,
    encounterId: string,
    options: { omitNoteContent?: boolean } = {},
  ): Promise<StoredEncounter | null> {
    const query = EncounterModel().findOne({ clinicId, _id: encounterId })
    if (options.omitNoteContent) query.select(WITHOUT_NOTE_CONTENT)
    const doc = (await query.lean()) as unknown as EncounterRecord | null
    return doc ? toEncounter(doc) : null
  },

  /**
   * Who the encounter belongs to, with no PHI read recorded: deciding whether someone may open
   * a chart is not the same act as reading it (section 11.3).
   */
  async findAccessFacts(
    clinicId: string,
    encounterId: string,
  ): Promise<{
    id: string
    patientId: string
    doctorId: string
    status: EncounterStatus
    noteStatus: NoteStatus
    isNoteVisible: boolean
  } | null> {
    const doc = (await EncounterModel()
      .findOne({ clinicId, _id: encounterId })
      .select({
        patientId: 1,
        doctorId: 1,
        status: 1,
        'note.status': 1,
        'note.isPatientVisible': 1,
      })
      .setOptions({ skipAudit: true })
      .lean()) as unknown as EncounterRecord | null
    if (!doc) return null
    return {
      id: doc._id,
      patientId: doc.patientId,
      doctorId: doc.doctorId,
      status: doc.status,
      noteStatus: doc.note?.status ?? 'DRAFT',
      isNoteVisible: Boolean(doc.note?.isPatientVisible),
    }
  },

  async findByAppointment(
    clinicId: string,
    appointmentId: string,
  ): Promise<StoredEncounter | null> {
    const doc = (await EncounterModel()
      .findOne({ clinicId, appointmentId })
      .lean()) as unknown as EncounterRecord | null
    return doc ? toEncounter(doc) : null
  },

  /**
   * A page of visits. Before Phase 10 this read at most 500 and said nothing about the rest.
   */
  async list(
    clinicId: string,
    filter: {
      patientId?: string
      doctorId?: string
      appointmentIds?: readonly string[]
      status?: EncounterStatus
      from?: Date
      to?: Date
      signedOnly?: boolean
      patientVisibleOnly?: boolean
    },
    page: { cursor?: string; limit: number },
    options: { omitNoteContent?: boolean } = {},
  ): Promise<Page<StoredEncounter>> {
    const where: Record<string, unknown> = { clinicId }
    if (filter.patientId) where.patientId = filter.patientId
    if (filter.doctorId) where.doctorId = filter.doctorId
    if (filter.appointmentIds) where.appointmentId = { $in: [...filter.appointmentIds] }
    if (filter.status) where.status = filter.status
    if (filter.signedOnly) where['note.status'] = 'SIGNED'
    if (filter.patientVisibleOnly) where['note.isPatientVisible'] = true
    if (filter.from || filter.to) {
      where.startedAt = {
        ...(filter.from ? { $gte: filter.from } : {}),
        ...(filter.to ? { $lt: filter.to } : {}),
      }
    }

    if (page.cursor)
      where.$and = [keysetAfter(LIST_ORDER, decodeCursor(page.cursor, LIST_ORDER.length))]

    const query = EncounterModel()
      .find(where)
      .sort(sortFor(LIST_ORDER))
      .limit(page.limit + 1)
    if (options.omitNoteContent) query.select(WITHOUT_NOTE_CONTENT)
    const docs = (await query.lean()) as unknown as Array<EncounterRecord & Record<string, unknown>>
    const { docs: rows, nextCursor } = pageFrom(docs, page.limit, LIST_ORDER)
    return { items: rows.map(toEncounter), nextCursor }
  },

  /** An access fact, not a chart read: has this doctor ever seen this patient (ADR-0004)? */
  async hasTreated(clinicId: string, doctorId: string, patientId: string): Promise<boolean> {
    const found = await EncounterModel()
      .exists({ clinicId, doctorId, patientId })
      .setOptions({ skipAudit: true })
    return found !== null
  },

  /**
   * "My patients" (D3), newest visit first, a page of ids the patients module then reads. Before
   * Phase 10: the most recent 500, and a doctor's 501st patient simply was not on their list.
   */
  async patientIdsTreatedBy(
    clinicId: string,
    doctorId: string,
    page: { cursor?: string; limit: number },
  ): Promise<Page<string>> {
    const order: readonly SortKey[] = [
      { field: 'lastSeen', direction: -1, kind: 'date' },
      { field: '_id', direction: -1, kind: 'string' },
    ]
    const rows = await EncounterModel()
      .aggregate<{ _id: string; lastSeen: Date } & Record<string, unknown>>([
        { $match: { clinicId, doctorId, deletedAt: null } },
        { $group: { _id: '$patientId', lastSeen: { $max: '$startedAt' } } },
        ...(page.cursor
          ? [{ $match: keysetAfter(order, decodeCursor(page.cursor, order.length)) }]
          : []),
        { $sort: sortFor(order) },
        { $limit: page.limit + 1 },
      ])
      .option({ skipAudit: true })
    const { docs, nextCursor } = pageFrom(rows, page.limit, order)
    return { items: docs.map((row) => row._id), nextCursor }
  },

  /**
   * Content changes carry `'note.status': 'DRAFT'` in the FILTER, not in a prior read: a note
   * that was signed between the check and the write must not be written (section 8.15).
   *
   * The encounter's own status is deliberately not `OPEN` here. Closing a visit and signing its
   * note are separate acts — a doctor finishes with the patient and writes the note up after —
   * so it is the note's status that decides whether the note can still be written.
   */
  async updateDraft(
    clinicId: string,
    encounterId: string,
    patch: Record<string, unknown>,
  ): Promise<StoredEncounter | null> {
    const doc = (await EncounterModel()
      .findOneAndUpdate(
        { clinicId, _id: encounterId, status: { $ne: 'CANCELLED' }, 'note.status': 'DRAFT' },
        { $set: patch },
        { new: true },
      )
      .lean()) as unknown as EncounterRecord | null
    return doc ? toEncounter(doc) : null
  },

  /** Metadata a signed encounter still accepts: who may read the note, and nothing it says. */
  async updateOpen(
    clinicId: string,
    encounterId: string,
    patch: Record<string, unknown>,
  ): Promise<StoredEncounter | null> {
    const doc = (await EncounterModel()
      .findOneAndUpdate({ clinicId, _id: encounterId }, { $set: patch }, { new: true })
      .lean()) as unknown as EncounterRecord | null
    return doc ? toEncounter(doc) : null
  },

  /** Signing is one atomic update with the precondition in the filter (ADR-0024). */
  async sign(
    clinicId: string,
    encounterId: string,
    signature: { signedAt: Date; signedBy: PersonRef; signatureHash: string },
  ): Promise<StoredEncounter | null> {
    const doc = (await EncounterModel()
      .findOneAndUpdate(
        { clinicId, _id: encounterId, 'note.status': 'DRAFT' },
        {
          $set: {
            'note.status': 'SIGNED',
            'note.signedAt': signature.signedAt,
            'note.signedBy': signature.signedBy,
            'note.signatureHash': signature.signatureHash,
          },
        },
        { new: true },
      )
      .lean()) as unknown as EncounterRecord | null
    return doc ? toEncounter(doc) : null
  },

  /** Append-only by construction: a $push cannot reach the content above it. */
  async addAddendum(
    clinicId: string,
    encounterId: string,
    addendum: { body: string; author: PersonRef },
  ): Promise<StoredEncounter | null> {
    const doc = (await EncounterModel()
      .findOneAndUpdate(
        { clinicId, _id: encounterId, 'note.status': 'SIGNED' },
        {
          $push: {
            'note.addenda': {
              _id: newId(),
              body: addendum.body,
              author: addendum.author,
              createdAt: new Date(),
            },
          },
        },
        { new: true },
      )
      .lean()) as unknown as EncounterRecord | null
    return doc ? toEncounter(doc) : null
  },

  async complete(clinicId: string, encounterId: string, at: Date): Promise<StoredEncounter | null> {
    const doc = (await EncounterModel()
      .findOneAndUpdate(
        { clinicId, _id: encounterId, status: 'OPEN' },
        { $set: { status: 'COMPLETED', endedAt: at } },
        { new: true },
      )
      .lean()) as unknown as EncounterRecord | null
    return doc ? toEncounter(doc) : null
  },
}
