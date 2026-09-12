'use client'

import { useId, useTransition } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { Button, Input } from '@clinic/ui'
import { useRouter } from '@/lib/navigation/use-router'

/**
 * The dashboard's date range, held in the address.
 *
 * Two inputs and three presets, because both ways of asking are real: "the last 30 days" is a
 * glance, "1 March to 31 March" is a report somebody has to reconcile against an invoice run.
 * Keeping it in the URL means either one is a link that can be sent.
 *
 * The presets are computed from **today in the browser**, which is the same calendar day as the
 * clinic's for any plausible deployment; the server re-resolves the dates in the clinic's own
 * timezone regardless, so a traveller with a laptop on another continent gets the clinic's days,
 * not their own.
 */
export function AnalyticsRange({
  from,
  to,
  max,
  labels,
  presets,
}: {
  from: string
  to: string
  max: string
  labels: { from: string; to: string; presets: string }
  presets: ReadonlyArray<{ days: number; label: string }>
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [pending, startTransition] = useTransition()
  const id = useId()

  function navigate(next: { from?: string | null; to?: string | null }) {
    const search = new URLSearchParams(params.toString())
    for (const [key, value] of Object.entries(next)) {
      if (value === null || value === '') search.delete(key)
      else search.set(key, value)
    }
    const target = search.size > 0 ? `${pathname}?${search.toString()}` : pathname
    startTransition(() => router.replace(target, { scroll: false }))
  }

  function applyPreset(days: number) {
    const today = new Date()
    const start = new Date(today)
    // `days - 1`, because a "last 7 days" that included today plus seven earlier days would be
    // eight days of data under a seven-day label.
    start.setDate(start.getDate() - (days - 1))
    navigate({ from: isoDate(start), to: isoDate(today) })
  }

  return (
    <div aria-busy={pending} className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
      <div className="flex flex-col gap-1 sm:w-44">
        <label htmlFor={`${id}-from`} className="text-muted-foreground text-xs font-medium">
          {labels.from}
        </label>
        <Input
          id={`${id}-from`}
          type="date"
          value={from}
          max={to || max}
          onChange={(event) => navigate({ from: event.target.value || null })}
        />
      </div>
      <div className="flex flex-col gap-1 sm:w-44">
        <label htmlFor={`${id}-to`} className="text-muted-foreground text-xs font-medium">
          {labels.to}
        </label>
        <Input
          id={`${id}-to`}
          type="date"
          value={to}
          min={from || undefined}
          max={max}
          onChange={(event) => navigate({ to: event.target.value || null })}
        />
      </div>
      <div role="group" aria-label={labels.presets} className="flex flex-wrap gap-2">
        {presets.map((preset) => (
          <Button
            key={preset.days}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => applyPreset(preset.days)}
          >
            {preset.label}
          </Button>
        ))}
      </div>
    </div>
  )
}

/** Local calendar date, not `toISOString()` — which would shift to UTC and lose a day after 21:00. */
function isoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}
