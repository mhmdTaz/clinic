'use client'

import { useId, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import {
  Alert,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Label,
  Spinner,
  Textarea,
  type ButtonProps,
} from '@clinic/ui'
import { apiFetch } from '@/lib/api/client'
import { useErrorMessage } from '@/lib/i18n/use-error-message'

/**
 * A consequential action behind a confirmation: suspend, archive, delete, force a reset. The
 * question names what will happen, the error stays inside the dialog, and on success the page
 * refreshes to show the new state — or moves somewhere else when the thing no longer exists.
 */
export function ConfirmAction({
  label,
  title,
  body,
  confirmLabel,
  action,
  method = 'POST',
  payload,
  withReason = false,
  tone = 'danger',
  triggerVariant = 'outline',
  redirectTo,
  disabled = false,
}: {
  label: string
  title: string
  body: string
  confirmLabel: string
  action: string
  method?: 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  payload?: Record<string, unknown>
  /** Offers an optional free-text reason, sent as `reason` and kept in the audit log. */
  withReason?: boolean
  tone?: 'danger' | 'primary'
  triggerVariant?: ButtonProps['variant']
  redirectTo?: string
  disabled?: boolean
}) {
  const t = useTranslations('common')
  const router = useRouter()
  const errorMessage = useErrorMessage()
  const reasonId = useId()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    setPending(true)
    setError(null)
    try {
      const body =
        payload || withReason
          ? { ...(payload ?? {}), ...(withReason ? { reason: reason.trim() || null } : {}) }
          : undefined
      await apiFetch(action, { method, body })
      setOpen(false)
      setReason('')
      if (redirectTo) router.push(redirectTo)
      else router.refresh()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return
        setOpen(next)
        if (!next) setError(null)
      }}
    >
      <DialogTrigger asChild>
        <Button variant={triggerVariant} size="sm" disabled={disabled}>
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{body}</DialogDescription>
        </DialogHeader>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {withReason ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor={reasonId}>{t('reasonOptional')}</Label>
            <Textarea
              id={reasonId}
              rows={3}
              maxLength={300}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
        ) : null}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={pending}>
              {t('cancel')}
            </Button>
          </DialogClose>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            disabled={pending}
            onClick={() => void confirm()}
          >
            {pending ? <Spinner /> : null}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
