'use client'

import { useId, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Alert, Button, Checkbox, Spinner } from '@clinic/ui'
import { apiFetch } from '@/lib/api/client'
import { useErrorMessage } from '@/lib/i18n/use-error-message'
import { useRouter } from '@/lib/navigation/use-router'

/**
 * The voice-charting switch (ADR-0037). Turning it on is a decision about where the clinic's
 * audio goes, so the consequence is stated first and has to be ticked; turning it off is one
 * press. Who did either, and when, is in the audit log with the clinic's other settings.
 */
export function VoiceChartingSetting({ enabled }: { enabled: boolean }) {
  const t = useTranslations('admin.dental.voice')
  const router = useRouter()
  const errorMessage = useErrorMessage()
  const fieldId = useId()
  const [acknowledged, setAcknowledged] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function set(next: boolean) {
    setPending(true)
    setError(null)
    try {
      await apiFetch('/api/v1/dental/voice-charting', {
        method: 'PUT',
        body: { enabled: next, acknowledged: next ? acknowledged : false },
      })
      setAcknowledged(false)
      router.refresh()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">{t('what')}</p>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {enabled ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Alert tone="success" className="flex-1">
            {t('on')}
          </Alert>
          <Button variant="outline" disabled={pending} onClick={() => void set(false)}>
            {pending ? <Spinner className="size-4" /> : null}
            {t('turnOff')}
          </Button>
        </div>
      ) : (
        <>
          <Alert tone="warning">{t('privacy')}</Alert>
          <label htmlFor={`${fieldId}-ack`} className="flex items-start gap-2 text-sm">
            <Checkbox
              id={`${fieldId}-ack`}
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            <span>{t('acknowledge')}</span>
          </label>
          <Button
            className="self-start"
            disabled={pending || !acknowledged}
            onClick={() => void set(true)}
          >
            {pending ? <Spinner className="size-4" /> : null}
            {t('turnOn')}
          </Button>
        </>
      )}
    </div>
  )
}
