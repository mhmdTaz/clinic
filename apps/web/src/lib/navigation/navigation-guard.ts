/**
 * The one place a screen with unsaved work can hold navigation (audit F02).
 *
 * A draft that lives only in component state is lost the moment the component unmounts, and the
 * app has several ways to unmount it: a link (sidebar, tab bar, breadcrumb, back link), a
 * programmatic `router.push`, the browser's Back button, a reload, closing the tab. The hook in
 * `use-leave-guard` covers the browser's routes; this module is how the app's own router asks
 * first. At most one guard is installed at a time — there is only one page on screen.
 */

export interface LeaveAttempt {
  /** Leave after all. The guard is already released when this runs. */
  leave(): void
  /** The person chose to stay: nothing happens, and the guard stays armed. */
  stay(): void
}

interface Guard {
  isBlocking(): boolean
  onBlocked(go: () => void): void
}

let installed: Guard | null = null

export function installNavigationGuard(guard: Guard): () => void {
  installed = guard
  return () => {
    if (installed === guard) installed = null
  }
}

/** Whether anything on screen would be lost by leaving it now. */
export function hasUnsavedWork(): boolean {
  return installed?.isBlocking() ?? false
}

/** Runs `go` now, or once the person has decided what happens to their unsaved work. */
export function guardNavigation(go: () => void): void {
  if (installed?.isBlocking()) installed.onBlocked(go)
  else go()
}

export interface ClickFacts {
  button: number
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  defaultPrevented: boolean
}

export interface AnchorFacts {
  href: string
  target: string
  download: boolean
}

/**
 * The in-app destination of a click on a link, or null when the click is not one this app would
 * route itself — a new tab, a download, another site, a jump within the same page. Those either
 * keep the page (so nothing is lost) or leave the app (where `beforeunload` is the only tool).
 */
export function inAppDestination(
  click: ClickFacts,
  anchor: AnchorFacts,
  current: { href: string; origin: string },
): string | null {
  if (click.defaultPrevented || click.button !== 0) return null
  if (click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return null
  if (anchor.download) return null
  if (anchor.target !== '' && anchor.target !== '_self') return null

  let url: URL
  try {
    url = new URL(anchor.href, current.href)
  } catch {
    return null
  }
  if (url.origin !== current.origin) return null

  const here = new URL(current.href)
  const samePage = url.pathname === here.pathname && url.search === here.search
  if (samePage && (url.hash !== '' || url.href === here.href)) return null

  return `${url.pathname}${url.search}${url.hash}`
}
