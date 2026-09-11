'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  RegisterPatientRequest,
  type DuplicateCandidate,
  type DuplicateCheckResult,
  type PatientDetail,
} from '@clinic/contracts'
import { Alert, Badge, Button, Label, Spinner, Textarea } from '@clinic/ui'
import { AutoForm } from '@/components/forms/auto-form'
import { ApiError, apiFetch } from '@/lib/api/client'
import { formatCalendarDate } from '@/lib/format/dates'
import type { Option } from '@/lib/format/regions'
import { useErrorMessage, useValidationMessage } from '@/lib/i18n/use-error-message'
import { useRouter } from '@/lib/navigation/use-router'
import { usePatientSections } from '../patient-form-sections'

const EMPTY: Partial<RegisterPatientRequest> = {
  bloodType: 'UNKNOWN',
  emergencyContacts: [],
  inviteToPortal: false,
}

function afterRegistration(result: { patient: PatientDetail; invitationSent: boolean | null }) {
  const outcome = result.invitationSent === null ? 'yes' : result.invitationSent ? 'sent' : 'unsent'
  return `/staff/patients/${result.patient.id}?registered=${outcome}`
}

/**
 * Registration with the duplicate check in front of it (ADR-0020). The check runs when the form is
 * submitted; if it finds possible matches, nothing is saved until the person either opens the
 * existing record or says, in words, why this is someone else.
 */
export function RegisterPatientForm({
  countries,
  today,
  locale,
}: {
  countries: Option[]
  today: string
  locale: string
}) {
  const t = useTranslations('staff.patients')
  const tReasons = useTranslations('duplicateReasons')
  const router = useRouter()
  const errorMessage = useErrorMessage()
  const validationMessage = useValidationMessage()
  const reasonId = useId()
  const sections = usePatientSections({ countries, today, withPortalInvite: true })

  const [review, setReview] = useState<{
    body: RegisterPatientRequest
    candidates: DuplicateCandidate[]
  } | null>(null)
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const panel = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    if (review) panel.current?.focus()
  }, [review])

  async function candidatesFor(body: RegisterPatientRequest) {
    const result = await apiFetch<DuplicateCheckResult>('/api/v1/patients/check-duplicates', {
      method: 'POST',
      body: {
        firstName: body.firstName,
        lastName: body.lastName,
        dateOfBirth: body.dateOfBirth,
        nationalId: body.nationalId,
        contact: body.contact,
        excludePatientId: null,
      },
    })
    return result.candidates
  }

  async function registerAnyway() {
    if (!review) return
    setPending(true)
    setError(null)
    setReasonError(null)
    try {
      const result = await apiFetch<{ patient: PatientDetail; invitationSent: boolean | null }>(
        '/api/v1/patients',
        {
          method: 'POST',
          body: {
            ...review.body,
            duplicateOverride: {
              reason,
              candidateIds: review.candidates.map((candidate) => candidate.id),
            },
          },
        },
      )
      router.push(afterRegistration(result))
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'POSSIBLE_DUPLICATE') {
        // Someone registered another match while this panel was open: show the current list.
        setReview({ body: review.body, candidates: await candidatesFor(review.body) })
        setError(errorMessage(caught))
      } else if (caught instanceof ApiError) {
        const onReason = caught.details.find((detail) =>
          detail.field.startsWith('duplicateOverride.reason'),
        )
        if (onReason) setReasonError(validationMessage(onReason.issue))
        else setError(errorMessage(caught))
      } else {
        setError(errorMessage(caught))
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {review ? (
        <section
          aria-labelledby={`${reasonId}-title`}
          className="border-warning/50 bg-warning/10 flex flex-col gap-4 rounded-[var(--radius-card)] border p-4"
        >
          <div className="flex flex-col gap-1">
            <h2
              id={`${reasonId}-title`}
              ref={panel}
              tabIndex={-1}
              className="font-semibold outline-none"
            >
              {t('duplicates.title')}
            </h2>
            <p className="text-muted-foreground text-sm">{t('duplicates.body')}</p>
          </div>

          {error ? <Alert tone="danger">{error}</Alert> : null}

          <ul className="flex flex-col gap-2">
            {review.candidates.map((candidate) => (
              <li
                key={candidate.id}
                className="border-border bg-card flex flex-col gap-2 rounded-[var(--radius-control)] border p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {candidate.firstName} {candidate.lastName}
                    <span className="text-muted-foreground text-xs font-normal tabular-nums">
                      {candidate.medicalRecordNo}
                    </span>
                    {candidate.isActive ? null : (
                      <Badge tone="neutral">{t('duplicates.archived')}</Badge>
                    )}
                  </p>
                  <p className="text-muted-foreground text-sm tabular-nums">
                    {[
                      candidate.dateOfBirth
                        ? formatCalendarDate(candidate.dateOfBirth, locale)
                        : null,
                      candidate.phone,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  <p className="mt-1 flex flex-wrap gap-1">
                    {candidate.reasons.map((code) => (
                      <Badge key={code} tone="warning">
                        {tReasons(code)}
                      </Badge>
                    ))}
                  </p>
                </div>
                {/* A new tab, so the details typed so far are still here afterwards. */}
                <a
                  href={`/staff/patients/${candidate.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary min-h-11 content-center self-start text-sm font-medium hover:underline sm:self-auto"
                >
                  {t('duplicates.open')}
                </a>
              </li>
            ))}
          </ul>

          <div className="flex flex-col gap-2">
            <Label htmlFor={reasonId}>{t('duplicates.reason')}</Label>
            <Textarea
              id={reasonId}
              rows={2}
              maxLength={300}
              value={reason}
              aria-invalid={reasonError ? true : undefined}
              aria-describedby={reasonError ? `${reasonId}-error` : `${reasonId}-hint`}
              onChange={(event) => setReason(event.target.value)}
            />
            {reasonError ? (
              <p id={`${reasonId}-error`} className="text-danger text-xs font-medium">
                {reasonError}
              </p>
            ) : (
              <p id={`${reasonId}-hint`} className="text-muted-foreground text-xs">
                {t('duplicates.reasonHint')}
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void registerAnyway()} disabled={pending}>
              {pending ? <Spinner /> : null}
              {t('duplicates.confirm')}
            </Button>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => {
                setReview(null)
                setError(null)
                setReasonError(null)
              }}
            >
              {t('duplicates.back')}
            </Button>
          </div>
        </section>
      ) : null}

      <div hidden={review !== null}>
        <AutoForm
          schema={RegisterPatientRequest}
          sections={sections}
          initialValues={EMPTY}
          action="/api/v1/patients"
          method="POST"
          submitLabel={t('new.submit')}
          fieldAliases={{ email: 'contact.email' }}
          beforeSubmit={async (body) => {
            const input = body as RegisterPatientRequest
            const candidates = await candidatesFor(input)
            if (candidates.length === 0) return input
            setReason('')
            setReview({ body: input, candidates })
            return null
          }}
          onSuccess={(data) =>
            router.push(
              afterRegistration(data as { patient: PatientDetail; invitationSent: boolean | null }),
            )
          }
        />
      </div>
    </div>
  )
}
