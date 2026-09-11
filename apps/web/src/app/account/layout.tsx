import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { NO_PORTAL_PATH, landingPortal } from '@clinic/core/access'
import { PortalShell } from '@/components/shell/portal-shell'
import { requireActor } from '@/lib/auth/server-session'

export const dynamic = 'force-dynamic'

/** Account pages belong to no portal, so they are framed by the user's landing portal. */
export default async function AccountLayout({ children }: { children: ReactNode }) {
  const actor = await requireActor()
  const portal = landingPortal(actor.portals, actor.preferredPortal)
  if (!portal) redirect(NO_PORTAL_PATH)

  return (
    <PortalShell actor={actor} portal={portal}>
      {children}
    </PortalShell>
  )
}
