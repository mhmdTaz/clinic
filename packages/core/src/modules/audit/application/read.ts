import type { ChainStatus } from '@clinic/contracts'
import { verifyChain } from '../domain/hash-chain'
import {
  auditRepository,
  type AuditSearchFilter,
  type StoredAuditEntry,
} from '../infrastructure/audit.repository'
import { chainRepository } from '../infrastructure/chain.repository'

/**
 * Reading the audit log, as a use case rather than as a person.
 *
 * **No permission checks here, deliberately.** Section 5.2 forbids `audit` from importing any
 * feature module, and `assertCan` lives in `access` — which already depends on `audit` to record
 * a denial. Gating here would close that loop into a cycle and break the one direction the graph
 * guarantees. The gate belongs one layer up, in `audit-explorer`, which is the only caller.
 *
 * That is not a weakening: nothing reaches these functions from a route without passing through
 * the explorer, and the explorer refuses before it asks.
 */

export type { AuditSearchFilter, StoredAuditEntry }

export async function searchAuditEntries(
  clinicId: string,
  filter: AuditSearchFilter = {},
): Promise<{ items: StoredAuditEntry[]; nextCursor: string | null }> {
  return auditRepository.search(clinicId, filter)
}

export async function findAuditEntry(
  clinicId: string,
  entryId: string,
): Promise<StoredAuditEntry | null> {
  return auditRepository.findById(clinicId, entryId)
}

/** Distinct actors in a window, for the explorer's actor filter. */
export async function auditActors(
  clinicId: string,
  since: Date,
): Promise<Array<{ id: string; name: string }>> {
  return auditRepository.actors(clinicId, since)
}

/**
 * Whether a clinic's chain still holds (section 11.5).
 *
 * Takes a clinic rather than an actor, because the nightly job in the worker runs it with no
 * actor at all. The explorer wraps it with the permission check.
 */
export async function verifyChainFor(
  clinicId: string,
  options: { afterSeq?: number; limit?: number; startingAfter?: string | null } = {},
): Promise<ChainStatus> {
  const [links, unchained] = await Promise.all([
    chainRepository.links(clinicId, { afterSeq: options.afterSeq, limit: options.limit }),
    chainRepository.countUnchained(clinicId),
  ])
  const verdict = verifyChain(links, options.startingAfter ?? null)
  const verifiedAt = new Date().toISOString()

  if (verdict.ok) {
    return {
      ok: true,
      checked: verdict.checked,
      unchained,
      verifiedAt,
      reason: null,
      brokenAt: null,
    }
  }

  return {
    ok: false,
    checked: verdict.checked,
    unchained,
    verifiedAt,
    reason: verdict.reason,
    brokenAt: {
      id: verdict.brokenAt.id,
      occurredAt: verdict.brokenAt.occurredAt.toISOString(),
      action: verdict.brokenAt.action,
    },
  }
}
