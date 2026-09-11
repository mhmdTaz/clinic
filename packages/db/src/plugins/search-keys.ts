import type { Document, MongooseQueryMiddleware, Query, Schema } from 'mongoose'

/**
 * Keeps normalised search keys in step with the fields they are derived from (section 8.14),
 * on every write path a model has: create and save, and query updates through $set,
 * $setOnInsert and $unset, whether the field is written dotted or nested. Use cases never
 * compute a key, so no write path can forget to.
 *
 * Pipeline updates are left alone: none of them writes a name, an email or a phone number.
 * Bulk inserts bypass middleware entirely and are confined to repositories (section 8.15).
 */
export type KeyFunction = (value: string | null | undefined) => string | null

export interface SearchKeyOptions {
  /** Key path -> the field it is derived from and how. */
  keys: Record<string, { from: string; key: KeyFunction }>
}

const UPDATE_HOOKS: MongooseQueryMiddleware[] = [
  'findOneAndUpdate',
  'updateOne',
  'updateMany',
  'findOneAndReplace',
  'replaceOne',
]

type Plain = Record<string, unknown>

function isPlain(value: unknown): value is Plain {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Finds `path` in an update object that may spell it "contact.phone" or { contact: { phone } }. */
function lookup(target: Plain, path: string): { found: boolean; value: unknown } {
  if (Object.prototype.hasOwnProperty.call(target, path))
    return { found: true, value: target[path] }
  const [head, ...rest] = path.split('.')
  if (!head || rest.length === 0) return { found: false, value: undefined }
  const child = target[head]
  return isPlain(child) ? lookup(child, rest.join('.')) : { found: false, value: undefined }
}

const asText = (value: unknown): string | null => (typeof value === 'string' ? value : null)

export function searchKeys(schema: Schema, options: SearchKeyOptions): void {
  const entries = Object.entries(options.keys)

  const refresh = function (this: Document) {
    for (const [path, spec] of entries) this.set(path, spec.key(asText(this.get(spec.from))))
  }
  schema.pre<Document>('validate', refresh)
  schema.pre<Document>('save', refresh)

  schema.pre<Query<unknown, unknown>>(UPDATE_HOOKS, { document: false, query: true }, function () {
    const update = this.getUpdate()
    if (!isPlain(update)) return

    const operation = (this as unknown as { op?: string }).op ?? ''
    if (operation === 'replaceOne' || operation === 'findOneAndReplace') {
      for (const [path, spec] of entries) {
        const source = lookup(update, spec.from)
        update[path] = spec.key(asText(source.value))
      }
      this.setUpdate(update)
      return
    }

    // Plain top-level fields are an implicit $set in Mongoose.
    const implicit: Plain = Object.fromEntries(
      Object.entries(update).filter(([key]) => !key.startsWith('$')),
    )

    for (const [path, spec] of entries) {
      for (const operator of ['$set', '$setOnInsert'] as const) {
        const target = update[operator]
        if (!isPlain(target)) continue
        const source = lookup(target, spec.from)
        if (source.found) target[path] = spec.key(asText(source.value))
      }

      const direct = lookup(implicit, spec.from)
      if (direct.found) update[path] = spec.key(asText(direct.value))

      const unset = update.$unset
      if (isPlain(unset) && lookup(unset, spec.from).found) unset[path] = ''
    }
    this.setUpdate(update)
  })
}
