import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_TYPES,
  type NotificationChannel,
  type NotificationType,
} from '@clinic/config'

/**
 * What somebody hears about, and how (section 8.12).
 *
 * Preferences are stored as a list of **exceptions**, not a full matrix. A user document carries
 * only the switches that differ from the defaults below, so adding a notification type later
 * needs no migration over every user — and a person who has never opened the preferences screen
 * has an empty array rather than a snapshot of whatever the defaults were on the day they
 * signed up.
 */

/** Channels a type reaches by default when nobody has said otherwise. */
const DEFAULTS: Readonly<Record<NotificationType, readonly NotificationChannel[]>> = {
  // Things about an appointment reach a patient both ways: the in-app row is the record, and the
  // email is what actually gets read.
  APPOINTMENT_CONFIRMED: ['IN_APP', 'EMAIL', 'PUSH'],
  // The flagship reason to have the app at all: a reminder that arrives as a buzz rather than as
  // an email somebody reads the following Tuesday.
  APPOINTMENT_REMINDER: ['IN_APP', 'EMAIL', 'PUSH'],
  APPOINTMENT_CANCELLED: ['IN_APP', 'EMAIL', 'PUSH'],
  // Money is not urgent and a push about it is intrusive. In the app and in the inbox is enough.
  INVOICE_ISSUED: ['IN_APP', 'EMAIL'],
  PAYMENT_RECEIVED: ['IN_APP'],
  TICKET_REPLY: ['IN_APP', 'EMAIL', 'PUSH'],
  // Clinic-side noise: it belongs in the bell, not in somebody's inbox.
  TICKET_ASSIGNED: ['IN_APP'],
  STOCK_LOW: ['IN_APP'],
  // A tamper alert goes both ways: the bell is the record, the email is what reaches somebody
  // who is not looking at the admin portal at 2am.
  AUDIT_CHAIN_BROKEN: ['IN_APP', 'EMAIL', 'PUSH'],
}

/**
 * What cannot be switched off.
 *
 * A cancelled appointment is not a marketing message: somebody who turned it off would turn up
 * to a closed door. The preferences screen shows these as locked rather than hiding them, so
 * nobody is left wondering why their toggle did nothing.
 */
const LOCKED: ReadonlySet<NotificationType> = new Set([
  'APPOINTMENT_CANCELLED',
  // An alert somebody can mute is an alert that will be muted. If the audit chain has broken,
  // every person who can read the log hears about it.
  'AUDIT_CHAIN_BROKEN',
])

export interface StoredPreference {
  type: NotificationType
  channel: NotificationChannel
  enabled: boolean
}

export const isLocked = (type: NotificationType): boolean => LOCKED.has(type)

export const defaultChannels = (type: NotificationType): readonly NotificationChannel[] =>
  DEFAULTS[type] ?? ['IN_APP']

/** Whether this person wants this type on this channel, defaults and locks applied. */
export function wantsChannel(
  preferences: readonly StoredPreference[],
  type: NotificationType,
  channel: NotificationChannel,
): boolean {
  if (isLocked(type)) return defaultChannels(type).includes(channel)
  const set = preferences.find(
    (preference) => preference.type === type && preference.channel === channel,
  )
  return set ? set.enabled : defaultChannels(type).includes(channel)
}

/** Which channels a notification of this type should actually go out on. */
export function channelsFor(
  preferences: readonly StoredPreference[],
  type: NotificationType,
): NotificationChannel[] {
  return NOTIFICATION_CHANNELS.filter((channel) => wantsChannel(preferences, type, channel))
}

/** The preferences screen: every type, with the state of each channel and whether it is fixed. */
export function preferenceRows(
  preferences: readonly StoredPreference[],
): Array<{ type: NotificationType; inApp: boolean; email: boolean; isLocked: boolean }> {
  return NOTIFICATION_TYPES.map((type) => ({
    type,
    inApp: wantsChannel(preferences, type, 'IN_APP'),
    email: wantsChannel(preferences, type, 'EMAIL'),
    isLocked: isLocked(type),
  }))
}

/**
 * Reduces a submitted screen back to the exceptions worth storing.
 *
 * Anything matching the default is dropped rather than written, which is what keeps the stored
 * list short and what lets a default change later actually reach the people who never touched
 * the screen. Locked types are discarded outright — they were never the caller's to set.
 */
export function toStoredPreferences(submitted: readonly StoredPreference[]): StoredPreference[] {
  return submitted.filter((preference) => {
    if (isLocked(preference.type)) return false
    return preference.enabled !== defaultChannels(preference.type).includes(preference.channel)
  })
}
