import type { AppointmentStatus } from '@clinic/config'

/**
 * The appointment lifecycle (section 8.7).
 *
 * Written as data rather than as a chain of ifs, so the allowed moves can be read at a glance
 * and the UI can ask the same question the server answers.
 */
const NEXT: Readonly<Record<AppointmentStatus, readonly AppointmentStatus[]>> = {
  SCHEDULED: ['CHECKED_IN', 'IN_PROGRESS', 'CANCELLED', 'NO_SHOW'],
  CHECKED_IN: ['IN_PROGRESS', 'CANCELLED', 'NO_SHOW'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
}

export function nextStatuses(from: AppointmentStatus): readonly AppointmentStatus[] {
  return NEXT[from]
}

export function canTransition(from: AppointmentStatus, to: AppointmentStatus): boolean {
  return NEXT[from].includes(to)
}

/** Nothing follows these. A cancelled appointment is not rescheduled; a new one is booked. */
export function isTerminal(status: AppointmentStatus): boolean {
  return NEXT[status].length === 0
}

/**
 * Whether an appointment still occupies its time. Only these hold reservations, so cancelling
 * or marking a no-show frees the slot for someone else.
 */
export function holdsSlot(status: AppointmentStatus): boolean {
  return status === 'SCHEDULED' || status === 'CHECKED_IN' || status === 'IN_PROGRESS'
}

export const SLOT_HOLDING_STATUSES: readonly AppointmentStatus[] = [
  'SCHEDULED',
  'CHECKED_IN',
  'IN_PROGRESS',
]
