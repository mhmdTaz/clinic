import { cn } from '@clinic/ui'

/**
 * One number, with the sentence that stops it being misread.
 *
 * The hint is not decoration: "collected" and "invoiced" are different amounts and a dashboard
 * that shows both without saying which is which invites somebody to quote the wrong one in a
 * meeting. `tabular-nums` keeps a column of figures aligned on their digits.
 */
export function StatCard({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string
  value: string
  hint?: string
  tone?: 'default' | 'warning'
}) {
  return (
    <div className="border-border bg-card flex flex-col gap-1 rounded-[var(--radius-card)] border p-4">
      <p className="text-muted-foreground text-xs font-medium">{label}</p>
      <p className={cn('text-2xl font-semibold tabular-nums', tone === 'warning' && 'text-danger')}>
        {value}
      </p>
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
    </div>
  )
}
