import { PatientModel, newId, nextFormatted } from '@clinic/db'
import { escapeRegex } from '@clinic/config'
import type { BloodType, Gender, PatientInput, PersonRef } from '@clinic/contracts'
import { afterCursor, decodeCursor, encodeCursor, type Page } from '../../../pagination'
import { sessionOf, type Transaction } from '../../../transaction'
import type { MatchKeys } from '../domain/duplicates'
import type { PatientQuery } from '../domain/records'

export interface StoredPatient {
  id: string
  userId: string | null
  medicalRecordNo: string
  firstName: string
  lastName: string
  dateOfBirth: string | null
  gender: Gender | null
  nationalId: string | null
  bloodType: BloodType
  contact: { phone: string | null; email: string | null }
  address: { line1: string | null; city: string | null; country: string | null }
  emergencyContacts: Array<{ name: string; relationship: string | null; phone: string }>
  /** The chart banner, embedded so it renders with no second query (section 8.6). */
  allergies: Array<{
    id: string
    substance: string
    reaction: string | null
    severity: string
    notedAt: Date | null
  }>
  chronicConditions: Array<{
    id: string
    code: string | null
    description: string
    diagnosedAt: string | null
    resolvedAt: string | null
  }>
  adminNotes: string | null
  isActive: boolean
  createdAt: Date | null
  updatedAt: Date | null
  createdBy: PersonRef | null
}

interface PatientRecord {
  _id: string
  userId?: string | null
  medicalRecordNo: string
  firstName: string
  lastName: string
  dateOfBirth?: string | null
  gender?: string | null
  nationalId?: string | null
  bloodType?: string | null
  contact?: { phone?: string | null; email?: string | null } | null
  address?: { line1?: string | null; city?: string | null; country?: string | null } | null
  emergencyContacts?: Array<{ name: string; relationship?: string | null; phone: string }> | null
  allergies?: Array<{
    _id: string
    substance: string
    reaction?: string | null
    severity?: string | null
    notedAt?: Date | null
  }> | null
  chronicConditions?: Array<{
    _id: string
    code?: string | null
    description: string
    diagnosedAt?: string | null
    resolvedAt?: string | null
  }> | null
  adminNotes?: string | null
  isActive?: boolean | null
  createdAt?: Date | null
  updatedAt?: Date | null
  createdBy?: { id?: string | null; name?: string | null } | null
  search?: { firstName?: string | null; lastName?: string | null } | null
}

function toPatient(doc: PatientRecord): StoredPatient {
  return {
    id: doc._id,
    userId: doc.userId ?? null,
    medicalRecordNo: doc.medicalRecordNo,
    firstName: doc.firstName,
    lastName: doc.lastName,
    dateOfBirth: doc.dateOfBirth ?? null,
    gender: (doc.gender ?? null) as Gender | null,
    nationalId: doc.nationalId ?? null,
    bloodType: (doc.bloodType ?? 'UNKNOWN') as BloodType,
    contact: { phone: doc.contact?.phone ?? null, email: doc.contact?.email ?? null },
    address: {
      line1: doc.address?.line1 ?? null,
      city: doc.address?.city ?? null,
      country: doc.address?.country ?? null,
    },
    emergencyContacts: (doc.emergencyContacts ?? []).map((contact) => ({
      name: contact.name,
      relationship: contact.relationship ?? null,
      phone: contact.phone,
    })),
    allergies: (doc.allergies ?? []).map((allergy) => ({
      id: allergy._id,
      substance: allergy.substance,
      reaction: allergy.reaction ?? null,
      severity: allergy.severity ?? 'UNKNOWN',
      notedAt: allergy.notedAt ?? null,
    })),
    chronicConditions: (doc.chronicConditions ?? []).map((condition) => ({
      id: condition._id,
      code: condition.code ?? null,
      description: condition.description,
      diagnosedAt: condition.diagnosedAt ?? null,
      resolvedAt: condition.resolvedAt ?? null,
    })),
    adminNotes: doc.adminNotes ?? null,
    isActive: doc.isActive ?? true,
    createdAt: doc.createdAt ?? null,
    updatedAt: doc.updatedAt ?? null,
    createdBy: doc.createdBy?.name
      ? { id: doc.createdBy.id ?? null, name: doc.createdBy.name }
      : null,
  }
}

const SORT_FIELDS = ['search.lastName', 'search.firstName', '_id'] as const
const startsWith = (value: string) => ({ $regex: `^${escapeRegex(value)}` })

