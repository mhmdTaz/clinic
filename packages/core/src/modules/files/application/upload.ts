import {
  MAX_FILE_BYTES,
  UPLOAD_URL_SECONDS,
  type FileCategory,
  type FileOwnerType,
} from '@clinic/config'
import type {
  ConfirmUploadRequest,
  PresignUploadRequest,
  PresignedUpload,
  StoredFile,
} from '@clinic/contracts'
import { BusinessRuleError, NotFoundError, ValidationError } from '../../../errors'
import { recordAudit } from '../../audit'
import { assertCan, type Actor } from '../../access'
import { findEncounterOwner } from '../../clinical'
import { findPatientForScheduling } from '../../patients'
import { bytesAgree } from '../domain/sniff'
import { storageKeyFor } from '../domain/storage-key'
import { fileRepository, type StoredFileRecord } from '../infrastructure/file.repository'
import { fileScanner } from '../infrastructure/file-scanner'
import { objectStorage } from '../infrastructure/object-storage'
import { fileResource } from './scope'

/** Enough for every signature in domain/sniff.ts, and small enough to be one cheap range read. */
const SNIFF_BYTES = 16

export function toStoredFile(file: StoredFileRecord): StoredFile {
  return {
    id: file.id,
    ownerType: file.ownerType,
    ownerId: file.ownerId,
    category: file.category,
    fileName: file.fileName,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    status: file.status,
    scanResult: file.scanResult,
    isPatientVisible: file.isPatientVisible,
    description: file.description,
    uploadedBy: file.uploadedBy,
    createdAt: file.createdAt ? file.createdAt.toISOString() : null,
  }
}

/** Which patient a file is about, whatever it hangs off. The vault reads by this. */
async function patientBehind(
  clinicId: string,
  ownerType: FileOwnerType,
  ownerId: string,
): Promise<string> {
  if (ownerType === 'PATIENT') {
    const patient = await findPatientForScheduling(clinicId, ownerId)
    if (!patient) throw new NotFoundError('Patient')
    if (!patient.isActive) {
      throw new BusinessRuleError('PATIENT_ARCHIVED', 'That patient record is archived.')
    }
    return patient.id
  }
  if (ownerType === 'ENCOUNTER') {
    const encounter = await findEncounterOwner(clinicId, ownerId)
    if (!encounter) throw new NotFoundError('Encounter')
    return encounter.patientId
  }
  // A prescription's PDF is written by the server, never uploaded through this path.
  throw new ValidationError('That is not something a file can be uploaded against.', [
    { field: 'ownerType', issue: 'INVALID_OPTION' },
  ])
}

/**
 * Step 1 of section 12.1: somewhere to put the bytes.
 *
 * The permission check happens **here**, before any URL exists — a presigned URL is a bearer
 * credential, and handing one out is the act being authorised. The size and content type are
 * signed into it, so storage refuses a PUT that does not match and an oversized upload never
 * reaches this server to be rejected.
 */
export async function presignUpload(
  actor: Actor,
  input: PresignUploadRequest,
): Promise<PresignedUpload> {
  if (input.sizeBytes > MAX_FILE_BYTES) {
    throw new ValidationError('That file is larger than the clinic allows.', [
      { field: 'sizeBytes', issue: 'TOO_LARGE' },
    ])
  }

  const patientId = await patientBehind(actor.clinicId, input.ownerType, input.ownerId)
  await assertCan(
    actor,
    'file:upload',
    fileResource(actor, { id: null, patientId, isPatientVisible: input.isPatientVisible }),
  )

  const fileId = fileRepository.newId()
  const storageKey = storageKeyFor({
    clinicId: actor.clinicId,
    ownerType: input.ownerType,
    ownerId: input.ownerId,
    fileId,
    fileName: input.fileName,
  })

  await fileRepository.create({
    id: fileId,
    clinicId: actor.clinicId,
    ownerType: input.ownerType,
    ownerId: input.ownerId,
    patientId,
    category: input.category,
    storageKey,
    bucket: objectStorage.bucket(),
    fileName: input.fileName,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    description: input.description,
    isPatientVisible: input.isPatientVisible,
    uploadedBy: { id: actor.userId, name: actor.displayName },
  })

  const { url, headers } = await objectStorage.presignPut(storageKey, {
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    expiresInSeconds: UPLOAD_URL_SECONDS,
  })

  return { fileId, uploadUrl: url, headers, expiresInSeconds: UPLOAD_URL_SECONDS }
}

/**
 * Step 4 of section 12.1. A presigned PUT succeeds without telling us, so the client says so —
 * and the server checks storage rather than believing it. Without this step an abandoned upload
 * would leave a PENDING row forever, which is what the nightly sweep looks for.
 */
