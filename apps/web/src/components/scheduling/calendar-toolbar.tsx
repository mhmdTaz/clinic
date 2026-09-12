'use client'

import { useId, useTransition } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button, Input, Select, cn } from '@clinic/ui'
import { isCalendarDate, shiftDate } from '@/lib/format/dates'
import { useRouter } from '@/lib/navigation/use-router'

export interface CalendarFilter {
  param: string
  label: string
  value: string
  options: ReadonlyArray<{ value: string; label: string }>
}

/**
 * Moving around the calendar. Like the list screens, the address is the state (section 14.3):
 * a particular day, doctor and view can be bookmarked, shared with a colleague, and survives
 * both a refresh and the browser's back button.
 */
export function CalendarToolbar({
  date,
  view,
  today,
  filters = [],
}: {
  date: string
  view: 'day' | 'week'
  /** Today in the clinic's timezone, which is not necessarily today where the user is. */
  today: string
  filters?: readonly CalendarFilter[]
}) {
  const t = useTranslations('scheduling.calendar')
  const tTable = useTranslations('dataTable')
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [pending, startTransition] = useTransition()
  const fieldId = useId()

  function navigate(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString())
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === '') next.delete(key)
      else next.set(key, value)
    }
    const target = next.size > 0 ? `${pathname}?${next.toString()}` : pathname
    startTransition(() => router.replace(target, { scroll: false }))
  }

  const step = view === 'week' ? 7 : 1

  return (
    <div
      aria-busy={pending}
      className={cn('flex flex-col gap-3 transition-opacity', pending && 'opacity-60')}
    >
      {pending ? (
        <p role="status" className="sr-only">
          {tTable('updating')}
        </p>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="flex items-end gap-2">
          <Button
            variant="outline"
            size="sm"
            aria-label={t('previous')}
            onClick={() => navigate({ date: shiftDate(date, -step) })}
          >
            <ChevronLeft className="size-4 rtl:rotate-180" aria-hidden="true" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={date === today}
            onClick={() => navigate({ date: today })}
          >
            {t('today')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            aria-label={t('next')}
            onClick={() => navigate({ date: shiftDate(date, step) })}
          >
            <ChevronRight className="size-4 rtl:rotate-180" aria-hidden="true" />
          </Button>
        </div>

        <div className="flex flex-col gap-1 sm:w-44">
          <label htmlFor={`${fieldId}-date`} className="text-muted-foreground text-xs font-medium">
            {t('date')}
          </label>
          <Input
            id={`${fieldId}-date`}
            type="date"
            value={date}
            onChange={(event) => {
              // A half-typed date would ask the server for nothing sensible.
              if (isCalendarDate(event.target.value)) navigate({ date: event.target.value })
            }}
          />
        </div>

        <div className="flex flex-col gap-1 sm:w-36">
          <label htmlFor={`${fieldId}-view`} className="text-muted-foreground text-xs font-medium">
            {t('view')}
          </label>
          <Select
            id={`${fieldId}-view`}
            value={view}
            onChange={(event) => navigate({ view: event.target.value === 'week' ? 'week' : null })}
          >
            <option value="day">{t('views.day')}</option>
            <option value="week">{t('views.week')}</option>
          </Select>
        </div>

        {filters.map((filter) => (
          <div key={filter.param} className="flex flex-col gap-1 sm:w-52">
            <label
              htmlFor={`${fieldId}-${filter.param}`}
              className="text-muted-foreground text-xs font-medium"
            >
              {filter.label}
            </label>
            <Select
              id={`${fieldId}-${filter.param}`}
              value={filter.value}
              onChange={(event) => navigate({ [filter.param]: event.target.value })}
            >
              {filter.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
        ))}
      </div>
    </div>
  )
}
