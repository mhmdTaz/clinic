'use client'

import { useEffect, useRef } from 'react'
import { inAppDestination, installNavigationGuard, type LeaveAttempt } from './navigation-guard'
import { useRouter } from './use-router'

/** How long to wait for our own `history.back()` to land before carrying on regardless. */
const SETTLE_MS = 1000

interface Sentinel {
  /** A duplicate of the current entry is on top of the history stack, so Back lands on us. */
  armed: boolean
  /** The entry the guard was armed on, for putting the page's address back. */
  state: unknown
  url: string
  /** `popstate` events we caused ourselves, which nothing else should act on. */
  swallow: number
  settled: Array<() => void>
}

/**
 * Holds every way of leaving the page while `blocking` is true (audit F02), and hands the
 * decision to `onBlocked` as a {@link LeaveAttempt} to answer.
 *
 * - Links anywhere on the page — sidebar, tab bar, breadcrumbs, back links — are caught in the
 *   capture phase, before Next.js's own click handler turns them into a navigation.
 * - `router.push`/`replace`/`back` from lib/navigation/use-router ask the same question.
 * - Back is caught with one duplicate history entry on top of this page: pressing Back pops the
 *   duplicate, the address does not change, and the question is asked with nothing yet lost. The
 *   duplicate is taken off again as soon as the page is clean, so a saved page never needs an
 *   extra Back press.
 * - Reload, closing the tab and typing another address get the browser's own warning. Browsers
 *   word that dialog themselves and offer only Leave or Stay; no page can add a Save button there.
 */
export function useLeaveGuard(blocking: boolean, onBlocked: (attempt: LeaveAttempt) => void): void {
  const router = useRouter()
  const blockingRef = useRef(blocking)
  blockingRef.current = blocking
  const onBlockedRef = useRef(onBlocked)
  onBlockedRef.current = onBlocked
  /** Set once the person has chosen to leave, so the way out is not itself held. */
  const releasedRef = useRef(false)
  const sentinel = useRef<Sentinel>({ armed: false, state: null, url: '', swallow: 0, settled: [] })

  useEffect(() => {
    const s = sentinel.current
    const isBlocking = () => blockingRef.current && !releasedRef.current

    /** Takes the duplicate entry off the stack; resolves once the browser has done it. */
    const disarm = (): Promise<void> => {
      if (s.armed) {
        s.armed = false
        s.swallow += 1
        window.history.back()
      }
      if (s.swallow === 0) return Promise.resolve()
      return new Promise((resolve) => {
        s.settled.push(resolve)
        window.setTimeout(resolve, SETTLE_MS)
      })
    }

    /** A link or a programmatic navigation: `go` is where the person was headed. */
    const ask = (go: () => void) =>
      onBlockedRef.current({
        leave: () => {
          releasedRef.current = true
          void disarm().then(go)
        },
        stay: () => {},
      })

    const uninstall = installNavigationGuard({ isBlocking, onBlocked: ask })

    const onClick = (event: MouseEvent) => {
      if (!isBlocking()) return
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null
      if (!(anchor instanceof HTMLAnchorElement)) return
      const to = inAppDestination(
        event,
        { href: anchor.href, target: anchor.target, download: anchor.hasAttribute('download') },
        window.location,
      )
      if (to === null) return
      event.preventDefault()
      event.stopPropagation()
      ask(() => router.push(to))
    }

    const onPopState = (event: PopStateEvent) => {
      if (s.swallow > 0) {
        s.swallow -= 1
        event.stopImmediatePropagation()
        if (s.swallow === 0) s.settled.splice(0).forEach((resolve) => resolve())
        return
      }
      if (!s.armed || !isBlocking()) return
      // Before Next.js sees it: the page must not change until the person has decided.
      event.stopImmediatePropagation()
      s.armed = false
      // A jump several entries back from the history menu: put the address back to match what is
      // on screen. The re-pushed entry then stands where the duplicate stood.
      const jumped = window.location.href !== s.url
      if (jumped) window.history.pushState(s.state, '', s.url)
      onBlockedRef.current({
        leave: () => {
          releasedRef.current = true
          window.history.back()
        },
        stay: () => {
          if (!isBlocking() || s.armed) return
          if (!jumped) window.history.pushState(s.state, '', s.url)
          s.armed = true
        },
      })
    }

    document.addEventListener('click', onClick, true)
    window.addEventListener('popstate', onPopState, true)
    return () => {
      uninstall()
      document.removeEventListener('click', onClick, true)
      window.removeEventListener('popstate', onPopState, true)
    }
  }, [router])

  // Armed for Back while there is something to lose; disarmed as soon as there is not.
  useEffect(() => {
    if (!blocking) return
    const s = sentinel.current
    releasedRef.current = false
    if (!s.armed && s.swallow === 0) {
      s.state = window.history.state
      s.url = window.location.href
      window.history.pushState(s.state, '', s.url)
      s.armed = true
    }

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (releasedRef.current) return
      event.preventDefault()
      // Older browsers need a value set; its text is never shown.
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)

    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      // Clean again — saved, while staying on the page: take the duplicate back off, silently.
      // On unmount `blocking` is still true: the page is going somewhere, and the history stack
      // is left to whatever is taking it there.
      if (!blockingRef.current && s.armed) {
        s.armed = false
        s.swallow += 1
        window.history.back()
      }
    }
  }, [blocking])
}
