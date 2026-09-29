export interface ShellNavItem {
  id: string
  href: string
  icon: string
  label: string
  /** Paths beneath which this item is the current one although it does not link there. */
  activeFor?: readonly string[]
}

export interface ShellNavSection {
  id: string
  label: string
  items: ShellNavItem[]
}

const within = (pathname: string, prefix: string) =>
  pathname === prefix || pathname.startsWith(`${prefix}/`)

/**
 * The href of the most specific item containing the current path. Plain prefix matching would
 * light up a portal's home on every page beneath it; exact matching would light up nothing on a
 * detail page. An item's `activeFor` paths count as its own, so a page with no item of its own is
 * placed under the one it belongs to rather than under the portal's home.
 */
export function activeHref(
  pathname: string,
  items: ReadonlyArray<Pick<ShellNavItem, 'href' | 'activeFor'>>,
): string | null {
  let best: { href: string; length: number } | null = null
  for (const item of items) {
    for (const prefix of [item.href, ...(item.activeFor ?? [])]) {
      if (within(pathname, prefix) && (best === null || prefix.length > best.length)) {
        best = { href: item.href, length: prefix.length }
      }
    }
  }
  return best?.href ?? null
}
