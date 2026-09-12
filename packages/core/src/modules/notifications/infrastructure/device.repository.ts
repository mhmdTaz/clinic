import { DeviceTokenModel, newId } from '@clinic/db'

/**
 * The devices a clinic pushes to (§9.4).
 *
 * Keyed on the **token**, not on the user, for a reason worth stating: a push token belongs to an
 * app installation, and an installation can change hands. Registering an existing token reassigns
 * it to whoever is signed in now, so a phone passed to a colleague stops buzzing with the previous
 * owner's appointments. Keying on (user, device name) instead would leave that row behind.
 */
export interface DeviceRecord {
  id: string
  userId: string
  token: string
  platform: 'ios' | 'android' | 'web'
  deviceName: string | null
  appVersion: string | null
  lastSeenAt: Date
}

export const deviceRepository = {
  /**
   * Registers a token, or moves it to this user and marks it alive again.
   *
   * `failedAt` is cleared on the way through: a token that failed yesterday and registered today
   * is a working token, and leaving the mark would have the sweep delete a device somebody is
   * holding.
   */
  async register(
    clinicId: string,
    input: {
      userId: string
      token: string
      platform: 'ios' | 'android' | 'web'
      deviceName?: string | null
      appVersion?: string | null
    },
    now: Date = new Date(),
  ): Promise<DeviceRecord> {
    const doc = await DeviceTokenModel().findOneAndUpdate(
      { clinicId, token: input.token },
      {
        $set: {
          userId: input.userId,
          platform: input.platform,
          deviceName: input.deviceName ?? null,
          appVersion: input.appVersion ?? null,
          lastSeenAt: now,
          failedAt: null,
          failureReason: null,
        },
        $setOnInsert: { _id: newId(), clinicId, token: input.token },
      },
      { upsert: true, new: true },
    )

    return toRecord(doc as unknown as Record<string, unknown>)
  },

  async listForUser(clinicId: string, userId: string): Promise<DeviceRecord[]> {
    const docs = await DeviceTokenModel().find({ clinicId, userId }).sort({ lastSeenAt: -1 }).lean()
    return (docs as unknown as Array<Record<string, unknown>>).map(toRecord)
  },

  /** Every live token for these people, which is what a delivery needs. */
  async tokensForUsers(clinicId: string, userIds: string[]): Promise<DeviceRecord[]> {
    if (userIds.length === 0) return []
    const docs = await DeviceTokenModel()
      .find({ clinicId, userId: { $in: userIds }, failedAt: null })
      .lean()
    return (docs as unknown as Array<Record<string, unknown>>).map(toRecord)
  },

  /**
   * Removes a device, but only if it belongs to this person.
   *
   * The ownership check is in the filter rather than in a preceding read: otherwise two requests
   * racing could have one delete a row the other had just been reassigned.
   */
  async remove(clinicId: string, userId: string, deviceId: string): Promise<boolean> {
    const result = await DeviceTokenModel().deleteOne({ _id: deviceId, clinicId, userId })
    return result.deletedCount > 0
  },

  /** Signing out of a device should stop it receiving, which is one call rather than a screen. */
  async removeByToken(clinicId: string, token: string): Promise<boolean> {
    const result = await DeviceTokenModel().deleteOne({ clinicId, token })
    return result.deletedCount > 0
  },

  /**
   * Marks a token the relay rejected as dead.
   *
   * Marked rather than deleted, so an operator can see why a device stopped and a transient relay
   * problem cannot silently empty the table. `DeviceNotRegistered` is the only failure that gets
   * here — everything else is worth retrying (see push.ts).
   */
  async markFailed(
    clinicId: string,
    token: string,
    reason: string,
    now: Date = new Date(),
  ): Promise<void> {
    await DeviceTokenModel().updateOne(
      { clinicId, token },
      { $set: { failedAt: now, failureReason: reason } },
    )
  },
}

function toRecord(doc: Record<string, unknown>): DeviceRecord {
  return {
    id: String(doc._id),
    userId: String(doc.userId),
    token: String(doc.token),
    platform: doc.platform as DeviceRecord['platform'],
    deviceName: (doc.deviceName as string | null) ?? null,
    appVersion: (doc.appVersion as string | null) ?? null,
    lastSeenAt: (doc.lastSeenAt as Date) ?? new Date(0),
  }
}
