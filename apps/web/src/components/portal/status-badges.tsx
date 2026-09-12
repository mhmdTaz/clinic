import { Badge } from '@clinic/ui'

const USER_STATUS_TONES = {
  ACTIVE: 'success',
  INVITED: 'warning',
  SUSPENDED: 'danger',
  DEACTIVATED: 'neutral',
} as const

/** Colour and words together — never colour alone (section 14.5). */
export function UserStatusBadge({
  status,
  label,
}: {
  status: keyof typeof USER_STATUS_TONES
  label: string
}) {
  return <Badge tone={USER_STATUS_TONES[status]}>{label}</Badge>
}

const APPOINTMENT_STATUS_TONES = {
  SCHEDULED: 'info',
  CHECKED_IN: 'warning',
  IN_PROGRESS: 'warning',
  COMPLETED: 'success',
  CANCELLED: 'neutral',
  NO_SHOW: 'danger',
} as const

export function AppointmentStatusBadge({
  status,
  label,
}: {
  status: keyof typeof APPOINTMENT_STATUS_TONES
  label: string
}) {
  return <Badge tone={APPOINTMENT_STATUS_TONES[status]}>{label}</Badge>
}
