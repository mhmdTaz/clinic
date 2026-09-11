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
  throw new ValidationError('The page cursor is not valid.', [
    { field: 'cursor', issue: 'INVALID_CURSOR' },
  ])
}

/**
 * Rows after the cursor on an ascending compound sort. For fields (a, b, _id) and values
 * (x, y, z): a > x, or a = x and b > y, or a = x and b = y and _id > z.
 */
export function afterCursor(
  fields: readonly string[],
  values: CursorValues,
): Record<string, unknown> {
  return {
    $or: fields.map((field, index) => {
      const branch: Record<string, unknown> = {}
      fields.slice(0, index).forEach((previous, position) => {
        branch[previous] = values[position]
      })
      branch[field] = { $gt: values[index] }
      return branch
    }),
  }
}

export interface Page<T> {
  items: T[]
  nextCursor: string | null
}
