import { AuditLogModel, newId } from '@clinic/db'
import { claimLink } from './chain.repository'
import type { ActorType, AuditCategory, AuditOutcome, AuditSeverity } from '@clinic/config'

export interface AuditEntry {
  clinicId: string
  occurredAt: Date
  actor: { id: string | null; type: ActorType; label: string | null; roles: string[] }
  impersonatorId?: string
  action: string
  category: AuditCategory
  entity?: { type: string; id?: string | null; ids?: string[]; label?: string | null }
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
  metadata?: Record<string, unknown>
  request: { id?: string; ipAddress?: string; userAgent?: string }
  severity: AuditSeverity
  outcome: AuditOutcome
  expiresAt: Date
}

export interface ChainedAuditEntry extends AuditEntry {
  previousHash: string
  hash: string
  chainSeq: number
}

export interface StoredAuditEntry extends AuditEntry {
  id: string
  previousHash?: string | null
  hash?: string | null
}

/**
 * What the explorer may narrow by. Dates are instants, already resolved from the clinic's
 * timezone by the caller: a repository that took a local date would have to know what "Tuesday"
 * means in Beirut, and that is not its job.
 */
export interface AuditSearchFilter {
  actorId?: string | undefined
  entityType?: string | undefined
  entityId?: string | undefined
  action?: string | undefined
  category?: string | undefined
  severity?: string | undefined
  outcome?: string | undefined
  readsOnly?: boolean | undefined
  from?: Date | undefined
  to?: Date | undefined
  cursor?: string | undefined
  limit?: number | undefined
}

/**
 * Reads, and only reads, are named this way — `<model>.viewed` by the capture plugin,
 * `file.downloaded` by the file module, `*.exported` by anything that takes data out.
 *
 * Anchored at the end so `patient.viewed` matches and a hypothetical `patient.viewed_flag`
 * does not. This one filter is the difference between "what changed" and "who has been
 * looking", and the second question is the one a privacy complaint actually asks.
 */
const READ_ACTIONS = /\.(viewed|downloaded|exported)$/

/**
 * The paging key: an instant and an id.
 *
 * `occurredAt` alone is not unique — a burst of automatic capture writes several entries in the
 * same millisecond — so a cursor built from the timestamp alone would skip or repeat rows at a
 * page boundary. The id breaks the tie, and the sort carries the same two keys.
 */
function encodeCursor(entry: { occurredAt: Date; id: string }): string {
  return Buffer.from(`${entry.occurredAt.toISOString()}|${entry.id}`).toString('base64url')
}

