import { AuditLogModel } from '@clinic/db'
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

export interface StoredAuditEntry extends AuditEntry {
  id: string
}

/** Writes over the audit connection (section 11.5), never the application's own. */
export const auditRepository = {
  async insert(entry: AuditEntry): Promise<void> {
    await AuditLogModel().create(entry)
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

    return docs.map((doc) => {
      const { _id, ...rest } = doc as unknown as AuditEntry & { _id: string }
      return { id: _id, ...rest }
    })
  },
}
