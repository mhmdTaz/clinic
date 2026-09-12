export {
  recordAudit,
  enqueueAudit,
  flushAudit,
  type RecordAuditInput,
  type AuditActorSnapshot,
} from './application/record-audit'
export { installAuditCapture, uninstallAuditCapture } from './application/install-audit-capture'
export { expiresAtFor, RETENTION_YEARS } from './domain/retention'
export {
  captureAction,
  captureCategory,
  captureSeverity,
  modelSlug,
} from './domain/capture-mapping'
// NOT exported: the repository and the capture sink.
export {
  chainHash,
  canonicalise,
  verifyChain,
  CHAIN_GENESIS,
  type ChainLink,
  type ChainVerdict,
} from './domain/hash-chain'
export {
  searchAuditEntries,
  findAuditEntry,
  auditActors,
  verifyChainFor,
  type AuditSearchFilter,
  type StoredAuditEntry,
} from './application/read'
export {
  runChainVerification,
  FULL_WALK_EVERY_DAYS,
  type ChainVerificationRun,
} from './application/verify'
// NOT exported: the repositories. Reading goes through application/read.ts, which is the only
// surface `audit-explorer` needs and keeps the driver out of every caller.
