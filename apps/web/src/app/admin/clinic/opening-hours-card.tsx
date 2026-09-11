'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import {
  SetWorkingHoursRequest,
  issueCode,
  issuePath,
  type BranchDetail,
  type WorkingHours,
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
  opensAt: string
  closesAt: string
}
type Week = Record<number, Block[]>

let blockSequence = 0
const blockKey = () => `block-${(blockSequence += 1)}`

function toWeek(hours: readonly WorkingHours[]): Week {
  const week: Week = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] }
  for (const entry of hours) {
    week[entry.dayOfWeek]?.push({
      key: blockKey(),
      opensAt: entry.opensAt,
      closesAt: entry.closesAt,
    })
  }
  return week
}

/** "13:00" plus hours, capped at 23:59 — a sensible default for a second block. */
function laterBy(time: string, hours: number): string {
  const [h = 0, m = 0] = time.split(':').map(Number)
  const minutes = Math.min(h * 60 + m + hours * 60, 23 * 60 + 59)
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

/**
 * The week for one location, one row per day, with as many blocks per day as the clinic keeps —
 * a morning and an afternoon, say. Saved as a whole so the week is never half-written.
 */
export function OpeningHoursCard({
  branches,
  timezone,
  weekdays,
  canEdit,
}: {
  branches: BranchDetail[]
  timezone: string
  weekdays: Array<{ day: number; name: string }>
  canEdit: boolean
}) {
  const t = useTranslations('admin.clinic.hours')
  const tCommon = useTranslations('common')
  const router = useRouter()
  const errorMessage = useErrorMessage()
  const validationMessage = useValidationMessage()
  const selectId = useId()

  const [branchId, setBranchId] = useState(
    () => (branches.find((branch) => branch.isActive) ?? branches[0])?.id ?? '',
  )
  const branch = branches.find((candidate) => candidate.id === branchId)
  const storedKey = JSON.stringify(branch?.workingHours ?? [])

  const [week, setWeek] = useState<Week>(() => toWeek(branch?.workingHours ?? []))
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
          opensAt: block.opensAt,
          closesAt: block.closesAt,
        })),
      ),
    [week, weekdays],
  )
  const dirty =
    JSON.stringify(
      entries.map(({ day, opensAt, closesAt }) => ({ dayOfWeek: day, opensAt, closesAt })),
    ) !==
    JSON.stringify(
      weekdays.flatMap(({ day }) =>
        (branch?.workingHours ?? []).filter((entry) => entry.dayOfWeek === day),
      ),
    )

  // After a save, the refreshed hours replace the local copy — unless someone is mid-edit.
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  useEffect(() => {
    if (!dirtyRef.current) setWeek(toWeek(JSON.parse(storedKey) as WorkingHours[]))
  }, [storedKey])

  if (!branch) return null

  function change(day: number, next: Block[]) {
    setWeek((current) => ({ ...current, [day]: next }))
    setSaved(false)
    setErrors({})
  }

  function addBlock(day: number) {
    const blocks = week[day] ?? []
    const last = blocks.at(-1)
    const opensAt = last ? last.closesAt : '09:00'
    change(day, [
      ...blocks,
      { key: blockKey(), opensAt, closesAt: last ? laterBy(opensAt, 4) : '17:00' },
    ])
  }

  function place(details: ReadonlyArray<{ field: string; issue: string }>) {
    const placed: Record<string, string[]> = {}
    let unplaced = false
    for (const detail of details) {
      const match = /^workingHours\.(\d+)\./.exec(detail.field)
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
    const body = {
      workingHours: entries.map(({ day, opensAt, closesAt }) => ({
        dayOfWeek: day,
        opensAt,
        closesAt,
      })),
    }
    const parsed = SetWorkingHoursRequest.safeParse(body)
    if (!parsed.success) {
      place(
        parsed.error.issues.map((issue) => ({ field: issuePath(issue), issue: issueCode(issue) })),
      )
      setGeneral(errorMessage(new ApiError(400, 'VALIDATION_FAILED', '')))
      return
    }
    setPending(true)
    try {
      await apiFetch(`/api/v1/admin/branches/${branchId}/working-hours`, {
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
        {branches.length > 1 ? (
          <div className="flex flex-col gap-1 sm:max-w-xs">
            <label htmlFor={selectId} className="text-sm font-medium">
              {t('location')}
            </label>
            <Select
              id={selectId}
              value={branchId}
              disabled={dirty}
              onChange={(event) => {
                const next = branches.find((candidate) => candidate.id === event.target.value)
                setBranchId(event.target.value)
                setWeek(toWeek(next?.workingHours ?? []))
                setErrors({})
                setSaved(false)
              }}
            >
              {branches.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </Select>
          </div>
        ) : null}

        {saved ? <Alert tone="success">{t('saved')}</Alert> : null}
        {general ? <Alert tone="danger">{general}</Alert> : null}

        <div className="divide-border flex flex-col divide-y">
          {weekdays.map(({ day, name }) => {
            const blocks = week[day] ?? []
            return (
              <div
                key={day}
                role="group"
                aria-labelledby={`${selectId}-day-${day}`}
                className="grid gap-2 py-3 sm:grid-cols-[9rem_1fr] sm:items-start"
              >
                <p id={`${selectId}-day-${day}`} className="pt-2.5 text-sm font-medium">
                  {name}
                </p>
                <div className="flex flex-col gap-2">
                  {blocks.length === 0 ? (
                    <p className="text-muted-foreground pt-2.5 text-sm">{t('closed')}</p>
                  ) : (
                    blocks.map((block, index) => {
                      const messages = errors[`${day}:${index}`] ?? []
                      return (
                        <div key={block.key} className="flex flex-col gap-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Input
                              type="time"
                              value={block.opensAt}
                              disabled={!canEdit}
                              aria-label={`${name} — ${t('opensAt')}`}
                              aria-invalid={messages.length > 0 || undefined}
                              className="w-32"
                              onChange={(event) =>
                                change(
                                  day,
                                  blocks.map((b) =>
                                    b.key === block.key ? { ...b, opensAt: event.target.value } : b,
                                  ),
                                )
                              }
                            />
                            <span aria-hidden="true" className="text-muted-foreground">
                              –
                            </span>
                            <Input
                              type="time"
                              value={block.closesAt}
                              disabled={!canEdit}
                              aria-label={`${name} — ${t('closesAt')}`}
                              aria-invalid={messages.length > 0 || undefined}
                              className="w-32"
                              onChange={(event) =>
                                change(
                                  day,
                                  blocks.map((b) =>
                                    b.key === block.key
                                      ? { ...b, closesAt: event.target.value }
                                      : b,
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
                                    blocks.filter((b) => b.key !== block.key),
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
                      {blocks.length > 0 ? t('addMoreHours') : t('addHours')}
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
              {pending ? tCommon('saving') : t('save')}
            </Button>
            {dirty && !pending ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setWeek(toWeek(branch.workingHours))
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
