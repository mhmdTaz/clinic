/**
 * How a time is written in a message (ADR-0010).
 *
 * Always in the **clinic's** timezone, never the server's and never UTC. A reminder that says
 * "09:00" has to mean the 09:00 the patient will turn up at, and a worker container set to UTC
 * would otherwise tell everybody the wrong hour — the failure that only shows up in production,
 * and only for clinics that are not in London.
 */
export function formatAppointmentTime(instant: Date, timeZone: string, locale = 'en'): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  }).format(instant)
}

/** Just the clock time, for a reminder whose date the sentence already carries. */
export function formatTimeOnly(instant: Date, timeZone: string, locale = 'en'): string {
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  }).format(instant)
}
