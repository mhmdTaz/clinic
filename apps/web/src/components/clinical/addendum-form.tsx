'use client'

import { useId, useState, type FormEvent } from 'react'
import { useTranslations } from 'next-intl'
import { AddendumRequest } from '@clinic/contracts'
import { Alert, Button, Label, Spinner, Textarea } from '@clinic/ui'
import { ApiError, apiFetch } from '@/lib/api/client'
import { useErrorMessage } from '@/lib/i18n/use-error-message'
import { useRouter } from '@/lib/navigation/use-router'

/**
 * The only way to change a signed record (D9, ADR-0024): text appended beneath it, never over
 * it. The original stays legible, which is what makes the addition mean anything.
 */
export function AddendumForm({ encounterId }: { encounterId: string }) {
  const t = useTranslations('clinical.note')
  const router = useRouter()
  const errorMessage = useErrorMessage()
  const fieldId = useId()

  const [body, setBody] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError(null)
    try {
      const parsed = AddendumRequest.safeParse({ body })
      if (!parsed.success) throw new ApiError(400, 'VALIDATION_FAILED', '')
      await apiFetch(`/api/v1/encounters/${encounterId}/addendum`, {
        method: 'POST',
        body: parsed.data,
      })
      setBody('')
      router.refresh()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-2">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Label htmlFor={`${fieldId}-addendum`}>{t('addendum')}</Label>
      <Textarea
        id={`${fieldId}-addendum`}
        rows={3}
        maxLength={2000}
        value={body}
        placeholder={t('addendumHint')}
        onChange={(event) => setBody(event.target.value)}
      />
      <Button
        type="submit"
        size="sm"
        className="self-start"
        disabled={pending || body.trim() === ''}
      >
        {pending ? <Spinner /> : null}
        {t('addAddendum')}
      </Button>
    </form>
  )
}
