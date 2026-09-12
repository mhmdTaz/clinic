/**
 * The audit log explorer (A5, section 11.6).
 *
 * Sits **above** `audit` rather than inside it: section 5.2 forbids `audit` from importing a
 * feature module, and gating a read needs `access`, which already depends on `audit` to record
 * denials. This module holds the permission checks, the diff rendering and the CSV; `audit`
 * keeps the writing, the chain and the raw reads.
 */
export {
  listAuditEntries,
  getAuditEntry,
  exportAuditCsv,
  auditActorOptions,
  verifyAuditChain,
} from './application/explorer'
export { fieldChanges, render, csvCell, csvRow } from './domain/diff'
