/**
 * Where a notification takes somebody when they tap it.
 *
 * Its own module, with **no native imports**, and that separation is the point rather than tidying:
 * this is a security rule — it decides whether a payload can send somebody out of the app — and a
 * security rule that can only be exercised by launching a phone is a security rule nobody
 * exercises. `push.ts` keeps the parts that genuinely need the device.
 */

/**
 * An unknown or missing destination goes home rather than nowhere. A notification that does
 * nothing when tapped reads as a broken app, and a payload from an older server will happen.
 */
export function destinationOf(data: Record<string, unknown> | undefined): string {
  const href = data?.href

  // In-app paths only. A notification payload is attacker-influenced in principle, and following
  // an absolute URL out of one would be an open redirect with a push notification as the vector.
  // `//host` is rejected too: it is protocol-relative, and a browser would treat it as absolute.
  if (typeof href === 'string' && href.startsWith('/') && !href.startsWith('//')) {
    return href
  }
  return '/'
}
