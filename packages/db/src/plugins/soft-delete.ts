import type { MongooseQueryMiddleware, Query, Schema } from 'mongoose'

/**
 * Medical and financial records are never hard-deleted (section 8.3). This adds
 * `deletedAt` and filters it out of every read unless the caller opts in with
 * .setOptions({ withDeleted: true }).
 *
 * Note the interaction with unique indexes: any unique index on a soft-deletable
 * model needs partialFilterExpression: { deletedAt: null }, or a deactivated user
 * reserves their email address forever.
 */
const READ_HOOKS: MongooseQueryMiddleware[] = ['find', 'findOne', 'countDocuments', 'distinct']

export function softDelete(schema: Schema): void {
  schema.add({ deletedAt: { type: Date, default: null } })
  schema.index({ deletedAt: 1 })

  schema.pre<Query<unknown, unknown>>(READ_HOOKS, { document: false, query: true }, function () {
    const options = this.getOptions() as { withDeleted?: boolean }
    if (options?.withDeleted === true) return
    if (this.getFilter().deletedAt === undefined) this.where({ deletedAt: null })
  })
}
