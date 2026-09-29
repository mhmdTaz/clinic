'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { activeHref, type ShellNavItem } from './nav-utils'
import { PortalSwitcher, type PortalOption } from './portal-switcher'
import { NotificationBell } from './notification-bell'
import { UserMenu } from './user-menu'

export function TopBar({
  portal,
  portalLabel,
  portals,
  items,
  userName,
}: {
  portal: string
  portalLabel: string
  portals: PortalOption[]
  items: ShellNavItem[]
  userName: string
}) {
  const pathname = usePathname()
  const t = useTranslations('shell')
  const homeHref = portals.find((option) => option.key === portal)?.href ?? null
  const active = activeHref(pathname, items)
  const current = items.find((item) => item.href === active)

  return (
    <header className="border-border bg-background/95 sticky top-0 z-20 flex h-16 items-center gap-3 border-b px-4 backdrop-blur sm:px-6">
      <nav aria-label={t('breadcrumb')} className="min-w-0 flex-1">
        <ol className="flex min-w-0 items-center gap-2 text-sm">
          <li className="text-muted-foreground shrink-0">
            {homeHref && current?.href !== homeHref ? (
              <Link href={homeHref} className="hover:text-foreground">
                {portalLabel}
              </Link>
            ) : (
              <span
                className={current?.href === homeHref ? 'text-foreground font-medium' : undefined}
              >
                {portalLabel}
              </span>
            )}
          </li>
          {current && current.href !== homeHref ? (
            <>
              <li aria-hidden="true" className="text-muted-foreground">
                /
              </li>
              <li className="truncate font-medium">
                {/* The section a detail page sits in is a way back to it; only the section's own
                    page is "the current page". */}
                {pathname === current.href ? (
                  <span aria-current="page">{current.label}</span>
                ) : (
                  <Link href={current.href} className="hover:underline">
                    {current.label}
                  </Link>
                )}
              </li>
            </>
          ) : null}
        </ol>
      </nav>
      {portals.length > 1 ? <PortalSwitcher current={portal} portals={portals} /> : null}
      <NotificationBell />
      <UserMenu name={userName} />
    </header>
  )
}
