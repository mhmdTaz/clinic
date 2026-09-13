import { randomBytes } from 'node:crypto'
import { IdempotencyKeyModel } from '@clinic/db'

/**
 * The claims on idempotency keys. Every write is conditional on the claim token, so a request
 * whose lease was taken over cannot later write its answer over the request that replaced it.
 */

export interface StoredKey {
  id: string
  state: 'IN_FLIGHT' | 'DONE'
  fingerprint: string
  lockedUntil: Date | null
  claimToken: string | null
  responseStatus: number | null
  responseBody: unknown
}

const isDuplicateKey = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 11000

const newToken = (): string => randomBytes(18).toString('base64url')

function toStored(doc: Record<string, unknown>): StoredKey {
  return {
    id: String(doc._id),
    state: doc.state as StoredKey['state'],
    fingerprint: String(doc.fingerprint),
    lockedUntil: (doc.lockedUntil as Date | null) ?? null,
    claimToken: (doc.claimToken as string | null) ?? null,
    responseStatus: (doc.responseStatus as number | null) ?? null,
    responseBody: doc.responseBody ?? null,
  }
}

export const idempotencyRepository = {
  /**
   * Claims a key by inserting it. The unique index is the lock: of two requests racing with the
   * same key, exactly one insert succeeds. Returns the claim token, or null if the key exists.
   */
  async claim(input: {
    clinicId: string
    scope: string
    key: string
    fingerprint: string
    lockedUntil: Date
    expiresAt: Date
  }): Promise<{ id: string; claimToken: string } | null> {
    const claimToken = newToken()
    try {
      const doc = await IdempotencyKeyModel().create({
        clinicId: input.clinicId,
        scope: input.scope,
        key: input.key,
        fingerprint: input.fingerprint,
        claimToken,
        state: 'IN_FLIGHT',
        lockedUntil: input.lockedUntil,
        responseStatus: null,
        responseBody: null,
        expiresAt: input.expiresAt,
      })
      return { id: String(doc._id), claimToken }
    } catch (error) {
      if (isDuplicateKey(error)) return null
      throw error
    }
  },

  async find(clinicId: string, scope: string, key: string): Promise<StoredKey | null> {
    const doc = await IdempotencyKeyModel().findOne({ clinicId, scope, key }).lean()
    return doc ? toStored(doc as unknown as Record<string, unknown>) : null
  },

  /**
   * Takes over a claim whose lease has run out. Conditional on the lease still being the expired
   * one, so two retries arriving together cannot both take it.
   */
  async takeOver(
    clinicId: string,
    id: string,
    expiredLease: Date | null,
    lockedUntil: Date,
  ): Promise<{ id: string; claimToken: string } | null> {
    const claimToken = newToken()
    const result = await IdempotencyKeyModel().updateOne(
      { clinicId, _id: id, state: 'IN_FLIGHT', lockedUntil: expiredLease },
      { $set: { claimToken, lockedUntil } },
    )
    return result.modifiedCount === 1 ? { id, claimToken } : null
  },

  /** Records the answer. Ignored if the claim was taken over in the meantime. */
  async complete(
    clinicId: string,
    id: string,
    claimToken: string,
    response: { status: number; body: unknown },
  ): Promise<boolean> {
    const result = await IdempotencyKeyModel().updateOne(
      { clinicId, _id: id, claimToken, state: 'IN_FLIGHT' },
      {
        $set: {
          state: 'DONE',
          lockedUntil: null,
          responseStatus: response.status,
          // A plain JSON copy: what is replayed is exactly what was sent, not a live object.
          responseBody: JSON.parse(JSON.stringify(response.body ?? null)) as unknown,
        },
      },
    )
    return result.modifiedCount === 1
  },

  /** Gives a key back after a failure that is not an answer, so a retry runs again. */
  async release(clinicId: string, id: string, claimToken: string): Promise<void> {
    await IdempotencyKeyModel().deleteOne({ clinicId, _id: id, claimToken, state: 'IN_FLIGHT' })
  },
}
