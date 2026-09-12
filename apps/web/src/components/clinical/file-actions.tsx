'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import type { DownloadLink } from '@clinic/contracts'
import { Button, Spinner } from '@clinic/ui'
import { apiFetch } from '@/lib/api/client'
import { useErrorMessage } from '@/lib/i18n/use-error-message'
import { useRouter } from '@/lib/navigation/use-router'

/**
 * What can be done with one stored document.
 *
 * The download is two steps on purpose (section 12.1): the application issues a sixty-second
 * link and records who asked for it, and the browser then fetches the bytes from object storage
 * directly. A link that sat in the markup would be a credential in the page source, readable by
 * anyone who can see the page and still valid after they stop being allowed to.
 */
export function FileActions({
  fileId,
  canShare,
  isPatientVisible,
  canDelete,
}: {
  fileId: string
  canShare: boolean
  isPatientVisible: boolean
  canDelete: boolean
}) {
  const t = useTranslations('clinical.files')
  const router = useRouter()
  const errorMessage = useErrorMessage()
  const [pending, setPending] = useState<'download' | 'share' | 'delete' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run<T>(kind: 'download' | 'share' | 'delete', work: () => Promise<T>) {
    setPending(kind)
    setError(null)
    try {
      return await work()
    } catch (caught) {
      setError(errorMessage(caught))
      return null
    } finally {
      setPending(null)
    }
  }

  async function download() {
    const link = await run('download', () =>
      apiFetch<DownloadLink>(`/api/v1/files/${fileId}/download-url`),
    )
    // A new tab, so a large download does not replace the page the person was reading.
    if (link) window.open(link.url, '_blank', 'noopener,noreferrer')
  }

  async function toggleSharing() {
    const done = await run('share', () =>
      apiFetch(`/api/v1/files/${fileId}`, {
        method: 'PATCH',
        body: { isPatientVisible: !isPatientVisible },
      }),
    )
    if (done !== null) router.refresh()
  }

  async function remove() {
    const done = await run('delete', () =>
      apiFetch(`/api/v1/files/${fileId}`, { method: 'DELETE' }),
    )
    if (done !== null) router.refresh()
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={pending !== null}
          onClick={() => void download()}
        >
          {pending === 'download' ? <Spinner /> : null}
          {t('download')}
        </Button>
        {canShare ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={pending !== null}
            onClick={() => void toggleSharing()}
          >
            {pending === 'share' ? <Spinner /> : null}
            {isPatientVisible ? t('stopSharing') : t('share')}
          </Button>
        ) : null}
        {canDelete ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={pending !== null}
            onClick={() => void remove()}
          >
            {pending === 'delete' ? <Spinner /> : null}
            {t('remove')}
          </Button>
        ) : null}
      </div>
      {error ? (
        <span role="alert" className="text-danger text-xs font-medium">
          {error}
        </span>
      ) : null}
    </div>
  )
}
