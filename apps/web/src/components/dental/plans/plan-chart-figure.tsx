'use client'

import { useCallback, useMemo } from 'react'
import { useTranslations } from 'next-intl'
import type { DentalChart, TreatmentPlan } from '@clinic/contracts'
import { Odontogram2D } from '../odontogram-2d'
import { teethForPlan } from './plan-money'

/**
 * The flat chart with a plan on it: everything already done, and of the work still to do only
 * this plan's. The same picture the presentation shows, for paper.
 */
export function PlanChartFigure({ chart, plan }: { chart: DentalChart; plan: TreatmentPlan }) {
  const t = useTranslations('dental')
  const teeth = useMemo(() => teethForPlan(chart.teeth, plan.items), [chart.teeth, plan.items])
  const toothLabel = useCallback(
    (fdi: string) => {
      const quadrant = Number(fdi[0])
      const primary = quadrant >= 5
      return t('tooth', {
        fdi,
        place: t(`quadrants.${primary ? quadrant - 4 : quadrant}`),
        name: t(`${primary ? 'primaryNames' : 'names'}.${fdi[1]}`),
      })
    },
    [t],
  )
  return (
    <Odontogram2D
      dentition={chart.dentition}
      teeth={teeth}
      selected={null}
      highlight={[]}
      onSelect={() => undefined}
      toothLabel={toothLabel}
      labels={{
        right: t('sides.right'),
        left: t('sides.left'),
        upper: t('jaws.upper'),
        lower: t('jaws.lower'),
        chart: t('chartLabel'),
      }}
    />
  )
}
