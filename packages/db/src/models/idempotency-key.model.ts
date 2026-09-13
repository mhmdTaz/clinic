import { Schema, type InferSchemaType, type Model } from 'mongoose'
import { idField } from '../id'
import { getConnection } from '../connection'
import { tenantGuard } from '../plugins/tenant-guard'

/**
 * A request somebody has promised to send only once (§9.2, Phase 10).
 *
 * A client that sends `Idempotency-Key` on a booking or a payment is saying "if you see this key
 * again, it is the same request — a retry after a lost response, a second tap". The first request
 * claims the key; the response it produced is kept here; a retry is given that response back
 * instead of doing the work twice.
 *
 * Why a collection of its own rather than a unique key on each target document, as payments have
 * (ADR-0028): a booking's retry must return **the appointment it made**, and a refused booking's
 * retry the same refusal. A unique index can stop a second write; it cannot say what the first
 * one answered.
 *
 * Deliberately not audited. The work a key protects is audited where it happens; the key itself
 * is plumbing, and an entry per retry would bury the events the log exists to show.
 */
export const IdempotencyKeySchema = new Schema(
  {
    _id: idField,
    clinicId: { type: String, required: true },
    /** Who sent it and to what: `user:<id> POST /api/v1/me/appointments`. A key is only ever
     *  matched within its scope, so two people — or two routes — cannot collide. */
    scope: { type: String, required: true },
    key: { type: String, required: true },
    /** A hash of the validated body. The same key with a different body is a client bug, and
     *  replaying the first answer to it would be quietly wrong. */
    fingerprint: { type: String, required: true },
    /** Who holds the claim. Every later write is conditional on it, so a request whose lease was
     *  taken over cannot write its answer over the one that replaced it. */
    claimToken: { type: String, default: null },

    state: { type: String, enum: ['IN_FLIGHT', 'DONE'], required: true },
    /** While in flight: how long the claim holds before a crashed request's key is taken over. */
    lockedUntil: { type: Date, default: null },

    /** The response to replay, once done. */
    responseStatus: { type: Number, default: null },
    responseBody: { type: Schema.Types.Mixed, default: null },

    /** When the TTL index removes it. A retry a day later is a new request. */
    expiresAt: { type: Date, required: true },
  },
  // `minimize: false` so a response body of `{}` survives the round trip rather than coming back
  // as undefined.
  { timestamps: true, collection: 'idempotencyKeys', minimize: false },
)

IdempotencyKeySchema.plugin(tenantGuard)

IdempotencyKeySchema.index({ clinicId: 1, scope: 1, key: 1 }, { unique: true })
IdempotencyKeySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export type IdempotencyKeyDoc = InferSchemaType<typeof IdempotencyKeySchema> & { _id: string }

export const IdempotencyKeyModel = (): Model<IdempotencyKeyDoc> =>
  getConnection().models.IdempotencyKey ??
  getConnection().model<IdempotencyKeyDoc>('IdempotencyKey', IdempotencyKeySchema)
