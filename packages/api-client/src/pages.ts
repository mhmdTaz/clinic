import type { Paged } from './client'

/**
 * Reading a collection a page at a time (§9.2).
 *
 * Every collection endpoint pages with a cursor, capped at `PAGE_LIMIT_MAX` rows a page. A screen
 * that scrolls asks for the next page when it gets there; a screen that shows a **bounded** list
 * whole — one day's diary, one patient's chart — reads pages until it has them all, up to a cap it
 * names, and says whether it stopped short. Before Phase 10 the server cut those lists off
 * silently; neither side may do that now.
 */

/** The most rows one page returns (`PaginationQuery`). */
export const PAGE_LIMIT_MAX = 100

/** Where to start and how much to take. Both optional: the first page, at the server's default. */
export interface PageRequest {
  cursor?: string
  limit?: number
}

/** A bounded list read whole, and whether it was longer than the cap. */
export interface Listed<T> {
  items: T[]
  truncated: boolean
}

export async function collectPages<T>(
  fetchPage: (page: {
    cursor: string | undefined
    limit: number
  }) => Promise<Pick<Paged<T>, 'items' | 'nextCursor'>>,
  max: number,
): Promise<Listed<T>> {
  const items: T[] = []
  let cursor: string | undefined

  while (items.length < max) {
    const page = await fetchPage({ cursor, limit: Math.min(PAGE_LIMIT_MAX, max - items.length) })
    items.push(...page.items)
    if (!page.nextCursor) return { items, truncated: false }
    cursor = page.nextCursor
  }
  return { items: items.slice(0, max), truncated: true }
}

/**
 * A page for each slice of a long list of ids, for a filter that takes at most `sliceSize` of them
 * (`appointmentIds` takes 100). Each id matches at most one row, so one page per slice is all of it.
 */
export async function collectByIds<T>(
  ids: readonly string[],
  fetchSlice: (slice: string[]) => Promise<Pick<Paged<T>, 'items'>>,
  sliceSize = PAGE_LIMIT_MAX,
): Promise<T[]> {
  const unique = [...new Set(ids)]
  const slices: string[][] = []
  for (let start = 0; start < unique.length; start += sliceSize) {
    slices.push(unique.slice(start, start + sliceSize))
  }
  const pages = await Promise.all(slices.map(fetchSlice))
  return pages.flatMap((page) => page.items)
}
