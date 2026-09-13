import { z } from 'zod'
import { LocalDate } from './common'

/**
 * Contracts for the audit explorer (section 11.6, A9).
 *
 * The shape is driven by one question the exit criterion names: *"who viewed this patient's file
 * last Tuesday, and what did they change?"* — which is an entity, a date range, and a diff. Every
 * filter here earns its place by being part of some version of that question.
 */

export const AuditCategory = z.enum([
  'AUTH',
  'ACCESS_CONTROL',
  'CLINICAL',
  'FINANCIAL',
  'INVENTORY',
  'ADMIN',
  'FILE',
  'SUPPORT',
  'SYSTEM',
])
export type AuditCategory = z.infer<typeof AuditCategory>

export const AuditSeverity = z.enum(['INFO', 'NOTICE', 'WARNING', 'CRITICAL'])
export type AuditSeverity = z.infer<typeof AuditSeverity>

export const AuditOutcome = z.enum(['SUCCESS', 'FAILURE', 'DENIED'])
export type AuditOutcome = z.infer<typeof AuditOutcome>

/** One changed field, as the diff viewer renders it. */
export const AuditFieldChange = z.object({
  field: z.string(),
  before: z.string().nullable(),
  after: z.string().nullable(),
  /** True where the value was redacted at capture: PHI never enters the log (11.3). */
  isRedacted: z.boolean(),
})
export type AuditFieldChange = z.infer<typeof AuditFieldChange>

export const AuditEntrySummary = z.object({
  id: z.string(),
  occurredAt: z.string().datetime(),
  actor: z.object({
    id: z.string().nullable(),
    type: z.string(),
    label: z.string().nullable(),
    roles: z.array(z.string()),
  }),
  action: z.string(),
  category: AuditCategory,
  severity: AuditSeverity,
  outcome: AuditOutcome,
  entity: z
    .object({ type: z.string(), id: z.string().nullable(), label: z.string().nullable() })
    .nullable(),
  /** How many fields changed — enough for a list row to say whether there is a diff to open. */
  changeCount: z.number(),
})
export type AuditEntrySummary = z.infer<typeof AuditEntrySummary>

export const AuditEntryDetail = AuditEntrySummary.extend({
  changes: z.array(AuditFieldChange),
  metadata: z.record(z.unknown()).nullable(),
  request: z.object({
    id: z.string().nullable(),
    ipAddress: z.string().nullable(),
    userAgent: z.string().nullable(),
  }),
  impersonatorId: z.string().nullable(),
  /** The chain links, so an investigator can see the entry is where it says it is (11.5). */
  previousHash: z.string().nullable(),
  hash: z.string().nullable(),
})
export type AuditEntryDetail = z.infer<typeof AuditEntryDetail>

export const AuditListQuery = z.object({
  actorId: z.string().max(64).optional(),
  /** Both together answer "everything that touched this record". */
  entityType: z.string().max(60).optional(),
  entityId: z.string().max(64).optional(),
  action: z.string().max(80).optional(),
  category: AuditCategory.optional(),
  severity: AuditSeverity.optional(),
  outcome: AuditOutcome.optional(),
  from: LocalDate.optional(),
  to: LocalDate.optional(),
  /** Only entries that read PHI — "who has been looking" rather than "who changed what". */
  readsOnly: z.coerce.boolean().optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})
export type AuditListQuery = z.infer<typeof AuditListQuery>

/** What the nightly verification found, and what the explorer shows at the top of the page. */
export const ChainStatus = z.object({
  ok: z.boolean(),
  checked: z.number(),
  /**
   * Entries written before the chain existed, which it does not cover.
   *
   * Surfaced rather than hidden: "12,000 entries verified" over a log of 20,000 would otherwise
   * read as a guarantee about all of them.
   */
  unchained: z.number(),
  verifiedAt: z.string().datetime().nullable(),
  reason: z.string().nullable(),
  brokenAt: z
    .object({ id: z.string(), occurredAt: z.string().datetime(), action: z.string() })
    .nullable(),
})
export type ChainStatus = z.infer<typeof ChainStatus>

/**
 * A person the explorer offers as an actor filter.
 *
 * Not `PersonRef`: that allows a null id, and an actor you cannot filter by is not an option —
 * it is a row that would silently clear the filter when picked.
 */
export const AuditActorOption = z.object({ id: z.string(), name: z.string() })
export type AuditActorOption = z.infer<typeof AuditActorOption>

/** The filtered log as a CSV file, capped — `truncated` says when the filter matched more rows. */
export const AuditExport = z.object({
  filename: z.string(),
  csv: z.string(),
  rows: z.number().int(),
  truncated: z.boolean(),
})
export type AuditExport = z.infer<typeof AuditExport>
