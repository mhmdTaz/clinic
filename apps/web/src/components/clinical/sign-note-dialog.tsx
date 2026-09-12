'use client'

import { useId, useState } from 'react'
import { useTranslations } from 'next-intl'
import { SignNoteRequest } from '@clinic/contracts'
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
  Input,
  Label,
  Spinner,
} from '@clinic/ui'
import { ApiError, apiFetch } from '@/lib/api/client'
import { useErrorMessage } from '@/lib/i18n/use-error-message'
import { useRouter } from '@/lib/navigation/use-router'

/**
 * Signing the note (D9, ADR-0024).
 *
 * The doctor types their own name rather than pressing a button labelled "sign". It is a small
 * friction, and it is the point: what follows is irreversible for the content of the record, and
 * the name typed here is the one printed beneath it afterwards.
 */
export function SignNoteDialog({
  encounterId,
  doctorName,
  label,
}: {
  encounterId: string
  /** Pre-filled, because it is a signature and not a memory test. */
  doctorName: string
  label: string
}) {
  const t = useTranslations('clinical.note')
  const tCommon = useTranslations('common')
  const router = useRouter()
  const errorMessage = useErrorMessage()
  const fieldId = useId()

  const [open, setOpen] = useState(false)
  const [signature, setSignature] = useState(doctorName)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function sign() {
    setPending(true)
    setError(null)
    try {
      const parsed = SignNoteRequest.safeParse({ signature })
      if (!parsed.success) throw new ApiError(400, 'VALIDATION_FAILED', '')
      await apiFetch(`/api/v1/encounters/${encounterId}/sign`, {
        method: 'POST',
        body: parsed.data,
      })
      setOpen(false)
      router.refresh()
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
        setSignature(doctorName)
        setError(null)
      }}
    >
      <DialogTrigger asChild>
        <Button>{label}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('signTitle')}</DialogTitle>
          <DialogDescription>{t('signDescription')}</DialogDescription>
        </DialogHeader>

        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Alert tone="warning">{t('signWarning')}</Alert>

        <div className="flex flex-col gap-2">
          <Label htmlFor={`${fieldId}-signature`}>{t('signature')}</Label>
          <Input
            id={`${fieldId}-signature`}
            value={signature}
            maxLength={120}
            autoComplete="off"
            onChange={(event) => setSignature(event.target.value)}
          />
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={pending}>
              {tCommon('cancel')}
            </Button>
          </DialogClose>
          <Button disabled={pending || signature.trim() === ''} onClick={() => void sign()}>
            {pending ? <Spinner /> : null}
            {t('signConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
