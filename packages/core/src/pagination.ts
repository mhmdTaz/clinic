import { ValidationError } from './errors'

/**
 * Keyset pagination with opaque cursors (section 9.2). A cursor holds the sort key of the last
 * row on a page, and the next page starts strictly after it. Unlike an offset, it does not re-read
 * every skipped row, and rows inserted while someone pages through do not shift what they see.
 */
export type CursorValues = ReadonlyArray<string | null>

export function encodeCursor(values: CursorValues): string {
  return Buffer.from(JSON.stringify(values), 'utf8').toString('base64url')
}

export function decodeCursor(cursor: string, arity: number): Array<string | null> {
  try {
    const values: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    if (
      Array.isArray(values) &&
      values.length === arity &&
      values.every((value) => value === null || typeof value === 'string')
    ) {
      return values as Array<string | null>
    }
  } catch {
    // Not base64 or not JSON: reported below exactly like a well-formed wrong cursor.
  }
  throw invalidCursor()
}

const invalidCursor = () =>
  new ValidationError('The page cursor is not valid.', [
    { field: 'cursor', issue: 'INVALID_CURSOR' },
  ])

/**
 * Rows after the cursor on an ascending compound sort. For fields (a, b, _id) and values
 * (x, y, z): a > x, or a = x and b > y, or a = x and b = y and _id > z.
 */
export function afterCursor(
  fields: readonly string[],
  values: CursorValues,
): Record<string, unknown> {
  return keysetAfter(
    fields.map((field) => ({ field, direction: 1, kind: 'string' }) as const),
    values,
  )
}

/** One field of a sort order: which way it runs, and what its values are. */
export interface SortKey {
  field: string
  direction: 1 | -1
  /** A date is carried in the cursor as ISO-8601 and compared as a date, never as a string. */
  kind: 'date' | 'string'
}

/**
 * Rows after the cursor on any compound sort, each field in its own direction.
 *
 * The same shape as `afterCursor`, with `$lt` wherever a field runs newest-first. **Dates are
 * turned back into dates** before comparing: MongoDB orders values of different BSON types by
 * type before value, so an ISO string compared with a stored date is never less than it — a
 * cursor built that way returns the whole collection again as page two.
 */
export function keysetAfter(
  keys: readonly SortKey[],
  values: CursorValues,
): Record<string, unknown> {
  if (values.length !== keys.length) throw invalidCursor()
  const typed = keys.map((key, index) => {
    const value = values[index]
    if (key.kind !== 'date' || value === null || value === undefined) return value ?? null
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) throw invalidCursor()
    return date
  })

  return {
    $or: keys.map((key, index) => {
      const branch: Record<string, unknown> = {}
      keys.slice(0, index).forEach((previous, position) => {
        branch[previous.field] = typed[position]
      })
      branch[key.field] = { [key.direction === 1 ? '$gt' : '$lt']: typed[index] }
      return branch
    }),
  }
}

/** The MongoDB sort for a set of keys. */
export const sortFor = (keys: readonly SortKey[]): Record<string, 1 | -1> =>
  Object.fromEntries(keys.map((key) => [key.field, key.direction]))

/**
 * The page from `limit + 1` rows, and the cursor to the next.
 *
 * One row more than the page is read on purpose: whether it came back is the only honest way to
 * know there is a next page. Asking for exactly `limit` and offering a cursor whenever the page is
 * full sends a client to an empty page every time a list is an exact multiple of the page size.
 */
export function pageFrom<TDoc extends Record<string, unknown>>(
  docs: readonly TDoc[],
  limit: number,
  keys: readonly SortKey[],
): { docs: TDoc[]; nextCursor: string | null } {
  const page = docs.slice(0, limit)
  const last = page.at(-1)
  if (docs.length <= limit || !last) return { docs: page, nextCursor: null }

  return {
    docs: page,
    nextCursor: encodeCursor(
      keys.map((key) => {
        const value = readPath(last, key.field)
        if (value === null || value === undefined) return null
        return value instanceof Date ? value.toISOString() : String(value)
      }),
    ),
  }
}

function readPath(doc: Record<string, unknown>, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (value, part) =>
        value && typeof value === 'object' ? (value as Record<string, unknown>)[part] : undefined,
      doc,
    )
}

/**
 * A page of a list that had to be computed whole — filtered on something the database does not
 * store, such as "running low" — with the same cursor semantics as a database page.
 */
export function pageInMemory<T>(
  items: readonly T[],
  keyOf: (item: T) => readonly [string, string],
  page: { cursor?: string; limit: number },
): Page<T> {
  const compare = (left: readonly [string, string], right: readonly [string, string]) =>
    left[0] === right[0]
      ? left[1] < right[1]
        ? -1
        : left[1] > right[1]
          ? 1
          : 0
      : left[0] < right[0]
        ? -1
        : 1
  const sorted = [...items].sort((left, right) => compare(keyOf(left), keyOf(right)))

  const after = page.cursor ? decodeCursor(page.cursor, 2) : null
  const remaining = after
    ? sorted.filter((item) => compare(keyOf(item), [after[0] ?? '', after[1] ?? '']) > 0)
    : sorted
  const rows = remaining.slice(0, page.limit)
  const last = rows.at(-1)
  return {
    items: rows,
    nextCursor: remaining.length > page.limit && last ? encodeCursor([...keyOf(last)]) : null,
  }
}

/** Rows a query may ask for, and what it gets when it does not say (§9.2). */
export const PAGE_LIMIT_MAX = 100
export const PAGE_LIMIT_DEFAULT = 25

export const pageLimit = (limit: number | undefined): number =>
  Math.min(PAGE_LIMIT_MAX, Math.max(1, Math.trunc(limit ?? PAGE_LIMIT_DEFAULT)))

export interface Page<T> {
  items: T[]
  nextCursor: string | null
}
