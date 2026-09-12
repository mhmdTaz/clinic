import { getLocale, getTranslations } from 'next-intl/server'
import type { FileCategory, StoredFile } from '@clinic/contracts'
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@clinic/ui'
import { EmptyState } from '@/components/portal/empty-state'
import { formatInstant } from '@/lib/format/dates'
import { FileActions } from './file-actions'
import { FileUploadDialog } from './file-upload-dialog'

/** Bytes as a person reads them. Files here are documents, not disk images — kB and MB suffice. */
function readableSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * A patient's documents, wherever they are shown: the chart, the front desk's copy of the
 * record, and the patient's own vault (S14, P6). The upload button appears only for someone who
 * may add to it, and the sharing toggle only for someone who may decide what a patient sees.
 */
export async function DocumentsCard({
  files,
  timeZone,
  upload,
  canShare,
  canDelete,
  title,
  description,
  emptyBody,
}: {
  files: StoredFile[]
  timeZone: string
  /** Where a new document would hang. Omitted for anyone who may only read. */
  upload?: { ownerType: 'PATIENT' | 'ENCOUNTER'; ownerId: string; defaultCategory?: FileCategory }
  canShare: boolean
  canDelete: boolean
  title?: string
  description?: string
  emptyBody?: string
}) {
  const [t, locale] = await Promise.all([getTranslations('clinical.files'), getLocale()])

  const uploadButton = upload ? (
    <FileUploadDialog
      ownerType={upload.ownerType}
      ownerId={upload.ownerId}
      defaultCategory={upload.defaultCategory}
      canShareWithPatient={canShare}
      label={t('upload')}
    />
  ) : null

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <CardTitle>{title ?? t('title')}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        {uploadButton}
      </CardHeader>
      <CardContent>
        {files.length === 0 ? (
          <EmptyState title={t('none')} body={emptyBody} action={uploadButton} />
        ) : (
          <ul className="divide-border flex flex-col divide-y">
            {files.map((file) => (
              <li
                key={file.id}
                className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2 font-medium break-all">
                    {file.fileName}
                    <Badge tone="neutral">{t(`categories.${file.category}`)}</Badge>
                    {file.isPatientVisible ? (
                      <Badge tone="success">{t('sharedBadge')}</Badge>
                    ) : null}
                    {file.status === 'INFECTED' || file.status === 'FAILED' ? (
                      <Badge tone="danger">{t(`statuses.${file.status}`)}</Badge>
                    ) : null}
                  </span>
                  {file.description ? (
                    <span className="text-sm break-words">{file.description}</span>
                  ) : null}
                  <span className="text-muted-foreground text-xs">
                    {readableSize(file.sizeBytes)}
                    {file.createdAt ? ` · ${formatInstant(file.createdAt, locale, timeZone)}` : ''}
                    {file.uploadedBy ? ` · ${file.uploadedBy.name}` : ''}
                  </span>
                </div>
                <FileActions
                  fileId={file.id}
                  canShare={canShare}
                  isPatientVisible={file.isPatientVisible}
                  canDelete={canDelete}
                />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
