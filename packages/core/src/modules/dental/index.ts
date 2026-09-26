/** The tooth chart: an event log of what was done to each tooth, and the picture drawn from it. */
export { getDentalChart, setDentition } from './application/chart'
export {
  listToothRecords,
  addToothRecord,
  completeToothRecord,
  voidToothRecord,
  applyQuickPick,
  toToothRecord,
} from './application/records'
export {
  listTreatments,
  createTreatment,
  updateTreatment,
  listQuickPicks,
  createQuickPick,
  updateQuickPick,
} from './application/catalogue'
export { installDentalScopeResolvers, dentalResource } from './application/scope'
export { deriveChart, supersedes, type ChartableRecord, type Mark } from './domain/derive-chart'
export { chartingProblems, statusProblem } from './domain/rules'
export {
  PERMANENT_TEETH,
  PRIMARY_TEETH,
  teethOf,
  belongsTo,
  successorOf,
  predecessorOf,
  isContinuousSpan,
  isAnterior,
  jawOf,
  chartOrder,
} from './domain/fdi'
export { DEFAULT_TREATMENTS } from './domain/defaults'
// NOT exported: the repositories.