function decodeCursor(cursor: string): { occurredAt: Date; id: string } | null {
  const [at, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|')
  if (!at || !id) return null
  const occurredAt = new Date(at)
  return Number.isNaN(occurredAt.getTime()) ? null : { occurredAt, id }
}

function toStored(doc: unknown): StoredAuditEntry {
  const { _id, ...rest } = doc as AuditEntry & {
    _id: string
    previousHash?: string
    hash?: string
  }
  return { id: _id, ...rest }
}

/** Writes over the audit connection (section 11.5), never the application's own. */
export const auditRepository = {
  /**
   * Writes one entry, chained to the one before it (section 11.5, layer 3).
   *
   * The link is claimed **before** the insert, by compare-and-swap on the clinic's chain head, so
   * two concurrent writes cannot both claim the same predecessor. The id is minted here rather
   * than by the driver because the head records which entry a hash belongs to, and it has to
   * know that before the document exists.
   */
  async insert(entry: AuditEntry): Promise<void> {
    const _id = newId()
    const { previousHash, hash, chainSeq } = await claimLink(entry, _id)
    await AuditLogModel().create({ _id, ...entry, previousHash, hash, chainSeq })
  },

  /**
   * One page of the explorer, newest first.
   *
   * Every filter is optional and every combination is legal, because an investigation starts
   * wide and narrows: "everything last Tuesday", then "everything on this patient", then "and
   * only the reads". The `clinicId` is not optional, and is first in every index.
   */
  async search(
    clinicId: string,
    filter: AuditSearchFilter = {},
  ): Promise<{ items: StoredAuditEntry[]; nextCursor: string | null }> {
    const query: Record<string, unknown> = { clinicId }

    if (filter.actorId) query['actor.id'] = filter.actorId
    if (filter.entityType) query['entity.type'] = filter.entityType
    if (filter.entityId) query['entity.id'] = filter.entityId
    if (filter.action) query.action = filter.action
    else if (filter.readsOnly) query.action = READ_ACTIONS
    if (filter.category) query.category = filter.category
    if (filter.severity) query.severity = filter.severity
    if (filter.outcome) query.outcome = filter.outcome

    // Half-open: `from` inclusive, `to` exclusive. The caller passes the start of the day
    // *after* the one asked for, so "to: Tuesday" includes all of Tuesday.
    const occurredAt: Record<string, Date> = {}
    if (filter.from) occurredAt.$gte = filter.from
    if (filter.to) occurredAt.$lt = filter.to

    const cursor = filter.cursor ? decodeCursor(filter.cursor) : null
    if (cursor) {
      // Strictly before the cursor in the same (occurredAt desc, _id desc) order the sort uses.
      query.$and = [
        {
          $or: [
            { occurredAt: { $lt: cursor.occurredAt } },
            { occurredAt: cursor.occurredAt, _id: { $lt: cursor.id } },
          ],
        },
      ]
      if (Object.keys(occurredAt).length > 0) {
        ;(query.$and as unknown[]).push({ occurredAt })
      }
    } else if (Object.keys(occurredAt).length > 0) {
      query.occurredAt = occurredAt
    }

    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 5_000)
    // One extra row, purely to learn whether there is a next page without counting the
    // collection — a count on the largest collection in the system, per keystroke, is not free.
    const docs = await AuditLogModel()
      .find(query)
      .sort({ occurredAt: -1, _id: -1 })
      .limit(limit + 1)
      .lean()

    const items = docs.slice(0, limit).map(toStored)
    const last = items.at(-1)
    return {
      items,
      nextCursor: docs.length > limit && last ? encodeCursor(last) : null,
    }
  },

  async findById(clinicId: string, id: string): Promise<StoredAuditEntry | null> {
    const doc = await AuditLogModel().findOne({ _id: id, clinicId }).lean()
    return doc ? toStored(doc) : null
  },

  /** Distinct actors in a window, for the explorer's actor filter. */
  async actors(clinicId: string, since: Date): Promise<Array<{ id: string; name: string }>> {
    const rows = await AuditLogModel().aggregate<{ _id: string; name: string | null }>([
      { $match: { clinicId, occurredAt: { $gte: since }, 'actor.id': { $ne: null } } },
      // The most recent label wins: a person who changed their name should appear under the
      // one they use now, not the one they had the first time they signed in.
      { $sort: { occurredAt: -1 } },
      { $group: { _id: '$actor.id', name: { $first: '$actor.label' } } },
      { $limit: 500 },
    ])

    return rows
      .filter((row) => Boolean(row._id))
      .map((row) => ({ id: row._id, name: row.name ?? row._id }))
      .sort((left, right) => left.name.localeCompare(right.name))
  },

  async listRecent(
    clinicId: string,
    filter: { action?: string; actorId?: string; limit?: number } = {},
  ): Promise<StoredAuditEntry[]> {
    const query: Record<string, unknown> = { clinicId }
    if (filter.action) query.action = filter.action
    if (filter.actorId) query['actor.id'] = filter.actorId

    const docs = await AuditLogModel()
      .find(query)
      .sort({ occurredAt: -1 })
      .limit(Math.min(filter.limit ?? 50, 200))
      .lean()

    return docs.map(toStored)
  },
}
