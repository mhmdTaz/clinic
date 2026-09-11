'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { cn } from '@clinic/ui'
import { NavIcon } from './nav-icon'
import { activeHref, type ShellNavSection } from './nav-utils'

/**
 * Section 14.4: hidden below 768px (the bottom tab bar takes over), an icon rail from
 * 768px, the full sidebar from 1024px. Labels stay in the accessibility tree at every
 * width, so the icon rail is never a row of unnamed links.
 */
export function Sidebar({
  sections,
  portalLabel,
  clinicName,
}: {
  sections: ShellNavSection[]
  portalLabel: string
  clinicName: string
}) {
  const pathname = usePathname()
  const t = useTranslations('shell')
  const active = activeHref(
    pathname,
    sections.flatMap((section) => section.items.map((item) => item.href)),
  )

  return (
    <aside className="border-border bg-card fixed inset-y-0 start-0 z-30 hidden w-20 flex-col border-e md:flex lg:w-64">
      <div className="border-border flex h-16 shrink-0 items-center justify-center gap-3 border-b px-4 lg:justify-start lg:px-5">
        <span
          aria-hidden="true"
          className="bg-primary text-primary-foreground flex size-9 shrink-0 items-center justify-center rounded-lg text-sm font-semibold"
        >
          {([...clinicName][0] ?? '?').toLocaleUpperCase()}
        </span>
        <div className="hidden min-w-0 flex-col lg:flex">
          <span className="truncate text-sm font-semibold">{clinicName}</span>
          <span className="text-muted-foreground truncate text-xs">{portalLabel}</span>
        </div>
      </div>

      <nav aria-label={t('primaryNavigation')} className="flex-1 overflow-y-auto px-2 py-4 lg:px-3">
        {sections.map((section) => (
          <div key={section.id} className="mb-4 last:mb-0">
            <p className="text-muted-foreground mb-1 hidden px-3 text-xs font-medium tracking-wide uppercase lg:block">
              {section.label}
            </p>
            <ul className="flex flex-col gap-1">
              {section.items.map((item) => {
                const isActive = item.href === active
                return (
                  <li key={item.id}>
                    <Link
                      href={item.href}
                      title={item.label}
                      aria-current={isActive ? 'page' : undefined}
                      className={cn(
                        'flex min-h-11 items-center justify-center gap-3 rounded-md px-3 text-sm font-medium transition-colors lg:justify-start',
                        isActive
                          ? 'bg-primary/10 text-primary'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                      )}
                    >
                      <NavIcon name={item.icon} className="size-5 shrink-0" />
                      <span className="sr-only lg:not-sr-only lg:truncate">{item.label}</span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  )
}
