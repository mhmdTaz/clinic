'use client'

import { useTranslations } from 'next-intl'
import { ApiError } from '@/lib/api/client'

/** API errors are switched on their stable `code`, never on the English message (9.2). */
export function useErrorMessage() {
  const t = useTranslations('errors')

  return (error: unknown): string => {
    if (!(error instanceof ApiError)) return t('NETWORK_ERROR')
    if (error.code === 'TOO_MANY_ATTEMPTS') {
      return error.retryAfterSeconds
        ? t('TOO_MANY_ATTEMPTS', { minutes: Math.max(1, Math.ceil(error.retryAfterSeconds / 60)) })
        : t('TOO_MANY_ATTEMPTS_SOON')
    }
    return t.has(error.code) ? t(error.code) : t('generic')
  }
}

/**
 * A validation issue code — from the contract's client-side check or the server's error envelope —
 * as a sentence. An unknown code still says something useful rather than nothing.
 */
export function useValidationMessage() {
  const t = useTranslations('validation')
  return (code: string): string => (t.has(code) ? t(code) : t('INVALID'))
}

const PASSWORD_ISSUES = new Set([
  'TOO_SHORT',
  'TOO_LONG',
  'TOO_COMMON',
  'TOO_REPETITIVE',
  'CONTAINS_PERSONAL_INFO',
  'SAME_AS_CURRENT',
])

/** Password problems, whether the contract or the server's policy caught them. */
export function usePasswordIssues() {
  const t = useTranslations('password.issues')

  return (error: unknown, field: string): string[] => {
    if (!(error instanceof ApiError)) return []
    return error.details
      .filter((detail) => detail.field === field && PASSWORD_ISSUES.has(detail.issue))
      .map((detail) => t(detail.issue))
  }
}
