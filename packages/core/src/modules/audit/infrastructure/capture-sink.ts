import { setAuditSink, type AuditCaptureEvent } from '@clinic/db'

export type CaptureEvent = AuditCaptureEvent

/** The one seam between the database plugin and the audit module (section 11.3). */
export function registerCaptureSink(handler: (event: CaptureEvent) => void): void {
  setAuditSink(handler)
}

export function unregisterCaptureSink(): void {
  setAuditSink(null)
}