function queryFilter(query: PatientQuery): Record<string, unknown> | null {
  switch (query.kind) {
    case 'mrn':
      return { medicalRecordNo: query.value }
    case 'phone':
      return { 'search.phone': query.value }
    case 'text': {
      const branches: Array<Record<string, unknown>> = []
      if (query.name) {
        branches.push({ 'search.lastName': startsWith(query.name) })
        branches.push({ 'search.firstName': startsWith(query.name) })
      }
      if (query.first && query.rest) {
        branches.push({
          'search.firstName': startsWith(query.first),
          'search.lastName': startsWith(query.rest),
        })
        branches.push({
          'search.lastName': startsWith(query.first),
          'search.firstName': startsWith(query.rest),
        })
      }
      if (query.nationalId) branches.push({ 'search.nationalId': query.nationalId })
      return branches.length > 0 ? { $or: branches } : null
    }
  }
}

function writableFields(input: PatientInput) {
  return {
    firstName: input.firstName,
    lastName: input.lastName,
    dateOfBirth: input.dateOfBirth,
    gender: input.gender,
    nationalId: input.nationalId,
    bloodType: input.bloodType,
    contact: { phone: input.contact.phone, email: input.contact.email },
    address: {
      line1: input.address.line1,
      city: input.address.city,
      country: input.address.country,
    },
    emergencyContacts: input.emergencyContacts.map((contact) => ({
      name: contact.name,
      relationship: contact.relationship,
      phone: contact.phone,
    })),
    adminNotes: input.adminNotes,
  }
}

/**
 * Every find on this collection is recorded as a view of the records it returned (section
 * 11.3). Reads that decide whether someone may look at all pass `skipAudit`, so a refused
 * request never counts as having seen anything.
 */
