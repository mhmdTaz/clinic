import 'server-only'

/**
 * Reading every page of a collection, for a screen that shows a bounded list whole.
 *
 * Collections page with a cursor (§9.2). A page that shows a list in full — a patient's visits on
 * their chart, a week's appointments on a board — reads pages until it has them all, up to `max`,
 * and says whether it stopped short. Before Phase 10 these lists were cut off silently in the
 * repositories (at 200, 300, 500 or 2,000 rows); a screen now knows, and says so.
 */
export interface CursorPage<T> {
  items: T[]
  nextCursor: string | null
}

export async function collectPages<T>(
  fetchPage: (page: { cursor: string | undefined; limit: number }) => Promise<CursorPage<T>>,
  max: number,
): Promise<{ items: T[]; truncated: boolean }> {
  const items: T[] = []
  let cursor: string | undefined

  while (items.length < max) {
    const page = await fetchPage({ cursor, limit: Math.min(100, max - items.length) })
    items.push(...page.items)
    if (!page.nextCursor) return { items, truncated: false }
    cursor = page.nextCursor
  }
  return { items: items.slice(0, max), truncated: true }
}

/**
 * Reads a page for each slice of a long list of ids, for a filter that caps how many ids it takes.
 * Each slice is one page, because each id matches at most one row.
 */
export async function collectByIds<T>(
  ids: readonly string[],
  fetchSlice: (slice: string[]) => Promise<CursorPage<T>>,
  sliceSize = 100,
): Promise<T[]> {
  const slices: string[][] = []
  for (let start = 0; start < ids.length; start += sliceSize) {
    slices.push(ids.slice(start, start + sliceSize))
  }
  const pages = await Promise.all(slices.map(fetchSlice))
  return pages.flatMap((page) => page.items)
}

/** No page at all: for a list the actor may not read, in the shape `collectPages` returns. */
export const noItems = <T>(): { items: T[]; truncated: boolean } => ({
  items: [],
  truncated: false,
})
