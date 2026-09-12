'use client'

import { useState } from 'react'
import { Button, Spinner, type ButtonProps } from '@clinic/ui'
import { apiFetch } from '@/lib/api/client'
import { useErrorMessage } from '@/lib/i18n/use-error-message'
import { useRouter } from '@/lib/navigation/use-router'

/**
 * A one-click step with nothing to decide: the patient has arrived, the doctor has taken them
 * in, the visit is over. Confirming these would only slow the front desk down — everything they
 * lead to is reversible by a further step, and all of them are in the audit log.
 *
 * Anything that frees the time or closes the record off — cancel, no-show — uses ConfirmAction
 * instead, so it is never one stray tap away.
 */
export function QuickAction({
  label,
  action,
  variant = 'outline',
}: {
  label: string
  action: string
  variant?: ButtonProps['variant']
}) {
  const router = useRouter()
  const errorMessage = useErrorMessage()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setPending(true)
    setError(null)
    try {
      await apiFetch(action, { method: 'POST' })
      router.refresh()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setPending(false)
    }
  }

  return (
    <span className="flex flex-col gap-1">
      <Button variant={variant} size="sm" disabled={pending} onClick={() => void run()}>
        {pending ? <Spinner /> : null}
        {label}
      </Button>
      {error ? (
        <span role="alert" className="text-danger text-xs font-medium">
          {error}
        </span>
      ) : null}
    </span>
  )
}
