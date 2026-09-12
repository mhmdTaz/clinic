/**
 * The Content-Security-Policy, and the headers that go with it (section 16.1).
 *
 * A CSP is the difference between "an XSS ran" and "an XSS ran and exfiltrated a patient list".
 * React escapes by default and `dangerouslySetInnerHTML` is lint-banned, so injection is already
 * unlikely — this is the layer that limits the damage when one gets through anyway.
 *
 * **Nonce-based, not allowlist-based.** An allowlist of hosts is bypassed the moment one of them
 * serves a JSONP endpoint or an old Angular; a per-request nonce with `strict-dynamic` says only
 * "the scripts this page vouched for, and whatever they load" — which is the property actually
 * wanted, and is why the nonce is generated per request rather than configured statically.
 */

export interface SecurityHeaders {
  nonce: string
  csp: string
  headers: Record<string, string>
}

export interface SecurityOptions {
  /** From `env().NODE_ENV` — never `process.env` here, so it comes from the one parsed schema. */
  isDevelopment: boolean
  /**
   * The object-storage origin the browser talks to directly on a presigned URL (section 12.1).
   *
   * Passed in rather than read here, which keeps this module free of configuration and therefore
   * testable on its own: a policy is a pure function of a few facts, and asserting on it should
   * not require a parsed environment.
   */
  storageOrigin?: string
  /** The app's own URL, used only to decide whether HSTS is honest to send. */
  appUrl?: string
}

export function buildSecurityHeaders(options: SecurityOptions): SecurityHeaders {
  const { isDevelopment, storageOrigin: storage = '', appUrl = '' } = options
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')

  const directives: Array<[string, string[]]> = [
    ['default-src', ["'self'"]],
    [
      'script-src',
      [
        // `'self'` is here for browsers that do not understand strict-dynamic, where it is the
        // whole policy. Browsers that do understand it ignore this and every other host source.
        "'self'",
        `'nonce-${nonce}'`,
        // Scripts loaded by a nonced script inherit trust, which is what lets Next's own chunk
        // loading work without enumerating every chunk.
        "'strict-dynamic'",
        // React Refresh evaluates modules during development. Never in a production build.
        ...(isDevelopment ? ["'unsafe-eval'"] : []),
      ],
    ],
    [
      'style-src',
      [
        "'self'",
        // Honest compromise: Next injects inline <style> for critical CSS and Tailwind's runtime
        // sets inline custom properties, neither of which carries our nonce. Style injection is a
        // far smaller lever than script injection, and `script-src` above is where the defence is.
        "'unsafe-inline'",
      ],
    ],
    // blob: and data: are how a generated PDF preview and an exported CSV reach the page.
    ['img-src', ["'self'", 'blob:', 'data:', storage].filter(Boolean)],
    ['font-src', ["'self'", 'data:']],
    // The API is same-origin; object storage is not, because a presigned PUT goes straight there.
    ['connect-src', ["'self'", storage].filter(Boolean)],
    ['media-src', ["'self'", storage].filter(Boolean)],
    ['worker-src', ["'self'", 'blob:']],
    // Nothing embeds anything, and nothing embeds us — clickjacking a "confirm" button on a
    // clinical record is a real attack, not a theoretical one.
    ['frame-src', ["'none'"]],
    ['frame-ancestors', ["'none'"]],
    ['object-src', ["'none'"]],
    // A form that posts elsewhere is an exfiltration primitive that survives most XSS filters.
    ['form-action', ["'self'"]],
    ['base-uri', ["'self'"]],
  ]

  if (!isDevelopment) directives.push(['upgrade-insecure-requests', []])

  const csp = directives
    .map(([name, values]) => (values.length > 0 ? `${name} ${values.join(' ')}` : name))
    .join('; ')

  const headers: Record<string, string> = {
    'Content-Security-Policy': csp,
    // Superseded by frame-ancestors for modern browsers; still the only thing older ones read.
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    // A full URL can carry a patient id in its path. Cross-origin requests get the origin only.
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': [
      'camera=()',
      'microphone=()',
      'geolocation=()',
      'payment=()',
      'usb=()',
      'interest-cohort=()',
    ].join(', '),
    // Isolates this origin's browsing context group, which is what makes high-resolution timers
    // safe and blocks a class of cross-origin leaks.
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
  }

  // HSTS only when the deployment is actually on HTTPS. Sending it from a plain-HTTP development
  // server would pin localhost to HTTPS in the developer's browser for two years.
  if (!isDevelopment && appUrl.startsWith('https://')) {
    headers['Strict-Transport-Security'] = 'max-age=63072000; includeSubDomains; preload'
  }

  return { nonce, csp, headers }
}
