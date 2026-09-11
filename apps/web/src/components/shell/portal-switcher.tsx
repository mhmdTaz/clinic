'use client'

import { useState } from 'react'
import { ChevronsUpDown } from 'lucide-react'
import { useTranslations } from 'next-intl'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@clinic/ui'
import { apiFetch } from '@/lib/api/client'

export interface PortalOption {
  key: string
  label: string
  href: string
}

/** Shown only to people who can enter more than one portal — a clinic owner who also practises. */
export function PortalSwitcher({ current, portals }: { current: string; portals: PortalOption[] }) {
  const t = useTranslations('shell')
  const [switching, setSwitching] = useState(false)
  const currentLabel = portals.find((portal) => portal.key === current)?.label ?? current

  async function choose(key: string) {
    const target = portals.find((portal) => portal.key === key)
    if (!target || key === current) return
    setSwitching(true)
    // Remembered for the next sign-in. Best effort: the switch must not wait on it succeeding.
    await apiFetch('/api/v1/me', { method: 'PATCH', body: { preferredPortal: key } }).catch(
      () => undefined,
    )
    // A full navigation, so the target portal's layout renders with its own menu.
    window.location.assign(target.href)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={switching} className="gap-2">
          <span className="sr-only">{t('switchPortal')}: </span>
          <span className="max-w-32 truncate">{currentLabel}</span>
          <ChevronsUpDown className="size-4 opacity-60" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>{t('switchPortal')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={current} onValueChange={(value) => void choose(value)}>
          {portals.map((portal) => (
            <DropdownMenuRadioItem key={portal.key} value={portal.key}>
              {portal.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
