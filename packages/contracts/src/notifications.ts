import { z } from 'zod'

/**
 * Contracts for notifications (section 8.12).
 *
 * A notification is one thing that happened, delivered to one person through one or more
 * channels. Delivery is tracked **per channel** rather than per notification, because IN_APP is a
 * row in our own database and EMAIL depends on somebody else's server: collapsing them into a
 * single status would make "sent" mean two different things.
 */

export const NotificationChannel = z.enum(['IN_APP', 'EMAIL', 'PUSH'])
export type NotificationChannel = z.infer<typeof NotificationChannel>

export const NotificationType = z.enum([
  'APPOINTMENT_CONFIRMED',
  'APPOINTMENT_REMINDER',
  'APPOINTMENT_CANCELLED',
  'INVOICE_ISSUED',
  'PAYMENT_RECEIVED',
  'TICKET_REPLY',
  'TICKET_ASSIGNED',
  'STOCK_LOW',
  'AUDIT_CHAIN_BROKEN',
])
export type NotificationType = z.infer<typeof NotificationType>

export const Notification = z.object({
  id: z.string(),
  type: NotificationType,
  title: z.string(),
  body: z.string(),
  /** Where the notification points; relative, because it is opened inside the app. */
  href: z.string().nullable(),
  isRead: z.boolean(),
  createdAt: z.string().datetime(),
  readAt: z.string().datetime().nullable(),
})
export type Notification = z.infer<typeof Notification>

export const NotificationListQuery = z.object({
  unreadOnly: z.coerce.boolean().default(false),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  /** Older notifications, from the `nextCursor` of the page before. */
  cursor: z.string().optional(),
})
export type NotificationListQuery = z.infer<typeof NotificationListQuery>

export const NotificationFeed = z.object({
  items: z.array(Notification),
  unreadCount: z.number(),
})
export type NotificationFeed = z.infer<typeof NotificationFeed>

export const MarkNotificationsReadRequest = z.object({
  /** Empty marks everything read — the "clear all" the bell offers. */
  ids: z.array(z.string().max(64)).max(50).default([]),
})
export type MarkNotificationsReadRequest = z.infer<typeof MarkNotificationsReadRequest>

/**
 * What a person wants to hear about, and how.
 *
 * Stored as an array of exceptions rather than a full matrix: absent means the channel's default
 * applies, so adding a notification type later does not need a migration over every user.
 */
export const NotificationPreference = z.object({
  type: NotificationType,
  channel: NotificationChannel,
  enabled: z.boolean(),
})
export type NotificationPreference = z.infer<typeof NotificationPreference>

export const SetNotificationPreferencesRequest = z.object({
  preferences: z.array(NotificationPreference).max(40),
})
export type SetNotificationPreferencesRequest = z.infer<typeof SetNotificationPreferencesRequest>

/** A row of the preferences screen: what it is, and the state of each channel. */
export const NotificationPreferenceRow = z.object({
  type: NotificationType,
  inApp: z.boolean(),
  email: z.boolean(),
  /** Some notifications cannot be turned off — a cancelled appointment is not optional. */
  isLocked: z.boolean(),
})
export type NotificationPreferenceRow = z.infer<typeof NotificationPreferenceRow>

// ── Devices (§9.4) ───────────────────────────────────────────────────────────

export const DevicePlatform = z.enum(['ios', 'android', 'web'])
export type DevicePlatform = z.infer<typeof DevicePlatform>

/**
 * Registering a device for push.
 *
 * The app calls this on every launch, not once: a push token is reissued on reinstall, on a
 * restore from backup, and sometimes for no reason the app is told. Registration is therefore an
 * upsert keyed on the token — which also reassigns a handed-over phone to whoever is signed in
 * now, instead of pushing the previous owner's appointments to them.
 */
export const RegisterDeviceRequest = z.object({
  token: z.string().min(8).max(256),
  platform: DevicePlatform,
  deviceName: z.string().trim().max(80).nullish(),
  appVersion: z.string().trim().max(40).nullish(),
})
export type RegisterDeviceRequest = z.infer<typeof RegisterDeviceRequest>

export const RegisteredDevice = z.object({
  id: z.string(),
  platform: DevicePlatform,
  deviceName: z.string().nullable(),
  appVersion: z.string().nullable(),
  lastSeenAt: z.string().datetime(),
  /** Never the token itself: it is a credential-shaped secret and a list is not a place for one. */
  isThisDevice: z.boolean(),
})
export type RegisteredDevice = z.infer<typeof RegisteredDevice>
