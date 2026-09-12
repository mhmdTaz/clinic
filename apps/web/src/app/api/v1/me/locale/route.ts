import { z } from 'zod'
import { withApi } from '@/lib/api/with-api'
import { LOCALE_COOKIE, isKnownLocale, selectableLocales } from '@/i18n/locales'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SetLocaleRequest = z.object({ locale: z.string().max(16) }).strict()

/**
 * A person's own interface language (section 13.6).
 *
 * A cookie rather than a column on the user: it belongs to the browser somebody is sitting at,
 * takes effect on the next render with no round trip through the database, and needs no
 * migration when a locale is added. The clinic's own `locale` setting remains the default for
 * anybody who has not chosen.
 *
 * Only a **complete** locale is accepted. A half-translated catalogue is wired and testable but
 * never offered, so a request naming one is refused here rather than leaving somebody stuck in a
 * two-language interface with no obvious way back.
 */
export const POST = withApi(
  { body: SetLocaleRequest, auth: 'optional' },
  async ({ body, request }) => {
    const offered = selectableLocales().map((locale) => locale.code)
    const locale = isKnownLocale(body.locale) && offered.includes(body.locale) ? body.locale : null

    return {
      data: { locale: locale ?? null, accepted: locale !== null },
      respond: (response) => {
        if (!locale) return
        response.cookies.set(LOCALE_COOKIE, locale, {
          httpOnly: false, // The switcher reads it to show what is selected.
          sameSite: 'lax',
          secure: request.nextUrl.protocol === 'https:',
          path: '/',
          maxAge: 60 * 60 * 24 * 365,
        })
      },
    }
  },
)
