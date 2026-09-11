export interface ShellNavItem {
  id: string
  href: string
  icon: string
  label: string
}

export interface ShellNavSection {
  id: string
  label: string
  items: ShellNavItem[]
}

/**
 * The most specific item containing the current path. Plain prefix matching would light
 * up a portal's home on every page beneath it; exact matching would light up nothing on
 * a detail page.
 */
export function activeHref(pathname: string, hrefs: readonly string[]): string | null {
  let best: string | null = null
  for (const href of hrefs) {
    const contains = pathname === href || pathname.startsWith(`${href}/`)
    if (contains && (best === null || href.length > best.length)) best = href
  }
  return best
}
