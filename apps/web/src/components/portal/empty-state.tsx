import type { ReactNode } from 'react'

/** What an empty list says instead of a bare table header: what this is, and what to do next. */
export function EmptyState({
  title,
  body,
  action,
}: {
  title: string
  body?: string
  action?: ReactNode
}) {
  return (
    <div className="border-border flex flex-col items-center gap-2 rounded-[var(--radius-card)] border border-dashed px-6 py-12 text-center">
      <p className="font-medium">{title}</p>
      {body ? <p className="text-muted-foreground max-w-md text-sm">{body}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}
