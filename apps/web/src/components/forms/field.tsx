import type { ReactNode } from 'react'
import { Label } from '@clinic/ui'

/**
 * Label, control, hint and errors, wired together. The control should reference
 * `${id}-hint` / `${id}-error` through aria-describedby so a screen reader reads them.
 */
export function Field({
  id,
  label,
  hint,
  errors = [],
  trailing,
  children,
}: {
  id: string
  label: ReactNode
  hint?: ReactNode
  errors?: string[]
  trailing?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={id}>{label}</Label>
        {trailing}
      </div>
      {children}
      {hint && errors.length === 0 ? (
        <p id={`${id}-hint`} className="text-muted-foreground text-xs">
          {hint}
        </p>
      ) : null}
      {errors.length > 0 ? (
        <ul id={`${id}-error`} className="text-danger flex flex-col gap-0.5 text-xs font-medium">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

export function describedBy(id: string, hasHint: boolean, hasErrors: boolean): string | undefined {
  const ids = [hasErrors ? `${id}-error` : null, hasHint && !hasErrors ? `${id}-hint` : null]
  const value = ids.filter(Boolean).join(' ')
  return value || undefined
}
