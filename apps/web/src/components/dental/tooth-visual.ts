import type { DentalSymbol, ToothMark, ToothRecordStatus, ToothState } from '@clinic/contracts'

/**
 * What a tooth looks like, worked out once from its marks and shared by the 3D jaw and the 2D
 * chart, so the two views can never disagree about a tooth.
 *
 * Red is still to do (a finding, or planned work); blue is done (here, or before the patient
 * came). A mark is always drawn with its words as well as its colour, never colour alone.
 */

export type Tone = 'done' | 'todo'

export const toneOf = (status: ToothRecordStatus): Tone =>
  status === 'COMPLETED' || status === 'EXISTING' ? 'done' : 'todo'

const isDone = (mark: ToothMark) => toneOf(mark.status) === 'done'

export interface ToothVisual {
  fdi: string
  /** Out of the mouth: extracted or missing, with nothing standing in for it. */
  absent: boolean
  /** In the mouth, but not as a natural tooth: the crown carried by an implant or a bridge. */
  replacedBy: 'IMPLANT' | 'PONTIC' | 'DENTURE' | null
  crown: Tone | null
  veneer: Tone | null
  rootCanal: Tone | null
  implant: Tone | null
  extraction: Tone | null
  /** Surfaces with a filling or sealant, and with decay: the 2D surface diagram. */
  surfaces: Partial<Record<'M' | 'D' | 'O' | 'I' | 'B' | 'L', Tone>>
  caries: boolean
  fracture: boolean
  impacted: boolean
  bridgeRole: 'ABUTMENT' | 'PONTIC' | null
  denture: boolean
  /** Anything planned on this tooth: the 3D red glass, the dashed 2D outline. */
  planned: boolean
  /** The most recent mark, for the badge and the hover label. */
  latest: ToothMark | null
}

const last = (marks: readonly ToothMark[], symbol: DentalSymbol) =>
  [...marks].reverse().find((mark) => mark.symbol === symbol)

export function toothVisual(tooth: ToothState): ToothVisual {
  const marks = tooth.marks
  const toneFor = (symbol: DentalSymbol): Tone | null => {
    const mark = last(marks, symbol)
    return mark ? toneOf(mark.status) : null
  }

  let replacedBy: ToothVisual['replacedBy'] = null
  for (const mark of marks) {
    if (!isDone(mark)) continue
    if (mark.symbol === 'EXTRACTION' || mark.symbol === 'MISSING') replacedBy = null
    else if (mark.symbol === 'IMPLANT') replacedBy = 'IMPLANT'
    else if (mark.role === 'PONTIC') replacedBy = 'PONTIC'
    else if (mark.role === 'DENTURE_TOOTH') replacedBy = 'DENTURE'
  }

  const surfaces: ToothVisual['surfaces'] = {}
  for (const mark of marks) {
    if (mark.symbol === 'FILLING' || mark.symbol === 'SEALANT' || mark.symbol === 'CARIES') {
      for (const surface of mark.surfaces) surfaces[surface] = toneOf(mark.status)
    }
  }

  const bridge = last(marks, 'BRIDGE')
  return {
    fdi: tooth.fdi,
    absent: !tooth.present,
    replacedBy: tooth.present ? replacedBy : null,
    crown: bridge?.role === 'ABUTMENT' ? toneOf(bridge.status) : toneFor('CROWN'),
    veneer: toneFor('VENEER'),
    rootCanal: toneFor('ROOT_CANAL'),
    implant: toneFor('IMPLANT'),
    extraction: toneFor('EXTRACTION'),
    surfaces,
    caries: marks.some((mark) => mark.symbol === 'CARIES'),
    fracture: marks.some((mark) => mark.symbol === 'FRACTURE'),
    impacted: marks.some((mark) => mark.symbol === 'IMPACTED'),
    bridgeRole: bridge?.role === 'ABUTMENT' || bridge?.role === 'PONTIC' ? bridge.role : null,
    denture: marks.some((mark) => mark.symbol === 'DENTURE'),
    planned: marks.some((mark) => mark.status === 'PLANNED'),
    latest: marks.at(-1) ?? null,
  }
}

/** Which marks a chart filter lets through. The picture is redrawn from what is left. */
export type ChartFilter = 'all' | 'todo' | 'done' | 'lastCharted'

export function filterTeeth(
  teeth: readonly ToothState[],
  filter: ChartFilter,
  lastChartedOn: string | null,
): ToothState[] {
  if (filter === 'all') return [...teeth]
  const keep = (mark: ToothMark) =>
    filter === 'todo'
      ? toneOf(mark.status) === 'todo'
      : filter === 'done'
        ? toneOf(mark.status) === 'done'
        : mark.performedOn === lastChartedOn
  // Presence is the tooth's, not a filter's: a filtered view never puts an extracted tooth back.
  return teeth.map((tooth) => ({ ...tooth, marks: tooth.marks.filter(keep) }))
}
