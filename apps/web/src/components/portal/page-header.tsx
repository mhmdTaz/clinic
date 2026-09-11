import type { ReactNode } from 'react'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'

export function PageHeader({
  title,
  subtitle,
  actions,
  back,
  badges,
}: {
  title: string
  subtitle?: string
  /** Primary actions for the page, beside the title from `sm` up and under it below. */
  actions?: ReactNode
  /** The list a detail page belongs to. */
  back?: { href: string; label: string }
  badges?: ReactNode
}) {
  return (
    <div className="mb-6 flex flex-col gap-2">
      {back ? (
        <Link
          href={back.href}
          className="text-muted-foreground hover:text-foreground -ms-1 inline-flex min-h-11 items-center gap-1 self-start text-sm"
        >
          <ChevronLeft className="size-4 rtl:rotate-180" aria-hidden="true" />
          {back.label}
        </Link>
      ) : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight break-words">{title}</h1>
            {badges}
          </div>
          {subtitle ? <p className="text-muted-foreground text-sm">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
      </div>
    </div>
  )
}
