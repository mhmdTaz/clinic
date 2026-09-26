import type {
  DentalSymbol,
  Dentition,
  ToothRecordStatus,
  ToothRole,
  ToothSurface,
} from '@clinic/config'
import { chartOrder, teethOf } from './fdi'

/**
 * From the log to the picture (ADR-0035).
 *
 * The tooth chart stores what was done, one row at a time, and never repaints anything. This is
 * where the rows become what a tooth shows: which marks are still worth drawing, and whether the
 * tooth is in the mouth at all. It is pure — no clock, no database — so the same rows always
 * draw the same chart, and replaying the chart on an earlier day is only a matter of which rows
 * go in.
 */

export interface ChartableRecord {
  id: string
  encounterId: string | null
  teeth: ReadonlyArray<{ fdi: string; role: ToothRole | null }>
  surfaces: readonly ToothSurface[]
  symbol: DentalSymbol
  treatmentName: string
  status: ToothRecordStatus
  completesRecordId: string | null
  performedOn: string
  createdAt: Date
  voided: boolean
}

export interface Mark {
  recordId: string
  symbol: DentalSymbol
  status: ToothRecordStatus
  surfaces: ToothSurface[]
  role: ToothRole | null
  treatmentName: string
  performedOn: string
}

export interface DerivedTooth {
  fdi: string
  present: boolean
  marks: Mark[]
}

export interface DerivedChart {
  teeth: DerivedTooth[]
  lastCharted: { performedOn: string; encounterId: string | null; teeth: string[] } | null
  history: string[]
}

const DONE: ReadonlySet<ToothRecordStatus> = new Set(['COMPLETED', 'EXISTING'])
const REMOVES: ReadonlySet<DentalSymbol> = new Set(['EXTRACTION', 'MISSING'])

/**
 * Whether a later mark on a tooth hides an earlier one from the picture. Both marks stay in the
 * tooth's history either way; this only decides what is drawn.
 *
 * `later` was charted after `earlier` on the same tooth. Neither is voided, and a plan that has
 * since been carried out is already gone.
 */
export function supersedes(later: Mark, earlier: Mark): boolean {
  // TODO(you): the clinical rule — see the request in the Phase 11 hand-over. Until it is written,
  // nothing hides anything: every mark is drawn, which is safe and only cluttered.
  void later
  void earlier
  return false
}

/**
 * A tooth is out of the mouth once it has been extracted or found missing, until something
 * stands in for it: an implant, or a bridge or denture that carries a tooth in its place.
 */
function isPresent(marks: readonly Mark[]): boolean {
  let present = true
  for (const mark of marks) {
    if (!DONE.has(mark.status)) continue
    if (REMOVES.has(mark.symbol)) present = false
    else if (mark.symbol === 'IMPLANT' || mark.role === 'PONTIC' || mark.role === 'DENTURE_TOOTH') {
      present = true
    }
  }
  return present
}

const byWhenCharted = (a: ChartableRecord, b: ChartableRecord) =>
  a.performedOn === b.performedOn
    ? a.createdAt.getTime() - b.createdAt.getTime()
    : a.performedOn < b.performedOn
      ? -1
      : 1

export function deriveChart(input: {
  records: readonly ChartableRecord[]
  dentition: Dentition
  /** The last day to include. Null draws everything, which is today. */
  asOf: string | null
}): DerivedChart {
  const live = input.records.filter((record) => !record.voided).sort(byWhenCharted)
  const history = [...new Set(live.map((record) => record.performedOn))]

  const included = input.asOf ? live.filter((record) => record.performedOn <= input.asOf!) : live
  // A plan that has been carried out is replaced by the row that carried it out.
  const carriedOut = new Set(
    included.flatMap((record) =>
      record.status === 'COMPLETED' && record.completesRecordId ? [record.completesRecordId] : [],
    ),
  )

  const perTooth = new Map<string, Mark[]>()
  for (const record of included) {
    if (record.status === 'PLANNED' && carriedOut.has(record.id)) continue
    for (const tooth of record.teeth) {
      const marks = perTooth.get(tooth.fdi) ?? []
      marks.push({
        recordId: record.id,
        symbol: record.symbol,
        status: record.status,
        surfaces: [...record.surfaces],
        role: tooth.role,
        treatmentName: record.treatmentName,
        performedOn: record.performedOn,
      })
      perTooth.set(tooth.fdi, marks)
    }
  }

  // Every tooth of the dentition, and any tooth charted outside it: a chart never hides a row.
  const numbers = [...new Set([...teethOf(input.dentition), ...perTooth.keys()])].sort(
    (a, b) => chartOrder(a) - chartOrder(b),
  )

  const teeth = numbers.map((fdi): DerivedTooth => {
    const all = perTooth.get(fdi) ?? []
    const visible = all.filter(
      (mark, index) => !all.slice(index + 1).some((later) => supersedes(later, mark)),
    )
    return { fdi, present: isPresent(all), marks: visible }
  })

  const last = included.at(-1)
  const lastCharted = last
    ? {
        performedOn: last.performedOn,
        encounterId: last.encounterId,
        teeth: [
          ...new Set(
            included
              .filter((record) => record.performedOn === last.performedOn)
              .flatMap((record) => record.teeth.map((tooth) => tooth.fdi)),
          ),
        ].sort((a, b) => chartOrder(a) - chartOrder(b)),
      }
    : null

  return { teeth, lastCharted, history }
}
