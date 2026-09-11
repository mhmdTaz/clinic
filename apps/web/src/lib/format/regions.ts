import { Currency, Locale, isRegionCode } from '@clinic/contracts'

export interface Option {
  value: string
  label: string
}

const countryCache = new Map<string, Option[]>()

/**
 * Every country the runtime can name, sorted by its name in `locale` — no hand-kept list to go
 * stale. Computed once per locale, on the server, and passed to forms as data.
 */
export function countryOptions(locale: string): Option[] {
  const cached = countryCache.get(locale)
  if (cached) return cached

  const names = new Intl.DisplayNames([locale], { type: 'region' })
  const options: Option[] = []
  for (let first = 65; first <= 90; first += 1) {
    for (let second = 65; second <= 90; second += 1) {
      const code = String.fromCharCode(first, second)
      if (isRegionCode(code)) options.push({ value: code, label: names.of(code) ?? code })
    }
  }
  options.sort((a, b) => a.label.localeCompare(b.label, locale))
  countryCache.set(locale, options)
  return options
}

export function countryName(code: string | null, locale: string): string | null {
  if (!code) return null
  return new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code
}

/** "USD — US Dollar", in the viewer's language. */
export function currencyOptions(locale: string): Option[] {
  const names = new Intl.DisplayNames([locale], { type: 'currency' })
  return Currency.options.map((code) => ({
    value: code,
    label: `${code} — ${names.of(code) ?? code}`,
  }))
}

export function localeOptions(locale: string): Option[] {
  const names = new Intl.DisplayNames([locale], { type: 'language' })
  return Locale.options.map((code) => ({ value: code, label: names.of(code) ?? code }))
}

/** IANA zones the runtime knows, with the clinic's current one guaranteed to be present. */
export function timezoneOptions(current: string): Option[] {
  const zones =
    typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []
  const all = new Set(['UTC', ...zones, current])
  return [...all]
    .sort((a, b) => a.localeCompare(b))
    .map((zone) => ({ value: zone, label: zone.replaceAll('_', ' ') }))
}
