import { localDateIn } from '@clinic/contracts'
import type {
  AuditActorOption,
  AuditExport,
  AuditEntryDetail,
  AuditEntrySummary,
  AuditListQuery,
  ChainStatus,
} from '@clinic/contracts'
import { NotFoundError } from '../../../errors'
import { assertCan, type Actor } from '../../access'
import {
  auditActors,
  findAuditEntry,
  recordAudit,
  searchAuditEntries,
  verifyChainFor,
  type StoredAuditEntry,
} from '../../audit'
import { getClinicFacts } from '../../clinic'
import { instantOf, nextDate } from '../../scheduling'
import { csvRow, fieldChanges } from '../domain/diff'

/**
 * The audit log explorer (A5, section 11.6).
 *
 * **Reading the audit log is itself audited.** "Who has been reading the audit log" is among the
 * first questions an auditor asks, and an explorer that could not answer it would be a hole in
 * the thing it exists to provide. Every list and every entry opened writes an `audit.viewed`
 * entry — recording *what was asked for* rather than what came back, because the query is the
 * intent and a filter that returned nothing is still somebody looking.
 *
 * This module sits above `audit` rather than inside it. Section 5.2 forbids `audit` from
 * importing a feature module, and the permission check needs `access`, which already depends on
 * `audit` to record denials. Putting the gate here keeps the graph pointing one way.
 */

const YEAR_MS = 365 * 24 * 60 * 60 * 1000
/** The whole range, in one file. Past this an auditor wants a database, not a spreadsheet. */
const EXPORT_LIMIT = 5_000

export async function listAuditEntries(
  actor: Actor,
  query: AuditListQuery,
  now: Date = new Date(),
): Promise<{ items: AuditEntrySummary[]; nextCursor: string | null }> {
  await assertCan(actor, 'audit:read')
  const clinic = await getClinicFacts(actor.clinicId)
  const page = await searchAuditEntries(actor.clinicId, filterFrom(query, clinic.timezone))

  await recordAudit({
    action: 'audit.viewed',
    category: 'ACCESS_CONTROL',
    severity: 'NOTICE',
    clinicId: actor.clinicId,
    // What was asked for, not what came back.
    metadata: {
      actorId: query.actorId ?? null,
      entityType: query.entityType ?? null,
      entityId: query.entityId ?? null,
      filteredAction: query.action ?? null,
      category: query.category ?? null,
      severity: query.severity ?? null,
      outcome: query.outcome ?? null,
      readsOnly: query.readsOnly ?? false,
      from: query.from ?? null,
      to: query.to ?? null,
      today: localDateIn(clinic.timezone, now),
      results: page.items.length,
    },
  })

  return { items: page.items.map(toSummary), nextCursor: page.nextCursor }
}

export async function getAuditEntry(actor: Actor, entryId: string): Promise<AuditEntryDetail> {
  await assertCan(actor, 'audit:read')
  const entry = await findAuditEntry(actor.clinicId, entryId)
  if (!entry) throw new NotFoundError('Audit entry')

  await recordAudit({
    action: 'audit.viewed',
    category: 'ACCESS_CONTROL',
    severity: 'NOTICE',
    clinicId: actor.clinicId,
    entity: { type: 'AuditLog', id: entryId },
    metadata: { openedAction: entry.action },
  })

  return {
    ...toSummary(entry),
    changes: fieldChanges(entry.before, entry.after),
    metadata: entry.metadata ?? null,
    request: {
      // `requestId` is what links an entry to the application trace behind it (11.6), so it is
      // surfaced even when the other two are absent.
      id: entry.request?.id ?? null,
      ipAddress: entry.request?.ipAddress ?? null,
      userAgent: entry.request?.userAgent ?? null,
    },
    impersonatorId: entry.impersonatorId ?? null,
    previousHash: entry.previousHash ?? null,
    hash: entry.hash ?? null,
  }
}

/**
 * CSV, for an auditor who wants the evidence in their own tooling (A5).
 *
 * Its own permission and its own audit entry, at WARNING: taking the log **out** of the system is
 * a different act from reading it inside one, and the row count is recorded so "somebody exported
 * everything" stays answerable afterwards.
 */
