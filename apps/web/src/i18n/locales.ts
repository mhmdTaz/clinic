/**
 * The locales this build knows about (section 13.6).
 *
 * **`isComplete` is the field that matters, and it is honest on purpose.** A half-translated
 * interface is worse than an untranslated one: the reader gets two languages and, in Arabic's
 * case, two directions on the same screen, and cannot tell which parts they are missing. So a
 * locale appears in the switcher only when its catalogue is finished; an unfinished one is still
 * fully wired — routing, direction, formatting, fallback — and reachable with a cookie, so the
 * engineering can be built and tested long before the translation lands.
 */
export interface LocaleDefinition {
  code: string
  /** What it calls itself. A language list in English is a list for people who read English. */
  endonym: string
  dir: 'ltr' | 'rtl'
  /** False while the catalogue is still partial. Such a locale is not offered to users. */
  isComplete: boolean
}

export const LOCALES: readonly LocaleDefinition[] = [
  { code: 'en', endonym: 'English', dir: 'ltr', isComplete: true },
  {
    code: 'ar',
    endonym: 'العربية',
    dir: 'rtl',
    // The shell, navigation, validation and the sign-in flow are translated; the clinical,
    // billing and inventory screens are not. A medical interface's wording is a clinical safety
    // question as much as a linguistic one, so the rest waits for a native speaker to write and
    // review it rather than being guessed at here. Everything else about this locale works today.
    isComplete: false,
  },
]

export const DEFAULT_LOCALE = 'en'

export const localeDefinition = (code: string): LocaleDefinition =>
  LOCALES.find((locale) => locale.code === code) ?? LOCALES[0]!

export const isKnownLocale = (code: string | undefined): code is string =>
  code !== undefined && LOCALES.some((locale) => locale.code === code)

/** What the switcher offers. */
export const selectableLocales = (): readonly LocaleDefinition[] =>
  LOCALES.filter((locale) => locale.isComplete)

/** The cookie a person's own choice lives in, overriding the clinic's default. */
export const LOCALE_COOKIE = 'clinic_locale'

export const directionOf = (code: string): 'ltr' | 'rtl' => localeDefinition(code).dir
