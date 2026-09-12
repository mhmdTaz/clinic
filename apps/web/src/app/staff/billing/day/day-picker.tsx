'use client'

import { useId } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { Input, Label } from '@clinic/ui'
import { useRouter } from '@/lib/navigation/use-router'

/**
 * Which day the report is for. The date lives in the address, so a day somebody is querying can
 * be refreshed, bookmarked and sent to the manager who asked about it.
 */
export function DayPicker({ date, label }: { date: string; label: string }) {
  const id = useId()
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  return (
    <span className="flex items-center gap-2">
      <Label htmlFor={id} className="sr-only">
        {label}
      </Label>
      <Input
        id={id}
        type="date"
        value={date}
        className="w-auto"
        onChange={(event) => {
          const next = new URLSearchParams(params.toString())
          if (event.target.value) next.set('date', event.target.value)
          else next.delete('date')
          router.replace(next.size > 0 ? `${pathname}?${next.toString()}` : pathname, {
            scroll: false,
          })
        }}
      />
    </span>
  )
}
