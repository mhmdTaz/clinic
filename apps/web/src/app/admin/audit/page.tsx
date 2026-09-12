import type { Metadata } from 'next'
import { getLocale, getTranslations } from 'next-intl/server'
import { AUDIT_CATEGORIES, AUDIT_OUTCOMES, AUDIT_SEVERITIES } from '@clinic/config'
import { localDateIn, type AuditListQuery } from '@clinic/contracts'
import { listAuditEntries, auditActorOptions, verifyAuditChain } from '@clinic/core/audit-explorer'
import { getClinicSessionInfo } from '@clinic/core/clinic'
import { DataTable } from '@/components/data-table/data-table'
import { AuditSeverityBadge, AuditOutcomeBadge } from '@/components/audit/audit-badges'
import { ChainStatusBanner } from '@/components/audit/chain-status-banner'
import { PageHeader } from '@/components/portal/page-header'
import { requirePortal } from '@/lib/auth/server-session'
import { formatInstant } from '@/lib/format/dates'
import { param, type SearchParams } from '@/lib/server/page-helpers'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.audit')
  return { title: t('title') }
}

const oneOf = <T extends string>(values: readonly T[], value: string | undefined): T | undefined =>
  value !== undefined && (values as readonly string[]).includes(value) ? (value as T) : undefined

/**
 * The audit log explorer (A5, section 11.6) — **Phase 8's first exit criterion**: an admin can
 * answer "who viewed this patient's file last Tuesday, and what did they change" in under a
 * minute.
 *
 * That sentence is three filters — an entity, a date range, and reads-only — so all three are on
 * the screen rather than behind a menu, and the address carries them, which means the answer is
 * a link somebody can paste into a ticket.
 *
 * Opening this page writes an `audit.viewed` entry of its own. That is not a side effect to be
 * apologised for; it is the feature.
 */
export default async function AuditExplorerPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requirePortal('admin')
  const values = await searchParams

  const query: AuditListQuery = {
    actorId: param(values, 'actorId'),
    entityType: param(values, 'entityType'),
    entityId: param(values, 'entityId'),
    action: param(values, 'action'),
    category: oneOf(AUDIT_CATEGORIES, param(values, 'category')),
    severity: oneOf(AUDIT_SEVERITIES, param(values, 'severity')),
    outcome: oneOf(AUDIT_OUTCOMES, param(values, 'outcome')),
    from: param(values, 'from'),
    to: param(values, 'to'),
    readsOnly: param(values, 'readsOnly') === 'yes',
    cursor: param(values, 'cursor'),
    limit: 50,
  }

  const [clinic, page, actors, chain, t, tCategory, tSeverity, tOutcome, locale] =
    await Promise.all([
      getClinicSessionInfo(actor.clinicId),
      listAuditEntries(actor, query),
      auditActorOptions(actor),
      verifyAuditChain(actor, { limit: 5_000 }),
      getTranslations('admin.audit'),
      getTranslations('audit.categories'),
      getTranslations('audit.severities'),
      getTranslations('audit.outcomes'),
      getLocale(),
    ])

  const today = localDateIn(clinic.timezone)
  const anyOption = { value: '', label: t('filters.any') }

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <ChainStatusBanner status={chain} />
      <DataTable
        label={t('title')}
        columns={[
          { id: 'what', header: t('columns.what'), priority: 1 },
          { id: 'who', header: t('columns.who'), priority: 2 },
          { id: 'entity', header: t('columns.entity'), priority: 3 },
          { id: 'when', header: t('columns.when'), priority: 2 },
        ]}
        filters={[
          {
            param: 'actorId',
            label: t('filters.actor'),
            value: query.actorId ?? '',
            options: [anyOption, ...actors.map((one) => ({ value: one.id, label: one.name }))],
          },
          {
            param: 'category',
            label: t('filters.category'),
            value: query.category ?? '',
            options: [
              anyOption,
              ...AUDIT_CATEGORIES.map((one) => ({ value: one, label: tCategory(one) })),
            ],
          },
          {
            param: 'outcome',
            label: t('filters.outcome'),
            value: query.outcome ?? '',
            options: [
              anyOption,
              ...AUDIT_OUTCOMES.map((one) => ({ value: one, label: tOutcome(one) })),
            ],
          },
          {
            // The "who has been looking" half of the exit criterion, as one switch.
            param: 'readsOnly',
            label: t('filters.kind'),
            value: query.readsOnly ? 'yes' : '',
            options: [
              { value: '', label: t('filters.everything') },
              { value: 'yes', label: t('filters.readsOnly') },
            ],
          },
        ]}
        dateRange={{
          fromParam: 'from',
          toParam: 'to',
          from: query.from ?? '',
          to: query.to ?? '',
          fromLabel: t('filters.from'),
          toLabel: t('filters.to'),
          max: today,
        }}
        exportCsv={{ href: '/api/v1/admin/audit-logs/export', label: t('export') }}
        // The entity and action filters arrive as plain search parameters rather than as
        // controls the table owns, so it has to be told they are in play — otherwise a search
        // that matched nothing says "nothing recorded yet", which reads as "the log is empty".
        isFiltered={Boolean(query.entityType ?? query.entityId ?? query.action ?? query.severity)}
        rows={page.items.map((entry) => ({
          id: entry.id,
          href: `/admin/audit/${entry.id}`,
          cells: {
            what: (
              <span className="flex min-w-0 flex-col">
                {/* An action name is an identifier, never prose. `dir="ltr"` stops the bidi
                    algorithm from reordering it inside an RTL page. */}
                <span dir="ltr" className="font-medium break-words">
                  {entry.action}
                </span>
                <span className="text-muted-foreground text-xs font-normal">
                  {tCategory(entry.category)}
                  {entry.changeCount > 0
                    ? ` · ${t('fieldsChanged', { count: entry.changeCount })}`
                    : ''}
                </span>
              </span>
            ),
            who: (
              <span className="flex flex-col gap-1">
                {/* A person's name may be in either script. `auto` takes the direction from the
                    name itself rather than from the page. */}
                <span dir="auto">{entry.actor.label ?? t('systemActor')}</span>
                <span className="flex flex-wrap items-center gap-1.5">
                  <AuditSeverityBadge severity={entry.severity} label={tSeverity(entry.severity)} />
                  {entry.outcome === 'SUCCESS' ? null : (
                    <AuditOutcomeBadge outcome={entry.outcome} label={tOutcome(entry.outcome)} />
                  )}
                </span>
              </span>
            ),
            entity: entry.entity ? (
              <span className="text-sm">
                {/* The label if the capture had one, otherwise the id — never the type twice,
                    which is what "Patient / Patient" would read as. */}
                <span dir="auto">{entry.entity.label ?? entry.entity.id ?? entry.entity.type}</span>
                <span className="text-muted-foreground block text-xs">
                  {(entry.entity.label ?? entry.entity.id) ? entry.entity.type : t('noRecordId')}
                </span>
              </span>
            ) : (
              <span className="text-muted-foreground">—</span>
            ),
            when: (
              <span className="text-sm">
                {formatInstant(entry.occurredAt, locale, clinic.timezone)}
              </span>
            ),
          },
        }))}
        nextCursor={page.nextCursor}
        empty={{ title: t('none'), body: t('noneBody') }}
      />
    </>
  )
}
