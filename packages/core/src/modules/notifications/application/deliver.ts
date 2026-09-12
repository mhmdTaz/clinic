import type { NotificationChannel, NotificationType } from '@clinic/config'
import { getClinicLetterhead } from '../../clinic'
import { notificationTemplate } from '../infrastructure/notification-templates'
import { mailer } from '../../../mailer'
import { push, type PushMessage } from '../../../push'
import { deviceRepository } from '../infrastructure/device.repository'
import {
  notificationRepository,
  preferenceRepository,
} from '../infrastructure/notification.repository'
import { channelsFor } from '../domain/preferences'

export interface DeliveryRequest {
  clinicId: string
  /** Who to tell. Anybody without an active account is silently skipped. */
  userIds: string[]
  type: NotificationType
  title: string
  body: string
  href: string | null
  entity?: { type: string | null; id: string | null }
  /**
   * What makes this notification *this* notification, independent of the attempt.
   *
   * It is combined with the recipient, so one event telling three people produces three
   * notifications and one retry produces none. Built from facts — ids and offsets — never from
   * a timestamp or a random value, or the retry would compute a different key and send again.
   */
  dedupeKey: string
  /** A longer message for the email, where the in-app body would be too terse. */
  emailBody?: string
  action?: { href: string; label: string }
}

export interface DeliveryResult {
  created: number
  /** How many were already there — the ordinary shape of a retry, not a failure. */
  duplicates: number
  emailed: number
  /** Devices the relay accepted. Zero with recipients present means nobody has the app. */
  pushed: number
}

/**
 * Telling people something happened (section 8.12) — the one path every notification takes.
 *
 * Three things worth naming:
 *
 *  - **the dedupe key is the guarantee.** A unique index on (clinicId, dedupeKey) means a handler
 *    that runs twice creates one notification, and the second attempt is told so rather than
 *    erroring. At-least-once delivery is a fact of queues; this is what makes it survivable
 *    (ADR-0030).
 *  - **preferences are applied per recipient**, so the same event can reach one person by email
 *    and another only in the bell.
 *  - **an email that fails does not fail the notification.** The in-app row is the record and it
 *    is already written; a dead SMTP server should not cost somebody their reminder, so the
 *    channel is marked FAILED and the caller carries on.
 */
export async function deliver(request: DeliveryRequest): Promise<DeliveryResult> {
  const recipients = await preferenceRepository.recipients(request.clinicId, request.userIds)
  if (recipients.size === 0) return { created: 0, duplicates: 0, emailed: 0, pushed: 0 }

  const clinic = await getClinicLetterhead(request.clinicId)
  const result: DeliveryResult = { created: 0, duplicates: 0, emailed: 0, pushed: 0 }

  /**
   * Push is gathered across recipients and sent once at the end, not per person.
   *
   * The relay takes a hundred messages per call, and a clinic-wide notice is a hundred devices;
   * one call each would be a hundred round trips inside a loop that is already holding up
   * whatever raised the event.
   */
  const outgoing: Array<{ userId: string; notificationId: string; message: PushMessage }> = []

  for (const userId of request.userIds) {
    const recipient = recipients.get(userId)
    if (!recipient) continue

    const channels = channelsFor(recipient.preferences, request.type)
    if (channels.length === 0) continue

    const notification = await notificationRepository.create({
      clinicId: request.clinicId,
      userId,
      type: request.type,
      title: request.title,
      body: request.body,
      href: request.href,
      entity: request.entity ?? { type: null, id: null },
      channels,
      // Per recipient: one event telling three people is three notifications.
      dedupeKey: `${request.dedupeKey}:${userId}`,
    })

    if (!notification) {
      result.duplicates += 1
      continue
    }
    result.created += 1

    // The in-app channel is the row that was just written, so it is already delivered.
    if (channels.includes('IN_APP')) {
      await notificationRepository.markChannel(request.clinicId, notification.id, 'IN_APP', 'SENT')
    }

    if (channels.includes('EMAIL')) {
      const sent = await sendEmail({
        to: recipient.email,
        firstName: recipient.firstName,
        clinicName: clinic.name,
        title: request.title,
        body: request.emailBody ?? request.body,
        action: request.action ?? null,
      })
      await notificationRepository.markChannel(
        request.clinicId,
        notification.id,
        'EMAIL',
        sent.ok ? 'SENT' : 'FAILED',
        sent.ok ? null : sent.error,
      )
      if (sent.ok) result.emailed += 1
    }

    if (channels.includes('PUSH')) {
      const devices = await deviceRepository.tokensForUsers(request.clinicId, [userId])
      for (const device of devices) {
        outgoing.push({
          userId,
          notificationId: notification.id,
          message: {
            to: device.token,
            title: request.title,
            body: request.body,
            // Small on purpose: the payload limit is about 4 KB, and everything the app needs to
            // open the right screen is an id and a path. The rest it fetches.
            data: {
              notificationId: notification.id,
              type: request.type,
              ...(request.href ? { href: request.href } : {}),
            },
          },
        })
      }
      // No device registered is not a failure — it is somebody who has not installed the app.
      if (devices.length === 0) {
        await notificationRepository.markChannel(
          request.clinicId,
          notification.id,
          'PUSH',
          'FAILED',
          'NO_DEVICE',
        )
      }
    }
  }

  if (outgoing.length > 0) result.pushed += await sendPush(request.clinicId, outgoing)

  return result
}

