/** Telling people things happened, and what they want to hear about (section 8.12). */
export {
  deliver,
  channelsForUser,
  type DeliveryRequest,
  type DeliveryResult,
} from './application/deliver'
export {
  notificationFeed,
  markNotificationsRead,
  getNotificationPreferences,
  setNotificationPreferences,
} from './application/feed'
export {
  channelsFor,
  wantsChannel,
  defaultChannels,
  isLocked,
  preferenceRows,
  toStoredPreferences,
  type StoredPreference,
} from './domain/preferences'
// NOT exported: the repositories, the mailer or the templates.
export { registerDevice, listMyDevices, removeDevice, detachDevice } from './application/devices'
// NOT exported: the device repository.
