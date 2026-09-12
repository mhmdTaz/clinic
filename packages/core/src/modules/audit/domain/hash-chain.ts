import { createHash } from 'node:crypto'

/**
 * Tamper evidence for the audit log (section 11.5, layer 3).
 *
 * Each entry stores `hash = sha256(previousHash + canonical(entry))`, so altering any historical
 * document breaks its own hash **and every hash after it**. An attacker who edits one entry has to
 * rewrite the whole tail to stay consistent — and a verifier that walks the chain nightly notices
 * either way.
 *
 * This is the third of four layers, and the weakest on its own: the restricted database user
 * (layer 1) is what actually prevents the application from writing here at all. The chain's job is
 * to make a *successful* tampering — at the database, below the application — detectable rather
 * than silent.
 *
 * Chained per `clinicId`, so a single global sequence is not a write bottleneck and one clinic's
 * volume cannot slow another's.
 */

/** The genesis link: what the first entry in a clinic's chain follows. */
export const CHAIN_GENESIS = '0'.repeat(64)

/**
 * The fields the hash covers, in a fixed order.
 *
 * **Order is the whole game.** `JSON.stringify` walks an object's own insertion order, so two
 * logically identical entries built by different code paths would hash differently — and a
 * verifier would report tampering that never happened. Listing the fields explicitly means the
 * canonical form is a property of this function rather than of how a caller happened to build
 * its object.
 *
 * `expiresAt` is deliberately **not** covered: the TTL monitor never rewrites it, but a clinic
 * changing its retention policy legitimately might, and a retention change is not tampering.
 */
export interface ChainableEntry {
  clinicId: string
  occurredAt: Date
  actor: { id: string | null; type: string; label: string | null; roles: string[] }
  action: string
  category: string
  entity?: { type: string; id?: string | null; label?: string | null } | undefined
  before?: Record<string, unknown> | null | undefined
  after?: Record<string, unknown> | null | undefined
  metadata?: Record<string, unknown> | undefined
  severity: string
  outcome: string
}

export function canonicalise(entry: ChainableEntry): string {
  return JSON.stringify([
    entry.clinicId,
    entry.occurredAt.toISOString(),
    [
      entry.actor.id ?? '',
      entry.actor.type,
      entry.actor.label ?? '',
      [...entry.actor.roles].sort(),
    ],
    entry.action,
    entry.category,
    entry.entity ? [entry.entity.type, entry.entity.id ?? '', entry.entity.label ?? ''] : null,
    stable(entry.before),
    stable(entry.after),
    stable(entry.metadata),
    entry.severity,
    entry.outcome,
  ])
}

/**
 * An object with its keys sorted, recursively.
 *
 * A diff built from `Object.keys(changed)` has whatever order the change happened to produce, so
 * two runs of the same edit can serialise differently. Sorting makes the canonical form depend on
 * the content and nothing else.
 */
function stable(value: unknown): unknown {
  if (value === null || value === undefined) return null
  if (Array.isArray(value)) return value.map(stable)
  if (typeof value !== 'object') return value
  if (value instanceof Date) return value.toISOString()

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  return Object.fromEntries(entries.map(([key, item]) => [key, stable(item)]))
}

export function chainHash(previousHash: string, entry: ChainableEntry): string {
  return createHash('sha256').update(previousHash).update(canonicalise(entry)).digest('hex')
}

export type ChainVerdict =
  | { ok: true; checked: number; lastHash: string | null }
  | {
      ok: false
      checked: number
      /** The first entry whose hash does not match, which is where tampering begins. */
      brokenAt: { id: string; occurredAt: Date; action: string }
      reason: 'HASH_MISMATCH' | 'BROKEN_LINK' | 'MISSING_HASH'
    }

export interface ChainLink extends ChainableEntry {
  id: string
  previousHash: string | null
  hash: string | null
  /**
   * Position in the chain, assigned when the link was claimed.
   *
   * Deliberately **not** part of the hash: the hash covers what happened, and the position is
   * where the entry landed. Including it would mean a chain could never be re-anchored after a
   * legitimate repair without rewriting every hash after the repair point.
   */
  chainSeq: number | null
}

/**
 * Walks a clinic's chain in the order it was written and reports the first break.
 *
 * Three ways it can fail, and they mean different things:
 *  - MISSING_HASH  — an entry written before the chain existed, or by something that bypassed it.
 *  - BROKEN_LINK   — an entry whose `previousHash` is not its predecessor's hash: something was
 *                    **deleted** from the middle.
 *  - HASH_MISMATCH — an entry whose content no longer produces its stored hash: it was **edited**.
 *
 * `startingAfter` lets a nightly job verify only what is new, carrying the last known-good hash
 * forward rather than re-reading seven years of history every night.
 */
export function verifyChain(links: ChainLink[], startingAfter: string | null = null): ChainVerdict {
  let previous = startingAfter ?? CHAIN_GENESIS
  let checked = 0

  for (const link of links) {
    const where = { id: link.id, occurredAt: link.occurredAt, action: link.action }

    if (link.hash === null) {
      return { ok: false, checked, brokenAt: where, reason: 'MISSING_HASH' }
    }
    if ((link.previousHash ?? CHAIN_GENESIS) !== previous) {
      return { ok: false, checked, brokenAt: where, reason: 'BROKEN_LINK' }
    }
    if (chainHash(previous, link) !== link.hash) {
      return { ok: false, checked, brokenAt: where, reason: 'HASH_MISMATCH' }
    }

    previous = link.hash
    checked += 1
  }

  return { ok: true, checked, lastHash: checked > 0 ? previous : startingAfter }
}
