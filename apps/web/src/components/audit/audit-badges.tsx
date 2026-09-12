import { Badge } from '@clinic/ui'
import type { AuditOutcome, AuditSeverity } from '@clinic/contracts'

const SEVERITY_TONES = {
  INFO: 'neutral',
  NOTICE: 'info',
  WARNING: 'warning',
  CRITICAL: 'danger',
} as const

/**
 * INFO is the ordinary case and says nothing, so it carries no badge — a colour on every row is
 * a colour that means nothing. NOTICE upwards is what somebody scanning the list is looking for.
 */
export function AuditSeverityBadge({
  severity,
  label,
}: {
  severity: AuditSeverity
  label: string
}) {
  if (severity === 'INFO') return null
  return (
    <Badge tone={SEVERITY_TONES[severity]} data-testid="audit-severity">
      {label}
    </Badge>
  )
}

const OUTCOME_TONES = {
  SUCCESS: 'success',
  FAILURE: 'danger',
  DENIED: 'warning',
} as const

/**
 * DENIED and FAILURE are different findings and read differently: one is somebody reaching for
 * something they may not have, the other is the system falling over. Sharing a colour would
 * blur the first investigation an auditor runs.
 */
export function AuditOutcomeBadge({ outcome, label }: { outcome: AuditOutcome; label: string }) {
  return (
    <Badge tone={OUTCOME_TONES[outcome]} data-testid="audit-outcome">
      {label}
    </Badge>
  )
}
