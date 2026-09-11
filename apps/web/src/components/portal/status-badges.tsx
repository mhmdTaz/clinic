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
