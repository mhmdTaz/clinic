/**
 * Field-level diffs for audit entries (section 11.3).
 *
 * Only changed fields are stored — persisting whole documents would inflate the largest
 * collection in the system and make the diff viewer unreadable. Sensitive values
 * (password hashes, secrets) are replaced before anything leaves this package, so the
 * audit log proves a field changed without ever holding the value.
 */
export type PlainObject = Record<string, unknown>

export const REDACTED = '[redacted]'

/** Noise on every write that says nothing about what a person did. */
const ALWAYS_IGNORED = ['_id', '__v', 'createdAt', 'updatedAt'] as const

export interface DiffOptions {
  /** Bookkeeping fields that change on their own (lastLoginAt...). Prefix match. */
  ignored?: readonly string[]
  /** Fields whose change is recorded but whose value is not. Prefix match. */
  sensitive?: readonly string[]
}

export interface DocumentDiff {
  before: PlainObject | null
  after: PlainObject | null
  changedPaths: string[]
}

export function isPlainObject(value: unknown): value is PlainObject {
  if (value === null || typeof value !== 'object') return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/**
 * Nested objects become dot paths. Arrays, dates and BSON values (Decimal128, ObjectId)
 * are leaves and compare as a whole.
 */
export function flatten(value: PlainObject, prefix = '', out: PlainObject = {}): PlainObject {
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (isPlainObject(child) && Object.keys(child).length > 0) flatten(child, path, out)
    else out[path] = child
  }
  return out
}

/** The inverse of flatten. Stored nested, because MongoDB queries dotted keys poorly. */
export function unflatten(flat: PlainObject): PlainObject {
  const root: PlainObject = {}
  for (const [path, value] of Object.entries(flat)) {
    const parts = path.split('.')
    let node: PlainObject = root
    parts.forEach((part, index) => {
      if (index === parts.length - 1) {
        node[part] = value
        return
      }
      if (!isPlainObject(node[part])) node[part] = {}
      node = node[part] as PlainObject
    })
  }
  return root
}

function matchesAny(path: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => path === pattern || path.startsWith(`${pattern}.`))
}

/** Dates, Decimal128 and ObjectId all serialise deterministically through toJSON. */
function comparable(value: unknown): string {
  return String(JSON.stringify(value))
}

/**
 * before === null  -> a creation: every non-ignored field appears in `after`.
 * after === null   -> a deletion: every non-ignored field appears in `before`.
 * otherwise        -> only paths whose values differ.
 */
export function diffDocuments(
  before: PlainObject | null,
  after: PlainObject | null,
  options: DiffOptions = {},
): DocumentDiff {
  const ignored = [...ALWAYS_IGNORED, ...(options.ignored ?? [])]
  const sensitive = options.sensitive ?? []

  const flatBefore = before ? flatten(before) : {}
  const flatAfter = after ? flatten(after) : {}
  const paths = [...new Set([...Object.keys(flatBefore), ...Object.keys(flatAfter)])].sort()

  const changedPaths: string[] = []
  const outBefore: PlainObject = {}
  const outAfter: PlainObject = {}

  for (const path of paths) {
    if (matchesAny(path, ignored)) continue

    const inBefore = Object.prototype.hasOwnProperty.call(flatBefore, path)
    const inAfter = Object.prototype.hasOwnProperty.call(flatAfter, path)
    if (before && after && comparable(flatBefore[path]) === comparable(flatAfter[path])) continue

    changedPaths.push(path)
    const redact = matchesAny(path, sensitive)
    if (before && inBefore) outBefore[path] = redact ? REDACTED : flatBefore[path]
    if (after && inAfter) outAfter[path] = redact ? REDACTED : flatAfter[path]
  }

  return {
    before: before ? unflatten(outBefore) : null,
    after: after ? unflatten(outAfter) : null,
    changedPaths,
  }
}
