import { cookies } from 'next/headers'
import { getRequestConfig } from 'next-intl/server'
import en from '../../messages/en.json'
import ar from '../../messages/ar.json'
import { DEFAULT_LOCALE, LOCALE_COOKIE, isKnownLocale } from './locales'

/**
 * No user-facing string is written in a component (section 13.6).
 *
 * Two things happen here that are worth naming.
 *
 * **The locale is a person's, not the server's.** A clinic has a default language, and somebody
 * working there may not read it. The cookie wins over the clinic's setting, which wins over
 * English — and the cookie is set by the switcher, so the choice survives a sign-out.
 *
 * **A missing key falls back to English rather than throwing.** next-intl's default is to render
 * the key itself, which puts `admin.audit.chain.ok` on the screen in front of a clinician. Deep
 * merging over the English catalogue means a partially translated locale degrades to a readable
 * sentence in the wrong language, which is recoverable, instead of a debug string, which is not.
 */
const CATALOGUES: Record<string, Record<string, unknown>> = { en, ar }

/** English underneath, the chosen locale on top, one key at a time. */
function withFallback(locale: string): Record<string, unknown> {
  if (locale === DEFAULT_LOCALE) return en
  return merge(en as Record<string, unknown>, CATALOGUES[locale] ?? {})
}

function merge(
  base: Record<string, unknown>,
  over: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(over)) {
    const existing = result[key]
    result[key] =
      isPlainObject(existing) && isPlainObject(value)
        ? merge(existing, value)
        : // An empty string is a translator's "not done yet", not a translation. Falling through
          // to English is better than rendering nothing at all.
          value === ''
          ? existing
          : value
  }
  return result
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export default getRequestConfig(async () => {
  const chosen = (await cookies()).get(LOCALE_COOKIE)?.value
  const locale = isKnownLocale(chosen) ? chosen : DEFAULT_LOCALE

  return {
    locale,
    messages: withFallback(locale),
    // Dates are always formatted with the clinic's own timezone passed explicitly; this is only
    // the fallback for anything that forgets.
    timeZone: 'UTC',
  }
})
