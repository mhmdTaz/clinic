'use client'

import { useState } from 'react'
import { OpenEncounterRequest, type EncounterDetail } from '@clinic/contracts'
import { Button, Spinner, type ButtonProps } from '@clinic/ui'
import { ApiError, apiFetch } from '@/lib/api/client'
import { useErrorMessage } from '@/lib/i18n/use-error-message'
import { useRouter } from '@/lib/navigation/use-router'

/**
 * Opening a visit and going straight into it (D6).
 *
 * The appointment id travels with it wherever there is one, so the chart and the diary agree
 * about what happened. Recording the same appointment twice is refused by the server, and the
 * refusal is shown here rather than swallowed — two half-records of one visit is the outcome
 * worth making noise about.
 */
export function StartEncounterButton({
  patientId,
  appointmentId = null,
  chiefComplaint = null,
  label,
  variant = 'primary',
}: {
  patientId: string
  appointmentId?: string | null
  chiefComplaint?: string | null
  label: string
  variant?: ButtonProps['variant']
}) {
  const router = useRouter()
  const errorMessage = useErrorMessage()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function start() {
    setPending(true)
    setError(null)
    try {
      const parsed = OpenEncounterRequest.safeParse({
        patientId,
        appointmentId,
        encounterType: 'CONSULTATION',
        chiefComplaint,
      })
      if (!parsed.success) throw new ApiError(400, 'VALIDATION_FAILED', '')
      const encounter = await apiFetch<EncounterDetail>('/api/v1/encounters', {
        method: 'POST',
        body: parsed.data,
      })
      router.push(`/doctor/encounters/${encounter.id}`)
    } catch (caught) {
      setError(errorMessage(caught))
      setPending(false)
    }
  }

  return (
    <span className="flex flex-col gap-1">
      <Button variant={variant} size="sm" disabled={pending} onClick={() => void start()}>
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
