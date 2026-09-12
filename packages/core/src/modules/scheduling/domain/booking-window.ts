import { BOOKING_WINDOW_DEFAULTS } from '@clinic/config'

/** Self-service limits a clinic can change (ADR-0022). */
export interface BookingWindow {
  horizonDays: number
  minimumNoticeHours: number
  cancellationCutoffHours: number
}

export type BookingRefusal = 'TOO_SOON' | 'BEYOND_HORIZON'

export function bookingWindowOf(
  settings: Partial<BookingWindow> | null | undefined,
): BookingWindow {
  return {
    horizonDays: settings?.horizonDays ?? BOOKING_WINDOW_DEFAULTS.horizonDays,
    minimumNoticeHours: settings?.minimumNoticeHours ?? BOOKING_WINDOW_DEFAULTS.minimumNoticeHours,
    cancellationCutoffHours:
      settings?.cancellationCutoffHours ?? BOOKING_WINDOW_DEFAULTS.cancellationCutoffHours,
  }
}

const HOUR = 3_600_000
const DAY = 24 * HOUR

/** Why a patient may not book this time themselves, or null when they may. */
export function bookingRefusal(
  startsAt: Date,
  window: BookingWindow,
  now: Date = new Date(),
): BookingRefusal | null {
  if (startsAt.getTime() < now.getTime() + window.minimumNoticeHours * HOUR) return 'TOO_SOON'
  if (startsAt.getTime() > now.getTime() + window.horizonDays * DAY) return 'BEYOND_HORIZON'
  return null
}

/** Whether a patient may still cancel or reschedule their own appointment. */
export function withinCancellationWindow(
  startsAt: Date,
  window: BookingWindow,
  now: Date = new Date(),
): boolean {
  return startsAt.getTime() - now.getTime() >= window.cancellationCutoffHours * HOUR
}
