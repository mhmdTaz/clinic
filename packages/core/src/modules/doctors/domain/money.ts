/**
 * Money arithmetic moved to @clinic/contracts in Phase 5, where billing and the screens can
 * reach the same implementation — a fee validated one way here and another way on an invoice
 * would be two truths about the same number.
 */
export { currencyDigits, normalizeAmount } from '@clinic/contracts'
