import { notFound } from 'next/navigation'
import { isDomainError } from '@clinic/core'

export type SearchParams = Promise<Record<string, string | string[] | undefined>>
export type RouteParams<K extends string> = Promise<Record<K, string>>

/** A single, non-empty search parameter; repeated or empty ones count as absent. */
export function param(
  values: Record<string, string | string[] | undefined>,
  key: string,
): string | undefined {
  const value = values[key]
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/**
 * A record that does not exist and a record this person may not see answer the same way — a 404
 * page — so a detail URL cannot be used to learn what exists (section 13.2).
 */
export async function orNotFound<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise
  } catch (error) {
    if (isDomainError(error) && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN')) {
      notFound()
    }
    throw error
  }
}

/** A page cursor from an old bookmark is not an error page: the list starts again from the top. */
export function isInvalidCursor(error: unknown): boolean {
  return (
    isDomainError(error) &&
    error.code === 'VALIDATION_FAILED' &&
    (error.details ?? []).some((detail) => detail.issue === 'INVALID_CURSOR')
  )
}
