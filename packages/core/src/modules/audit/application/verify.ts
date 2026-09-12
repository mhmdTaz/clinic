import type { ChainStatus } from '@clinic/contracts'
import { CHAIN_GENESIS, verifyChain } from '../domain/hash-chain'
import { chainRepository, type ChainCheckpoint } from '../infrastructure/chain.repository'

/**
 * Running the tamper check (section 11.5).
 *
 * **Incremental most nights, full once a week.** Re-walking seven years of entries every night
 * would eventually take longer than a night; resuming from a bookmark keeps the ordinary run
 * proportional to a day's writes. But the bookmark is not evidence — anybody who could forge it
 * could already move the head — so a walk from genesis runs weekly, and the explorer can ask for
 * one at any time. An incremental pass that never re-examines history would be a check an
 * attacker only has to beat once.
 *
 * Lives in `audit` rather than in the worker because the decision of *what* to verify is a
 * property of the chain. What to do when it fails — who to wake, how loudly — is the worker's.
 */

/** How stale a full walk may get before the next run does one regardless. */
export const FULL_WALK_EVERY_DAYS = 7

/** A ceiling on one run, so a first verification of a huge log does not run for an hour. */
const MAX_LINKS_PER_RUN = 200_000

export interface ChainVerificationRun {
  status: ChainStatus
  /** True when this run started from genesis rather than from the bookmark. */
  wasFullWalk: boolean
  checkpoint: ChainCheckpoint
}

export async function runChainVerification(
  clinicId: string,
  options: { force?: 'full' | 'incremental'; now?: Date } = {},
): Promise<ChainVerificationRun> {
  const now = options.now ?? new Date()
  const checkpoint = await chainRepository.readCheckpoint(clinicId)

  const wasFullWalk =
    options.force === 'full' || (options.force !== 'incremental' && isFullWalkDue(checkpoint, now))

  const afterSeq = wasFullWalk ? 0 : checkpoint.verifiedSeq
  const startingAfter = wasFullWalk ? null : checkpoint.verifiedHash

  const [links, head, unchained] = await Promise.all([
    chainRepository.links(clinicId, { afterSeq, limit: MAX_LINKS_PER_RUN }),
    chainRepository.readHead(clinicId),
    chainRepository.countUnchained(clinicId),
  ])
  const verdict = verifyChain(links, startingAfter)
  const verifiedAt = now.toISOString()

  if (!verdict.ok) {
    // No checkpoint is written. A run that found a break must not move the bookmark past it, or
    // the next run would resume beyond the damage and report a clean chain over a broken one.
    return {
      status: {
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
      },
      wasFullWalk,
      checkpoint,
    }
  }

  /**
   * The walk agreed with itself. Now check it agrees with the **head**.
   *
   * This is the case a self-consistent rewrite would otherwise pass: an attacker who edits an
   * entry and recomputes every hash after it produces a chain that verifies perfectly on its own
   * terms — and ends somewhere the head has never been. The head is the independent witness, and
   * comparing against it is what turns "these entries are consistent" into "these entries are
   * the ones that were written".
   *
   * Only meaningful after a complete walk: an incremental run is capped at MAX_LINKS_PER_RUN and
   * may legitimately stop short of the end.
   */
  const computedHead = verdict.lastHash ?? checkpoint.verifiedHash ?? CHAIN_GENESIS
  const reachedTheEnd = links.length < MAX_LINKS_PER_RUN
  if (wasFullWalk && reachedTheEnd && computedHead !== head.hash) {
    const lastVerified = links.at(-1)
    return {
      status: {
        ok: false,
        checked: verdict.checked,
        unchained,
        verifiedAt,
        reason: 'HEAD_MISMATCH',
        brokenAt: {
          id: lastVerified?.id ?? head.entryId ?? 'unknown',
          occurredAt: (lastVerified?.occurredAt ?? now).toISOString(),
          action: lastVerified?.action ?? 'audit.chain_head',
        },
      },
      wasFullWalk,
      checkpoint,
    }
  }

  const lastLink = links.at(-1)
  await chainRepository.writeCheckpoint(
    clinicId,
    {
      verifiedAt: now,
      // Nothing new: keep the hash and position we resumed from, so tomorrow resumes from the
      // same place rather than falling back to genesis.
      verifiedHash: verdict.lastHash ?? checkpoint.verifiedHash,
      verifiedSeq: lastLink?.chainSeq ?? checkpoint.verifiedSeq,
    },
    wasFullWalk,
  )

  return {
    status: {
      ok: true,
      checked: verdict.checked,
      unchained,
      verifiedAt,
      reason: null,
      brokenAt: null,
    },
    wasFullWalk,
    checkpoint,
  }
}

function isFullWalkDue(checkpoint: ChainCheckpoint, now: Date): boolean {
  if (!checkpoint.fullyVerifiedAt || !checkpoint.verifiedHash) return true
  const ageDays = (now.getTime() - checkpoint.fullyVerifiedAt.getTime()) / 86_400_000
  return ageDays >= FULL_WALK_EVERY_DAYS
}
