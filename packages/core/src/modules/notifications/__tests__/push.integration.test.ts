import { afterEach, describe, expect, it } from 'vitest'
import { env } from '@clinic/config'
import { DeviceTokenModel, NotificationModel, newId } from '@clinic/db'
import { providePushSender, type PushMessage, type PushResult } from '../../../push'
import { signedInActor } from '../../../../test/fixtures'
import { runWithContext } from '../../../context/request-context'
import type { Actor } from '../../access'
import { flushAudit } from '../../audit'
import { deliver } from '../application/deliver'
import { listMyDevices, registerDevice, removeDevice } from '../application/devices'

const clinicId = () => env().CLINIC_ID

/** A relay double: records what it was asked to send, answers however the test wants. */
function relay(answer: (message: PushMessage) => PushResult = () => ({ ok: true })) {
  const sent: PushMessage[] = []
  providePushSender(async (messages) => {
    sent.push(...messages)
    return messages.map(answer)
  })
  return sent
}

afterEach(() => {
  providePushSender(null)
})

const token = () => `ExponentPushToken[${newId()}]`

/**
 * Runs a call inside a request context, as `withApi` does on a real request.
 *
 * Without it the ambient actor is anonymous and the captured entry records `actor.id: null` —
 * which would make the assertion below pass for the wrong reason.
 */
function as<T>(actor: Actor, fn: () => Promise<T>) {
  return runWithContext(
    {
      requestId: newId(),
      actorId: actor.userId,
      actorType: actor.kind,
      actorLabel: actor.displayName,
      actorRoles: actor.roleKeys,
      clinicId: actor.clinicId,
    },
    fn,
  )
}

