import * as React from 'react'
import { cn } from '../lib/cn'

/**
 * 44px tall for touch, and 16px text on small screens: iOS zooms the whole page into
 * any input whose font is smaller than that, which reads as the layout breaking.
 */
export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type = 'text', ...props }, ref) => (
  <input
    ref={ref}
    type={type}
    className={cn(
      'border-input bg-card text-foreground flex h-11 w-full rounded-[var(--radius-control)] border px-3 text-base sm:text-sm',
      'placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50',
      'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-ring)]',
      'aria-[invalid=true]:border-danger',
      className,
    )}
    {...props}
  />
))
Input.displayName = 'Input'
