import type { Dentition } from '@clinic/config'

/**
 * FDI two-digit tooth notation (ISO 3950): the first digit is the quadrant, the second the
 * position counted from the midline. Quadrants 1–4 are the permanent teeth (upper right, upper
 * left, lower left, lower right), eight to a quadrant; 5–8 are the primary teeth, five to one.
 *
 * The order everything here returns is the order a chart is read in: the upper jaw from the
 * patient's right to their left, then the lower jaw from right to left — the way a dentist facing
 * the patient sees them.
 */

const FDI = /^([1-4][1-8]|[5-8][1-5])$/

export const isToothNumber = (value: string): boolean => FDI.test(value)

export const isPrimaryTooth = (fdi: string): boolean => Number(fdi[0]) >= 5

const quadrant = (q: number, count: number, reversed: boolean): string[] => {
  const teeth = Array.from({ length: count }, (_, index) => `${q}${index + 1}`)
  return reversed ? teeth.reverse() : teeth
}

/** Upper right, upper left, lower right, lower left — each read outward from the midline. */
export const PERMANENT_TEETH: readonly string[] = [
  ...quadrant(1, 8, true),
  ...quadrant(2, 8, false),
  ...quadrant(4, 8, true),
  ...quadrant(3, 8, false),
]

export const PRIMARY_TEETH: readonly string[] = [
  ...quadrant(5, 5, true),
  ...quadrant(6, 5, false),
  ...quadrant(8, 5, true),
  ...quadrant(7, 5, false),
]

/**
 * The permanent tooth that takes a primary tooth's place: 55 is followed by 15, 83 by 43. Only
 * the first five positions have a predecessor — the permanent molars erupt behind the primary
 * teeth rather than under them.
 */
export function successorOf(primary: string): string | null {
  if (!isToothNumber(primary) || !isPrimaryTooth(primary)) return null
  return `${Number(primary[0]) - 4}${primary[1]}`
}

export function predecessorOf(permanent: string): string | null {
  if (!isToothNumber(permanent) || isPrimaryTooth(permanent)) return null
  const position = Number(permanent[1])
  return position <= 5 ? `${Number(permanent[0]) + 4}${position}` : null
}

/** Every tooth a chart of this dentition draws. MIXED draws both sets: which is erupted is data. */
export function teethOf(dentition: Dentition): readonly string[] {
  switch (dentition) {
    case 'PERMANENT':
      return PERMANENT_TEETH
    case 'PRIMARY':
      return PRIMARY_TEETH
    case 'MIXED':
      return [...PERMANENT_TEETH, ...PRIMARY_TEETH]
  }
}

export function belongsTo(fdi: string, dentition: Dentition): boolean {
  if (!isToothNumber(fdi)) return false
  if (dentition === 'MIXED') return true
  return isPrimaryTooth(fdi) === (dentition === 'PRIMARY')
}

/** Front teeth have an incisal edge where back teeth have an occlusal surface. */
export function isAnterior(fdi: string): boolean {
  return Number(fdi[1]) <= 3
}

/** Upper and lower are different jaws: a bridge cannot cross from one to the other. */
export function jawOf(fdi: string): 'UPPER' | 'LOWER' {
  const q = Number(fdi[0])
  return q === 1 || q === 2 || q === 5 || q === 6 ? 'UPPER' : 'LOWER'
}

/** Position along the arch from the patient's right to their left, for adjacency. */
export function archIndex(fdi: string): number {
  const q = Number(fdi[0])
  const position = Number(fdi[1])
  const right = q === 1 || q === 4 || q === 5 || q === 8
  return right ? -position : position
}

/**
 * Whether a run of teeth is continuous along one arch — what a bridge must be. 11 and 21 are
 * neighbours across the midline; 14 and 16 are not, with 15 between them.
 */
export function isContinuousSpan(teeth: readonly string[]): boolean {
  if (teeth.length < 2) return false
  if (new Set(teeth.map(jawOf)).size !== 1) return false
  if (new Set(teeth.map(isPrimaryTooth)).size !== 1) return false
  const indexes = [...new Set(teeth.map(archIndex))].sort((a, b) => a - b)
  if (indexes.length !== teeth.length) return false
  for (let i = 1; i < indexes.length; i++) {
    const step = indexes[i]! - indexes[i - 1]!
    // -1 to 1 skips zero: there is no tooth on the midline itself.
    const crossesMidline = indexes[i - 1] === -1 && indexes[i] === 1
    if (step !== 1 && !crossesMidline) return false
  }
  return true
}

/** Chart order, for sorting any list of teeth the way the chart reads. */
export function chartOrder(fdi: string): number {
  const all = [...PERMANENT_TEETH, ...PRIMARY_TEETH]
  const index = all.indexOf(fdi)
  return index === -1 ? Number.MAX_SAFE_INTEGER : index
}
