import { env } from '@clinic/config'
import { usersHolding } from '@clinic/core/access'
import { recordAudit, runChainVerification } from '@clinic/core/audit'
import { deliver } from '@clinic/core/notifications'

/**
 * The nightly tamper check (section 11.5, Phase 8).
 *
 * The chain makes tampering *detectable*; this job is what does the detecting. Without something
 * walking it on a schedule, a hash chain is a promise that nobody ever checks — and the whole
 * point is to find out within a day rather than during an investigation two years later.
 *
 * **A break is treated as an incident, not as a failed job.** It is written to the audit log at
 * CRITICAL, it wakes every person who can read the log, and it is logged to stderr where the
 * platform's alerting can see it. Three channels because the one thing that must not happen is a
 * break that is noticed by nobody.
 */

export interface ChainCheckResult {
  ok: boolean
  checked: number
  wasFullWalk: boolean
  reason: string | null
  alerted: number
}

export async function verifyAuditChainNightly(now: Date = new Date()): Promise<ChainCheckResult> {
  const clinicId = env().CLINIC_ID
  const run = await runChainVerification(clinicId, { now })

  if (run.status.ok) {
    await recordAudit({
      action: 'audit.chain_verified',
      category: 'SYSTEM',
      severity: 'INFO',
      clinicId,
      actor: { id: null, type: 'SYSTEM', label: 'Chain verifier', roles: [] },
      metadata: { checked: run.status.checked, fullWalk: run.wasFullWalk },
    })
    return {
      ok: true,
      checked: run.status.checked,
      wasFullWalk: run.wasFullWalk,
      reason: null,
      alerted: 0,
    }
  }

  const broken = run.status.brokenAt
  const detail =
    `The audit log failed its integrity check. ` +
    `${reasonText(run.status.reason)} ` +
    `The first affected entry is "${broken?.action ?? 'unknown'}" ` +
    `recorded at ${broken?.occurredAt ?? 'an unknown time'} (id ${broken?.id ?? 'unknown'}). ` +
    `${run.status.checked} entries verified before the break.`

  // Loud, and first: stderr is what a platform alert watches, and it costs nothing if the
  // writes below are themselves the thing that is broken.
  console.error(`[worker] AUDIT CHAIN BROKEN — ${detail}`)

  // Ironic but necessary: the alert about the audit log goes into the audit log. It chains like
  // any other entry, so the record of the detection is itself tamper-evident.
  await recordAudit({
    action: 'audit.chain_broken',
    category: 'SYSTEM',
    severity: 'CRITICAL',
    outcome: 'FAILURE',
    clinicId,
    actor: { id: null, type: 'SYSTEM', label: 'Chain verifier', roles: [] },
    entity: broken ? { type: 'AuditLog', id: broken.id } : undefined,
    metadata: {
      reason: run.status.reason,
      checked: run.status.checked,
      fullWalk: run.wasFullWalk,
      brokenAt: broken?.occurredAt ?? null,
    },
  })

  const recipients = await usersHolding(clinicId, 'audit:read')
  const delivery = await deliver({
    clinicId,
    userIds: recipients,
    type: 'AUDIT_CHAIN_BROKEN',
    title: 'The audit log fails its integrity check',
    body: detail,
    href: '/admin/audit',
    entity: broken ? { type: 'AuditLog', id: broken.id } : undefined,
    // Keyed to the entry that broke, so a nightly job that keeps finding the same break sends
    // one alert rather than one a night — but a *second*, different break still gets through.
    dedupeKey: `chain-broken:${broken?.id ?? 'unknown'}`,
    action: { href: '/admin/audit', label: 'Open the audit log' },
  })

  return {
    ok: false,
    checked: run.status.checked,
    wasFullWalk: run.wasFullWalk,
    reason: run.status.reason,
    alerted: delivery.created,
  }
}

/** Plain English for each verdict, because the person woken by this is not reading the source. */
function reasonText(reason: string | null): string {
  switch (reason) {
    case 'HASH_MISMATCH':
      return 'An entry no longer matches its own hash, which means its contents were changed after it was written.'
    case 'BROKEN_LINK':
      return 'An entry does not follow the one before it, which means an entry was removed from the middle of the log.'
    case 'MISSING_HASH':
      return 'An entry carries no hash at all, which means it was written by something that bypassed the chain.'
    case 'HEAD_MISMATCH':
      return 'The log is internally consistent but does not end where the recorded chain head says it should, which is the signature of a rewritten history.'
    default:
      return 'The chain could not be verified.'
  }
}
