import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../lib/cn'

const alertVariants = cva(
  'flex flex-col gap-1 rounded-[var(--radius-control)] border px-4 py-3 text-sm',
  {
    variants: {
      tone: {
        info: 'border-border bg-muted',
        success: 'border-success/30 bg-success/10',
        warning: 'border-warning/40 bg-warning/15',
        danger: 'border-danger/30 bg-danger/10',
      },
    },
    defaultVariants: { tone: 'info' },
  },
)

export interface AlertProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'>, VariantProps<typeof alertVariants> {
  title?: React.ReactNode
}

/**
 * Errors are announced immediately (role="alert"); everything else politely
 * (role="status"), so a screen reader is not interrupted for a success message.
 */
export function Alert({ className, tone, title, children, ...props }: AlertProps) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn(alertVariants({ tone }), className)}
      {...props}
    >
      {title ? <p className="font-medium">{title}</p> : null}
      {children ? <div className="text-muted-foreground">{children}</div> : null}
    </div>
  )
}
