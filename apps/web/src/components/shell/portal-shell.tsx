import type { ReactNode } from 'react'
import { headers } from 'next/headers'
import { getTranslations } from 'next-intl/server'
import type { PortalKey } from '@clinic/config'
import { PORTALS, type Actor } from '@clinic/core/access'
import { getClinicSessionInfo } from '@clinic/core/clinic'
import { getMyNavigation } from '@clinic/core/session'
import { TokenRenewal } from '@/components/auth/token-renewal'
import { accessTokenIsStale } from '@/lib/auth/server-session'
import { BottomNav } from './bottom-nav'
import { Sidebar } from './sidebar'
import { TopBar } from './top-bar'

/**
 * The frame every portal page sits in. The menu is computed on the server from the
 * actor's permissions (section 14.2); the client only highlights the active item.
 */
export async function PortalShell({
  actor,
  portal,
  children,
}: {
  actor: Actor
  portal: PortalKey
  children: ReactNode
}) {
  const [navigation, clinic, t, staleToken, requestHeaders] = await Promise.all([
    getMyNavigation(actor, portal),
    getClinicSessionInfo(actor.clinicId),
    getTranslations(),
    accessTokenIsStale(),
    headers(),
  ])
  // A new value on every server render, so a client refresh can tell whether it actually
  // rendered (lib/navigation/use-router).
  const renderId = requestHeaders.get('x-request-id') ?? crypto.randomUUID()

  const sections = navigation.sections.map((section) => ({
    id: section.id,
    label: t(section.labelKey),
    items: section.items.map((item) => ({
      id: item.id,
      href: item.href,
      icon: item.icon,
      label: t(item.labelKey),
    })),
  }))
  const items = sections.flatMap((section) => section.items)
  /**
   * The phone's tab bar carries *every* one of the portal's own destinations (section 14.4).
   *
   * Account is deliberately not among them: it lives in the account menu, which is on every
   * screen at every width. Nor is the list capped — the tab bar is the only navigation below
   * 768px, since the top bar shows a breadcrumb rather than a menu, so a cap would make the
   * dropped page unreachable on a phone. The bar scrolls sideways instead once the portal has
   * more destinations than fit, which billing was the first phase to do.
   */
  const tabs = sections
    .filter((section) => section.id !== 'account')
    .flatMap((section) => section.items)
  const portals = actor.portals.map((key) => ({
    key,
    href: PORTALS[key].homePath,
    label: t(PORTALS[key].labelKey),
  }))
  const portalLabel = t(PORTALS[navigation.portal].labelKey)

  return (
    <div className="bg-background min-h-dvh" data-render-id={renderId}>
      <a
        href="#main"
        className="focus:bg-card sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-50 focus:rounded-md focus:px-4 focus:py-2 focus:shadow"
      >
        {t('shell.skipToContent')}
      </a>
      <Sidebar sections={sections} portalLabel={portalLabel} clinicName={clinic.name} />
      <div className="md:ps-20 lg:ps-64">
        <TopBar
          portal={navigation.portal}
          portalLabel={portalLabel}
          portals={portals}
          items={items}
          userName={actor.displayName}
        />
        <main id="main" className="mx-auto w-full max-w-6xl px-4 pt-6 pb-28 sm:px-6 md:pb-12">
          {children}
        </main>
      </div>
      <BottomNav items={tabs} />
      {/* The menu above already reflects the current grants; this only stores the new token. */}
      {staleToken ? <TokenRenewal /> : null}
    </div>
  )
}
