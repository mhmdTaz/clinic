'use client'

import { useId, useRef, useState } from 'react'
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
import { useSigningReadiness, type DraftSectionId } from './encounter-drafts'

const SECTIONS = ['subjective', 'objective', 'assessment', 'plan'] as const

/**
 * Signing the note (D9, ADR-0024).
 *
 * The doctor types their own name rather than pressing a button labelled "sign". It is a small
 * friction, and it is the point: what follows is irreversible for the content of the record, and
 * the name typed here is the one printed beneath it afterwards.
 *
 * What is signed is what the server holds, so the dialog shows exactly that, and refuses while
 * anything on the page is unsaved (audit F01): a doctor who saved A and typed B must not sign A
 * believing it to be B. The revision shown is sent with the signature, and the server refuses it
 * if anything was saved since — from another tab, another device, anyone.
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
  const tSections = useTranslations('clinical.note.sections')
  const tCommon = useTranslations('common')
  const router = useRouter()
  const errorMessage = useErrorMessage()
  const fieldId = useId()
  const readiness = useSigningReadiness()

  const [open, setOpen] = useState(false)
  const [signature, setSignature] = useState(doctorName)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [changedElsewhere, setChangedElsewhere] = useState(false)
  /** A second click before the first has re-rendered must not send a second signature. */
  const inFlight = useRef(false)
  /** The unsaved section to put the cursor in once the dialog has closed. */
  const focusAfterClose = useRef<DraftSectionId | null>(null)

  const blocked = readiness.blocking.length > 0

  async function sign() {
    if (inFlight.current || blocked) return
    inFlight.current = true
    setPending(true)
    setError(null)
    setChangedElsewhere(false)
    try {
      const parsed = SignNoteRequest.safeParse({
        signature,
        expectedRevision: readiness.revision,
      })
      if (!parsed.success) throw new ApiError(400, 'VALIDATION_FAILED', '')
      await apiFetch(`/api/v1/encounters/${encounterId}/sign`, {
        method: 'POST',
        body: parsed.data,
      })
      setOpen(false)
      router.refresh()
    } catch (caught) {
      setError(errorMessage(caught))
      setChangedElsewhere(caught instanceof ApiError && caught.code === 'NOTE_CHANGED')
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }

  function goTo(id: DraftSectionId) {
    focusAfterClose.current = id
    setOpen(false)
  }

  const saved = readiness.savedNote

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return
        setOpen(next)
        setSignature(doctorName)
        setError(null)
        setChangedElsewhere(false)
      }}
    >
      <DialogTrigger asChild>
        <Button>{label}</Button>
      </DialogTrigger>
      <DialogContent
        onCloseAutoFocus={(event) => {
          const section = focusAfterClose.current
          if (section === null) return
          focusAfterClose.current = null
          event.preventDefault()
          readiness.focus(section)
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('signTitle')}</DialogTitle>
          <DialogDescription>
            {blocked ? t('signBlockedDescription') : t('signDescription')}
          </DialogDescription>
        </DialogHeader>

        {blocked ? (
          <Alert tone="warning">
            <span className="block font-medium">{t('signBlocked')}</span>
            <ul className="mt-2 flex flex-col gap-1">
              {readiness.blocking.map((section) => (
                <li key={section.id} className="flex flex-wrap items-center gap-2">
                  <span>
                    {section.saving
                      ? t('sectionSaving', { section: section.label })
                      : section.label}
                  </span>
                  <Button variant="outline" size="sm" onClick={() => goTo(section.id)}>
                    {t('goToSection', { section: section.label })}
                  </Button>
                </li>
              ))}
            </ul>
          </Alert>
        ) : (
          <>
            {error ? (
              <Alert tone="danger">
                <span className="block">{error}</span>
                {changedElsewhere ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    onClick={() => {
                      setOpen(false)
                      router.refresh()
                    }}
                  >
                    {t('reviewLatest')}
                  </Button>
                ) : null}
              </Alert>
            ) : null}
            <Alert tone="warning">{t('signWarning')}</Alert>

            {saved ? (
              <section aria-labelledby={`${fieldId}-signing`} className="flex flex-col gap-2">
                <h3 id={`${fieldId}-signing`} className="text-sm font-semibold">
                  {t('signingSaved')}
                </h3>
                <dl className="bg-muted/40 border-border flex max-h-48 flex-col gap-2 overflow-y-auto rounded-md border p-3 text-sm">
                  {SECTIONS.map((section) => (
                    <div key={section}>
                      <dt className="text-muted-foreground text-xs font-medium">
                        {tSections(section)}
                      </dt>
                      <dd className="break-words whitespace-pre-wrap">
                        {saved[section] ?? (
                          <span className="text-muted-foreground">{tCommon('none')}</span>
                        )}
                      </dd>
                    </div>
                  ))}
                  <div>
                    <dt className="text-muted-foreground text-xs font-medium">
                      {t('shareWithPatient')}
                    </dt>
                    <dd>{saved.isPatientVisible ? tCommon('yes') : tCommon('no')}</dd>
                  </div>
                </dl>
              </section>
            ) : null}

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
          </>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={pending}>
              {tCommon('cancel')}
            </Button>
          </DialogClose>
          <Button
            disabled={pending || blocked || signature.trim() === ''}
            onClick={() => void sign()}
          >
            {pending ? <Spinner /> : null}
            {t('signConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