export async function exportAuditCsv(
  actor: Actor,
  query: AuditListQuery,
  now: Date = new Date(),
): Promise<AuditExport> {
  await assertCan(actor, 'audit:export')
  const clinic = await getClinicFacts(actor.clinicId)
  const page = await searchAuditEntries(actor.clinicId, {
    ...filterFrom(query, clinic.timezone),
    cursor: undefined,
    limit: EXPORT_LIMIT,
  })

  const header = [
    'occurredAt',
    'actor',
    'actorId',
    'action',
    'category',
    'severity',
    'outcome',
    'entityType',
    'entityId',
    'changes',
    'requestId',
    'ipAddress',
    'hash',
  ]

  const rows = page.items.map((entry) =>
    csvRow([
      entry.occurredAt.toISOString(),
      entry.actor?.label ?? '',
      entry.actor?.id ?? '',
      entry.action,
      entry.category,
      entry.severity,
      entry.outcome,
      entry.entity?.type ?? '',
      entry.entity?.id ?? '',
      fieldChanges(entry.before, entry.after)
        .map((change) => `${change.field}: ${change.before ?? '—'} → ${change.after ?? '—'}`)
        .join('; '),
      entry.request?.id ?? '',
      entry.request?.ipAddress ?? '',
      entry.hash ?? '',
    ]),
  )

  // The export hit the cap, so the file is not the whole answer. Said in the audit entry and
  // returned to the caller, because a silently short export is a wrong export.
  const truncated = page.nextCursor !== null

  await recordAudit({
    action: 'audit.exported',
    category: 'ACCESS_CONTROL',
    severity: 'WARNING',
    clinicId: actor.clinicId,
    metadata: {
      rows: rows.length,
      truncated,
      from: query.from ?? null,
      to: query.to ?? null,
    },
  })

  return {
    filename: `audit-${localDateIn(clinic.timezone, now)}.csv`,
    csv: [csvRow(header), ...rows].join('\r\n'),
    rows: rows.length,
    truncated,
  }
}

/**
 * The people who appear in the log, for the actor filter.
 *
 * A year's window rather than all of history: the filter exists to answer "who did this", and
 * seven years of everyone who ever signed in is a list nobody scrolls.
 */
export async function auditActorOptions(
  actor: Actor,
  now: Date = new Date(),
): Promise<AuditActorOption[]> {
  await assertCan(actor, 'audit:read')
  return auditActors(actor.clinicId, new Date(now.getTime() - YEAR_MS))
}

/**
 * Whether the chain still holds (section 11.5).
 *
 * Shown at the top of the explorer, because an audit log nobody has verified is a log nobody
 * should rely on. The nightly job runs the same check without an actor.
 */
export async function verifyAuditChain(
  actor: Actor,
  options: { limit?: number } = {},
): Promise<ChainStatus> {
  await assertCan(actor, 'audit:read')
  return verifyChainFor(actor.clinicId, options)
}

/**
 * A contract query becomes a repository filter.
 *
 * The date conversion happens here because a local date is a clinic fact: "last Tuesday" is a
 * different instant in Beirut than in London, and the repository should not have to know which.
 * `to` becomes the start of the *next* day, so the last day the admin asked for is included —
 * the off-by-one that silently drops today.
 */
function filterFrom(query: AuditListQuery, timezone: string) {
  return {
    actorId: query.actorId,
    entityType: query.entityType,
    entityId: query.entityId,
    action: query.action,
    category: query.category,
    severity: query.severity,
    outcome: query.outcome,
    readsOnly: query.readsOnly,
    from: query.from ? instantOf(query.from, '00:00', timezone) : undefined,
    to: query.to ? instantOf(nextDate(query.to), '00:00', timezone) : undefined,
    cursor: query.cursor,
    limit: query.limit,
  }
}

function toSummary(entry: StoredAuditEntry): AuditEntrySummary {
  return {
    id: entry.id,
    occurredAt: entry.occurredAt.toISOString(),
    actor: {
      id: entry.actor?.id ?? null,
      type: entry.actor?.type ?? 'SYSTEM',
      label: entry.actor?.label ?? null,
      roles: entry.actor?.roles ?? [],
    },
    action: entry.action,
    category: entry.category,
    severity: entry.severity,
    outcome: entry.outcome,
    entity: entry.entity
      ? {
          type: entry.entity.type,
          id: entry.entity.id ?? null,
          label: entry.entity.label ?? null,
        }
      : null,
    changeCount: fieldChanges(entry.before, entry.after).length,
  }
}
