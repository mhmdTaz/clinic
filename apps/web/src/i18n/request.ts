import { getRequestConfig } from 'next-intl/server'
import en from '../../messages/en.json'

/**
 * No user-facing string is written in a component (section 13.6). English is the only
 * catalogue for now; adding Arabic is a new messages file plus `dir="rtl"`, and the
 * layout already uses logical properties (ps-, me-, start-) so nothing needs mirroring.
 */
export const DEFAULT_LOCALE = 'en'

export default getRequestConfig(async () => ({
  locale: DEFAULT_LOCALE,
  messages: en,
  // Dates are always formatted with the clinic's own timezone passed explicitly; this
  // is only the fallback for anything that forgets.
  timeZone: 'UTC',
}))
