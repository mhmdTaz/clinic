'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { cn } from '@clinic/ui'
import { NavIcon } from './nav-icon'
import { activeHref, type ShellNavItem } from './nav-utils'

/**
 * Below 768px the sidebar becomes a bottom tab bar of the portal's own destinations
 * (section 14.4), padded clear of the home indicator on phones that have one. The caller
 * decides which items those are; this only draws them.
 *
 * Tabs share the width evenly while they fit and keep a legible minimum once they do not, at
 * which point the row scrolls sideways — the partly visible tab at the edge is the affordance.
 * Dropping the overflow instead would make those pages unreachable on a phone, because this bar
 * is the only navigation at that width.
 */
export function BottomNav({ items }: { items: ShellNavItem[] }) {
  const pathname = usePathname()
  const t = useTranslations('shell')
  if (items.length === 0) return null

  const active = activeHref(
    pathname,
    items.map((item) => item.href),
  )

  return (
    <nav
      aria-label={t('primaryNavigation')}
      className="border-border bg-card/95 fixed inset-x-0 bottom-0 z-30 border-t pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <ul className="mx-auto flex max-w-lg snap-x overflow-x-auto">
        {items.map((item) => {
          const isActive = item.href === active
          return (
            <li key={item.id} className="min-w-[4.5rem] flex-1 snap-start">
              <Link
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'flex min-h-14 flex-col items-center justify-center gap-1 px-2 text-xs font-medium',
                  isActive ? 'text-primary' : 'text-muted-foreground',
                )}
              >
                <NavIcon name={item.icon} className="size-5" />
                <span className="max-w-full truncate">{item.label}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
