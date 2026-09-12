'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import {
  SLOT_MINUTES,
  SetAvailabilityRequest,
  issueCode,
  issuePath,
  type AvailabilityBlock,
} from '@clinic/contracts'
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Select,
  Spinner,
} from '@clinic/ui'
import { ApiError, apiFetch } from '@/lib/api/client'
import { useErrorMessage, useValidationMessage } from '@/lib/i18n/use-error-message'
import { useRouter } from '@/lib/navigation/use-router'

interface Block {
  key: string
  startsAt: string
  endsAt: string
}
type Week = Record<number, Block[]>

let blockSequence = 0
const blockKey = () => `availability-${(blockSequence += 1)}`

function toWeek(blocks: readonly AvailabilityBlock[]): Week {
  const week: Week = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] }
  for (const block of blocks) {
    week[block.dayOfWeek]?.push({
      key: blockKey(),
      startsAt: block.startsAt,
      endsAt: block.endsAt,
    })
  }
  return week
}

/** A second block usually starts where the first ended and runs a few hours. */
function laterBy(time: string, hours: number): string {
  const [h = 0, m = 0] = time.split(':').map(Number)
  const minutes = Math.min(h * 60 + m + hours * 60, 23 * 60 + 59)
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

/**
 * The doctor's working week (D10, S4). Times are local to the clinic (ADR-0010) and the slot
 * length divides each block into the times a patient can pick.
 *
 * Saved whole, like the clinic's opening hours: a week is one thing, and a half-written one
 * would offer appointments in hours nobody agreed to.
 */
export function AvailabilityCard({
  doctorId,
  blocks,
  slotMinutes,
  timezone,
  weekdays,
  canEdit,
}: {
  doctorId: string
  blocks: AvailabilityBlock[]
  slotMinutes: number
  timezone: string
  weekdays: Array<{ day: number; name: string }>
  canEdit: boolean
}) {
  const t = useTranslations('scheduling.availability')
  const tScheduling = useTranslations('scheduling')
  const tCommon = useTranslations('common')
  const router = useRouter()
  const errorMessage = useErrorMessage()
  const validationMessage = useValidationMessage()
  const fieldId = useId()

  const storedKey = JSON.stringify(blocks)
  const [week, setWeek] = useState<Week>(() => toWeek(blocks))
  const [length, setLength] = useState(slotMinutes)
  const [errors, setErrors] = useState<Record<string, string[]>>({})
  const [general, setGeneral] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [pending, setPending] = useState(false)

  const entries = useMemo(
    () =>
      weekdays.flatMap(({ day }) =>
        (week[day] ?? []).map((block, index) => ({
          day,
          index,
          startsAt: block.startsAt,
          endsAt: block.endsAt,
        })),
      ),
    [week, weekdays],
  )

  const dirty =
    length !== slotMinutes ||
    JSON.stringify(
      entries.map(({ day, startsAt, endsAt }) => ({ dayOfWeek: day, startsAt, endsAt })),
    ) !==
      JSON.stringify(
        weekdays.flatMap(({ day }) => blocks.filter((block) => block.dayOfWeek === day)),
      )

  // After a save the refreshed week replaces the local copy — unless someone is mid-edit.
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  useEffect(() => {
    if (!dirtyRef.current) setWeek(toWeek(JSON.parse(storedKey) as AvailabilityBlock[]))
  }, [storedKey])

  function change(day: number, next: Block[]) {
    setWeek((current) => ({ ...current, [day]: next }))
    setSaved(false)
    setErrors({})
  }

  function addBlock(day: number) {
    const dayBlocks = week[day] ?? []
    const last = dayBlocks.at(-1)
    const startsAt = last ? last.endsAt : '09:00'
    change(day, [
      ...dayBlocks,
      { key: blockKey(), startsAt, endsAt: last ? laterBy(startsAt, 3) : '17:00' },
    ])
  }

  /** Server and contract both name a block by its index in the flattened list. */
  function place(details: ReadonlyArray<{ field: string; issue: string }>) {
    const placed: Record<string, string[]> = {}
    let unplaced = false
    for (const detail of details) {
      const match = /^blocks\.(\d+)\./.exec(detail.field)
      const entry = match ? entries[Number(match[1])] : undefined
      if (!entry) {
        unplaced = true
        continue
      }
      ;(placed[`${entry.day}:${entry.index}`] ??= []).push(validationMessage(detail.issue))
    }
    setErrors(placed)
    return unplaced
  }

  async function save() {
    setGeneral(null)
    setSaved(false)
    const parsed = SetAvailabilityRequest.safeParse({
      slotMinutes: length,
      blocks: entries.map(({ day, startsAt, endsAt }) => ({ dayOfWeek: day, startsAt, endsAt })),
    })
    if (!parsed.success) {
      place(
        parsed.error.issues.map((issue) => ({ field: issuePath(issue), issue: issueCode(issue) })),
      )
      setGeneral(errorMessage(new ApiError(400, 'VALIDATION_FAILED', '')))
      return
    }

    setPending(true)
    try {
      await apiFetch(`/api/v1/doctors/${doctorId}/availability`, {
        method: 'PUT',
        body: parsed.data,
      })
      setSaved(true)
      router.refresh()
    } catch (caught) {
      const unplaced = caught instanceof ApiError ? place(caught.details) : true
      if (unplaced) setGeneral(errorMessage(caught))
    } finally {
      setPending(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('subtitle', { timezone })}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1 sm:max-w-xs">
          <label htmlFor={`${fieldId}-length`} className="text-sm font-medium">
            {t('slotLength')}
          </label>
          <Select
            id={`${fieldId}-length`}
            value={String(length)}
            disabled={!canEdit}
            onChange={(event) => {
              setLength(Number(event.target.value))
              setSaved(false)
            }}
          >
            {SLOT_MINUTES.map((minutes) => (
              <option key={minutes} value={minutes}>
                {tScheduling('minutes', { count: minutes })}
              </option>
            ))}
          </Select>
          <p className="text-muted-foreground text-xs">{t('slotLengthHint')}</p>
        </div>

        {saved ? <Alert tone="success">{t('saved')}</Alert> : null}
        {general ? <Alert tone="danger">{general}</Alert> : null}

        <div className="divide-border flex flex-col divide-y">
          {weekdays.map(({ day, name }) => {
            const dayBlocks = week[day] ?? []
            return (
              <div
                key={day}
                role="group"
                aria-labelledby={`${fieldId}-day-${day}`}
                className="grid gap-2 py-3 sm:grid-cols-[9rem_1fr] sm:items-start"
              >
                <p id={`${fieldId}-day-${day}`} className="pt-2.5 text-sm font-medium">
                  {name}
                </p>
                <div className="flex flex-col gap-2">
                  {dayBlocks.length === 0 ? (
                    <p className="text-muted-foreground pt-2.5 text-sm">{t('away')}</p>
                  ) : (
                    dayBlocks.map((block, index) => {
                      const messages = errors[`${day}:${index}`] ?? []
                      return (
                        <div key={block.key} className="flex flex-col gap-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Input
                              type="time"
                              value={block.startsAt}
                              disabled={!canEdit}
                              aria-label={`${name} — ${t('startsAt')}`}
                              aria-invalid={messages.length > 0 || undefined}
                              className="w-32"
                              onChange={(event) =>
                                change(
                                  day,
                                  dayBlocks.map((b) =>
                                    b.key === block.key
                                      ? { ...b, startsAt: event.target.value }
                                      : b,
                                  ),
                                )
                              }
                            />
                            <span aria-hidden="true" className="text-muted-foreground">
                              –
                            </span>
                            <Input
                              type="time"
                              value={block.endsAt}
                              disabled={!canEdit}
                              aria-label={`${name} — ${t('endsAt')}`}
                              aria-invalid={messages.length > 0 || undefined}
                              className="w-32"
                              onChange={(event) =>
                                change(
                                  day,
                                  dayBlocks.map((b) =>
                                    b.key === block.key ? { ...b, endsAt: event.target.value } : b,
                                  ),
                                )
                              }
                            />
                            {canEdit ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                aria-label={`${name} — ${t('removeHours')}`}
                                onClick={() =>
                                  change(
                                    day,
                                    dayBlocks.filter((b) => b.key !== block.key),
                                  )
                                }
                              >
                                <X className="size-4" aria-hidden="true" />
                              </Button>
                            ) : null}
                          </div>
                          {messages.length > 0 ? (
                            <p className="text-danger text-xs font-medium">{messages.join(' ')}</p>
                          ) : null}
                        </div>
                      )
                    })
                  )}
                  {canEdit ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="self-start"
                      onClick={() => addBlock(day)}
                    >
                      {dayBlocks.length > 0 ? t('addMoreHours') : t('addHours')}
                    </Button>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>

        {canEdit ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => void save()} disabled={pending || !dirty}>
              {pending ? <Spinner /> : null}
              {pending ? tCommon('saving') : tCommon('save')}
            </Button>
            {dirty && !pending ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setWeek(toWeek(blocks))
                    setLength(slotMinutes)
                    setErrors({})
                    setGeneral(null)
                  }}
                >
                  {tCommon('cancel')}
                </Button>
                <span className="text-muted-foreground text-xs">{tCommon('unsaved')}</span>
              </>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
