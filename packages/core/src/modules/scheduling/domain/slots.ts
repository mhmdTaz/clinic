import { addMinutes, eachDate, instantOf, weekdayOf } from './zoned-time'

export interface AvailabilityBlock {
  dayOfWeek: number
  startsAt: string
  endsAt: string
}

/** Calendar dates, both ends inclusive. */
export interface TimeOffRange {
  startDate: string
  endDate: string
}

export interface BusyRange {
  startsAt: Date
  endsAt: Date
}

export interface SlotRequest {
  from: string
  to: string
  timeZone: string
  blocks: readonly AvailabilityBlock[]
  timeOff: readonly TimeOffRange[]
  /** Clinic closures as calendar dates: whole-clinic holidays, and the branch's own. */
  closedDates: readonly string[]
  /** Appointments already booked. Cancelled ones are not busy. */
  busy: readonly BusyRange[]
  durationMinutes: number
  /** Nothing earlier is offered: the past, and the clinic's minimum notice for patients. */
  notBefore: Date
  /** How far apart offers start. Defaults to the appointment's own length. */
  stepMinutes?: number
}

export interface DaySlots {
  date: string
  slots: Array<{ startsAt: Date; endsAt: Date }>
}

/**
 * The slots a doctor can be booked into — computed, never stored (section 8.7).
 *
 * Storing them would mean a second source of truth to invalidate on every change to the week,
 * the time off, the clinic's closures and every booking. Computing costs one doctor read, one
 * clinic read and one indexed range query over appointments.
 *
 * Every day in the range comes back, including the empty ones, so a calendar can render a column
 * per day without deciding what a missing day means.
 */
export function computeSlots(request: SlotRequest): DaySlots[] {
  const step = request.stepMinutes ?? request.durationMinutes
  const closed = new Set(request.closedDates)

  return eachDate(request.from, request.to).map((date) => {
    if (closed.has(date) || isAway(date, request.timeOff)) return { date, slots: [] }

    const weekday = weekdayOf(date)
    const slots = request.blocks
      .filter((block) => block.dayOfWeek === weekday)
      .flatMap((block) => slotsInBlock(date, block, request, step))
      .sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime())

    return { date, slots }
  })
}

function isAway(date: string, timeOff: readonly TimeOffRange[]): boolean {
  return timeOff.some((away) => away.startDate <= date && date <= away.endDate)
}

function slotsInBlock(
  date: string,
  block: AvailabilityBlock,
  request: SlotRequest,
  step: number,
): Array<{ startsAt: Date; endsAt: Date }> {
  const blockStart = instantOf(date, block.startsAt, request.timeZone)
  const blockEnd = instantOf(date, block.endsAt, request.timeZone)
  const slots: Array<{ startsAt: Date; endsAt: Date }> = []

  for (
    let start = blockStart;
    addMinutes(start, request.durationMinutes).getTime() <= blockEnd.getTime();
    start = addMinutes(start, step)
  ) {
    const end = addMinutes(start, request.durationMinutes)
    if (start.getTime() < request.notBefore.getTime()) continue
    if (overlapsBusy(start, end, request.busy)) continue
    slots.push({ startsAt: start, endsAt: end })
  }

  return slots
}

function overlapsBusy(start: Date, end: Date, busy: readonly BusyRange[]): boolean {
  return busy.some(
    (taken) => taken.startsAt.getTime() < end.getTime() && start.getTime() < taken.endsAt.getTime(),
  )
}
