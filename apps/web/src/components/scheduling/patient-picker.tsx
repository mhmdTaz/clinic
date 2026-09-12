'use client'

import { useEffect, useId, useState } from 'react'
import { useTranslations } from 'next-intl'
import type { PatientSummary } from '@clinic/contracts'
import { Button, Input, Label, Spinner } from '@clinic/ui'
import { apiFetch } from '@/lib/api/client'

/** Long enough that typing a name does not fire a request per keystroke. */
const DEBOUNCE_MS = 250
const MAX_RESULTS = 6

export interface PickedPatient {
  id: string
  name: string
  medicalRecordNo: string
}

/**
 * Who the appointment is for. The front desk knows the person, not their id, so this searches
 * the directory by name, record number or phone — the same search the patient list uses — and
 * shows the record number beside every name, because two people do share a name.
 */
export function PatientPicker({
  value,
  onChange,
}: {
  value: PickedPatient | null
  onChange: (patient: PickedPatient | null) => void
}) {
  const t = useTranslations('scheduling.book')
  const fieldId = useId()

  const [term, setTerm] = useState('')
  const [results, setResults] = useState<PatientSummary[] | null>(null)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    const query = term.trim()
    if (value || query.length < 2) {
      setResults(null)
      return
    }
    let current = true
    const timer = window.setTimeout(() => {
      setPending(true)
      apiFetch<PatientSummary[]>(
        `/api/v1/patients?q=${encodeURIComponent(query)}&limit=${MAX_RESULTS}`,
      )
        .then((patients) => {
          if (current) setResults(patients)
        })
        .catch(() => {
          // A search that fails leaves the list empty; the booking itself reports any real problem.
          if (current) setResults([])
        })
        .finally(() => {
          if (current) setPending(false)
        })
    }, DEBOUNCE_MS)

    return () => {
      current = false
      window.clearTimeout(timer)
    }
  }, [term, value])

  if (value) {
    return (
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">{t('patient')}</span>
        <div className="border-border flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-control)] border px-3 py-2">
          <span className="flex min-w-0 flex-col">
            <span className="font-medium">{value.name}</span>
            <span className="text-muted-foreground text-xs tabular-nums">
              {value.medicalRecordNo}
            </span>
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onChange(null)
              setTerm('')
            }}
          >
            {t('changePatient')}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={fieldId}>{t('patient')}</Label>
      <Input
        id={fieldId}
        type="search"
        autoComplete="off"
        value={term}
        placeholder={t('patientPlaceholder')}
        onChange={(event) => setTerm(event.target.value)}
      />
      {pending ? (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <Spinner />
          {t('searching')}
        </p>
      ) : null}
      {!pending && results !== null && results.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('noPatients')}</p>
      ) : null}
      {results && results.length > 0 ? (
        <ul className="border-border divide-border divide-y rounded-[var(--radius-control)] border">
          {results.map((patient) => (
            <li key={patient.id}>
              <button
                type="button"
                className="hover:bg-muted flex w-full flex-col items-start gap-0.5 px-3 py-2 text-start"
                onClick={() =>
                  onChange({
                    id: patient.id,
                    name: `${patient.firstName} ${patient.lastName}`,
                    medicalRecordNo: patient.medicalRecordNo,
                  })
                }
              >
                <span className="font-medium">
                  {patient.firstName} {patient.lastName}
                </span>
                <span className="text-muted-foreground text-xs">
                  <span className="tabular-nums">{patient.medicalRecordNo}</span>
                  {patient.phone ? ` · ${patient.phone}` : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