export const patientRepository = {
  nextMedicalRecordNo(clinicId: string): Promise<string> {
    return nextFormatted(`mrn:${clinicId}`, 'MRN', 6)
  },

  /** The record linked to an account, for the `pid` claim. Not a view of the record. */
  async findIdByUserId(clinicId: string, userId: string): Promise<string | null> {
    const doc = (await PatientModel()
      .findOne({ clinicId, userId })
      .select({ _id: 1 })
      .setOptions({ skipAudit: true })
      .lean()) as unknown as { _id: string } | null
    return doc?._id ?? null
  },

  /** What an authorisation decision needs — the linked account — without viewing the record. */
  async findAccessFacts(
    clinicId: string,
    patientId: string,
  ): Promise<{ id: string; userId: string | null; isActive: boolean } | null> {
    const doc = (await PatientModel()
      .findOne({ clinicId, _id: patientId })
      .select({ userId: 1, isActive: 1 })
      .setOptions({ skipAudit: true })
      .lean()) as unknown as { _id: string; userId?: string | null; isActive?: boolean } | null
    return doc ? { id: doc._id, userId: doc.userId ?? null, isActive: doc.isActive ?? true } : null
  },

  async findById(clinicId: string, patientId: string): Promise<StoredPatient | null> {
    const doc = await PatientModel().findOne({ clinicId, _id: patientId }).lean()
    return doc ? toPatient(doc as unknown as PatientRecord) : null
  },

  async list(
    clinicId: string,
    filter: {
      query: PatientQuery | null
      active: boolean
      userId?: string
      limit: number
      cursor?: string
    },
  ): Promise<Page<StoredPatient>> {
    const where: Record<string, unknown> = { clinicId, isActive: filter.active }
    if (filter.userId) where.userId = filter.userId

    const conditions: Array<Record<string, unknown>> = []
    const search = filter.query ? queryFilter(filter.query) : null
    if (search) conditions.push(search)
    if (filter.cursor) conditions.push(afterCursor(SORT_FIELDS, decodeCursor(filter.cursor, 3)))
    if (conditions.length > 0) where.$and = conditions

    const docs = (await PatientModel()
      .find(where)
      .sort({ 'search.lastName': 1, 'search.firstName': 1, _id: 1 })
      .limit(filter.limit + 1)
      .lean()) as unknown as PatientRecord[]

    const page = docs.slice(0, filter.limit)
    const last = page.at(-1)
    return {
      items: page.map(toPatient),
      nextCursor:
        docs.length > filter.limit && last
          ? encodeCursor([last.search?.lastName ?? null, last.search?.firstName ?? null, last._id])
          : null,
    }
  },

  /** Records sharing any duplicate signal — archived ones too (ADR-0020). At most twenty. */
  async findCandidates(
    clinicId: string,
    keys: MatchKeys,
    excludeId: string | null,
  ): Promise<StoredPatient[]> {
    const branches: Array<Record<string, unknown>> = []
    if (keys.nationalId) branches.push({ 'search.nationalId': keys.nationalId })
    if (keys.phone) branches.push({ 'search.phone': keys.phone })
    if (keys.email) branches.push({ 'search.email': keys.email })
    if (keys.firstName && keys.lastName && keys.dateOfBirth) {
      branches.push({
        'search.lastName': keys.lastName,
        'search.firstName': keys.firstName,
        dateOfBirth: keys.dateOfBirth,
      })
    }
    if (branches.length === 0) return []

    const where: Record<string, unknown> = { clinicId, $or: branches }
    if (excludeId) where._id = { $ne: excludeId }
    const docs = await PatientModel().find(where).limit(20).lean()
    return (docs as unknown as PatientRecord[]).map(toPatient)
  },

  async create(
    input: PatientInput & {
      clinicId: string
      medicalRecordNo: string
      userId: string | null
      createdBy: PersonRef
    },
    tx?: Transaction,
  ): Promise<StoredPatient> {
    const [doc] = await PatientModel().create(
      [
        {
          _id: newId(),
          clinicId: input.clinicId,
          userId: input.userId,
          medicalRecordNo: input.medicalRecordNo,
          ...writableFields(input),
          isActive: true,
          createdBy: input.createdBy,
          updatedBy: input.createdBy,
          deletedAt: null,
        },
      ],
      { session: sessionOf(tx) },
    )
    if (!doc) throw new Error('The patient document was not created')
    return toPatient(doc.toObject() as unknown as PatientRecord)
  },

  async update(
    clinicId: string,
    patientId: string,
    input: PatientInput,
    updatedBy: PersonRef,
  ): Promise<StoredPatient | null> {
    const doc = await PatientModel()
      .findOneAndUpdate(
        { clinicId, _id: patientId },
        { $set: { ...writableFields(input), updatedBy } },
        { new: true },
      )
      .lean()
    return doc ? toPatient(doc as unknown as PatientRecord) : null
  },

  async setActive(
    clinicId: string,
    patientId: string,
    isActive: boolean,
    updatedBy: PersonRef,
  ): Promise<boolean> {
    const result = await PatientModel().updateOne(
      { clinicId, _id: patientId },
      { $set: { isActive, updatedBy } },
    )
    return result.matchedCount === 1
  },

  /** Atomic: a record that gained an account a moment ago is not linked to a second one. */
  async linkUser(
    clinicId: string,
    patientId: string,
    userId: string,
    tx?: Transaction,
  ): Promise<boolean> {
    const result = await PatientModel().updateOne(
      { clinicId, _id: patientId, userId: null },
      { $set: { userId } },
      { session: sessionOf(tx) },
    )
    return result.modifiedCount === 1
  },

  /** The chart banner, replaced whole: an allergy list is edited as a list (section 8.6). */
  async setAllergies(
    clinicId: string,
    patientId: string,
    allergies: Array<{
      substance: string
      reaction: string | null
      severity: string
      notedAt: Date
    }>,
    by: PersonRef,
  ): Promise<StoredPatient | null> {
    const doc = (await PatientModel()
      .findOneAndUpdate(
        { clinicId, _id: patientId },
        {
          $set: {
            allergies: allergies.map((allergy) => ({ _id: newId(), ...allergy })),
            updatedBy: by,
          },
        },
        { new: true },
      )
      .lean()) as unknown as PatientRecord | null
    return doc ? toPatient(doc) : null
  },

  async setChronicConditions(
    clinicId: string,
    patientId: string,
    conditions: Array<{
      code: string | null
      description: string
      diagnosedAt: string | null
      resolvedAt: string | null
    }>,
    by: PersonRef,
  ): Promise<StoredPatient | null> {
    const doc = (await PatientModel()
      .findOneAndUpdate(
        { clinicId, _id: patientId },
        {
          $set: {
            chronicConditions: conditions.map((condition) => ({ _id: newId(), ...condition })),
            updatedBy: by,
          },
        },
        { new: true },
      )
      .lean()) as unknown as PatientRecord | null
    return doc ? toPatient(doc) : null
  },

  /** "My patients" (D3): the records behind ids another module resolved, in that same order. */
  async findByIds(clinicId: string, ids: readonly string[]): Promise<StoredPatient[]> {
    if (ids.length === 0) return []
    const docs = await PatientModel()
      .find({ clinicId, _id: { $in: [...ids] } })
      .lean()
    const byId = new Map(
      (docs as unknown as PatientRecord[]).map((doc) => [doc._id, toPatient(doc)]),
    )
    return ids
      .map((id) => byId.get(id))
      .filter((patient): patient is StoredPatient => Boolean(patient))
  },
}
