import Link from 'next/link'
import { getLocale, getTranslations } from 'next-intl/server'
import type { EncounterSummary } from '@clinic/contracts'
import { Badge } from '@clinic/ui'
import { EmptyState } from '@/components/portal/empty-state'
import { formatInstant } from '@/lib/format/dates'

/**
 * The visit history, as a chart timeline (D4) or a patient's own record of their care (P4, P10).
 *
 * It lists what happened and what it was decided to be — never the note's text. A timeline is a
 * list of visits, so the note is not read out of the database for any audience here (ADR-0025).
 */
export async function EncounterList({
  encounters,
  timeZone,
  hrefFor,
  show,
  emptyTitle,
  emptyBody,
}: {
  encounters: EncounterSummary[]
  timeZone: string
  hrefFor?: (encounter: EncounterSummary) => string
  show: { patient?: boolean; doctor?: boolean }
  emptyTitle: string
  emptyBody?: string
}) {
  const [t, locale] = await Promise.all([getTranslations('clinical.encounters'), getLocale()])

  if (encounters.length === 0) return <EmptyState title={emptyTitle} body={emptyBody} />

  return (
    <ul className="divide-border flex flex-col divide-y">
      {encounters.map((encounter) => {
        const href = hrefFor?.(encounter)
        const title = show.patient ? encounter.patient.name : encounter.doctor.name
        return (
          <li key={encounter.id} className="flex flex-col gap-1.5 py-4 first:pt-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">
                {href ? (
                  <Link href={href} className="hover:underline">
                    {title}
                  </Link>
                ) : (
                  title
                )}
              </span>
              <Badge tone={encounter.noteStatus === 'SIGNED' ? 'success' : 'warning'}>
                {t(`noteStatuses.${encounter.noteStatus}`)}
              </Badge>
              {encounter.status === 'OPEN' ? <Badge tone="info">{t('open')}</Badge> : null}
            </div>

            <span className="text-muted-foreground text-xs">
              {/* The clinic's own zone, so a visit is dated the day the clinic saw it (ADR-0010). */}
              {formatInstant(encounter.startedAt, locale, timeZone)} ·{' '}
              <span className="tabular-nums">{encounter.number}</span>
              {show.doctor && show.patient ? ` · ${encounter.doctor.name}` : ''}
            </span>

            {encounter.chiefComplaint ? (
              <span className="text-sm break-words">{encounter.chiefComplaint}</span>
            ) : null}

            {encounter.diagnoses.length > 0 ? (
              <ul className="flex flex-wrap gap-1.5">
                {encounter.diagnoses.map((diagnosis) => (
                  <li key={diagnosis.id}>
                    <Badge tone={diagnosis.isPrimary ? 'info' : 'neutral'}>
                      <span className="tabular-nums">{diagnosis.code}</span> —{' '}
                      {diagnosis.description}
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}
