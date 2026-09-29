'use client'

import { useMemo } from 'react'
import { useRouter as useNextRouter } from 'next/navigation'
import { guardNavigation, hasUnsavedWork } from './navigation-guard'

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
 *
 * Two things a reload must never do (audit F02): throw away a draft in another part of the page,
 * and navigate past an unsaved-changes guard. So while anything on screen is unsaved, the fallback
 * asks for one more refresh instead of reloading — the section that was just saved already shows
 * what the server answered, and the rest of the page keeps what was typed. push, replace and back
 * go through the same guard as a clicked link.
 */
export function useRouter(): ReturnType<typeof useNextRouter> {
  const router = useNextRouter()
  return useMemo(
    () => ({
      ...router,
      push: (...args: Parameters<typeof router.push>) =>
        guardNavigation(() => router.push(...args)),
      replace: (...args: Parameters<typeof router.replace>) =>
        guardNavigation(() => router.replace(...args)),
      back: () => guardNavigation(() => router.back()),
      refresh: () => {
        const before = renderId()
        router.refresh()
        if (before === null) return
        const deadline = Date.now() + RENDER_TIMEOUT_MS
        const check = () => {
          if (renderId() !== before) return
          if (Date.now() < deadline) window.setTimeout(check, POLL_MS)
          else if (hasUnsavedWork()) router.refresh()
          else window.location.reload()
        }
        window.setTimeout(check, POLL_MS)
      },
    }),
    [router],
  )
}
