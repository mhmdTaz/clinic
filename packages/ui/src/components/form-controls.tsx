import * as React from 'react'
import { cn } from '../lib/cn'

const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-ring)]'

/**
 * Native controls, styled to match Input: 44px targets, 16px text below `sm` so iOS does not zoom,
 * and a red border when the control is marked invalid. Native selects and checkboxes are fully
 * accessible and work with the phone's own pickers, which a custom listbox would have to imitate.
 */
export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      'border-input bg-card text-foreground h-11 w-full rounded-[var(--radius-control)] border px-3 text-base sm:text-sm',
      'aria-[invalid=true]:border-danger disabled:cursor-not-allowed disabled:opacity-50',
      focusRing,
      className,
    )}
    {...props}
  />
))
Select.displayName = 'Select'

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, rows = 4, ...props }, ref) => (
  <textarea
    ref={ref}
    rows={rows}
    className={cn(
      'border-input bg-card text-foreground w-full rounded-[var(--radius-control)] border px-3 py-2 text-base sm:text-sm',
      'placeholder:text-muted-foreground aria-[invalid=true]:border-danger disabled:cursor-not-allowed disabled:opacity-50',
      focusRing,
      className,
    )}
    {...props}
  />
))
Textarea.displayName = 'Textarea'

export const Checkbox = React.forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    type="checkbox"
    className={cn(
      'accent-primary size-5 shrink-0 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50',
      focusRing,
      className,
    )}
    {...props}
  />
))
Checkbox.displayName = 'Checkbox'

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'bg-muted animate-pulse rounded-[var(--radius-control)] motion-reduce:animate-none',
        className,
      )}
      {...props}
    />
  )
}
