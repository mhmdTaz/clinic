import { REDACTED_MARKER } from '@clinic/config'
import type { AuditFieldChange } from '@clinic/contracts'

/**
 * Turning a stored entry into something a person can read (A5, section 11.6).
 *
 * Pure, so the rules that matter here — what counts as a change, what a redacted field looks
 * like, and how a value becomes a CSV cell — are testable without a database.
 */

/**
 * The fields that changed, sorted by name.
 *
 * Sorted rather than left in insertion order because the capture plugin builds the diff from
 * `Object.keys` of whatever changed, so the same edit made twice can arrive in two orders. A diff
 * viewer whose rows move between two readings of the same entry is a diff viewer nobody trusts.
 */
export function fieldChanges(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): AuditFieldChange[] {
  const left = before ?? {}
  const right = after ?? {}
  const fields = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()

  return fields.map((field) => {
    const from = left[field]
    const to = right[field]
    return {
      field,
      before: render(from),
      after: render(to),
      // The capture plugin replaces PHI and secrets with a marker rather than storing them
      // (11.3), so the viewer can show that a field changed without ever showing to what.
      isRedacted: from === REDACTED_MARKER || to === REDACTED_MARKER,
    }
  })
}

/**
 * A stored value as a string.
 *
 * `null` means "absent" and renders as an em dash upstream — distinct from the *string* "null",
 * which would be a value somebody actually stored. Dates go to ISO so a diff of two timestamps
 * is comparable character by character rather than by whatever locale the server happens to run in.
 */
export function render(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string') return value
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

/**
 * One CSV cell.
 *
 * The leading apostrophe on anything starting with `=`, `+`, `-`, `@` or a control character is a
 * **formula-injection guard**, and quoting alone does not provide it: a spreadsheet strips the
 * quotes first and then evaluates `=cmd|'/c calc'!A1` as a command. The audit log is full of
 * attacker-influenced strings — a display name, a ticket subject — and is exactly the sort of
 * file an administrator double-clicks.
 */
export function csvCell(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return `"${guarded.replaceAll('"', '""')}"`
}

/** A CSV row. RFC 4180 line endings, because Excel on Windows is the consumer that matters. */
export function csvRow(cells: string[]): string {
  return cells.map(csvCell).join(',')
}
