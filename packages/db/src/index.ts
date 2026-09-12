export {
  connect,
  disconnect,
  getConnection,
  getAuditConnection,
  ping,
  inspectTopology,
  withTransaction,
  type TopologyInfo,
} from './connection'
export { newId, isValidId, idField } from './id'
export { decimal128 } from './decimal'
export { nextSequence, nextFormatted } from './counters'
export { tenantGuard, filterHasTenant } from './plugins/tenant-guard'
export { softDelete } from './plugins/soft-delete'
export { searchKeys, type KeyFunction, type SearchKeyOptions } from './plugins/search-keys'
export {
  auditCapture,
  setAuditSink,
  hasAuditSink,
  AuditSinkNotConfiguredError,
  type AuditCaptureEvent,
  type AuditCaptureOptions,
  type AuditOperation,
  type AuditSink,
} from './plugins/audit-capture'
export { diffDocuments, REDACTED, type PlainObject, type DocumentDiff } from './plugins/audit-diff'
export { MissingTenantFilterError, MissingTenantFieldError } from './errors'
export * from './models'
