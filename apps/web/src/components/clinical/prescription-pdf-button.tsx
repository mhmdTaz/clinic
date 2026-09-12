'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import type { DownloadLink } from '@clinic/contracts'
import { Button, Spinner } from '@clinic/ui'
import { apiFetch } from '@/lib/api/client'
import { useErrorMessage } from '@/lib/i18n/use-error-message'

/**
 * The printable copy (D8, P7). The first press renders it and stores it; every one after serves
 * the file that already exists, so two people printing the same prescription get the same
 * document rather than two that happen to look alike (ADR-0026).
 */
export function PrescriptionPdfButton({ prescriptionId }: { prescriptionId: string }) {
  const t = useTranslations('clinical.prescriptions')
  const errorMessage = useErrorMessage()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function open() {
    setPending(true)
    setError(null)
    try {
      const link = await apiFetch<DownloadLink>(`/api/v1/prescriptions/${prescriptionId}/pdf`)
      window.open(link.url, '_blank', 'noopener,noreferrer')
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setPending(false)
    }
  }

  return (
    <span className="flex flex-col items-end gap-1">
      <Button variant="outline" size="sm" disabled={pending} onClick={() => void open()}>
        {pending ? <Spinner /> : null}
        {t('print')}
      </Button>
      {error ? (
        <span role="alert" className="text-danger text-xs font-medium">
          {error}
        </span>
      ) : null}
    </span>
  )
}
