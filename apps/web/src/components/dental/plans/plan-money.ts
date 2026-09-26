import {
  addAmounts,
  isNegativeAmount,
  multiplyAmount,
  percentOf,
  subtractAmounts,
  type DentalScope,
  type ToothState,
  type TreatmentPlanStatus,
} from '@clinic/contracts'

/**
 * A plan's figures while it is being drawn up. The same order of operations as the server
 * (ADR-0027): multiply, discount, tax, round once per line, then sum the rounded lines. The server
 * prices the plan again when it is saved, and its figures are the ones kept; a figure mid-typing
 * that does not parse contributes nothing rather than throwing the preview away.
 */
export interface PreviewLine {
  quantity: string
  unitPrice: string
  discount: string
  taxRatePercent: string
}

export function previewLine(line: PreviewLine, currency: string): string | null {
  try {
    const gross = multiplyAmount(currency, line.unitPrice || '0', line.quantity || '0')
    const net = subtractAmounts(currency, gross, line.discount || '0')
    if (isNegativeAmount(net)) return null
    return addAmounts(currency, net, percentOf(currency, net, line.taxRatePercent || '0'))
  } catch {
    return null
  }
}

export function previewTotal(lines: readonly PreviewLine[], currency: string): string {
  return addAmounts(
    currency,
    ...lines.map((line) => previewLine(line, currency)).filter((v): v is string => v !== null),
  )
}

/** The server's default (see `defaultQuantity`): a bridge per unit, anything else as one. */
export const usualQuantity = (scope: DentalScope, teeth: number) =>
  scope === 'SPAN' ? String(Math.max(1, teeth)) : '1'

export const PLAN_TONES: Record<
  TreatmentPlanStatus,
  'neutral' | 'info' | 'success' | 'warning' | 'danger'
> = {
  DRAFT: 'neutral',
  PRESENTED: 'info',
  ACCEPTED: 'warning',
  COMPLETED: 'success',
  DECLINED: 'danger',
  CANCELLED: 'neutral',
}

/**
 * The chart as a plan shows it: everything already done, for context; of the work still to do,
 * only this plan's; and the findings on the teeth the plan treats — the reason for the work.
 */
export function teethForPlan(
  teeth: readonly ToothState[],
  items: ReadonlyArray<{ toothRecordId: string; teeth: ReadonlyArray<{ fdi: string }> }>,
): ToothState[] {
  const records = new Set(items.map((item) => item.toothRecordId))
  const treated = new Set(items.flatMap((item) => item.teeth.map((tooth) => tooth.fdi)))
  return teeth.map((tooth) => ({
    ...tooth,
    marks: tooth.marks.filter((mark) =>
      mark.status === 'PLANNED'
        ? records.has(mark.recordId)
        : mark.status === 'CONDITION'
          ? treated.has(tooth.fdi)
          : true,
    ),
  }))
}
