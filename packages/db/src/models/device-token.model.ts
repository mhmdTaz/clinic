import { Schema, type InferSchemaType, type Model } from 'mongoose'
import { idField } from '../id'
import { getConnection } from '../connection'
import { tenantGuard } from '../plugins/tenant-guard'
import { auditCapture } from '../plugins/audit-capture'

/**
 * A device that has asked to be told things (§9.4).
 *
 * **The token is the identity, not the device.** A push token is reissued when an app is
 * reinstalled, restored from a backup, or simply because the platform felt like it — and the same
 * token can move to a different user when a phone is handed over. So the unique key is the token
 * itself, and registering an existing token **reassigns** it rather than creating a second row.
 * Without that, a shared phone keeps pushing one person's appointment reminders to the next.
 *
 * There is no soft delete here. A revoked device should stop receiving immediately and leave
 * nothing behind that a later bug could resurrect; the audit log records that it was removed,
 * which is where that history belongs.
 */
export const DeviceTokenSchema = new Schema(
  {
    _id: idField,
    clinicId: { type: String, required: true },
    userId: { type: String, required: true },

    /** The platform's address for this installation, e.g. `ExponentPushToken[...]`. */
    token: { type: String, required: true },
    platform: { type: String, enum: ['ios', 'android', 'web'], required: true },
    /** What the person sees in "your devices" — "Pixel 7", not a token. */
    deviceName: { type: String, default: null },
    /** The app build, so a delivery failure can be traced to a version. */
    appVersion: { type: String, default: null },

    /**
     * When the app last proved this token still works by registering it again.
     *
     * Apps re-register on every launch, so a token untouched for months belongs to an app nobody
     * opens. Stale rows are what turn a push batch into mostly failures.
     */
    lastSeenAt: { type: Date, default: Date.now },
    /** Set when the relay says DeviceNotRegistered, so the next sweep can drop it. */
    failedAt: { type: Date, default: null },
    failureReason: { type: String, default: null },
  },
  { timestamps: true, collection: 'deviceTokens' },
)

DeviceTokenSchema.plugin(tenantGuard)
// Registering a device is somebody attaching a new address to their account, which belongs in
// the log for the same reason a new session does.
DeviceTokenSchema.plugin(auditCapture, {
  model: 'DeviceToken',
  // The token is a credential-shaped secret: the log records that a device was added, never
  // which address it was added at.
  sensitivePaths: ['token'],
  ignoredPaths: ['lastSeenAt'],
})

// One row per token, whoever it currently belongs to. Re-registering reassigns.
DeviceTokenSchema.index({ clinicId: 1, token: 1 }, { unique: true })
DeviceTokenSchema.index({ clinicId: 1, userId: 1, lastSeenAt: -1 })

export type DeviceTokenDoc = InferSchemaType<typeof DeviceTokenSchema> & { _id: string }

export const DeviceTokenModel = (): Model<DeviceTokenDoc> =>
  getConnection().models.DeviceToken ??
  getConnection().model<DeviceTokenDoc>('DeviceToken', DeviceTokenSchema)
