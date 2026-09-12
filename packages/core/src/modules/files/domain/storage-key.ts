import type { FileOwnerType } from '@clinic/config'

/**
 * The key layout from section 12.2. `clinicId` leads so that a per-tenant policy, a lifecycle
 * rule or a whole-tenant export is a prefix operation. The file id is in the object name, which
 * keeps the key unguessable and collision-free when two patients both upload "scan.pdf".
 */
const FOLDER: Record<FileOwnerType, string> = {
  PATIENT: 'patients',
  ENCOUNTER: 'encounters',
  PRESCRIPTION: 'prescriptions',
}

const LEAF: Record<FileOwnerType, string> = {
  PATIENT: 'documents',
  ENCOUNTER: 'attachments',
  PRESCRIPTION: 'pdf',
}

/** Lower-case, hyphenated, and short enough that a long name cannot bloat the key. */
export function slugify(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName
  const extension = dot > 0 ? fileName.slice(dot + 1).toLowerCase() : ''
  const slug =
    stem
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'file'
  return extension ? `${slug}.${extension.replace(/[^a-z0-9]/g, '').slice(0, 10)}` : slug
}

export function storageKeyFor(input: {
  clinicId: string
  ownerType: FileOwnerType
  ownerId: string
  fileId: string
  fileName: string
}): string {
  const { clinicId, ownerType, ownerId, fileId, fileName } = input
  return [
    'clinics',
    clinicId,
    FOLDER[ownerType],
    ownerId,
    LEAF[ownerType],
    `${fileId}-${slugify(fileName)}`,
  ].join('/')
}
