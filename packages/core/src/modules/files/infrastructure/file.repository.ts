import { FileModel, newId } from '@clinic/db'
import type { FileCategory, FileOwnerType, FileStatus } from '@clinic/config'
import type { PersonRef } from '@clinic/contracts'

export interface StoredFileRecord {
  id: string
  ownerType: FileOwnerType
  ownerId: string
  patientId: string | null
  category: FileCategory
  storageKey: string
  bucket: string
  fileName: string
  mimeType: string
  sizeBytes: number
  checksumSha256: string | null
  description: string | null
  status: FileStatus
  scanResult: string | null
  isPatientVisible: boolean
  uploadedBy: PersonRef | null
  confirmedAt: Date | null
  createdAt: Date | null
}

interface FileRecord {
  _id: string
  owner: { type: FileOwnerType; id: string }
  patientId: string | null
  category: FileCategory
  storageKey: string
  bucket: string
  fileName: string
  mimeType: string
  sizeBytes: number
  checksumSha256: string | null
  description: string | null
  status: FileStatus
  scanResult: string | null
  isPatientVisible: boolean
  uploadedBy: PersonRef | null
  confirmedAt: Date | null
  createdAt: Date | null
}

function toFile(doc: FileRecord): StoredFileRecord {
  return {
    id: doc._id,
    ownerType: doc.owner.type,
    ownerId: doc.owner.id,
    patientId: doc.patientId ?? null,
    category: doc.category,
    storageKey: doc.storageKey,
    bucket: doc.bucket,
    fileName: doc.fileName,
    mimeType: doc.mimeType,
    sizeBytes: doc.sizeBytes ?? 0,
    checksumSha256: doc.checksumSha256 ?? null,
    description: doc.description ?? null,
    status: doc.status,
    scanResult: doc.scanResult ?? null,
    isPatientVisible: Boolean(doc.isPatientVisible),
    uploadedBy: doc.uploadedBy ?? null,
    confirmedAt: doc.confirmedAt ?? null,
    createdAt: doc.createdAt ?? null,
  }
}

/** A vault page is bounded: a patient's documents are counted in dozens, not thousands. */
const LIST_LIMIT = 200

export const fileRepository = {
  newId(): string {
    return newId()
  },

  async create(input: {
    id: string
    clinicId: string
    ownerType: FileOwnerType
    ownerId: string
    patientId: string | null
    category: FileCategory
    storageKey: string
    bucket: string
    fileName: string
    mimeType: string
    sizeBytes: number
    description: string | null
    isPatientVisible: boolean
    uploadedBy: PersonRef
  }): Promise<StoredFileRecord> {
    const doc = await FileModel().create({
      _id: input.id,
      clinicId: input.clinicId,
      owner: { type: input.ownerType, id: input.ownerId },
      patientId: input.patientId,
      category: input.category,
      storageKey: input.storageKey,
      bucket: input.bucket,
      fileName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      description: input.description,
      isPatientVisible: input.isPatientVisible,
      status: 'PENDING',
      uploadedBy: input.uploadedBy,
    })
    return toFile(doc.toObject() as unknown as FileRecord)
  },

  async findById(clinicId: string, fileId: string): Promise<StoredFileRecord | null> {
    const doc = (await FileModel()
      .findOne({ clinicId, _id: fileId })
      .lean()) as unknown as FileRecord | null
    return doc ? toFile(doc) : null
  },

  /**
   * The access facts on their own, with no PHI read recorded: deciding whether someone may see
   * a file is not the same act as looking at it (section 11.3).
   */
  async findAccessFacts(
    clinicId: string,
    fileId: string,
  ): Promise<{
    id: string
    ownerType: FileOwnerType
    ownerId: string
    patientId: string | null
    isPatientVisible: boolean
    status: FileStatus
  } | null> {
    const doc = (await FileModel()
      .findOne({ clinicId, _id: fileId })
      .select({ owner: 1, patientId: 1, isPatientVisible: 1, status: 1 })
      .setOptions({ skipAudit: true })
      .lean()) as unknown as FileRecord | null
    if (!doc) return null
    return {
      id: doc._id,
      ownerType: doc.owner.type,
      ownerId: doc.owner.id,
      patientId: doc.patientId ?? null,
      isPatientVisible: Boolean(doc.isPatientVisible),
      status: doc.status,
    }
  },

  async list(
    clinicId: string,
    filter: {
      ownerType?: FileOwnerType
      ownerId?: string
      patientId?: string
      category?: FileCategory
      patientVisibleOnly?: boolean
    },
  ): Promise<StoredFileRecord[]> {
    const where: Record<string, unknown> = { clinicId }
    if (filter.ownerType) where['owner.type'] = filter.ownerType
    if (filter.ownerId) where['owner.id'] = filter.ownerId
    if (filter.patientId) where.patientId = filter.patientId
    if (filter.category) where.category = filter.category
    if (filter.patientVisibleOnly) where.isPatientVisible = true
    // A file nobody confirmed is an abandoned upload, and an infected one is quarantined.
    where.status = { $ne: 'PENDING' }

    const docs = await FileModel().find(where).sort({ createdAt: -1 }).limit(LIST_LIMIT).lean()
    return (docs as unknown as FileRecord[]).map(toFile)
  },

  /** Confirming is the one transition that may only happen once, so PENDING is in the filter. */
  async confirm(
    clinicId: string,
    fileId: string,
    patch: {
      status: FileStatus
      scanResult: string
      sizeBytes: number
      checksumSha256: string | null
      confirmedAt: Date
    },
  ): Promise<StoredFileRecord | null> {
    const doc = (await FileModel()
      .findOneAndUpdate(
        { clinicId, _id: fileId, status: 'PENDING' },
        { $set: patch },
        { new: true },
      )
      .lean()) as unknown as FileRecord | null
    return doc ? toFile(doc) : null
  },

  async update(
    clinicId: string,
    fileId: string,
    patch: Partial<Pick<StoredFileRecord, 'category' | 'isPatientVisible' | 'description'>>,
  ): Promise<StoredFileRecord | null> {
    const doc = (await FileModel()
      .findOneAndUpdate({ clinicId, _id: fileId }, { $set: patch }, { new: true })
      .lean()) as unknown as FileRecord | null
    return doc ? toFile(doc) : null
  },

  /** Soft delete: a clinical file is never removed inside the retention window (12.3). */
  async softDelete(clinicId: string, fileId: string, at: Date): Promise<boolean> {
    const result = await FileModel().updateOne(
      { clinicId, _id: fileId },
      { $set: { deletedAt: at } },
    )
    return result.matchedCount > 0
  },
}
