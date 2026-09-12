import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { NO_PORTAL_PATH, landingPortal } from '@clinic/core/access'
import { PortalShell } from '@/components/shell/portal-shell'
import { requireActor } from '@/lib/auth/server-session'

export const dynamic = 'force-dynamic'

/**
 * Support pages belong to no portal — a patient and a doctor ask the clinic the same way — so
 * they are framed by whichever portal the reader lands on, exactly as account pages are.
 */
export default async function SupportLayout({ children }: { children: ReactNode }) {
  const actor = await requireActor()
  const portal = landingPortal(actor.portals, actor.preferredPortal)
  if (!portal) redirect(NO_PORTAL_PATH)

  return (
    <PortalShell actor={actor} portal={portal}>
      {children}
    </PortalShell>
  )
}
