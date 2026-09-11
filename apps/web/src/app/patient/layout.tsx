import type { ReactNode } from 'react'
import { PortalShell } from '@/components/shell/portal-shell'
import { requirePortal } from '@/lib/auth/server-session'

export const dynamic = 'force-dynamic'

export default async function PatientLayout({ children }: { children: ReactNode }) {
  const actor = await requirePortal('patient')
  return (
    <PortalShell actor={actor} portal="patient">
      {children}
    </PortalShell>
  )
}
