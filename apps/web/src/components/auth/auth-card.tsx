import type { ReactNode } from 'react'
import { Card } from '@clinic/ui'

export function AuthCard({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: ReactNode
}) {
  return (
    <Card>
      <div className="flex flex-col gap-1.5 px-6 pt-6">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle ? <p className="text-muted-foreground text-sm">{subtitle}</p> : null}
      </div>
      <div className="p-6">{children}</div>
    </Card>
  )
}
