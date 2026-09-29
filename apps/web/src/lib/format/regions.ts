import { COUNTRY_CODES, Currency, Locale, isCountryCode, storedCountry } from '@clinic/contracts'

export interface Option {
  value: string
  label: string
}

const countryCache = new Map<string, Option[]>()

/**
 * Every current country, once each, named and sorted in `locale` (audit F04). Which codes exist
 * comes from the shared contract; `Intl` only supplies the names — it names historical codes too,
 * and as the list of countries it offered Germany, Serbia and thirteen others twice.
 *
 * `stored` is the value already on the record. A retired code (Yugoslavia, say) is not a choice
 * anyone can make today, but a form that dropped it would silently show another country — or none
 * — and save that. So it stays in the list, labelled by `formerLabel`, until a person picks the
 * current country; the contract refuses to save it as it is.
 */
export function countryOptions(
  locale: string,
  stored?: string | null,
  formerLabel?: (code: string) => string,
): Option[] {
  let options = countryCache.get(locale)
  if (!options) {
    const names = new Intl.DisplayNames([locale], { type: 'region' })
    options = COUNTRY_CODES.map((code) => ({ value: code, label: names.of(code) ?? code }))
    options.sort((a, b) => a.label.localeCompare(b.label, locale))
    countryCache.set(locale, options)
  }

  const kept = storedCountry(stored)
  if (!kept || isCountryCode(kept)) return options
  // Labelled by its code, not by Intl: Intl calls YU "Serbia" and SU "Russia", which is exactly
  // the guess this list refuses to make.
  return [{ value: kept, label: formerLabel ? formerLabel(kept) : kept }, ...options]
}

/**
 * A country's name in `locale`. A renamed code is named as its current country; a retired one
 * (YU, SU, AN…) is shown as the code it is. Intl would call YU "Serbia" and SU "Russia" — the
 * guess about a country that split which this app refuses to make, least of all on an address a
 * patient reads (audit F04).
 */
export function countryName(code: string | null, locale: string): string | null {
  if (!code) return null
  const current = storedCountry(code)
  if (!current || !isCountryCode(current)) return current
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(current) ?? current
  } catch {
    // Not a code Intl accepts at all: show what was stored rather than fail the page.
    return code
  }
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
