/**
 * The admin analytics dashboard (A8, section 13.5).
 *
 * Read-only and derived: this module owns no collection of its own and writes nothing. It reads
 * across billing, scheduling and patients through its own reporting repository — separate from
 * every transactional one so a year-long report runs on a secondary rather than competing with
 * the front desk (section 13.5).
 */
export { getAnalyticsOverview } from './application/overview'
export {
  rosteredMinutes,
  utilisationPercent,
  isOff,
  rate,
  type RosterBlock,
  type TimeOff,
} from './domain/utilisation'
// NOT exported: the reporting repository.
