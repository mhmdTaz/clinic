import { captureAction, captureCategory, captureSeverity } from '../domain/capture-mapping'
import {
  registerCaptureSink,
  unregisterCaptureSink,
  type CaptureEvent,
} from '../infrastructure/capture-sink'
import { enqueueAudit } from './record-audit'

/**
 * Connects the database plugin to the audit log. Every entry point calls this once at
 * startup; until it does, a write to any audited model throws rather than going
 * unrecorded.
 */
export function installAuditCapture(): void {
  registerCaptureSink((event: CaptureEvent) => {
    enqueueAudit({
      action: captureAction(event.model, event.operation),
      category: captureCategory(event.model),
      severity: captureSeverity(event.model, event.operation),
      clinicId: event.clinicId ?? undefined,
      entity: {
        type: event.model,
        id: event.entityId,
        ids: event.entityIds.length > 0 ? event.entityIds : undefined,
      },
      before: event.before,
      after: event.after,
      metadata: event.changedPaths.length > 0 ? { changedPaths: event.changedPaths } : undefined,
    })
  })
}

export function uninstallAuditCapture(): void {
  unregisterCaptureSink()
}
