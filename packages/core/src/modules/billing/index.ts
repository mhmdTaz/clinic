/** Money: the price list, invoices, payments and the day's reconciliation (A6, S7, S8, S9, P8). */
export { listServices, createService, updateService } from './application/catalogue'
export {
  createInvoice,
  updateInvoice,
  issueInvoice,
  voidInvoice,
  listInvoices,
  getInvoice,
  toInvoiceSummary,
  toInvoiceDetail,
  // The seam Phase 5 left for inventory: charging a visit for what it consumed.
  billToEncounter,
} from './application/invoicing'
export {
  recordPayment,
  refundPayment,
  listPayments,
  getPayment,
  toPayment,
} from './application/payments'
export { dailyReconciliation, accountStatement } from './application/reporting'
export { getInvoicePdf, getReceiptPdf } from './application/documents'
export { installBillingScopeResolvers } from './application/scope'
export { computeLine, computeTotals, type ComputedLine, type ComputedTotals } from './domain/totals'
export {
  isEditable,
  canIssue,
  canVoid,
  isPayable,
  isSettled,
  isOverdue,
  statusAfterBalance,
  paymentStatusAfterRefund,
} from './domain/invoice'
export { allocationsBalance, unwindAllocations, type Allocation } from './domain/allocation'
// NOT exported: the repositories, or the PDF renderer.
