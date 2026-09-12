import type { ReactNode } from 'react'
import { cn } from '@clinic/ui'

export interface BoardColumn {
  id: string
  heading: string
  /** Under the heading: how many, or whose day it is. */
  note?: string
  /** Marks today's column in a week, so the eye lands on it first. */
  highlight?: boolean
  empty?: string
  items: ReactNode[]
}

/**
 * The calendar's columns — a day per doctor, or a week per day. Columns scroll sideways rather
 * than squeezing, so seven days stay readable on a phone at the front desk; below `sm` they
 * stack, because a column two fingers wide is no calendar at all.
 */
export function Board({ columns, label }: { columns: readonly BoardColumn[]; label: string }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul
        aria-label={label}
        className="flex flex-col gap-4 sm:grid sm:auto-cols-[minmax(15rem,1fr)] sm:grid-flow-col"
      >
        {columns.map((column) => (
          <li key={column.id} className="flex min-w-0 flex-col gap-2">
            <div
              className={cn(
                'border-border flex flex-col gap-0.5 border-b pb-2',
                column.highlight && 'border-primary border-b-2',
              )}
            >
              <h2 className={cn('text-sm font-semibold', column.highlight && 'text-primary')}>
                {column.heading}
              </h2>
              {column.note ? <p className="text-muted-foreground text-xs">{column.note}</p> : null}
            </div>
            {column.items.length === 0 ? (
              <p className="text-muted-foreground px-1 py-3 text-sm">{column.empty}</p>
            ) : (
              <div className="flex flex-col gap-2">{column.items}</div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