describe('registering a device', () => {
  it('is an upsert on the token, so launching the app twice is not two devices', async () => {
    const { actor } = await signedInActor({ role: 'patient' })
    const pushToken = token()

    const first = await registerDevice(actor, {
      token: pushToken,
      platform: 'ios',
      deviceName: 'iPhone 15',
      appVersion: '1.0.0',
    })
    const second = await registerDevice(actor, {
      token: pushToken,
      platform: 'ios',
      deviceName: 'iPhone 15',
      appVersion: '1.0.1',
    })

    expect(second.id).toBe(first.id)
    const devices = await listMyDevices(actor, pushToken)
    expect(devices.filter((device) => device.id === first.id)).toHaveLength(1)
    // The later registration wins: the app version is how a delivery failure is traced to a build.
    expect(devices.find((device) => device.id === first.id)?.appVersion).toBe('1.0.1')
    expect(devices.find((device) => device.id === first.id)?.isThisDevice).toBe(true)
  })

  /**
   * The case that makes the token the key rather than the user: a phone handed over.
   *
   * Keyed on (user, device) the old row would survive, and the new owner's handset would keep
   * delivering the previous owner's appointment reminders — a privacy failure with a plausible
   * everyday cause.
   */
  it('reassigns a handed-over phone rather than leaving the old owner attached', async () => {
    const first = await signedInActor({ role: 'patient' })
    const second = await signedInActor({ role: 'patient' })
    const shared = token()

    await registerDevice(first.actor, { token: shared, platform: 'android', deviceName: 'Pixel' })
    await registerDevice(second.actor, { token: shared, platform: 'android', deviceName: 'Pixel' })

    expect(await listMyDevices(first.actor)).toHaveLength(0)
    expect(await listMyDevices(second.actor)).toHaveLength(1)

    const rows = await DeviceTokenModel().countDocuments({ clinicId: clinicId(), token: shared })
    expect(rows).toBe(1)
  })

  it('records the first registration and not every launch', async () => {
    const { actor } = await signedInActor({ role: 'patient' })
    const pushToken = token()

    await as(actor, () => registerDevice(actor, { token: pushToken, platform: 'ios' }))
    await as(actor, () => registerDevice(actor, { token: pushToken, platform: 'ios' }))
    await as(actor, () => registerDevice(actor, { token: pushToken, platform: 'ios' }))
    await flushAudit()

    const { AuditLogModel } = await import('@clinic/db')
    const entries = await AuditLogModel().countDocuments({
      clinicId: clinicId(),
      action: 'device.registered',
      'actor.id': actor.userId,
    })
    // One. An entry per launch would drown the log in its least interesting event.
    expect(entries).toBe(1)
  })

  it('never writes the token itself into the audit log', async () => {
    const { actor } = await signedInActor({ role: 'patient' })
    const pushToken = token()
    await registerDevice(actor, { token: pushToken, platform: 'ios', deviceName: 'Test' })
    await flushAudit()

    const { AuditLogModel } = await import('@clinic/db')
    const entries = await AuditLogModel()
      .find({ clinicId: clinicId(), 'entity.type': 'DeviceToken' })
      .lean()

    // A push token is credential-shaped. The log records that a device was added, never where.
    expect(JSON.stringify(entries)).not.toContain(pushToken)
    expect(entries.length).toBeGreaterThan(0)
  })

  it('removes only this person’s device', async () => {
    const mine = await signedInActor({ role: 'patient' })
    const theirs = await signedInActor({ role: 'patient' })

    const device = await registerDevice(mine.actor, { token: token(), platform: 'ios' })

    // Somebody else's id is not found rather than refused: a device list is not a way to learn
    // which ids exist.
    await expect(removeDevice(theirs.actor, device.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    await removeDevice(mine.actor, device.id)
    expect(await listMyDevices(mine.actor)).toHaveLength(0)
  })
})

describe('delivering to a device', () => {
  it('pushes to every device the person has registered', async () => {
    const { actor } = await signedInActor({ role: 'patient' })
    await registerDevice(actor, { token: token(), platform: 'ios', deviceName: 'Phone' })
    await registerDevice(actor, { token: token(), platform: 'android', deviceName: 'Tablet' })

    const sent = relay()
    const result = await deliver({
      clinicId: clinicId(),
      userIds: [actor.userId],
      type: 'APPOINTMENT_REMINDER',
      title: 'Tomorrow at 09:00',
      body: 'With Dr Haddad.',
      href: '/patient/appointments',
      dedupeKey: `push-test-${newId()}`,
    })

    expect(sent).toHaveLength(2)
    expect(result.pushed).toBe(2)
    // Small on purpose: the payload cap is about 4 KB, and an id plus a path is all the app needs
    // to open the right screen.
    expect(sent[0]!.data).toMatchObject({
      type: 'APPOINTMENT_REMINDER',
      href: '/patient/appointments',
    })
    expect(JSON.stringify(sent[0]).length).toBeLessThan(1024)
  })

  it('marks the channel sent, and one notification counts once however many phones', async () => {
    const { actor } = await signedInActor({ role: 'patient' })
    await registerDevice(actor, { token: token(), platform: 'ios' })
    await registerDevice(actor, { token: token(), platform: 'android' })
    relay()

    const dedupeKey = `push-one-${newId()}`
    await deliver({
      clinicId: clinicId(),
      userIds: [actor.userId],
      type: 'APPOINTMENT_REMINDER',
      title: 'Tomorrow',
      body: 'x',
      href: null,
      dedupeKey,
    })

    const notification = (await NotificationModel()
      .findOne({ clinicId: clinicId(), dedupeKey: `${dedupeKey}:${actor.userId}` })
      .lean()) as unknown as { channels: Array<{ channel: string; status: string }> }

    const push = notification.channels.filter((channel) => channel.channel === 'PUSH')
    expect(push).toHaveLength(1)
    expect(push[0]!.status).toBe('SENT')
  })

  it('marks a dead token so the next batch skips it', async () => {
    const { actor } = await signedInActor({ role: 'patient' })
    const dead = token()
    await registerDevice(actor, { token: dead, platform: 'ios' })

    relay(() => ({ ok: false, error: 'DeviceNotRegistered', unregistered: true }))
    await deliver({
      clinicId: clinicId(),
      userIds: [actor.userId],
      type: 'APPOINTMENT_REMINDER',
      title: 'x',
      body: 'y',
      href: null,
      dedupeKey: `push-dead-${newId()}`,
    })

    const row = (await DeviceTokenModel()
      .findOne({ clinicId: clinicId(), token: dead })
      .lean()) as unknown as { failedAt: Date | null; failureReason: string | null }
    expect(row.failedAt).toBeInstanceOf(Date)
    expect(row.failureReason).toBe('DeviceNotRegistered')

    // The next send skips it: an uninstalled app otherwise stays in every batch forever.
    const second = relay()
    await deliver({
      clinicId: clinicId(),
      userIds: [actor.userId],
      type: 'APPOINTMENT_REMINDER',
      title: 'x',
      body: 'y',
      href: null,
      dedupeKey: `push-dead-2-${newId()}`,
    })
    expect(second).toHaveLength(0)
  })

  it('does not lose the notification when the relay is down', async () => {
    const { actor } = await signedInActor({ role: 'patient' })
    await registerDevice(actor, { token: token(), platform: 'ios' })
    providePushSender(async () => {
      throw new Error('relay unreachable')
    })

    const dedupeKey = `push-down-${newId()}`
    // The in-app row is the record, and it is already written. A dead relay must not cost
    // somebody the reminder they would have seen in the app.
    const result = await deliver({
      clinicId: clinicId(),
      userIds: [actor.userId],
      type: 'APPOINTMENT_REMINDER',
      title: 'Still delivered',
      body: 'x',
      href: null,
      dedupeKey,
    })

    expect(result.created).toBe(1)
    expect(result.pushed).toBe(0)
    const notification = await NotificationModel()
      .findOne({ clinicId: clinicId(), dedupeKey: `${dedupeKey}:${actor.userId}` })
      .lean()
    expect(notification).toBeTruthy()
  })

  it('reports no device rather than pretending it pushed', async () => {
    const { actor } = await signedInActor({ role: 'patient' })
    const sent = relay()

    const dedupeKey = `push-none-${newId()}`
    const result = await deliver({
      clinicId: clinicId(),
      userIds: [actor.userId],
      type: 'APPOINTMENT_REMINDER',
      title: 'x',
      body: 'y',
      href: null,
      dedupeKey,
    })

    expect(sent).toHaveLength(0)
    expect(result.pushed).toBe(0)

    const notification = (await NotificationModel()
      .findOne({ clinicId: clinicId(), dedupeKey: `${dedupeKey}:${actor.userId}` })
      .lean()) as unknown as { channels: Array<{ channel: string; status: string; error: string }> }
    const push = notification.channels.find((channel) => channel.channel === 'PUSH')
    // Somebody who has not installed the app is not a failure to investigate, but it is not a
    // success either — so it says which.
    expect(push?.status).toBe('FAILED')
    expect(push?.error).toBe('NO_DEVICE')
  })

  it('does not push a type whose default excludes it', async () => {
    const { actor } = await signedInActor({ role: 'patient' })
    await registerDevice(actor, { token: token(), platform: 'ios' })
    const sent = relay()

    // Money is not urgent and a buzz about it is intrusive: in the app and the inbox is enough.
    await deliver({
      clinicId: clinicId(),
      userIds: [actor.userId],
      type: 'INVOICE_ISSUED',
      title: 'A bill',
      body: 'x',
      href: null,
      dedupeKey: `push-invoice-${newId()}`,
    })

    expect(sent).toHaveLength(0)
  })
})
