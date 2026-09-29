/**
 * Countries, as data rather than as whatever the runtime happens to name (audit F04).
 *
 * `Intl.DisplayNames` names 273 two-letter codes, historical ones included: it happily calls DD
 * "Germany" and CS, RS and YU all "Serbia". Used as the list of valid countries, it offered fifteen
 * countries twice under different codes. It is still the right tool for a country's *name* in the
 * reader's language — just not for deciding which codes exist. Its data also differs between
 * Node.js, browsers and the phone's engine; this list does not.
 */

/**
 * ISO 3166-1 alpha-2, the 249 officially assigned codes (ISO 3166 Maintenance Agency; unchanged
 * since BQ, CW, SX and SS were assigned in 2010–2011) — plus XK, Kosovo, the user-assigned code in
 * common use (the EU, the IMF, passports) while ISO has not assigned one. It was selectable before
 * this list existed and stays selectable.
 *
 * To update: add or remove the code here, and in RENAMED_COUNTRIES or RETIRED_COUNTRIES if an old
 * code stops being current. The contract tests check the count and that every code has a name.
 */
// prettier-ignore
export const COUNTRY_CODES: readonly string[] = [
  'AD', 'AE', 'AF', 'AG', 'AI', 'AL', 'AM', 'AO', 'AQ', 'AR', 'AS', 'AT', 'AU', 'AW', 'AX', 'AZ',
  'BA', 'BB', 'BD', 'BE', 'BF', 'BG', 'BH', 'BI', 'BJ', 'BL', 'BM', 'BN', 'BO', 'BQ', 'BR', 'BS',
  'BT', 'BV', 'BW', 'BY', 'BZ', 'CA', 'CC', 'CD', 'CF', 'CG', 'CH', 'CI', 'CK', 'CL', 'CM', 'CN',
  'CO', 'CR', 'CU', 'CV', 'CW', 'CX', 'CY', 'CZ', 'DE', 'DJ', 'DK', 'DM', 'DO', 'DZ', 'EC', 'EE',
  'EG', 'EH', 'ER', 'ES', 'ET', 'FI', 'FJ', 'FK', 'FM', 'FO', 'FR', 'GA', 'GB', 'GD', 'GE', 'GF',
  'GG', 'GH', 'GI', 'GL', 'GM', 'GN', 'GP', 'GQ', 'GR', 'GS', 'GT', 'GU', 'GW', 'GY', 'HK', 'HM',
  'HN', 'HR', 'HT', 'HU', 'ID', 'IE', 'IL', 'IM', 'IN', 'IO', 'IQ', 'IR', 'IS', 'IT', 'JE', 'JM',
  'JO', 'JP', 'KE', 'KG', 'KH', 'KI', 'KM', 'KN', 'KP', 'KR', 'KW', 'KY', 'KZ', 'LA', 'LB', 'LC',
  'LI', 'LK', 'LR', 'LS', 'LT', 'LU', 'LV', 'LY', 'MA', 'MC', 'MD', 'ME', 'MF', 'MG', 'MH', 'MK',
  'ML', 'MM', 'MN', 'MO', 'MP', 'MQ', 'MR', 'MS', 'MT', 'MU', 'MV', 'MW', 'MX', 'MY', 'MZ', 'NA',
  'NC', 'NE', 'NF', 'NG', 'NI', 'NL', 'NO', 'NP', 'NR', 'NU', 'NZ', 'OM', 'PA', 'PE', 'PF', 'PG',
  'PH', 'PK', 'PL', 'PM', 'PN', 'PR', 'PS', 'PT', 'PW', 'PY', 'QA', 'RE', 'RO', 'RS', 'RU', 'RW',
  'SA', 'SB', 'SC', 'SD', 'SE', 'SG', 'SH', 'SI', 'SJ', 'SK', 'SL', 'SM', 'SN', 'SO', 'SR', 'SS',
  'ST', 'SV', 'SX', 'SY', 'SZ', 'TC', 'TD', 'TF', 'TG', 'TH', 'TJ', 'TK', 'TL', 'TM', 'TN', 'TO',
  'TR', 'TT', 'TV', 'TW', 'TZ', 'UA', 'UG', 'UM', 'US', 'UY', 'UZ', 'VA', 'VC', 'VE', 'VG', 'VI',
  'VN', 'VU', 'WF', 'WS', 'YE', 'YT', 'ZA', 'ZM', 'ZW',
  'XK',
]

/**
 * Former codes for a country that still exists over the same territory, under a new code. A stored
 * or submitted old code means exactly the new one, so it is read as the new one.
 */
export const RENAMED_COUNTRIES: Readonly<Record<string, string>> = {
  BU: 'MM', // Burma → Myanmar
  DD: 'DE', // German Democratic Republic → Germany (reunified)
  DY: 'BJ', // Dahomey → Benin
  FX: 'FR', // Metropolitan France → France
  HV: 'BF', // Upper Volta → Burkina Faso
  NH: 'VU', // New Hebrides → Vanuatu
  RH: 'ZW', // Southern Rhodesia → Zimbabwe
  TP: 'TL', // East Timor → Timor-Leste
  UK: 'GB', // reserved by ISO for the United Kingdom, whose code is GB
  VD: 'VN', // North Vietnam → Vietnam (reunified)
  YD: 'YE', // South Yemen → Yemen (unified)
  ZR: 'CD', // Zaire → Congo (Kinshasa)
}

/**
 * Codes the runtime names that no longer mean one current country: states that split, and
 * territories reserved inside another country's code. There is no correct automatic answer — an
 * address in Yugoslavia is in one of seven countries today — so one is never guessed. A form keeps
 * showing the stored value until a person chooses the current country.
 */
export const RETIRED_COUNTRIES: ReadonlySet<string> = new Set([
  'AN', // Netherlands Antilles → BQ, CW or SX
  'CS', // Czechoslovakia (→ CZ, SK), later Serbia and Montenegro (→ RS, ME)
  'SU', // Soviet Union → fifteen states
  'YU', // Yugoslavia → seven states
  'AC', // Ascension Island, part of SH
  'CP', // Clipperton Island, part of FR
  'CQ', // Sark, part of GG
  'DG', // Diego Garcia, part of IO
  'EA', // Ceuta and Melilla, part of ES
  'IC', // Canary Islands, part of ES
  'TA', // Tristan da Cunha, part of SH
])

const CURRENT = new Set(COUNTRY_CODES)

/** Whether `code` is a current country code, exactly as stored (upper case, not renamed). */
export function isCountryCode(code: string): boolean {
  return CURRENT.has(code)
}

/** The current code for an old one that still means a single country; anything else unchanged. */
export function canonicalCountry(code: string): string {
  return RENAMED_COUNTRIES[code] ?? code
}

/**
 * A country as it was stored, read for today: a renamed code becomes its current one, and anything
 * else — a retired code included — is returned as it is, for a person to correct.
 */
export function storedCountry(code: string | null | undefined): string | null {
  if (!code) return null
  return canonicalCountry(code.trim().toUpperCase())
}
