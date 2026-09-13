import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'
import type { RegisterDeviceRequest, RegisteredDevice } from '@clinic/contracts'
import Constants from 'expo-constants'
import { keychain } from './device/keychain'

/**
 * Asking for push, and telling the server where to send it (§9.4).
 *
 * **Permission is asked for at the moment it means something**, not on launch. A prompt on first
 * open, before the app has shown anything, is the prompt people decline — and iOS gives an app
 * exactly one chance to ask. So the only caller that prompts is a switch the person deliberately
 * turned on.
 *
 * **Registration is renewed on every launch.** A push token is reissued on reinstall, on restore
 * from a backup, and occasionally for no reason the app is told. The first version registered once,
 * from the switch, while the API client's own comment said "every launch": a reissued token would
 * have gone quietly unregistered and reminders would have stopped with nothing on screen to say so.
 */

export type PushEnrolment =
  | { status: 'ready'; registration: RegisterDeviceRequest }
  | { status: 'denied' }
  | { status: 'unsupported'; reason: string }

/**
 * The token for this installation, kept only while the person has reminders switched on.
 *
 * Its presence *is* the opt-in. It is also what sign-out sends, so this phone stops receiving the
 * person's notifications in the same request that ends their session.
 */
const OPT_IN_ITEM = 'clinic.push.token'

async function registrationFor(): Promise<PushEnrolment> {
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
      deviceName: deviceLabel(),
      // The build, so a delivery failure can be traced to a version rather than guessed at.
      appVersion: Constants.expoConfig?.version ?? null,
    },
  }
}

/**
 * Obtains a token, asking if the person has not been asked before.
 *
 * A discriminated result rather than a throw or a null, because the three outcomes need three
 * different things said: "you're set up", "you said no and here is how to change that", and "this
 * device cannot do this, which is not your fault".
 */
export async function enrolForPush(): Promise<PushEnrolment> {
  // A simulator has no push service behind it. Asking anyway produces a confusing failure that
  // reads like a bug in the app.
  if (!Device.isDevice || Platform.OS === 'web') {
    return { status: 'unsupported', reason: 'Push notifications need a phone or tablet.' }
  }

  const existing = await Notifications.getPermissionsAsync()
  let granted = existing.granted
  if (!granted && existing.canAskAgain) {
    granted = (await Notifications.requestPermissionsAsync()).granted
  }
  if (!granted) return { status: 'denied' }

  return registrationFor()
}

/** Remembers that this person switched reminders on here, and which token they were given. */
export const rememberOptIn = (token: string): Promise<void> => keychain.setItem(OPT_IN_ITEM, token)

export const forgetOptIn = (): Promise<void> => keychain.removeItem(OPT_IN_ITEM)

/** The token sign-out should detach, if reminders are on. */
export const optedInToken = (): Promise<string | null> =>
  keychain.getItem(OPT_IN_ITEM).catch(() => null)

/**
 * Renews this installation's registration, **without ever prompting**.
 *
 * Only for somebody who switched reminders on. If they have since turned notifications off in the
 * phone's Settings, the opt-in is forgotten rather than retried on every launch — the switch then
 * shows off, which is the truth.
 */
export async function renewPushRegistration(
  register: (input: RegisterDeviceRequest) => Promise<RegisteredDevice>,
): Promise<void> {
  if (!Device.isDevice || Platform.OS === 'web') return
  const previous = await optedInToken()
  if (!previous) return

  const permissions = await Notifications.getPermissionsAsync()
  if (!permissions.granted) {
    await forgetOptIn()
    return
  }

  const enrolment = await registrationFor()
  if (enrolment.status !== 'ready') return
  await register(enrolment.registration)
  if (enrolment.registration.token !== previous) await rememberOptIn(enrolment.registration.token)
}

/** How this phone is named to the server: at sign-in, and in the list of devices. */
export function deviceLabel(): string | null {
  const name = Device.deviceName ?? Device.modelName ?? null
  return name ? name.slice(0, 80) : null
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
