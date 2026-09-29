import type { DentalScope, ToothRole, TreatmentPlanStatus } from '@clinic/config'

/**
 * The rules of a treatment plan (Phase 12, ADR-0036). Pure: no clock, no database.
 *
 *   DRAFT ──present──▶ PRESENTED ──accept──▶ ACCEPTED ──(last item done)──▶ COMPLETED
 *     │  ◀───edit─────────┘  │                  │  ▲──(a completion voided)──┘
 *     ├──accept / decline────┴──decline──▶ DECLINED
 *     └──────────────cancel (any of the first three)──────────▶ CANCELLED
 *
 * Editing a presented plan sends it back to DRAFT: what the patient was shown is not what the
 * plan now says, so it has to be shown again. A plan may be accepted straight from DRAFT — at the
 * chair the dentist often talks it through and the patient signs, with no separate showing.
 */

export const isEditable = (status: TreatmentPlanStatus) =>
  status === 'DRAFT' || status === 'PRESENTED'

export const canPresent = (status: TreatmentPlanStatus) =>
  status === 'DRAFT' || status === 'PRESENTED'

export const canDecide = (status: TreatmentPlanStatus) =>
  status === 'DRAFT' || status === 'PRESENTED'

export const canCancel = (status: TreatmentPlanStatus) =>
  status === 'DRAFT' || status === 'PRESENTED' || status === 'ACCEPTED'

/** Done work is billed from an agreed plan, at the agreed price — never from a draft. */
export const canBill = (status: TreatmentPlanStatus) =>
  status === 'ACCEPTED' || status === 'COMPLETED'

/**
 * Where an agreed plan stands once its items have moved. Only an agreed plan follows its items:
 * a draft with everything done is still a draft nobody signed. A plan is complete when nothing is
 * left open and something was done — one whose every item was voided off the chart was not
 * carried out, it fell away, and stays agreed for somebody to cancel with a reason.
 */
export function statusAfterProgress(
  status: TreatmentPlanStatus,
  items: { open: number; done: number },
): TreatmentPlanStatus {
  if (status !== 'ACCEPTED' && status !== 'COMPLETED') return status
  return items.open === 0 && items.done > 0 ? 'COMPLETED' : 'ACCEPTED'
}

export type PlanItemState = 'OPEN' | 'DONE' | 'DROPPED'

/**
 * An item's state, from the chart. A planned row that was voided takes its item with it: the
 * dentist decided it was a mistake, and the patient is not asked to pay for it.
 */
export function itemState(planned: { voided: boolean }, completion: unknown): PlanItemState {
  if (planned.voided) return 'DROPPED'
  return completion ? 'DONE' : 'OPEN'
}

/**
 * How many units a piece of planned work is priced as, when the plan does not say.
 *
 * A bridge is priced per unit — every abutment and every pontic is a crown the lab makes — and so
 * is a denture's tooth count when the clinic prices it that way. Everything else is one: a crown
 * is one crown, a filling on three surfaces is one filling.
 */
export function defaultQuantity(work: {
  scope: DentalScope
  teeth: ReadonlyArray<{ role: ToothRole | null }>
}): string {
  if (work.scope === 'SPAN') return String(Math.max(1, work.teeth.length))
  return '1'
}

/** "Porcelain-fused-to-metal crown — 16", "Composite filling (MO) — 24", "Bridge — 45–47". */
export function describeWork(work: {
  name: string
  teeth: ReadonlyArray<{ fdi: string }>
  surfaces: readonly string[]
}): string {
  const teeth = work.teeth.map((tooth) => tooth.fdi)
  const where = teeth.length > 2 ? `${teeth[0]}–${teeth[teeth.length - 1]}` : teeth.join(', ')
  const surfaces = work.surfaces.length > 0 ? ` (${work.surfaces.join('')})` : ''
  return `${work.name}${surfaces} — ${where}`
}
