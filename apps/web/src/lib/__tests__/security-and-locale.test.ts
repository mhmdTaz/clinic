import { describe, expect, it } from 'vitest'
import en from '../../../messages/en.json'
import ar from '../../../messages/ar.json'
import {
  DEFAULT_LOCALE,
  LOCALES,
  directionOf,
  isKnownLocale,
  localeDefinition,
  selectableLocales,
} from '../../i18n/locales'
import { buildSecurityHeaders } from '../security/csp'

describe('the security headers', () => {
  it('carries a fresh nonce on every request', () => {
    const one = buildSecurityHeaders({ isDevelopment: false })
    const two = buildSecurityHeaders({ isDevelopment: false })
    expect(one.nonce).not.toBe(two.nonce)
    // A nonce that appeared in the policy of a page an attacker could read would be reusable.
    expect(one.csp).toContain(`'nonce-${one.nonce}'`)
    expect(one.csp).not.toContain(two.nonce)
  })

  it('locks down the directives an XSS would reach for', () => {
    const { csp } = buildSecurityHeaders({ isDevelopment: false })
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("object-src 'none'")
    // A form posting elsewhere is an exfiltration primitive that survives most XSS filters.
    expect(csp).toContain("form-action 'self'")
    expect(csp).toContain("base-uri 'self'")
    // Clickjacking a "confirm" on a clinical record is a real attack.
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("'strict-dynamic'")
  })

  it('never allows eval in a production build', () => {
    expect(buildSecurityHeaders({ isDevelopment: false }).csp).not.toContain('unsafe-eval')
    // React Refresh needs it while developing, and only there.
    expect(buildSecurityHeaders({ isDevelopment: true }).csp).toContain('unsafe-eval')
  })

  it('upgrades insecure requests in production only', () => {
    expect(buildSecurityHeaders({ isDevelopment: false }).csp).toContain(
      'upgrade-insecure-requests',
    )
    expect(buildSecurityHeaders({ isDevelopment: true }).csp).not.toContain(
      'upgrade-insecure-requests',
    )
  })

  it('does not send HSTS from a plain-HTTP development server', () => {
    // Sending it from localhost would pin the developer's browser to HTTPS for two years.
    expect(
      buildSecurityHeaders({ isDevelopment: true }).headers['Strict-Transport-Security'],
    ).toBeUndefined()
  })

  it('sets the headers that do not depend on the policy', () => {
    const { headers } = buildSecurityHeaders({ isDevelopment: false })
    expect(headers['X-Content-Type-Options']).toBe('nosniff')
    expect(headers['X-Frame-Options']).toBe('DENY')
    expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin')
    expect(headers['Cross-Origin-Opener-Policy']).toBe('same-origin')
    expect(headers['Permissions-Policy']).toContain('camera=()')
  })

  it('lets the browser reach object storage, which a presigned upload needs', () => {
    // Files go straight from the browser to S3 on a presigned PUT (section 12.1), so a policy of
    // `connect-src 'self'` alone would break every upload with no visible error.
    const { csp } = buildSecurityHeaders({
      isDevelopment: false,
      storageOrigin: 'https://files.example.test',
    })
    expect(csp).toContain("connect-src 'self' https://files.example.test")
    expect(csp).toContain("img-src 'self' blob: data: https://files.example.test")
  })

  it('leaves the origin out rather than emitting an empty source when it is unknown', () => {
    // An empty string in a source list is a parse error that browsers handle by dropping the
    // whole directive, which would silently widen the policy instead of narrowing it.
    const { csp } = buildSecurityHeaders({ isDevelopment: false })
    expect(csp).toContain("connect-src 'self';")
    expect(csp).not.toMatch(/ {2}/)
  })

  it('sends HSTS only from an HTTPS deployment', () => {
    const plain = buildSecurityHeaders({ isDevelopment: false, appUrl: 'http://clinic.test' })
    expect(plain.headers['Strict-Transport-Security']).toBeUndefined()

    const secure = buildSecurityHeaders({ isDevelopment: false, appUrl: 'https://clinic.test' })
    expect(secure.headers['Strict-Transport-Security']).toContain('max-age=63072000')
  })
})

describe('locales', () => {
  it('has a definition for every catalogue that exists', () => {
    expect(isKnownLocale('en')).toBe(true)
    expect(isKnownLocale('ar')).toBe(true)
    expect(isKnownLocale('klingon')).toBe(false)
    expect(isKnownLocale(undefined)).toBe(false)
  })

  it('knows which way each one reads', () => {
    expect(directionOf('en')).toBe('ltr')
    expect(directionOf('ar')).toBe('rtl')
    // An unknown locale falls back rather than rendering with no direction at all.
    expect(directionOf('nonsense')).toBe('ltr')
  })

  it('offers only finished catalogues', () => {
    // A half-translated interface gives the reader two languages and, for Arabic, two directions
    // on one screen, with no way to tell what they are missing.
    const offered = selectableLocales().map((locale) => locale.code)
    expect(offered).toContain(DEFAULT_LOCALE)
    expect(offered).not.toContain('ar')
    expect(localeDefinition('ar').isComplete).toBe(false)
  })

  it('names each language in its own words', () => {
    // A language list written in English is a list for people who already read English.
    for (const locale of LOCALES) expect(locale.endonym.length).toBeGreaterThan(0)
    expect(localeDefinition('ar').endonym).toBe('العربية')
  })
})

describe('the Arabic catalogue', () => {
  const keysOf = (value: unknown, prefix = ''): string[] => {
    if (typeof value !== 'object' || value === null) return [prefix]
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
      keysOf(child, prefix ? `${prefix}.${key}` : key),
    )
  }

  it('only contains keys English also has, so nothing is orphaned', () => {
    const english = new Set(keysOf(en))
    const extra = keysOf(ar).filter((key) => !key.startsWith('_') && !english.has(key))
    expect(extra).toEqual([])
  })

  it('translates the shell somebody sees on every screen', () => {
    // The subset that has to be right for the RTL layout to be worth testing at all.
    for (const section of ['nav', 'shell', 'common', 'validation', 'auth', 'errorPage']) {
      expect(
        Object.keys((ar as unknown as Record<string, object>)[section] ?? {}).length,
      ).toBeGreaterThan(0)
    }
  })

  it('has no empty string, which would render as nothing rather than fall back', () => {
    const empties = keysOf(ar).filter((key) => {
      const value = key
        .split('.')
        .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], ar)
      return value === ''
    })
    expect(empties).toEqual([])
  })
})
