/**
 * Scheduling rules (section 8.7): the clinic's calendar arithmetic, the slots a week produces,
 * the reservation grid that settles booking races, and the window self-service booking obeys.
 *
 * Pure by design — no repositories here. Appointments owns the I/O and calls in.
 */
export {
  computeSlots,
  type AvailabilityBlock,
  type BusyRange,
  type DaySlots,
  type SlotRequest,
  type TimeOffRange,
} from './domain/slots'
export { gridCellIds, floorToGrid, sitsOnGrid } from './domain/grid'
export {
  bookingRefusal,
  bookingWindowOf,
  withinCancellationWindow,
  type BookingRefusal,
  type BookingWindow,
} from './domain/booking-window'
export {
  addMinutes,
  eachDate,
  instantOf,
  localMoment,
  nextDate,
  weekdayOf,
  type LocalMoment,
} from './domain/zoned-time'
