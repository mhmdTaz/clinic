import type { PortalKey, SessionUser } from '@clinic/contracts'

/**
 * Where things are in the app, and how a link from the server finds its way to them.
 *
 * Pure, and in its own file, for the same reason as `format.ts`: these are rules that are easy to
 * get quietly wrong and worth testing without a device.
 */

/**
 * The portals this app has screens for.
 *
 * Staff and administrators work at a desk, with a keyboard, across a whole clinic's day — the web
 * is their tool, and a phone version of the billing screen would be worse at everything. The app
 * is for the two people who are away from a desk: the patient, and the doctor between rooms.
 */
export const MOBILE_PORTALS = ['patient', 'doctor'] as const satisfies readonly PortalKey[]
export type MobilePortal = (typeof MOBILE_PORTALS)[number]

export const isMobilePortal = (value: unknown): value is MobilePortal =>
  (MOBILE_PORTALS as readonly unknown[]).includes(value)

/** The portals this person may use here, most relevant first — the order the session gives. */
export const mobilePortalsOf = (user: Pick<SessionUser, 'portals'>): MobilePortal[] =>
  user.portals.filter(isMobilePortal)

/**
 * Which portal to open on launch.
 *
 * The same rule as the web's landing (§10.1): the portal the person last chose, if they still
 * hold it, otherwise the most relevant one they have. `null` means this account has nothing the
 * app can show — a receptionist who installed it — and the app says so rather than showing an
 * empty tab bar.
 */
export function landingPortal(
  user: Pick<SessionUser, 'portals' | 'preferredPortal'>,
): MobilePortal | null {
  const available = mobilePortalsOf(user)
  if (isMobilePortal(user.preferredPortal) && available.includes(user.preferredPortal)) {
    return user.preferredPortal
  }
  return available[0] ?? null
}

export const homeOf = (portal: MobilePortal | null): string => (portal ? `/${portal}` : '/')

/** The portal a route belongs to, from its first segment. */
export const portalOfPath = (segments: readonly string[]): MobilePortal | null =>
  isMobilePortal(segments[0]) ? segments[0] : null

const ID = '([A-Za-z0-9_-]{1,64})'

interface RouteRule {
  pattern: RegExp
  /** The portal the destination belongs to; `null` for screens any signed-in person may open. */
  portal: MobilePortal | null
  to: (match: RegExpMatchArray, current: MobilePortal | null) => string | null
}

/**
 * Links the server writes, and where each one lands in the app.
 *
 * **The server writes web paths** — a reminder's `href` is `/patient/appointments`, a ticket
 * reply's is `/support/<id>` — because the same notification is an email with a button, an entry
 * in the web's bell, and a push. The app's routes mirror the web's where they can, which is most
 * of them; this table covers the rest.
 *
 * The first version of the app routed notifications to `/appointments` and `/notifications`, paths
 * that only ever existed in the app, while every notification the server actually sends names a
 * web path. Tapping a real reminder would have opened "page not found". Nothing caught it because
 * the test used the app's own paths as input.
 */
const RULES: readonly RouteRule[] = [
  { pattern: /^\/patient$/, portal: 'patient', to: () => '/patient' },
  { pattern: /^\/patient\/appointments$/, portal: 'patient', to: () => '/patient/appointments' },
  // The web's booking page; in the app, a screen of its own above the tabs.
  { pattern: /^\/patient\/appointments\/new$/, portal: 'patient', to: () => '/patient/book' },
  { pattern: /^\/patient\/book$/, portal: 'patient', to: () => '/patient/book' },
  { pattern: /^\/patient\/documents$/, portal: 'patient', to: () => '/patient/documents' },
  { pattern: /^\/patient\/messages$/, portal: 'patient', to: () => '/patient/messages' },
  { pattern: /^\/patient\/updates$/, portal: 'patient', to: () => '/patient/updates' },
  { pattern: /^\/patient\/account$/, portal: 'patient', to: () => '/patient/account' },

  // Support is one list for everybody on the web. In the app it is a patient's tab; a doctor
  // raising a ticket from a phone is rare enough to leave to the desk, so the list sends a doctor
  // home — but a reply to a thread they did open still opens that thread.
  {
    pattern: /^\/support$/,
    portal: null,
    to: (_match, current) => (current === 'patient' ? '/patient/messages' : null),
  },
  { pattern: /^\/support\/new$/, portal: 'patient', to: () => '/support/new' },
  { pattern: new RegExp(`^/support/${ID}$`), portal: null, to: (match) => `/support/${match[1]}` },

  { pattern: /^\/doctor$/, portal: 'doctor', to: () => '/doctor' },
  // The web's agenda is the app's home screen: "my day" is what a doctor opens the app for.
  { pattern: /^\/doctor\/appointments$/, portal: 'doctor', to: () => '/doctor' },
  { pattern: /^\/doctor\/patients$/, portal: 'doctor', to: () => '/doctor/patients' },
  {
    pattern: new RegExp(`^/doctor/patients/${ID}$`),
    portal: 'doctor',
    to: (match) => `/doctor/patients/${match[1]}`,
  },
  {
    pattern: new RegExp(`^/doctor/encounters/${ID}$`),
    portal: 'doctor',
    to: (match) => `/doctor/encounters/${match[1]}`,
  },
  { pattern: /^\/doctor\/account$/, portal: 'doctor', to: () => '/doctor/account' },
]

export interface RouteContext {
  /** The portals this person holds. A link into one they do not hold goes home instead. */
  portals: readonly PortalKey[]
  /** The portal they are in now, which is where "home" is. */
  current: MobilePortal | null
}

/**
 * Where a link from the server should take somebody.
 *
 * **Never somewhere outside the app.** A notification payload is attacker-influenced in principle;
 * following an absolute URL out of one would be an open redirect with a push as the delivery
 * mechanism. Only a single-slash path is considered, and only one that matches a known route.
 *
 * **Never nowhere.** Anything unrecognised — a link to billing, which the app does not have, or a
 * staff path — goes to the home of the portal the person is in. A tap that does nothing reads as a
 * broken app, and a payload from a newer server naming a screen this build lacks is a case that
 * will happen.
 */
export function resolveHref(href: unknown, context: RouteContext): string {
  const home = homeOf(context.current)
  if (typeof href !== 'string') return home
  if (!href.startsWith('/') || href.startsWith('//') || href.includes('\\')) return home

  const path = (href.split(/[?#]/)[0] ?? '').replace(/(.)\/+$/, '$1')

  for (const rule of RULES) {
    const match = path.match(rule.pattern)
    if (!match) continue
    if (rule.portal && !context.portals.includes(rule.portal)) return home
    return rule.to(match, context.current) ?? home
  }
  return home
}

/** The destination named by a notification's data payload. */
export const destinationOf = (data: unknown, context: RouteContext): string =>
  resolveHref(
    data && typeof data === 'object' ? (data as { href?: unknown }).href : undefined,
    context,
  )
