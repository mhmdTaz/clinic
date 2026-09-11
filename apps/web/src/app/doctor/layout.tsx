import type { ReactNode } from 'react'
import { PortalShell } from '@/components/shell/portal-shell'
import { requirePortal } from '@/lib/auth/server-session'

export const dynamic = 'force-dynamic'

export default async function DoctorLayout({ children }: { children: ReactNode }) {
  const actor = await requirePortal('doctor')
  return (
    <PortalShell actor={actor} portal="doctor">
      {children}
    </PortalShell>
  )
}
