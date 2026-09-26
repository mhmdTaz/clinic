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
export {
  listTreatmentPlans,
  getTreatmentPlan,
  createTreatmentPlan,
  updateTreatmentPlan,
  presentTreatmentPlan,
  acceptTreatmentPlan,
  declineTreatmentPlan,
  cancelTreatmentPlan,
  billPlanItem,
  listOverduePlans,
  toTreatmentPlan,
} from './application/plans'
export {
  createLabOrder,
  listPatientLabOrders,
  listLabOrders,
  changeLabOrderStatus,
  openLabOrdersFor,
  labWorkAtLabFor,
  setVoiceCharting,
  toLabOrder,
} from './application/lab'
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
export {
  canMoveLabOrder,
  nextLabStatuses,
  isAtLab,
  isOpenLabOrder,
  isLabOrderOverdue,
} from './domain/lab'
export {
  isEditable as isPlanEditable,
  canPresent as canPresentPlan,
  canDecide as canDecidePlan,
  canCancel as canCancelPlan,
  canBill as canBillPlan,
  statusAfterProgress,
  itemState,
  defaultQuantity,
  describeWork,
} from './domain/plan'
// NOT exported: the repositories.
