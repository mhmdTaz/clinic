import type { LabOrderStatus } from '@clinic/config'

/**
 * Lab work's round trip (Phase 13). Pure: no clock, no database.
 *
 *   SENT ──received──▶ RECEIVED ──fitted──▶ FITTED
 *     │                  │  ▲
 *     │               remake │ received
 *     │                  ▼  │
 *     │                REMAKE
 *     └──cancel──▶ CANCELLED ◀──cancel── RECEIVED, REMAKE
 *
 * A remake is a piece that came back and did not fit; it goes back to the lab with a new date.
 * Fitted is the end — a crown that breaks a year later is new work, and a new order.
 */
const NEXT: Readonly<Record<LabOrderStatus, readonly LabOrderStatus[]>> = {
  SENT: ['RECEIVED', 'CANCELLED'],
  RECEIVED: ['FITTED', 'REMAKE', 'CANCELLED'],
  REMAKE: ['RECEIVED', 'CANCELLED'],
  FITTED: [],
  CANCELLED: [],
}

export const canMoveLabOrder = (from: LabOrderStatus, to: LabOrderStatus): boolean =>
  NEXT[from].includes(to)

export const nextLabStatuses = (from: LabOrderStatus): readonly LabOrderStatus[] => NEXT[from]

/** At the lab: sent, or sent back for a remake. What a patient's appointment may be waiting on. */
export const isAtLab = (status: LabOrderStatus): boolean => status === 'SENT' || status === 'REMAKE'

/** Not finished with: at the lab, or back in the clinic and not yet fitted. */
export const isOpenLabOrder = (status: LabOrderStatus): boolean =>
  isAtLab(status) || status === 'RECEIVED'

/** Still at the lab after the day it was promised. Calendar dates compare as strings. */
export const isLabOrderOverdue = (status: LabOrderStatus, dueOn: string, today: string): boolean =>
  isAtLab(status) && dueOn < today
