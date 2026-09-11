import type {
  ClientSession,
  Document,
  FilterQuery,
  MongooseQueryMiddleware,
  Query,
  Schema,
} from 'mongoose'
import { processSingleton } from '@clinic/config'
import { diffDocuments, type PlainObject } from './audit-diff'

/**
 * Automatic audit capture — path 1 of section 11.1.
 *
 * The plugin observes writes and hands a neutral event to a SINK. It does not know
 * about request contexts, actors or the audit collection: those live in @clinic/core,
 * which installs the sink at startup. That inversion is what lets @clinic/db stay free
 * of any dependency on the layers above it.
 *
 * Its one blind spot is bulk operations — updateMany, bulkWrite and insertMany bypass
 * document middleware. Those are confined to repositories by lint and must record an
 * explicit audit entry (section 8.15).
 */
export type AuditOperation = 'created' | 'updated' | 'deleted' | 'viewed'

export interface AuditCaptureEvent {
  model: string
  operation: AuditOperation
  entityId: string | null
  /** Every document a read returned; empty for writes. */
  entityIds: string[]
  clinicId: string | null
  before: PlainObject | null
  after: PlainObject | null
  changedPaths: string[]
}

export type AuditSink = (event: AuditCaptureEvent) => void

export class AuditSinkNotConfiguredError extends Error {
  readonly code = 'AUDIT_SINK_NOT_CONFIGURED'
  constructor(model: string) {
    super(
      `A write to the audited model "${model}" ran before an audit sink was installed. Every ` +
        'entry point — the web server, the seed, scripts and tests — must install one first, ' +
        'so that an audited write can never happen silently unaudited.',
    )
    this.name = 'AuditSinkNotConfiguredError'
  }
}

/**
 * Process-wide. A model is compiled once on the shared connection, so its hooks can belong
 * to a different bundle copy of this file than the code that installed the sink.
 */
const installed = processSingleton('db:audit-sink', () => ({ sink: null as AuditSink | null }))

export function setAuditSink(next: AuditSink | null): void {
  installed.sink = next
}

export function hasAuditSink(): boolean {
  return installed.sink !== null
}

/**
 * Events captured inside a transaction wait here for the commit (section 11.3), so a write
 * that rolls back leaves no entry behind. Keyed by the driver session, and process-wide for
 * the same reason as the sink: the model's hooks and the transaction can belong to different
 * bundle copies of this file.
 */
const deferred = processSingleton(
  'db:deferred-audit',
  () => new WeakMap<ClientSession, AuditCaptureEvent[]>(),
)

/** Starts an empty buffer for one attempt of a transaction. */
export function deferAuditUntilCommit(session: ClientSession): void {
  deferred.set(session, [])
}

/** The transaction committed: its captured events go to the sink, in the order they happened. */
export function releaseDeferredAudit(session: ClientSession): void {
  const events = deferred.get(session) ?? []
  deferred.delete(session)
  for (const event of events) {
    // The write hooks refused to run without a sink, so one existed moments ago. If it has
    // since been removed (a test tearing down), the data is committed and the entry cannot
    // be refused — say so loudly rather than throw after the fact.
    if (installed.sink) installed.sink(event)
    else console.error('[audit] sink removed before a committed transaction released', event)
  }
}

/** The transaction failed or is being retried: what it captured never happened. */
export function discardDeferredAudit(session: ClientSession): void {
  deferred.delete(session)
}

/** Inside a transaction an event waits for the commit; outside one it goes straight out. */
function deliver(event: AuditCaptureEvent, session: ClientSession | null | undefined): void {
  const pending = session ? deferred.get(session) : undefined
  if (pending) {
    pending.push(event)
    return
  }
  if (!installed.sink) throw new AuditSinkNotConfiguredError(event.model)
  installed.sink(event)
}

export interface AuditCaptureOptions {
  model: string
  ignoredPaths?: readonly string[]
  sensitivePaths?: readonly string[]
  /** Record every read of this model — the access log HIPAA asks for. */
  phiRead?: boolean
  /** Field holding the clinic id. The Clinic model is its own tenant, so it uses _id. */
  tenantField?: string
}

type Collation = Parameters<Query<unknown, unknown>['collation']>[0]

interface CaptureQueryOptions {
  skipAudit?: boolean
  session?: ClientSession | null
  collation?: Collation
}

const WRITE_HOOKS: MongooseQueryMiddleware[] = [
  'findOneAndUpdate',
  'findOneAndReplace',
  'findOneAndDelete',
  'updateOne',
  'replaceOne',
  'deleteOne',
]
const READ_HOOKS: MongooseQueryMiddleware[] = ['find', 'findOne']
const DELETE_OPERATIONS = new Set(['findOneAndDelete', 'deleteOne'])

/** The plugin's own look-ups must not trip the tenant guard, soft delete, or itself. */
const INTERNAL_READ = { withDeleted: true, bypassTenantGuard: true, skipAudit: true } as const

/**
 * Pre-images keyed by the Query object. Deliberately not query.set(): on a Query,
 * set() adds a path to the UPDATE, which would write the pre-image into the document.
 */
const preImages = new WeakMap<object, PlainObject | null>()

function toPlain(doc: Document): PlainObject {
  return doc.toObject({ depopulate: true, flattenMaps: true, versionKey: false }) as PlainObject
}

