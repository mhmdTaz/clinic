import type { EncounterStatus } from '@clinic/config'
import type { DiagnosisInput } from '@clinic/contracts'

/**
 * A visit's lifecycle (section 8.8). Shorter than the appointment's on purpose: an appointment
 * is a plan, with all the ways a plan can fall through, while an encounter is something that
 * actually happened. It is open while the doctor is writing, and then it is over.
 */
const NEXT: Readonly<Record<EncounterStatus, readonly EncounterStatus[]>> = {
  OPEN: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
}

export function canTransition(from: EncounterStatus, to: EncounterStatus): boolean {
  return NEXT[from].includes(to)
}

export function isOpen(status: EncounterStatus): boolean {
  return status === 'OPEN'
}

/**
 * Exactly one diagnosis is primary, and it is the first one flagged. A doctor ticking a second
 * primary means "this one instead", not "both" — so the list is normalised rather than refused,
 * and a list with none marked takes its first entry as primary, which is what a coder expects.
 */
export function withOnePrimary(diagnoses: readonly DiagnosisInput[]): DiagnosisInput[] {
  if (diagnoses.length === 0) return []
  const chosen = diagnoses.findIndex((diagnosis) => diagnosis.isPrimary)
  const primary = chosen === -1 ? 0 : chosen
  return diagnoses.map((diagnosis, index) => ({ ...diagnosis, isPrimary: index === primary }))
}

/**
 * ICD-10 as it is written: a letter, two digits, and an optional decimal refinement.
 *
 * The letter deliberately includes U. Most published regexes exclude it because U codes are
 * "reserved for provisional assignment" — and then U07.1 was assigned to COVID-19 and coded
 * millions of times. A validator that refuses a code clinicians actually use is a validator
 * people work around.
 */
const ICD10 = /^[A-Z][0-9][0-9AB](\.[0-9A-TV-Z]{1,4})?$/

export function isIcd10Code(code: string): boolean {
  return ICD10.test(code.trim().toUpperCase())
}
