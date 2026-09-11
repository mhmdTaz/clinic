import { getConnection } from './connection'

/**
 * MongoDB has no SERIAL, and human-facing numbers (INV-2026-000318, MRN-000142,
 * TKT-001204) have to be gapless-ish and unique (section 8.15).
 *
 * findOneAndUpdate with $inc is atomic on a single document, so this is safe under
 * concurrency without a transaction.
 */
export async function nextSequence(scope: string): Promise<number> {
  const conn = getConnection()
  const result = await conn
    .collection<{ _id: string; seq: number }>('counters')
    .findOneAndUpdate(
      { _id: scope },
      { $inc: { seq: 1 } },
      { returnDocument: 'after', upsert: true },
    )
  if (!result) throw new Error(`Failed to allocate a sequence number for "${scope}"`)
  return result.seq
}

export async function nextFormatted(scope: string, prefix: string, padding = 6): Promise<string> {
  const seq = await nextSequence(scope)
  return `${prefix}-${String(seq).padStart(padding, '0')}`
}