/**
 * Sends the batch and records what happened to each device.
 *
 * A token the relay reports as `DeviceNotRegistered` is marked dead so the next batch skips it:
 * an uninstalled app otherwise stays in every send forever, turning a push run into mostly
 * failures and hiding the ones that matter.
 */
async function sendPush(
  clinicId: string,
  outgoing: Array<{ userId: string; notificationId: string; message: PushMessage }>,
): Promise<number> {
  const results = await push.send(outgoing.map((entry) => entry.message))
  let delivered = 0

  // Per notification rather than per device: one person with three phones has one notification,
  // and it counts as delivered if it reached any of them.
  const byNotification = new Map<string, { ok: boolean; error?: string }>()

  for (const [index, entry] of outgoing.entries()) {
    const outcome = results[index] ?? { ok: false, error: 'NO_RESULT' }
    if (outcome.ok) delivered += 1
    else if (outcome.unregistered) {
      await deviceRepository.markFailed(clinicId, entry.message.to, outcome.error ?? 'UNREGISTERED')
    }

    const current = byNotification.get(entry.notificationId)
    if (!current?.ok) {
      byNotification.set(entry.notificationId, {
        ok: outcome.ok,
        ...(outcome.ok ? {} : { error: outcome.error ?? 'UNKNOWN' }),
      })
    }
  }

  for (const [notificationId, outcome] of byNotification) {
    await notificationRepository.markChannel(
      clinicId,
      notificationId,
      'PUSH',
      outcome.ok ? 'SENT' : 'FAILED',
      outcome.ok ? null : (outcome.error ?? 'UNKNOWN'),
    )
  }

  return delivered
}

async function sendEmail(input: {
  to: string
  firstName: string
  clinicName: string
  title: string
  body: string
  action: { href: string; label: string } | null
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await mailer.send(notificationTemplate(input))
    return { ok: true }
  } catch (error) {
    // Deliberately swallowed: the in-app notification is the record and it is already written.
    // A dead SMTP server should not cost somebody the reminder they would have seen in the app.
    return { ok: false, error: error instanceof Error ? error.message : 'send failed' }
  }
}

/** Which channels a type would actually reach this person on — used by the preferences screen. */
export async function channelsForUser(
  clinicId: string,
  userId: string,
  type: NotificationType,
): Promise<NotificationChannel[]> {
  const preferences = await preferenceRepository.read(clinicId, userId)
  return channelsFor(preferences, type)
}
