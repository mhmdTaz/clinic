import {
  env,
  processSingleton,
  type ActorType,
  type AuditCategory,
  type AuditOutcome,
  type AuditSeverity,
} from '@clinic/config'
import { currentContext } from '../../../context/request-context'
import { expiresAtFor } from '../domain/retention'
import { auditRepository, type AuditEntry } from '../infrastructure/audit.repository'

export interface AuditActorSnapshot {
  id: string | null
  type: ActorType
  label: string | null
  roles: string[]
}

export interface RecordAuditInput {
  action: string
  category: AuditCategory
  severity?: AuditSeverity
  outcome?: AuditOutcome
  entity?: { type: string; id?: string | null; ids?: string[]; label?: string | null }
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
  metadata?: Record<string, unknown>
  /**
   * Overrides the ambient actor. A successful sign-in, for instance, starts as an
   * anonymous request but is recorded as the user who just signed in.
   */
  actor?: AuditActorSnapshot
  clinicId?: string
}

/**
 * Builds the entry synchronously, so the actor and request are captured at the moment
 * of the action rather than whenever an asynchronous write happens to run.
 */
function buildEntry(input: RecordAuditInput, now = new Date()): AuditEntry {
  const context = currentContext()
  return {
    clinicId: input.clinicId ?? context?.clinicId ?? env().CLINIC_ID,
    occurredAt: now,
    actor: input.actor ?? {
      id: context?.actorId ?? null,
      type: context?.actorType ?? 'ANONYMOUS',
      label: context?.actorLabel ?? null,
      roles: context?.actorRoles ?? [],
    },
    impersonatorId: context?.impersonatorId,
    action: input.action,
    category: input.category,
    entity: input.entity,
    before: input.before ?? undefined,
    after: input.after ?? undefined,
    metadata: input.metadata,
    request: {
      id: context?.requestId,
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
    },
    severity: input.severity ?? 'INFO',
    outcome: input.outcome ?? 'SUCCESS',
    expiresAt: expiresAtFor(input.category, now),
  }
}

/**
 * Awaited. For events whose loss would matter — sign-ins, denials, password changes —
 * durability is worth the millisecond.
 */
export async function recordAudit(input: RecordAuditInput): Promise<void> {
  await auditRepository.insert(buildEntry(input))
}

// Process-wide, so a shutdown flush waits for writes started from any bundle.
const pending = processSingleton('audit:pending-writes', () => new Set<Promise<void>>())

/**
 * Fire-and-forget, for high-volume automatic capture that must never sit on a request's
 * critical path. Pending writes are tracked so a script or a shutting-down server can
 * flush them rather than exit with entries still in flight.
 *
 * Known limit, due before Phase 3: capture fires when an operation executes, not when
 * its transaction commits, so a write that is later rolled back still leaves an entry.
 * No audited model is written inside a transaction yet; the booking and payment flows
 * that introduce one must buffer entries per session and flush on commit.
 */
export function enqueueAudit(input: RecordAuditInput): void {
  const entry = buildEntry(input)
  const write: Promise<void> = auditRepository
    .insert(entry)
    .catch((error: unknown) => {
      console.error('[audit] failed to write an audit entry', { action: entry.action, error })
    })
    .finally(() => {
      pending.delete(write)
    })
  pending.add(write)
}

export async function flushAudit(): Promise<void> {
  while (pending.size > 0) await Promise.allSettled([...pending])
}
