import type { LabOrderStatus } from '@clinic/contracts'

/** A lab order's badge colour. Late work is shown as danger whatever its status, by the caller. */
export const LAB_TONES: Record<
  LabOrderStatus,
  'neutral' | 'info' | 'success' | 'warning' | 'danger'
> = {
  SENT: 'warning',
  REMAKE: 'warning',
  RECEIVED: 'info',
  FITTED: 'success',
  CANCELLED: 'neutral',
}
