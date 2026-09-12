import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'
import type { RegisterDeviceRequest } from '@clinic/contracts'
import Constants from 'expo-constants'

// Re-exported so a screen has one obvious import for "push things". The rule itself lives in a
// module with no native imports, so it can be tested without a device.
export { destinationOf } from './notification-routing'

/**
 * Asking for push, and telling the server where to send it (§9.4).
 *
 * **Permission is asked for at the moment it means something**, not on launch. A prompt on first
 * open, before the app has shown anything, is the prompt people decline — and iOS gives an app
 * exactly one chance to ask. So the caller is a screen that has just explained why: after booking
 * an appointment, or from a switch the person deliberately turned on.
 */

export type PushEnrolment =
  | { status: 'ready'; registration: RegisterDeviceRequest }
  | { status: 'denied' }
  | { status: 'unsupported'; reason: string }

/**
 * Obtains a token, if the person allows it and the device can have one.
 *
 * Returns a discriminated result rather than throwing or returning null, because the three
 * outcomes need three different things said to somebody: "you're set up", "you said no and here
 * is how to change that", and "this device cannot do this, which is not your fault".
 */
export async function enrolForPush(): Promise<PushEnrolment> {
  // A simulator has no push service behind it. Asking anyway produces a confusing failure that
  // reads like a bug in the app.
  if (!Device.isDevice) {
    return { status: 'unsupported', reason: 'Push notifications need a physical device.' }
  }

  const existing = await Notifications.getPermissionsAsync()
  let granted = existing.granted

  if (!granted && existing.canAskAgain) {
    const asked = await Notifications.requestPermissionsAsync()
    granted = asked.granted
  }
  if (!granted) return { status: 'denied' }

  const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)
    ?.eas?.projectId
  if (!projectId) {
    return { status: 'unsupported', reason: 'This build has no EAS project id configured.' }
  }

  const token = await Notifications.getExpoPushTokenAsync({ projectId })

  return {
    status: 'ready',
    registration: {
      token: token.data,
      platform: Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web',
      // What the person sees in "your devices" — "Pixel 7", never a token.
      deviceName: Device.deviceName ?? Device.modelName ?? null,
      // The build, so a delivery failure can be traced to a version rather than guessed at.
      appVersion: Constants.expoConfig?.version ?? null,
    },
  }
}

/**
 * How a notification behaves while the app is open.
 *
 * Shown rather than swallowed: the alternative is a reminder that arrives silently because
 * somebody happened to have the app open, which is the moment it is least likely to be noticed
 * and most likely to be assumed sent.
 */
export const foregroundBehaviour: Notifications.NotificationBehavior = {
  shouldShowBanner: true,
  shouldShowList: true,
  shouldPlaySound: false,
  shouldSetBadge: true,
}
