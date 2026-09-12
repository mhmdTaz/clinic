import { DOWNLOAD_URL_SECONDS } from '@clinic/config'
import type { DownloadLink, FileListQuery, StoredFile, UpdateFileRequest } from '@clinic/contracts'
import { BusinessRuleError, ForbiddenError, NotFoundError, ValidationError } from '../../../errors'
import { recordAudit } from '../../audit'
import { assertCan, careRelationship, type Actor } from '../../access'
import { fileRepository } from '../infrastructure/file.repository'
import { objectStorage } from '../infrastructure/object-storage'
import { fileListScope, fileResource } from './scope'
import { toStoredFile } from './upload'

/**
 * The document vault (P6) and the attachments on a chart (S14, D6).
 *
 * A patient reaches their own documents, and only those someone chose to share. A doctor reaches
 * the documents of patients they have treated. The clinic reaches all of them.
 */
export async function listFiles(actor: Actor, query: FileListQuery): Promise<StoredFile[]> {
  await assertCan(actor, 'file:read')
  const scope = fileListScope(actor)
  if (!scope) throw new ForbiddenError('file:read')

  // ASSIGNED has no filter of its own: it is a question about a patient, so one must be named.
  if (actor.permissions.get('file:read') === 'ASSIGNED') {
    if (!actor.doctorId || !query.patientId) throw new ForbiddenError('file:read')
    const treats = await careRelationship().hasTreated(
      actor.clinicId,
      actor.doctorId,
      query.patientId,
    )
    if (!treats) throw new ForbiddenError('file:read')
  }

  const files = await fileRepository.list(actor.clinicId, {
    ownerType: query.ownerType,
    ownerId: query.ownerId,
    patientId: scope.patientId ?? query.patientId,
    category: query.category,
    patientVisibleOnly: scope.patientVisibleOnly,
  })
  return files.map(toStoredFile)
}

export async function getFile(actor: Actor, fileId: string): Promise<StoredFile> {
  const facts = await fileRepository.findAccessFacts(actor.clinicId, fileId)
  if (!facts) throw new NotFoundError('File')
  await assertCan(actor, 'file:read', fileResource(actor, facts))

  const file = await fileRepository.findById(actor.clinicId, fileId)
  if (!file) throw new NotFoundError('File')
  return toStoredFile(file)
}

/**
 * Step 1 of the download in section 12.1: a 60-second URL, and a line in the audit log naming
 * who took it. The bytes then come from storage directly, so the download is as fast as the
 * object store is and this server is not in the path.
 */
export async function getDownloadLink(actor: Actor, fileId: string): Promise<DownloadLink> {
  const facts = await fileRepository.findAccessFacts(actor.clinicId, fileId)
  if (!facts) throw new NotFoundError('File')
  await assertCan(actor, 'file:read', fileResource(actor, facts))

  const file = await fileRepository.findById(actor.clinicId, fileId)
  if (!file) throw new NotFoundError('File')
  if (file.status !== 'CLEAN') {
    throw new BusinessRuleError(
      'FILE_NOT_AVAILABLE',
      file.status === 'INFECTED'
        ? 'That file was quarantined and cannot be downloaded.'
        : 'That file is not ready yet.',
    )
  }

  const url = await objectStorage.presignGet(file.storageKey, {
    fileName: file.fileName,
    mimeType: file.mimeType,
    expiresInSeconds: DOWNLOAD_URL_SECONDS,
  })

  await recordAudit({
    action: 'file.downloaded',
    category: 'FILE',
    clinicId: actor.clinicId,
    entity: { type: 'File', id: fileId },
    metadata: { fileName: file.fileName, patientId: file.patientId },
  })

  return { url, fileName: file.fileName, expiresInSeconds: DOWNLOAD_URL_SECONDS }
}

/**
 * Changing what a document is, or who may see it. Sharing with a patient is a decision, and a
 * decision that can be taken can be taken back — so both directions are recorded (ADR-0025).
 */
export async function updateFile(
  actor: Actor,
  fileId: string,
  input: UpdateFileRequest,
): Promise<StoredFile> {
  const facts = await fileRepository.findAccessFacts(actor.clinicId, fileId)
  if (!facts) throw new NotFoundError('File')
  await assertCan(actor, 'file:upload', fileResource(actor, facts))

  const patch = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))
  if (Object.keys(patch).length === 0) {
    throw new ValidationError('Nothing to update.', [
      { field: '(body)', issue: 'NOTHING_TO_UPDATE' },
    ])
  }

  const updated = await fileRepository.update(actor.clinicId, fileId, patch)
  if (!updated) throw new NotFoundError('File')

  if (input.isPatientVisible !== undefined && input.isPatientVisible !== facts.isPatientVisible) {
    await recordAudit({
      action: input.isPatientVisible ? 'file.shared_with_patient' : 'file.unshared',
      category: 'FILE',
      severity: 'NOTICE',
      clinicId: actor.clinicId,
      entity: { type: 'File', id: fileId },
      metadata: { fileName: updated.fileName, patientId: updated.patientId },
    })
  }

  return toStoredFile(updated)
}

/**
 * Soft delete only. A clinical document is never removed inside the retention window (12.3);
 * the object itself is reclaimed by a storage lifecycle rule once that window has passed.
 */
export async function deleteFile(
  actor: Actor,
  fileId: string,
  now: Date = new Date(),
): Promise<void> {
  const facts = await fileRepository.findAccessFacts(actor.clinicId, fileId)
  if (!facts) throw new NotFoundError('File')
  await assertCan(actor, 'file:delete', fileResource(actor, facts))

  const file = await fileRepository.findById(actor.clinicId, fileId)
  if (!file) throw new NotFoundError('File')
  if (!(await fileRepository.softDelete(actor.clinicId, fileId, now))) {
    throw new NotFoundError('File')
  }

  await recordAudit({
    action: 'file.deleted',
    category: 'FILE',
    severity: 'WARNING',
    clinicId: actor.clinicId,
    entity: { type: 'File', id: fileId },
    metadata: { fileName: file.fileName, patientId: file.patientId },
  })
}
