import { DoctorModel, newId } from '@clinic/db'
import type { PersonRef } from '@clinic/contracts'
import { sessionOf, type Transaction } from '../../../transaction'

export interface StoredDoctor {
  id: string
  userId: string
  title: string | null
  licenseNumber: string | null
  bio: string | null
  yearsOfExperience: number | null
  /** A decimal string in the clinic's currency, "45.00"; never a float (section 8.3). */
  consultationFee: string | null
  defaultSlotMinutes: number
  specialties: Array<{ id: string; name: string }>
  branchIds: string[]
  /** The doctor's week and the days away, local to the clinic (section 8.7). */
  availability: Array<{ dayOfWeek: number; startsAt: string; endsAt: string }>
  timeOff: Array<{ id: string; startDate: string; endDate: string; reason: string | null }>
  isAcceptingNew: boolean
  isActive: boolean
  createdAt: Date | null
  updatedAt: Date | null
}

export interface DoctorWrite {
  title: string | null
  licenseNumber: string | null
  bio: string | null
  yearsOfExperience: number | null
  consultationFee: string | null
  defaultSlotMinutes: number
  specialties: ReadonlyArray<{ id: string; name: string }>
  branchIds: readonly string[]
  isAcceptingNew: boolean
}

interface DoctorRecord {
  _id: string
  userId: string
  title?: string | null
  licenseNumber?: string | null
  bio?: string | null
  yearsOfExperience?: number | null
  consultationFee?: { toString(): string } | null
  defaultSlotMinutes?: number | null
  specialties?: Array<{ id: string; name: string }> | null
  branchIds?: string[] | null
  availability?: Array<{ dayOfWeek: number; startsAt: string; endsAt: string }> | null
  timeOff?: Array<{ id: string; startDate: string; endDate: string; reason?: string | null }> | null
  isAcceptingNew?: boolean | null
  isActive?: boolean | null
  createdAt?: Date | null
  updatedAt?: Date | null
}

function toDoctor(doc: DoctorRecord): StoredDoctor {
  return {
    id: doc._id,
    userId: doc.userId,
    title: doc.title ?? null,
    licenseNumber: doc.licenseNumber ?? null,
    bio: doc.bio ?? null,
    yearsOfExperience: doc.yearsOfExperience ?? null,
    // Decimal128 prints its exact decimal value; it never passes through a JS number.
    consultationFee: doc.consultationFee ? doc.consultationFee.toString() : null,
    defaultSlotMinutes: doc.defaultSlotMinutes ?? 30,
    specialties: (doc.specialties ?? []).map(({ id, name }) => ({ id, name })),
    branchIds: doc.branchIds ?? [],
    availability: (doc.availability ?? []).map(({ dayOfWeek, startsAt, endsAt }) => ({
      dayOfWeek,
      startsAt,
      endsAt,
    })),
    timeOff: (doc.timeOff ?? []).map((entry) => ({
      id: entry.id,
      startDate: entry.startDate,
      endDate: entry.endDate,
      reason: entry.reason ?? null,
    })),
    isAcceptingNew: doc.isAcceptingNew ?? true,
    isActive: doc.isActive ?? true,
    createdAt: doc.createdAt ?? null,
    updatedAt: doc.updatedAt ?? null,
  }
}

const fieldsOf = (input: DoctorWrite) => ({
  title: input.title,
  licenseNumber: input.licenseNumber,
  bio: input.bio,
  yearsOfExperience: input.yearsOfExperience,
  // Mongoose casts the decimal string straight to Decimal128.
  consultationFee: input.consultationFee,
  defaultSlotMinutes: input.defaultSlotMinutes,
  specialties: input.specialties.map(({ id, name }) => ({ id, name })),
  branchIds: [...input.branchIds],
  isAcceptingNew: input.isAcceptingNew,
})

/** Doctors per clinic are bounded — tens, rarely hundreds — so the directory reads them whole. */
const DIRECTORY_LIMIT = 500

