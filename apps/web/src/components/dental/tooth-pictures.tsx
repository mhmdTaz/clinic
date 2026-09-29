'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { FileText } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { DownloadLink, StoredFile } from '@clinic/contracts'
import { Alert, Spinner } from '@clinic/ui'
import { FileUploadDialog } from '@/components/clinical/file-upload-dialog'
import { ApiError, apiFetch } from '@/lib/api/client'
import { useErrorMessage } from '@/lib/i18n/use-error-message'

/**
 * A tooth's X-rays and photos (Phase 11): the patient's documents that name this tooth. Uploaded
 * from here, a picture belongs to the visit being charted when there is one, and to the patient
 * otherwise — the same place the documents card would put it.
 *
 * A thumbnail is a short-lived download link, taken when the picture is shown; each one is a line
 * in the audit log, as any other download is.
 */
const IMAGE = /^image\/(jpeg|png|webp)$/

function Thumbnail({ file }: { file: StoredFile }) {
  const t = useTranslations('dental.panel')
  const [url, setUrl] = useState<string | null>(null)
  const image = IMAGE.test(file.mimeType) && file.status === 'CLEAN'

  useEffect(() => {
    if (!image) return
    let cancelled = false
    apiFetch<DownloadLink>(`/api/v1/files/${file.id}/download-url`)
      .then((link) => (cancelled ? null : setUrl(link.url)))
      .catch(() => null)
    return () => {
      cancelled = true
    }
  }, [file.id, image])

  // A fresh link on every open: the one behind the thumbnail lasts a minute.
  async function open() {
    const link = await apiFetch<DownloadLink>(`/api/v1/files/${file.id}/download-url`)
    window.open(link.url, '_blank', 'noopener,noreferrer')
  }

  return (
    <button
      type="button"
      onClick={() => void open()}
      disabled={file.status !== 'CLEAN'}
      title={file.status === 'CLEAN' ? file.fileName : t('notReady')}
      aria-label={t('openPicture', { name: file.fileName })}
      className="bg-muted relative flex aspect-square items-center justify-center overflow-hidden rounded-md border disabled:opacity-60"
    >
      {url ? (
        // A presigned object-storage URL, not something next/image can optimise.
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : image ? (
        <Spinner />
      ) : (
        <FileText aria-hidden="true" className="text-muted-foreground" size={22} />
      )}
      <span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1 text-[10px] text-white">
        {file.teeth.join(' ')}
      </span>
    </button>
  )
}

export function ToothPictures({
  patientId,
  tooth,
  visitId,
  canUpload,
}: {
  patientId: string
  tooth: string
  visitId: string | null
  canUpload: boolean
}) {
  const t = useTranslations('dental.panel')
  const errorMessage = useErrorMessage()
  const describe = useRef(errorMessage)
  describe.current = errorMessage
  const [files, setFiles] = useState<StoredFile[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const query = new URLSearchParams({ patientId, tooth, limit: '12' })
      const response = await fetch(`/api/v1/files?${query}`, {
        credentials: 'same-origin',
        cache: 'no-store',
      })
      const body = (await response.json()) as { data?: StoredFile[] }
      if (!response.ok) throw new ApiError(response.status, 'INTERNAL_ERROR', '')
      setFiles(body.data ?? [])
    } catch (caught) {
      setError(describe.current(caught))
    }
  }, [patientId, tooth])

  useEffect(() => {
    setFiles(null)
    void load()
  }, [load])

  return (
    <section className="flex flex-col gap-2 border-t pt-3" aria-label={t('pictures')}>
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-medium">{t('pictures')}</h4>
        {canUpload ? (
          <FileUploadDialog
            ownerType={visitId ? 'ENCOUNTER' : 'PATIENT'}
            ownerId={visitId ?? patientId}
            label={t('addPicture')}
            defaultCategory="IMAGING"
            teeth={[tooth]}
            onUploaded={() => void load()}
          />
        ) : null}
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {files === null ? (
        <Spinner />
      ) : files.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('noPictures')}</p>
      ) : (
        <div className="grid grid-cols-4 gap-2">
          {files.map((file) => (
            <Thumbnail key={file.id} file={file} />
          ))}
        </div>
      )}
    </section>
  )
}
