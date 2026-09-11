'use client'

import { useMemo } from 'react'
import { useRouter as useNextRouter } from 'next/navigation'

/** How long a refresh may take to render before the page is reloaded instead. */
const RENDER_TIMEOUT_MS = 2500
const POLL_MS = 100

function renderId(): string | null {
  return document.querySelector('[data-render-id]')?.getAttribute('data-render-id') ?? null
}

/**
 * Next.js's useRouter, except that refresh() makes sure the refreshed page is what ends up on
 * screen. Import it instead of next/navigation's; lint enforces that.
 *
 * In end-to-end runs Next.js 15.5 sometimes received a refresh in full and never rendered it: no
 * error, no navigation, nothing written to history. It was seen after confirm dialogs, about one
 * attempt in four once the server was warm. The portal shell stamps every server render with its
 * request id; if the stamp has not changed by the timeout, the page reloads, so a saved change is
 * never shown as though it had not happened. Outside the portal shell there is no stamp, and
 * refresh() behaves exactly like Next.js's.
 */
export function useRouter(): ReturnType<typeof useNextRouter> {
  const router = useNextRouter()
  return useMemo(
    () => ({
      ...router,
      refresh: () => {
        const before = renderId()
        router.refresh()
        if (before === null) return
        const deadline = Date.now() + RENDER_TIMEOUT_MS
        const check = () => {
          if (renderId() !== before) return
          if (Date.now() >= deadline) window.location.reload()
          else window.setTimeout(check, POLL_MS)
        }
        window.setTimeout(check, POLL_MS)
      },
    }),
    [router],
  )
}
