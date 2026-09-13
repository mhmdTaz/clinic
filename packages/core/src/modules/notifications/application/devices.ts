import type { RegisterDeviceRequest, RegisteredDevice } from '@clinic/contracts'
import { NotFoundError } from '../../../errors'
import { recordAudit } from '../../audit'
import type { Actor } from '../../access'
import { deviceRepository, type DeviceRecord } from '../infrastructure/device.repository'

/**
 * Registering a device for push (§9.4) — the one piece of backend work Phase 9 allows.
 *
 * No permission check, deliberately: this is somebody attaching a notification address to **their
 * own** account, exactly like a browser being handed a session cookie. Every write is scoped to
 * `actor.userId`, so there is nothing a permission could usefully narrow — and requiring one would
 * mean a role edit could silently stop a patient's reminders arriving.
 *
 * It *is* audited. A new address on an account is the same class of event as a new session, and
 * "why did my appointments start appearing on someone else's phone" is a question the log should
 * be able to answer.
 */

export async function registerDevice(
  actor: Actor,
  input: RegisterDeviceRequest,
): Promise<RegisteredDevice> {
  const existing = await deviceRepository
    .listForUser(actor.clinicId, actor.userId)
    .then((devices) => devices.find((device) => device.token === input.token))

  const device = await deviceRepository.register(actor.clinicId, {
    userId: actor.userId,
    token: input.token,
    platform: input.platform,
    deviceName: input.deviceName ?? null,
    appVersion: input.appVersion ?? null,
  })

  // Only the first registration is news. The app re-registers on every launch, and an entry per
  // launch would drown the log in the least interesting event it records.
  if (!existing) {
    await recordAudit({
      action: 'device.registered',
      category: 'AUTH',
      severity: 'NOTICE',
      clinicId: actor.clinicId,
      entity: { type: 'DeviceToken', id: device.id, label: device.deviceName },
      // Never the token: it is credential-shaped, and a log is not a place to keep one.
      metadata: { platform: device.platform, appVersion: device.appVersion },
    })
  }

  return toRegistered(device, input.token)
}

export async function listMyDevices(actor: Actor, thisToken?: string): Promise<RegisteredDevice[]> {
  const devices = await deviceRepository.listForUser(actor.clinicId, actor.userId)
  return devices.map((device) => toRegistered(device, thisToken))
}

export async function removeDevice(actor: Actor, deviceId: string): Promise<void> {
  const removed = await deviceRepository.remove(actor.clinicId, actor.userId, deviceId)
  if (!removed) throw new NotFoundError('Device')

  await recordAudit({
    action: 'device.removed',
    category: 'AUTH',
    severity: 'NOTICE',
    clinicId: actor.clinicId,
    entity: { type: 'DeviceToken', id: deviceId },
  })
}

/**
 * Detaches a device on sign-out.
 *
 * Best-effort by design: signing out must succeed whether or not this does. A device that keeps
 * its row would receive a push for an account no longer signed in on it, which is why it is
 * attempted — but failing to detach is not a reason to refuse somebody the sign-out they asked
 * for, on a phone they may be about to hand over.
 */
export async function detachDevice(
  clinicId: string,
  userId: string,
  token: string,
): Promise<boolean> {
  return deviceRepository.removeByToken(clinicId, userId, token)
}

const toRegistered = (device: DeviceRecord, thisToken?: string): RegisteredDevice => ({
  id: device.id,
  platform: device.platform,
  deviceName: device.deviceName,
  appVersion: device.appVersion,
  lastSeenAt: device.lastSeenAt.toISOString(),
  isThisDevice: thisToken !== undefined && device.token === thisToken,
})
