import { Schema, type InferSchemaType, type Model } from 'mongoose'
import { NOTIFICATION_CHANNELS, NOTIFICATION_STATUSES, NOTIFICATION_TYPES } from '@clinic/config'
import { idField } from '../id'
import { getConnection } from '../connection'
import { tenantGuard } from '../plugins/tenant-guard'

/**
 * One thing that happened, told to one person (section 8.12).
 *
 * **`dedupeKey` is what makes at-least-once delivery safe.** A reminder's key is
 * `reminder:<appointmentId>:24`, computed from the facts rather than from the attempt, so a job
 * that retries after a timeout it actually survived computes the same key and loses on the unique
 * index. The same shape as a payment's idempotency key (ADR-0028), applied to the one other place
 * in the system where doing the work twice is worse than not doing it.
 *
 * Delivery is tracked **per channel**: IN_APP is a row in our own database and EMAIL depends on
 * somebody else's server, so a single status would have to mean two different things at once.
 *
 * Not audited. A notification is a consequence of an audited change, never a change of its own,
 * and reading one's own bell is not an event anybody needs a record of.
 */
export const NotificationSchema = new Schema(
  {
    _id: idField,
    clinicId: { type: String, required: true },
    /** Who is being told. Always a user account — a notification needs somewhere to land. */
    userId: { type: String, required: true },

    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    title: { type: String, required: true },
    body: { type: String, required: true },
    /** Relative, because it is opened inside the app rather than followed from an email. */
    href: { type: String, default: null },

    /** What the notification is about, so a screen can link back to it. */
    entity: {
      type: { type: String, default: null },
      id: { type: String, default: null },
    },

    channels: [
      {
        _id: false,
        channel: { type: String, enum: NOTIFICATION_CHANNELS, required: true },
        status: { type: String, enum: NOTIFICATION_STATUSES, default: 'PENDING' },
        sentAt: { type: Date, default: null },
        error: { type: String, default: null },
      },
    ],

    isRead: { type: Boolean, default: false },
    readAt: { type: Date, default: null },

    /** The idempotency key. Unique per clinic; see the note above. */
    dedupeKey: { type: String, required: true },
    /** Set when it is read; the TTL index reclaims it 90 days later (section 8.16). */
    expiresAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'notifications' },
)

NotificationSchema.plugin(tenantGuard)

// The guard: one notification per thing-that-happened, however many times a job runs.
NotificationSchema.index({ clinicId: 1, dedupeKey: 1 }, { unique: true })
NotificationSchema.index({ clinicId: 1, userId: 1, createdAt: -1 }) // the bell
NotificationSchema.index({ clinicId: 1, userId: 1, isRead: 1 }) // the unread count
NotificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export type NotificationDoc = InferSchemaType<typeof NotificationSchema> & { _id: string }

export const NotificationModel = (): Model<NotificationDoc> =>
  getConnection().models.Notification ??
  getConnection().model<NotificationDoc>('Notification', NotificationSchema)
