import { cn } from '../lib/cn'

/**
 * Initials, taken per code point so a name that starts with an accented letter or a
 * non-Latin script is not split in half.
 */
export function initialsOf(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => ([...part][0] ?? '').toLocaleUpperCase())
    .join('')
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'bg-primary text-primary-foreground inline-flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
        className,
      )}
    >
      {initialsOf(name) || '?'}
    </span>
  )
}
