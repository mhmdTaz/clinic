/** The clinical record: visits, notes, vitals and coded diagnoses (D6, D7, D9, P4, P10). */
export {
  listEncounters,
  getEncounter,
  toEncounterSummary,
  toEncounterDetail,
  mayReadNote,
} from './application/directory'
export {
  openEncounter,
  updateEncounter,
  recordVitals,
  setDiagnoses,
  completeEncounter,
} from './application/workspace'
export { signNote, addAddendum, verifyNoteSignature } from './application/signing'
export {
  careRelationshipFromEncounters,
  patientIdsTreatedBy,
  findEncounterOwner,
  listMyPatients,
} from './application/care'
export { installEncounterScopeResolvers } from './application/scope'
export { canTransition, isOpen, withOnePrimary, isIcd10Code } from './domain/encounter'
export { noteContentHash, hasContent, isEditable, isSigned, NOTE_SECTIONS } from './domain/note'
// NOT exported: the repository.
