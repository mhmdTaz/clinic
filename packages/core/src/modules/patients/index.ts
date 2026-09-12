/** The patient directory and registration (S2). */
export {
  listPatients,
  getPatient,
  toPatientSummary,
  toPatientDetail,
  findPatientIdForUser,
  findPatientForScheduling,
  listPatientsByIds,
  type PatientSchedulingFacts,
} from './application/directory'
export {
  getChartBanner,
  setAllergies,
  setChronicConditions,
  toChartBanner,
} from './application/chart'
export { checkDuplicates, registerPatient, updatePatient } from './application/registration'
export { archivePatient, restorePatient, invitePatientToPortal } from './application/lifecycle'
export {
  installPatientScopeResolvers,
  assertClinicWidePatientRead,
  patientListScope,
} from './application/scope'
export {
  duplicateReasons,
  matchKeys,
  uncoveredCandidates,
  type MatchInput,
  type MatchKeys,
} from './domain/duplicates'
export {
  formatMrn,
  birthDateIssue,
  parsePatientQuery,
  MRN_DIGITS,
  type PatientQuery,
} from './domain/records'
// NOT exported: the repository.
