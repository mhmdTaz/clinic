import { redirect } from 'next/navigation'
import { landingPath } from '@clinic/core/access'
import { requireActor } from '@/lib/auth/server-session'

export const dynamic = 'force-dynamic'

/**
 * There is no home page, only landing pages. The middleware normally redirects before
 * this renders; this is the fallback, and it resolves the session properly.
 */
export default async function RootPage() {
  const actor = await requireActor()
  redirect(landingPath(actor.portals, actor.preferredPortal))
}
