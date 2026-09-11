export type PartOfDay = 'morning' | 'afternoon' | 'evening'

/**
 * In the CLINIC's timezone, not the server's and not the browser's: a doctor opening the
 * portal at 8am in Beirut should be greeted with good morning even if the server runs on
 * UTC.
 */
export function partOfDay(timeZone: string, now: Date = new Date()): PartOfDay {
  let hour: number
  try {
    hour = Number(
      new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(now),
    )
  } catch {
    hour = now.getUTCHours() // an unknown timezone falls back to UTC rather than crashing the page
  }
  if (hour < 12) return 'morning'
  if (hour < 18) return 'afternoon'
  return 'evening'
}
