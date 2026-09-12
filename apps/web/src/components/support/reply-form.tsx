'use client'

import { useId, useState } from 'react'
import { useTranslations } from 'next-intl'
import { ReplyToTicketRequest } from '@clinic/contracts'
import { Alert, Button, Checkbox, Label, Spinner, Textarea, cn } from '@clinic/ui'
import { ApiError, apiFetch } from '@/lib/api/client'
import { useErrorMessage } from '@/lib/i18n/use-error-message'
import { useRouter } from '@/lib/navigation/use-router'

/**
 * Answering a ticket (P9, S11).
 *
 * The internal-note switch only renders for somebody clinic-side, and the server refuses it for
 * anybody else regardless — the checkbox is a convenience, never the control. When it is ticked
 * the form changes colour and says who will see it, because "internal" is a word that has to
 * mean something the moment before you press send, not after.
 */
export function ReplyForm({
  ticketId,
  canWriteInternal,
}: {
  ticketId: string
  canWriteInternal: boolean
}) {
  const t = useTranslations('support.reply')
  const router = useRouter()
  const errorMessage = useErrorMessage()
  const fieldId = useId()

  const [body, setBody] = useState('')
  const [isInternal, setIsInternal] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setPending(true)
    setError(null)
    try {
      const parsed = ReplyToTicketRequest.safeParse({ body, isInternal, fileIds: [] })
      if (!parsed.success) throw new ApiError(400, 'VALIDATION_FAILED', '')
      await apiFetch(`/api/v1/support/tickets/${ticketId}/replies`, {
        method: 'POST',
        body: parsed.data,
      })
      setBody('')
      setIsInternal(false)
      router.refresh()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setPending(false)
    }
  }

  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-lg border p-4',
        isInternal ? 'border-warning/40 bg-warning/5 border-dashed' : 'border-border',
      )}
    >
      <div className="flex flex-col gap-1">
        <Label htmlFor={fieldId}>{isInternal ? t('internalLabel') : t('label')}</Label>
        <Textarea
          id={fieldId}
          rows={4}
          value={body}
          maxLength={4000}
          placeholder={isInternal ? t('internalPlaceholder') : t('placeholder')}
          onChange={(event) => setBody(event.target.value)}
        />
      </div>

      {canWriteInternal ? (
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={isInternal}
            onChange={(event) => setIsInternal(event.target.checked)}
          />
          {t('internalToggle')}
        </label>
      ) : null}

      {isInternal ? <p className="text-muted-foreground text-xs">{t('internalHint')}</p> : null}

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <div className="flex justify-end">
        <Button
          type="button"
          disabled={pending || body.trim() === ''}
          onClick={() => void submit()}
        >
          {pending ? <Spinner className="size-4" /> : null}
          {isInternal ? t('sendInternal') : t('send')}
        </Button>
      </div>
    </div>
  )
}
