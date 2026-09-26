import type {
  DentalScope,
  DentalSymbol,
  Dentition,
  ToothRecordStatus,
  ToothRole,
  ToothSurface,
} from '@clinic/config'
import { belongsTo, isAnterior, isContinuousSpan, isToothNumber, jawOf } from './fdi'

/**
 * What makes a charted row make sense, checked before it is written: the log is never edited, so
 * a row that is wrong on the way in stays wrong until someone voids it.
 *
 * Each problem names the field it is about, in the shape a ValidationError carries, so the drawer
 * can put the message next to the control that caused it.
 */

export interface ChartingProblem {
  field: string
  issue: string
}

export interface ChartingInput {
  teeth: ReadonlyArray<{ fdi: string; role: ToothRole | null }>
  surfaces: readonly ToothSurface[]
  scope: DentalScope
  dentition: Dentition
}

export function chartingProblems(input: ChartingInput): ChartingProblem[] {
  const problems: ChartingProblem[] = []
  const numbers = input.teeth.map((tooth) => tooth.fdi)

  if (numbers.length === 0) return [{ field: 'teeth', issue: 'REQUIRED' }]
  if (new Set(numbers).size !== numbers.length)
    problems.push({ field: 'teeth', issue: 'DUPLICATE' })
  for (const fdi of numbers) {
    if (!isToothNumber(fdi)) problems.push({ field: 'teeth', issue: 'INVALID_TOOTH' })
    else if (!belongsTo(fdi, input.dentition)) {
      problems.push({ field: 'teeth', issue: 'NOT_IN_DENTITION' })
    }
  }
  if (problems.length > 0) return problems

  switch (input.scope) {
    case 'TOOTH':
    case 'SURFACE':
      if (numbers.length !== 1) problems.push({ field: 'teeth', issue: 'ONE_TOOTH_ONLY' })
      if (input.teeth.some((tooth) => tooth.role !== null)) {
        problems.push({ field: 'teeth', issue: 'ROLE_NOT_ALLOWED' })
      }
      break
    case 'SPAN': {
      if (!isContinuousSpan(numbers)) problems.push({ field: 'teeth', issue: 'NOT_A_SPAN' })
      const roles = input.teeth.map((tooth) => tooth.role)
      // A bridge stands on something: at least one abutment, and something between them to carry.
      if (!roles.includes('ABUTMENT')) problems.push({ field: 'teeth', issue: 'NEEDS_ABUTMENT' })
      if (!roles.includes('PONTIC')) problems.push({ field: 'teeth', issue: 'NEEDS_PONTIC' })
      if (roles.some((role) => role === null || role === 'DENTURE_TOOTH')) {
        problems.push({ field: 'teeth', issue: 'SPAN_ROLES' })
      }
      break
    }
    case 'ARCH':
      if (new Set(numbers.map(jawOf)).size !== 1) {
        problems.push({ field: 'teeth', issue: 'ONE_JAW_ONLY' })
      }
      if (input.teeth.some((tooth) => tooth.role !== 'DENTURE_TOOTH')) {
        problems.push({ field: 'teeth', issue: 'ARCH_ROLES' })
      }
      break
  }

  if (input.scope === 'SURFACE' && input.surfaces.length === 0) {
    problems.push({ field: 'surfaces', issue: 'REQUIRED' })
  }
  if (input.scope !== 'SURFACE' && input.surfaces.length > 0) {
    problems.push({ field: 'surfaces', issue: 'NOT_ALLOWED' })
  }
  if (new Set(input.surfaces).size !== input.surfaces.length) {
    problems.push({ field: 'surfaces', issue: 'DUPLICATE' })
  }
  if (input.scope === 'SURFACE' && numbers.length === 1) {
    // An incisor has an incisal edge and no occlusal surface; a molar the other way round.
    const front = isAnterior(numbers[0]!)
    if (input.surfaces.includes(front ? 'O' : 'I')) {
      problems.push({
        field: 'surfaces',
        issue: front ? 'NO_OCCLUSAL_ON_FRONT_TOOTH' : 'NO_INCISAL_ON_BACK_TOOTH',
      })
    }
  }
  return problems
}

/** Findings are only ever found: decay is not planned, and nobody performs a fracture. */
const FINDINGS: ReadonlySet<DentalSymbol> = new Set(['CARIES', 'FRACTURE', 'IMPACTED'])

/**
 * Whether a status fits what is being charted. A finding is a CONDITION and nothing else; a
 * missing tooth is either found missing or already known to be; everything else is work, which is
 * planned, done here, or was done before the patient came.
 */
export function statusProblem(
  symbol: DentalSymbol,
  status: ToothRecordStatus,
): ChartingProblem | null {
  if (FINDINGS.has(symbol)) {
    return status === 'CONDITION' ? null : { field: 'status', issue: 'FINDING_IS_A_CONDITION' }
  }
  if (symbol === 'MISSING') {
    return status === 'CONDITION' || status === 'EXISTING'
      ? null
      : { field: 'status', issue: 'MISSING_IS_FOUND' }
  }
  if (symbol === 'OTHER') return null
  return status === 'CONDITION' ? { field: 'status', issue: 'WORK_IS_NOT_A_CONDITION' } : null
}
