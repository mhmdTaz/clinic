import type { Aggregate, MongooseQueryMiddleware, Query, Schema } from 'mongoose'
import { MissingTenantFieldError, MissingTenantFilterError } from '../errors'

/**
 * The replacement for Postgres row-level security (section 8.15).
 *
 * It THROWS when a tenant-scoped query omits clinicId. It deliberately does not
 * quietly inject one: a silent injection hides the bug and trains developers to stop
 * thinking about tenancy. A loud failure in development is the point.
 */
const GUARDED_QUERY_HOOKS: MongooseQueryMiddleware[] = [
  'find',
  'findOne',
  'findOneAndDelete',
  'findOneAndReplace',
  'findOneAndUpdate',
  'countDocuments',
  'distinct',
  'updateOne',
  'updateMany',
  'deleteOne',
  'deleteMany',
  'replaceOne',
]

type FilterLike = Record<string, unknown>
type GuardOptions = { bypassTenantGuard?: boolean }

/** True when this filter constrains clinicId on every branch it could match. */
export function filterHasTenant(filter: unknown): boolean {
  if (!filter || typeof filter !== 'object') return false
  const f = filter as FilterLike

  if (f.clinicId !== undefined) return true

  // $and: one branch carrying clinicId is enough — it narrows the whole conjunction.
  if (Array.isArray(f.$and) && f.$and.some((branch) => filterHasTenant(branch))) return true

  // $or / $nor: EVERY branch must carry it, or one branch escapes the tenant.
  for (const key of ['$or', '$nor'] as const) {
    const branches = f[key]
    if (Array.isArray(branches) && branches.length > 0 && branches.every((b) => filterHasTenant(b)))
      return true
  }

  return false
}

export function tenantGuard(schema: Schema): void {
  // { document: false, query: true } matters: updateOne and deleteOne exist as BOTH
  // query and document middleware, and the document variant has no filter to inspect.
  schema.pre<Query<unknown, unknown>>(
    GUARDED_QUERY_HOOKS,
    { document: false, query: true },
    function () {
      const options = this.getOptions() as GuardOptions
      if (options?.bypassTenantGuard === true) return
      if (filterHasTenant(this.getFilter())) return
      const op = (this as unknown as { op?: string }).op ?? 'query'
      throw new MissingTenantFilterError(this.model?.modelName ?? 'unknown', op)
    },
  )

  schema.pre<Aggregate<unknown>>('aggregate', function () {
    const options = this.options as GuardOptions | undefined
    if (options?.bypassTenantGuard === true) return
    const first = this.pipeline()[0] as { $match?: unknown } | undefined
    if (first?.$match && filterHasTenant(first.$match)) return
    throw new MissingTenantFilterError(this.model()?.modelName ?? 'unknown', 'aggregate')
  })

  schema.pre<{ clinicId?: string; constructor: { name?: string } }>('save', function () {
    if (!this.clinicId) throw new MissingTenantFieldError(this.constructor?.name ?? 'unknown')
  })
}
