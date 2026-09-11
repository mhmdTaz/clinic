'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Alert, Button, Spinner } from '@clinic/ui'
import { apiFetch } from '@/lib/api/client'
import { useErrorMessage } from '@/lib/i18n/use-error-message'
import { useRouter } from '@/lib/navigation/use-router'

/** Creates the portal account and emails the link, or sends a fresh link to one still waiting. */
export function PortalInviteButton({ patientId, label }: { patientId: string; label: string }) {
  const t = useTranslations('staff.patients.detail')
  const router = useRouter()
  const errorMessage = useErrorMessage()
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<{
    tone: 'success' | 'warning' | 'danger'
    text: string
  } | null>(null)

  async function invite() {
    setPending(true)
    setResult(null)
    try {
      const { invitationSent } = await apiFetch<{ invitationSent: boolean }>(
        `/api/v1/patients/${patientId}/portal-invitation`,
        { method: 'POST' },
      )
      setResult(
        invitationSent
          ? { tone: 'success', text: t('inviteDone') }
          : { tone: 'warning', text: t('invitationNotSent') },
      )
      router.refresh()
    } catch (caught) {
      setResult({ tone: 'danger', text: errorMessage(caught) })
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex w-full flex-col items-start gap-2">
      {result ? (
        <Alert tone={result.tone} className="w-full">
          {result.text}
        </Alert>
      ) : null}
      <Button variant="outline" size="sm" disabled={pending} onClick={() => void invite()}>
        {pending ? <Spinner /> : null}
        {label}
      </Button>
    </div>
  )
}
