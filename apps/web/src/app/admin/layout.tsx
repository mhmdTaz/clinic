import type { ReactNode } from 'react'
import { PortalShell } from '@/components/shell/portal-shell'
import { requirePortal } from '@/lib/auth/server-session'

export const dynamic = 'force-dynamic'

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const actor = await requirePortal('admin')
  return (
    <PortalShell actor={actor} portal="admin">
      {children}
    </PortalShell>
  )
}
