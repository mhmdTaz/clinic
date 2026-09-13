import type {
  MarkNotificationsReadRequest,
  Notification,
  NotificationFeed,
  NotificationListQuery,
  NotificationPreferenceRow,
  SetNotificationPreferencesRequest,
} from '@clinic/contracts'
import { NotFoundError } from '../../../errors'
import type { Actor } from '../../access'
import { preferenceRows, toStoredPreferences } from '../domain/preferences'
import {
  notificationRepository,
  preferenceRepository,
  type StoredNotification,
} from '../infrastructure/notification.repository'

const toNotification = (row: StoredNotification): Notification => ({
  id: row.id,
  type: row.type,
  title: row.title,
  body: row.body,
  href: row.href,
  isRead: row.isRead,
  createdAt: row.createdAt.toISOString(),
  readAt: row.readAt ? row.readAt.toISOString() : null,
})

/**
 * A person's own bell (section 8.12).
 *
 * No permission check anywhere in this file, deliberately: a notification is addressed to one
 * user by id, and the only id any of these functions will read is the caller's own. There is no
 * parameter through which somebody could ask for another person's, so there is nothing for a
 * permission to gate.
 */
export async function notificationFeed(
  actor: Actor,
  query: Partial<NotificationListQuery>,
): Promise<NotificationFeed & { nextCursor: string | null }> {
  const [page, unreadCount] = await Promise.all([
    notificationRepository.listFor(actor.clinicId, actor.userId, {
      unreadOnly: query.unreadOnly ?? false,
      limit: Math.min(50, Math.max(1, query.limit ?? 20)),
      cursor: query.cursor,
    }),
    notificationRepository.countUnread(actor.clinicId, actor.userId),
  ])
  return { items: page.items.map(toNotification), unreadCount, nextCursor: page.nextCursor }
}

export async function markNotificationsRead(
  actor: Actor,
  input: MarkNotificationsReadRequest,
): Promise<{ read: number; unreadCount: number }> {
  const read = await notificationRepository.markRead(actor.clinicId, actor.userId, input.ids)
  const unreadCount = await notificationRepository.countUnread(actor.clinicId, actor.userId)
  return { read, unreadCount }
}

export async function getNotificationPreferences(
  actor: Actor,
): Promise<NotificationPreferenceRow[]> {
  const stored = await preferenceRepository.read(actor.clinicId, actor.userId)
  return preferenceRows(stored)
}

/**
 * Saving the preferences screen. Only the exceptions are stored — see the domain note — so a
 * default that changes later actually reaches people who never opened this screen, and a locked
 * type is dropped rather than quietly accepted and ignored.
 */
export async function setNotificationPreferences(
  actor: Actor,
  input: SetNotificationPreferencesRequest,
): Promise<NotificationPreferenceRow[]> {
  const stored = toStoredPreferences(input.preferences)
  const saved = await preferenceRepository.write(actor.clinicId, actor.userId, stored)
  if (!saved) throw new NotFoundError('User')
  return preferenceRows(stored)
}
