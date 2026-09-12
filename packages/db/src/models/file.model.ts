import { Schema, type InferSchemaType, type Model } from 'mongoose'
import { FILE_CATEGORIES, FILE_OWNER_TYPES, FILE_STATUSES } from '@clinic/config'
import { idField } from '../id'
import { getConnection } from '../connection'
import { tenantGuard } from '../plugins/tenant-guard'
import { softDelete } from '../plugins/soft-delete'
import { auditCapture } from '../plugins/audit-capture'

const PersonRefSchema = new Schema({ id: String, name: String }, { _id: false })

/**
 * A stored document: metadata here, bytes in object storage (sections 8.9 and 12).
 *
 * `owner` is polymorphic — a file hangs off a patient, an encounter or a prescription — which a
 * document store expresses directly and a relational schema would need three nullable columns or
 * a join table for. `storageKey` is unique, so the same object can never be claimed twice.
 */
export const FileSchema = new Schema(
  {
    _id: idField,
    clinicId: { type: String, required: true },

    owner: {
      type: { type: String, enum: FILE_OWNER_TYPES, required: true },
      id: { type: String, required: true },
    },
    /** The patient the file is about, whatever it hangs off — the vault reads by this (P6). */
    patientId: { type: String, default: null },

    category: { type: String, enum: FILE_CATEGORIES, default: 'OTHER' },
    storageKey: { type: String, required: true, unique: true },
    bucket: { type: String, required: true },
    fileName: { type: String, required: true },
    mimeType: { type: String, required: true },
    sizeBytes: { type: Number, default: 0 },
    checksumSha256: { type: String, default: null },
    description: { type: String, default: null },

    status: { type: String, enum: FILE_STATUSES, default: 'PENDING' },
    /** What the scanner said, or why it did not run. Never null once a scan was attempted. */
    scanResult: { type: String, default: null },
    /** Off by default: a patient sees a document because someone decided so (ADR-0025). */
    isPatientVisible: { type: Boolean, default: false },

    uploadedBy: { type: PersonRefSchema, default: null },
    confirmedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'files' },
)

FileSchema.plugin(tenantGuard)
FileSchema.plugin(softDelete)
// A file's metadata says what it is about; reading the list is reading the chart (11.3).
FileSchema.plugin(auditCapture, { model: 'File', phiRead: true, ignoredPaths: ['storageKey'] })

FileSchema.index({ clinicId: 1, 'owner.type': 1, 'owner.id': 1, createdAt: -1 })
FileSchema.index({ clinicId: 1, patientId: 1, createdAt: -1 }) // the document vault
FileSchema.index({ clinicId: 1, category: 1, createdAt: -1 })
FileSchema.index({ status: 1, createdAt: 1 }) // the PENDING sweep

export type FileDoc = InferSchemaType<typeof FileSchema> & { _id: string }

export const FileModel = (): Model<FileDoc> =>
  getConnection().models.File ?? getConnection().model<FileDoc>('File', FileSchema)
