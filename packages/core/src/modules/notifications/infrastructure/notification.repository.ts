import { NotificationModel, UserModel, newId } from '@clinic/db'
import { NOTIFICATION_RETENTION_DAYS } from '@clinic/config'
import type { NotificationChannel, NotificationStatus, NotificationType } from '@clinic/config'
import type { StoredPreference } from '../domain/preferences'
import {
  decodeCursor,
  keysetAfter,
  pageFrom,
  sortFor,
  type Page,
  type SortKey,
} from '../../../pagination'

export interface StoredNotification {
  id: string
  userId: string
  type: NotificationType
  title: string
  body: string
  href: string | null
  isRead: boolean
  createdAt: Date
  readAt: Date | null
  channels: Array<{ channel: NotificationChannel; status: NotificationStatus }>
}

interface NotificationRecord {
  _id: string
  userId: string
  type: NotificationType
  title: string
  body: string
  href?: string | null
  isRead?: boolean
  createdAt?: Date | null
  readAt?: Date | null
  channels?: Array<{ channel: NotificationChannel; status?: NotificationStatus }>
}

const toNotification = (doc: NotificationRecord): StoredNotification => ({
  id: doc._id,
  userId: doc.userId,
  type: doc.type,
  title: doc.title,
  body: doc.body,
  href: doc.href ?? null,
  isRead: doc.isRead ?? false,
  createdAt: doc.createdAt ?? new Date(0),
  readAt: doc.readAt ?? null,
  channels: (doc.channels ?? []).map((entry) => ({
    channel: entry.channel,
    status: entry.status ?? 'PENDING',
  })),
})

/** A MongoDB duplicate-key error, whatever wrapper it arrives in. */
const isDuplicateKey = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000

const FEED_ORDER: readonly SortKey[] = [
  { field: 'createdAt', direction: -1, kind: 'date' },
  { field: '_id', direction: -1, kind: 'string' },
]

export const notificationRepository = {
  /**
   * Creates the notification, or returns null because it already exists.
   *
   * **Null is the ordinary outcome, not an error.** At-least-once delivery means a handler will
   * run twice sooner or later; the unique index on (clinicId, dedupeKey) is what turns the second
   * run into a no-op rather than a second email. The caller does not retry — it stops
   * (ADR-0030).
   */
  async create(input: {
    clinicId: string
    userId: string
    type: NotificationType
    title: string
    body: string
    href: string | null
    entity: { type: string | null; id: string | null }
    channels: NotificationChannel[]
    dedupeKey: string
  }): Promise<StoredNotification | null> {
    try {
      const doc = await NotificationModel().create({
        _id: newId(),
        ...input,
        channels: input.channels.map((channel) => ({ channel, status: 'PENDING' })),
      })
      return toNotification(doc.toObject() as NotificationRecord)
    } catch (error) {
      if (isDuplicateKey(error)) return null
      throw error
    }
  },

  /** Records what happened on one channel. Delivery is per channel, never per notification. */
  async markChannel(
    clinicId: string,
    notificationId: string,
    channel: NotificationChannel,
    status: NotificationStatus,
    error: string | null = null,
  ): Promise<void> {
    await NotificationModel().updateOne(
      { clinicId, _id: notificationId },
      {
        $set: {
          'channels.$[c].status': status,
          'channels.$[c].sentAt': status === 'SENT' ? new Date() : null,
          'channels.$[c].error': error ? error.slice(0, 300) : null,
        },
      },
      { arrayFilters: [{ 'c.channel': channel }] },
    )
  },

  /** A page of the bell, newest first. Before Phase 10 there was only ever the first page. */
  async listFor(
    clinicId: string,
    userId: string,
    options: { unreadOnly: boolean; limit: number; cursor?: string },
  ): Promise<Page<StoredNotification>> {
    const filter: Record<string, unknown> = { clinicId, userId }
    if (options.unreadOnly) filter.isRead = false
    if (options.cursor) {
      filter.$and = [keysetAfter(FEED_ORDER, decodeCursor(options.cursor, FEED_ORDER.length))]
    }
    const docs = (await NotificationModel()
      .find(filter)
      .sort(sortFor(FEED_ORDER))
      .limit(options.limit + 1)
      .lean()) as unknown as Array<NotificationRecord & Record<string, unknown>>
    const { docs: rows, nextCursor } = pageFrom(docs, options.limit, FEED_ORDER)
    return { items: rows.map(toNotification), nextCursor }
  },

  async countUnread(clinicId: string, userId: string): Promise<number> {
    return NotificationModel().countDocuments({ clinicId, userId, isRead: false })
  },

  /**
   * Marks notifications read. An empty `ids` marks everything, which is the bell's "clear all".
   *
   * Reading one sets `expiresAt`, and the TTL index reclaims it ninety days later — a nightly
   * job the database runs for us rather than one that can silently stop (section 8.16).
   */
  async markRead(clinicId: string, userId: string, ids: string[]): Promise<number> {
    const now = new Date()
    const expiresAt = new Date(now.getTime() + NOTIFICATION_RETENTION_DAYS * 86_400_000)
    const filter: Record<string, unknown> = { clinicId, userId, isRead: false }
    if (ids.length > 0) filter._id = { $in: ids }

    const result = await NotificationModel().updateMany(filter, {
      $set: { isRead: true, readAt: now, expiresAt },
    })
    return result.modifiedCount
  },
}

/**
 * Notification preferences live on the user document (section 8.12), so this reaches into the
 * users collection rather than owning one of its own — the only cross-collection read in the
 * module, and the reason it is here rather than in a repository of its own.
 */
export const preferenceRepository = {
  async read(clinicId: string, userId: string): Promise<StoredPreference[]> {
    const doc = (await UserModel()
      .findOne({ clinicId, _id: userId })
      .select({ notificationPreferences: 1 })
      .setOptions({ skipAudit: true })
      .lean()) as { notificationPreferences?: StoredPreference[] } | null
    return doc?.notificationPreferences ?? []
  },

  async write(clinicId: string, userId: string, preferences: StoredPreference[]): Promise<boolean> {
    const result = await UserModel().updateOne(
      { clinicId, _id: userId },
      { $set: { notificationPreferences: preferences } },
    )
    return result.matchedCount > 0
  },

  /** Who to tell, with their preferences and address, in one read. */
  async recipients(
    clinicId: string,
    userIds: string[],
  ): Promise<
    Map<string, { id: string; email: string; firstName: string; preferences: StoredPreference[] }>
  > {
    if (userIds.length === 0) return new Map()
    const docs = (await UserModel()
      .find({ clinicId, _id: { $in: userIds }, status: 'ACTIVE' })
      .select({ email: 1, firstName: 1, notificationPreferences: 1 })
      .setOptions({ skipAudit: true })
      .lean()) as Array<{
      _id: string
      email: string
      firstName?: string
      notificationPreferences?: StoredPreference[]
    }>

    return new Map(
      docs.map((doc) => [
        doc._id,
        {
          id: doc._id,
          email: doc.email,
          firstName: doc.firstName ?? '',
          preferences: doc.notificationPreferences ?? [],
        },
      ]),
    )
  },
}
