/** Booking and the appointment lifecycle (S5, D5, P3, P5). */
export {
  listAppointments,
  getAppointment,
  toAppointmentSummary,
  toAppointmentDetail,
} from './application/directory'
export { bookAppointment, bookOwnAppointment } from './application/booking'
export { registerWalkIn } from './application/walk-in'
export {
  rescheduleAppointment,
  cancelAppointment,
  checkInAppointment,
  startAppointment,
  completeAppointment,
  markNoShow,
} from './application/lifecycle'
export { offerSlots } from './application/slots'
export { installAppointmentScopeResolvers } from './application/scope'
export {
  canTransition,
  holdsSlot,
  isTerminal,
  nextStatuses,
  SLOT_HOLDING_STATUSES,
} from './domain/status'
// NOT exported: the repository.
