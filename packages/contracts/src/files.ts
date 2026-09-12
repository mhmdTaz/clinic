import { z } from 'zod'
import { IdParam, PersonRef, nullableText, requiredText } from './common'

/**
 * Contracts for stored documents (section 12). The bytes never pass through the application:
 * the client is handed a short-lived presigned URL and uploads straight to object storage, then
 * tells the server it is done. These are the three messages that dance takes.
 */

export const FileOwnerType = z.enum(['PATIENT', 'ENCOUNTER', 'PRESCRIPTION'])
export type FileOwnerType = z.infer<typeof FileOwnerType>

export const FileCategory = z.enum([
  'LAB_RESULT',
  'IMAGING',
  'REFERRAL',
  'CONSENT',
  'PRESCRIPTION',
  'INSURANCE',
  'OTHER',
])
export type FileCategory = z.infer<typeof FileCategory>

export const FileStatus = z.enum(['PENDING', 'SCANNING', 'CLEAN', 'INFECTED', 'FAILED'])
export type FileStatus = z.infer<typeof FileStatus>

export const FileMimeType = z.enum([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'text/csv',
])
export type FileMimeType = z.infer<typeof FileMimeType>

/**
 * Asking for somewhere to put a file. The size is declared up front so it can go into the
 * presigned policy: object storage then refuses an oversized PUT itself, rather than the
 * application discovering it afterwards.
 */
export const PresignUploadRequest = z.object({
  /** A prescription's PDF is written by the server, so it is not something to upload against. */
  ownerType: z.enum(['PATIENT', 'ENCOUNTER']),
  ownerId: IdParam,
  category: FileCategory,
  fileName: requiredText(200),
  mimeType: FileMimeType,
  sizeBytes: z.coerce
    .number()
    .int()
    .min(1)
    .max(25 * 1024 * 1024),
  /** Clinical content a patient may see is a deliberate act, never a default (ADR-0025). */
  isPatientVisible: z.boolean().default(false),
  description: nullableText(200),
})
export type PresignUploadRequest = z.infer<typeof PresignUploadRequest>

export const PresignedUpload = z.object({
  fileId: z.string(),
  uploadUrl: z.string(),
  /** Headers the PUT must repeat, because they were signed into the URL. */
  headers: z.record(z.string()),
  expiresInSeconds: z.number(),
})
export type PresignedUpload = z.infer<typeof PresignedUpload>

/**
 * A presigned PUT succeeds without telling the application, so the client says so. The server
 * verifies against storage rather than believing the claim (section 12.1).
 */
export const ConfirmUploadRequest = z.object({ checksumSha256: nullableText(64) })
export type ConfirmUploadRequest = z.infer<typeof ConfirmUploadRequest>

export const StoredFile = z.object({
  id: z.string(),
  ownerType: FileOwnerType,
  ownerId: z.string(),
  category: FileCategory,
  fileName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
  status: FileStatus,
  scanResult: z.string().nullable(),
  isPatientVisible: z.boolean(),
  description: z.string().nullable(),
  uploadedBy: PersonRef.nullable(),
  createdAt: z.string().datetime().nullable(),
})
export type StoredFile = z.infer<typeof StoredFile>

export const FileListQuery = z.object({
  ownerType: FileOwnerType.optional(),
  ownerId: z.string().max(64).optional(),
  /** The vault reads by patient, whatever each document happens to hang off (P6). */
  patientId: z.string().max(64).optional(),
  category: FileCategory.optional(),
})
export type FileListQuery = z.infer<typeof FileListQuery>

export const UpdateFileRequest = z.object({
  category: FileCategory.optional(),
  isPatientVisible: z.boolean().optional(),
  description: nullableText(200).optional(),
})
export type UpdateFileRequest = z.infer<typeof UpdateFileRequest>

export const DownloadLink = z.object({
  url: z.string(),
  fileName: z.string(),
  expiresInSeconds: z.number(),
})
export type DownloadLink = z.infer<typeof DownloadLink>