export const doctorRepository = {
  async list(
    clinicId: string,
    filter: { specialtyId?: string; isActive?: boolean },
  ): Promise<StoredDoctor[]> {
    const where: Record<string, unknown> = { clinicId }
    if (filter.isActive !== undefined) where.isActive = filter.isActive
    if (filter.specialtyId) where['specialties.id'] = filter.specialtyId
    const docs = await DoctorModel().find(where).limit(DIRECTORY_LIMIT).lean()
    return (docs as unknown as DoctorRecord[]).map(toDoctor)
  },

  async findById(clinicId: string, doctorId: string): Promise<StoredDoctor | null> {
    const doc = await DoctorModel().findOne({ clinicId, _id: doctorId }).lean()
    return doc ? toDoctor(doc as unknown as DoctorRecord) : null
  },

  async findByUserId(clinicId: string, userId: string): Promise<StoredDoctor | null> {
    const doc = await DoctorModel().findOne({ clinicId, userId }).lean()
    return doc ? toDoctor(doc as unknown as DoctorRecord) : null
  },

  async findAccessFacts(
    clinicId: string,
    doctorId: string,
  ): Promise<{ id: string; userId: string } | null> {
    const doc = (await DoctorModel()
      .findOne({ clinicId, _id: doctorId })
      .select({ userId: 1 })
      .lean()) as unknown as { _id: string; userId: string } | null
    return doc ? { id: doc._id, userId: doc.userId } : null
  },

  async create(
    input: DoctorWrite & { clinicId: string; userId: string; createdBy: PersonRef },
    tx?: Transaction,
  ): Promise<StoredDoctor> {
    const [doc] = await DoctorModel().create(
      [
        {
          _id: newId(),
          clinicId: input.clinicId,
          userId: input.userId,
          ...fieldsOf(input),
          isActive: true,
          createdBy: input.createdBy,
          updatedBy: input.createdBy,
          deletedAt: null,
        },
      ],
      { session: sessionOf(tx) },
    )
    if (!doc) throw new Error('The doctor document was not created')
    return toDoctor(doc.toObject() as unknown as DoctorRecord)
  },

  async update(
    clinicId: string,
    doctorId: string,
    input: DoctorWrite & { isActive: boolean },
    updatedBy: PersonRef,
  ): Promise<StoredDoctor | null> {
    const doc = await DoctorModel()
      .findOneAndUpdate(
        { clinicId, _id: doctorId },
        { $set: { ...fieldsOf(input), isActive: input.isActive, updatedBy } },
        { new: true },
      )
      .lean()
    return doc ? toDoctor(doc as unknown as DoctorRecord) : null
  },

  /**
   * Refreshes the display snapshot on every doctor holding a renamed specialty. A bulk write
   * bypasses the audit middleware (section 8.15): the caller records an explicit entry.
   */
  async renameSpecialty(clinicId: string, specialtyId: string, name: string): Promise<number> {
    const result = await DoctorModel().updateMany(
      { clinicId, 'specialties.id': specialtyId },
      { $set: { 'specialties.$[entry].name': name } },
      { arrayFilters: [{ 'entry.id': specialtyId }] },
    )
    return result.modifiedCount
  },

  /** The week itself. Replaced whole: a schedule is edited as one thing, not block by block. */
  async setSchedule(
    clinicId: string,
    doctorId: string,
    input: {
      defaultSlotMinutes: number
      availability: ReadonlyArray<{ dayOfWeek: number; startsAt: string; endsAt: string }>
    },
    updatedBy: PersonRef,
  ): Promise<StoredDoctor | null> {
    const doc = await DoctorModel()
      .findOneAndUpdate(
        { clinicId, _id: doctorId },
        {
          $set: {
            defaultSlotMinutes: input.defaultSlotMinutes,
            availability: input.availability.map(({ dayOfWeek, startsAt, endsAt }) => ({
              dayOfWeek,
              startsAt,
              endsAt,
            })),
            updatedBy,
          },
        },
        { new: true },
      )
      .lean()
    return doc ? toDoctor(doc as unknown as DoctorRecord) : null
  },

  async addTimeOff(
    clinicId: string,
    doctorId: string,
    entry: { startDate: string; endDate: string; reason: string | null },
    updatedBy: PersonRef,
  ): Promise<{ doctor: StoredDoctor; timeOffId: string } | null> {
    const timeOffId = newId()
    const doc = await DoctorModel()
      .findOneAndUpdate(
        { clinicId, _id: doctorId },
        {
          $push: { timeOff: { id: timeOffId, ...entry } },
          $set: { updatedBy },
        },
        { new: true },
      )
      .lean()
    return doc ? { doctor: toDoctor(doc as unknown as DoctorRecord), timeOffId } : null
  },

  async removeTimeOff(
    clinicId: string,
    doctorId: string,
    timeOffId: string,
    updatedBy: PersonRef,
  ): Promise<StoredDoctor | null> {
    const doc = await DoctorModel()
      .findOneAndUpdate(
        { clinicId, _id: doctorId },
        { $pull: { timeOff: { id: timeOffId } }, $set: { updatedBy } },
        { new: true },
      )
      .lean()
    return doc ? toDoctor(doc as unknown as DoctorRecord) : null
  },

  async countBySpecialty(clinicId: string): Promise<Map<string, number>> {
    const rows = await DoctorModel().aggregate<{ _id: string; count: number }>([
      // Soft-delete filtering does not apply to aggregations, so it is spelled out here.
      { $match: { clinicId, deletedAt: null } },
      { $unwind: '$specialties' },
      { $group: { _id: '$specialties.id', count: { $sum: 1 } } },
    ])
    return new Map(rows.map((row) => [row._id, row.count]))
  },
}
