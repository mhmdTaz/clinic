import { cn } from '@clinic/ui'

/**
 * An amount, right-aligned and in tabular figures.
 *
 * Money is formatted here and calculated nowhere on the client (section 8.3): the string arrives
 * exact from the server, and `Number()` is safe only because nothing is added to the result.
 * `tabular-nums` is what makes a column of figures line up on the decimal point, which is the
 * difference between a list somebody can check and one they cannot.
 */
export function Money({
  amount,
  currency,
  locale,
  className,
  tone,
}: {
  amount: string
  currency: string
  locale: string
  className?: string
  tone?: 'muted' | 'strong'
}) {
  const formatted = new Intl.NumberFormat(locale, { style: 'currency', currency }).format(
    Number(amount),
  )
  return (
    <span
      className={cn(
        'tabular-nums',
        tone === 'muted' && 'text-muted-foreground',
        tone === 'strong' && 'font-semibold',
        className,
      )}
    >
      {formatted}
    </span>
  )
}