export async function confirmUpload(
  actor: Actor,
  fileId: string,
  input: ConfirmUploadRequest,
  now: Date = new Date(),
): Promise<StoredFile> {
  const facts = await fileRepository.findAccessFacts(actor.clinicId, fileId)
  if (!facts) throw new NotFoundError('File')
  await assertCan(actor, 'file:upload', fileResource(actor, facts))
  if (facts.status !== 'PENDING') {
    throw new BusinessRuleError('UPLOAD_ALREADY_CONFIRMED', 'That upload was already confirmed.')
  }

  const file = await fileRepository.findById(actor.clinicId, fileId)
  if (!file) throw new NotFoundError('File')

  const object = await objectStorage.describe(file.storageKey)
  if (!object) {
    throw new BusinessRuleError('UPLOAD_NOT_FOUND', 'Nothing was uploaded. Try the upload again.')
  }

  /**
   * What was actually uploaded, checked rather than believed (section 12.3). A presigned PUT
   * does not bind the content type, so this is the only place the declaration is tested — and
   * it is tested against the bytes, not against the header the client sent with them.
   */
  const prefix = await objectStorage.readPrefix(file.storageKey, SNIFF_BYTES)
  const honest = bytesAgree(file.mimeType as Parameters<typeof bytesAgree>[0], prefix)
  const oversized = object.sizeBytes > Math.min(MAX_FILE_BYTES, file.sizeBytes)
  if (!honest || oversized) {
    await fileRepository.confirm(actor.clinicId, fileId, {
      status: 'FAILED',
      scanResult: oversized
        ? `rejected: ${object.sizeBytes} bytes, more than was declared`
        : `rejected: the bytes are not ${file.mimeType}`,
      sizeBytes: object.sizeBytes,
      checksumSha256: null,
      confirmedAt: now,
    })
    await recordAudit({
      action: 'file.rejected',
      category: 'FILE',
      severity: 'WARNING',
      outcome: 'FAILURE',
      clinicId: actor.clinicId,
      entity: { type: 'File', id: fileId },
      metadata: {
        fileName: file.fileName,
        declared: file.mimeType,
        sizeBytes: object.sizeBytes,
        reason: oversized ? 'LARGER_THAN_DECLARED' : 'CONTENT_MISMATCH',
      },
    })
    throw new BusinessRuleError(
      'UPLOAD_REJECTED',
      oversized
        ? 'That upload is larger than it said it would be.'
        : 'That file is not the kind of file it was uploaded as.',
    )
  }

  const verdict = await fileScanner().scan({
    storageKey: file.storageKey,
    mimeType: file.mimeType,
    sizeBytes: object.sizeBytes,
  })

  const confirmed = await fileRepository.confirm(actor.clinicId, fileId, {
    status: verdict.status,
    scanResult: verdict.result,
    sizeBytes: object.sizeBytes,
    checksumSha256: object.checksumSha256 ?? input.checksumSha256,
    confirmedAt: now,
  })
  if (!confirmed) {
    throw new BusinessRuleError('UPLOAD_ALREADY_CONFIRMED', 'That upload was already confirmed.')
  }

  await recordAudit({
    action: 'file.uploaded',
    category: 'FILE',
    clinicId: actor.clinicId,
    entity: { type: 'File', id: fileId },
    metadata: {
      fileName: confirmed.fileName,
      ownerType: confirmed.ownerType,
      ownerId: confirmed.ownerId,
      patientId: confirmed.patientId,
      sizeBytes: confirmed.sizeBytes,
      scanResult: confirmed.scanResult,
    },
  })

  return toStoredFile(confirmed)
}

/**
 * A file the server produced itself — a rendered prescription (ADR-0026). It never passes
 * through a presigned URL, so it is created, written and confirmed in one step, and the caller
 * vouches for the patient because it already knows which record it is writing for.
 */
export async function storeGeneratedFile(input: {
  clinicId: string
  ownerType: FileOwnerType
  ownerId: string
  patientId: string
  category: FileCategory
  fileName: string
  mimeType: string
  body: Uint8Array
  isPatientVisible: boolean
  generatedBy: { id: string; name: string }
  now?: Date
}): Promise<StoredFileRecord> {
  const fileId = fileRepository.newId()
  const storageKey = storageKeyFor({
    clinicId: input.clinicId,
    ownerType: input.ownerType,
    ownerId: input.ownerId,
    fileId,
    fileName: input.fileName,
  })

  await fileRepository.create({
    id: fileId,
    clinicId: input.clinicId,
    ownerType: input.ownerType,
    ownerId: input.ownerId,
    patientId: input.patientId,
    category: input.category,
    storageKey,
    bucket: objectStorage.bucket(),
    fileName: input.fileName,
    mimeType: input.mimeType,
    sizeBytes: input.body.byteLength,
    description: null,
    isPatientVisible: input.isPatientVisible,
    uploadedBy: input.generatedBy,
  })

  await objectStorage.put(storageKey, input.body, input.mimeType)

  const confirmed = await fileRepository.confirm(input.clinicId, fileId, {
    status: 'CLEAN',
    scanResult: 'generated by the clinic; not scanned',
    sizeBytes: input.body.byteLength,
    checksumSha256: null,
    confirmedAt: input.now ?? new Date(),
  })
  if (!confirmed) throw new NotFoundError('File')
  return confirmed
}
