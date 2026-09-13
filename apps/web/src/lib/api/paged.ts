import type { ApiResult } from './with-api'

/**
 * A page of a collection, in the envelope §9.2 describes: the rows as `data`, the way on in
 * `meta`.
 *
 * One helper for every list route, because the mistake it prevents is easy and silent: a route
 * returning `{ data: page }` still compiles — `data` accepts anything — and hands every client an
 * object where the contract promises an array.
 */
export function paged<T>(page: { items: T[]; nextCursor: string | null }): ApiResult<T[]> {
  return {
    data: page.items,
    meta: { nextCursor: page.nextCursor, hasMore: page.nextCursor !== null },
  }
}