function idOf(value: unknown): string | null {
  if (!value || typeof value !== 'object' || !('_id' in value)) return null
  const id = (value as { _id: unknown })._id
  return id === null || id === undefined ? null : String(id)
}

function tenantOf(value: unknown, field: string): string | null {
  if (!value || typeof value !== 'object') return null
  const tenant = (value as Record<string, unknown>)[field]
  return typeof tenant === 'string' ? tenant : null
}

/**
 * Reads on the SAME session as the write. Inside a transaction a read on another
 * session sees the data from outside it, and the diff would be silently wrong.
 */
async function readInternal(
  query: Query<unknown, unknown>,
  filter: FilterQuery<unknown>,
): Promise<PlainObject | null> {
  const options = query.getOptions() as CaptureQueryOptions
  let lookup = query.model.findOne(filter).setOptions(INTERNAL_READ)
  if (options.session) lookup = lookup.session(options.session)
  if (options.collation) lookup = lookup.collation(options.collation)
  const found = await lookup.lean().exec()
  return (found as PlainObject | null) ?? null
}

export function auditCapture(schema: Schema, options: AuditCaptureOptions): void {
  const tenantField = options.tenantField ?? 'clinicId'
  const diffOptions = {
    ignored: options.ignoredPaths ?? [],
    sensitive: options.sensitivePaths ?? [],
  }

  const requireSink = (): AuditSink => {
    if (!installed.sink) throw new AuditSinkNotConfiguredError(options.model)
    return installed.sink
  }

  // ── Writes through a document: create and save ─────────────────────────────
  schema.post<Document>('init', function () {
    this.$locals.auditOriginal = toPlain(this)
  })

  // Checked BEFORE the write, so a missing sink stops the write rather than logging
  // an error after the data has already changed.
  schema.pre<Document>('save', function () {
    requireSink()
    this.$locals.auditWasNew = this.isNew
  })

  schema.post<Document>('save', function () {
    requireSink()
    const session = this.$session()
    const wasNew = this.$locals.auditWasNew === true
    const before = wasNew ? null : ((this.$locals.auditOriginal as PlainObject | undefined) ?? null)
    const after = toPlain(this)
    this.$locals.auditOriginal = after

    const diff = diffDocuments(before, after, diffOptions)
    if (!wasNew && diff.changedPaths.length === 0) return

    deliver(
      {
        model: options.model,
        operation: wasNew ? 'created' : 'updated',
        entityId: idOf(after),
        entityIds: [],
        clinicId: tenantOf(after, tenantField),
        before: diff.before,
        after: diff.after,
        changedPaths: diff.changedPaths,
      },
      session,
    )
  })

  // ── Writes through a query: the diff needs an explicit pre-image ──────────
  schema.pre<Query<unknown, unknown>>(
    WRITE_HOOKS,
    { document: false, query: true },
    async function () {
      if ((this.getOptions() as CaptureQueryOptions).skipAudit) return
      requireSink()
      preImages.set(this, await readInternal(this, this.getFilter()))
    },
  )

  schema.post<Query<unknown, unknown>>(
    WRITE_HOOKS,
    { document: false, query: true },
    async function () {
      const queryOptions = this.getOptions() as CaptureQueryOptions
      if (queryOptions.skipAudit) return
      requireSink()

      const before = preImages.get(this) ?? null
      preImages.delete(this)

      const operationName = (this as unknown as { op?: string }).op ?? ''
      const isDelete = DELETE_OPERATIONS.has(operationName)
      // findOneAndUpdate returns the PRE-update document by default, so the post-image is
      // read explicitly. An upsert that inserted has no pre-image: find it by the filter.
      const after = isDelete
        ? null
        : await readInternal(
            this,
            before ? ({ _id: before._id } as FilterQuery<unknown>) : this.getFilter(),
          )

      if (!before && !after) return // the filter matched nothing and nothing was written

      const diff = diffDocuments(before, after, diffOptions)
      const operation: AuditOperation = !before ? 'created' : isDelete ? 'deleted' : 'updated'
      if (operation === 'updated' && diff.changedPaths.length === 0) return

      const subject = after ?? before
      deliver(
        {
          model: options.model,
          operation,
          entityId: idOf(subject),
          entityIds: [],
          clinicId: tenantOf(subject, tenantField),
          before: diff.before,
          after: diff.after,
          changedPaths: diff.changedPaths,
        },
        queryOptions.session,
      )
    },
  )

  // ── Reads of protected health information ─────────────────────────────────
  if (options.phiRead) {
    schema.post<Query<unknown, unknown>>(
      READ_HOOKS,
      { document: false, query: true },
      function (result: unknown) {
        if ((this.getOptions() as CaptureQueryOptions).skipAudit) return
        const emit = requireSink()

        const documents: unknown[] = Array.isArray(result) ? result : result ? [result] : []
        const ids = documents.map(idOf).filter((id): id is string => id !== null)
        if (ids.length === 0) return

        // The id of what was viewed, never the payload. Not deferred: a read inside a
        // transaction that later rolls back still showed the record to someone.
        emit({
          model: options.model,
          operation: 'viewed',
          entityId: ids.length === 1 ? (ids[0] ?? null) : null,
          entityIds: ids,
          clinicId: tenantOf(documents[0], tenantField),
          before: null,
          after: null,
          changedPaths: [],
        })
      },
    )
  }
}
