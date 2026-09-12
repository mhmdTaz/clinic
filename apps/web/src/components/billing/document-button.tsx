'use client'

import { useState } from 'react'
import type { DownloadLink } from '@clinic/contracts'
import { Button, Spinner } from '@clinic/ui'
import { apiFetch } from '@/lib/api/client'
import { useErrorMessage } from '@/lib/i18n/use-error-message'

/**
 * The printable invoice or receipt. The first press renders it and stores it; every one after
 * serves the file that already exists, so two people printing the same bill get the same
 * document rather than two that happen to look alike (ADR-0026).
 */
export function DocumentButton({ href, label }: { href: string; label: string }) {
  const errorMessage = useErrorMessage()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function open() {
    setPending(true)
    setError(null)
    try {
      const link = await apiFetch<DownloadLink>(href)
      window.open(link.url, '_blank', 'noopener,noreferrer')
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setPending(false)
    }
  }

  return (
    <span className="flex flex-col items-end gap-1">
      <Button variant="outline" size="sm" disabled={pending} onClick={() => void open()}>
        {pending ? <Spinner /> : null}
        {label}
      </Button>
      {error ? (
        <span role="alert" className="text-danger text-xs font-medium">
          {error}
        </span>
      ) : null}
    </span>
  )
}
