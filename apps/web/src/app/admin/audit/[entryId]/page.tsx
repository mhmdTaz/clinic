import type { Metadata } from 'next'
import { getLocale, getTranslations } from 'next-intl/server'
import { getAuditEntry } from '@clinic/core/audit-explorer'
import { getClinicSessionInfo } from '@clinic/core/clinic'
import { Badge, Card, CardContent, CardHeader, CardTitle } from '@clinic/ui'
import { AuditOutcomeBadge, AuditSeverityBadge } from '@/components/audit/audit-badges'
import { FieldDiff } from '@/components/audit/field-diff'
import { PageHeader } from '@/components/portal/page-header'
import { requirePortal } from '@/lib/auth/server-session'
import { formatInstant } from '@/lib/format/dates'
import { orNotFound, type RouteParams } from '@/lib/server/page-helpers'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.audit')
  return { title: t('entryTitle') }
}

/**
 * One entry, in full — the "and what did they change" half of the exit criterion.
 *
 * Three blocks, in the order somebody reads them: what happened, what changed, and the evidence
 * that the entry is where it says it is. The hashes are shown rather than hidden behind a
 * developer toggle, because an investigator needs to be able to quote them.
 */
export default async function AuditEntryPage({ params }: { params: RouteParams<'entryId'> }) {
  const actor = await requirePortal('admin')
  const { entryId } = await params

  const [entry, clinic, t, tCategory, tSeverity, tOutcome, locale] = await Promise.all([
    orNotFound(getAuditEntry(actor, entryId)),
    getClinicSessionInfo(actor.clinicId),
    getTranslations('admin.audit'),
    getTranslations('audit.categories'),
    getTranslations('audit.severities'),
    getTranslations('audit.outcomes'),
    getLocale(),
  ])

  const metadataEntries = Object.entries(entry.metadata ?? {})

  return (
    <>
      <PageHeader
        // The action name is an identifier; the header renders it verbatim.
        title={entry.action}
        subtitle={formatInstant(entry.occurredAt, locale, clinic.timezone)}
        back={{ href: '/admin/audit', label: t('backToLog') }}
        badges={
          <>
            <Badge tone="neutral">{tCategory(entry.category)}</Badge>
            <AuditSeverityBadge severity={entry.severity} label={tSeverity(entry.severity)} />
            <AuditOutcomeBadge outcome={entry.outcome} label={tOutcome(entry.outcome)} />
          </>
        }
      />

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>{t('whoDidIt')}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[12rem_1fr]">
              <Detail label={t('fields.actor')}>
                <span dir="auto">{entry.actor.label ?? t('systemActor')}</span>
                {entry.actor.roles.length > 0 ? (
                  <span className="text-muted-foreground block text-xs">
                    {entry.actor.roles.join(', ')}
                  </span>
                ) : null}
              </Detail>
              {entry.impersonatorId ? (
                // Somebody acting as somebody else. It goes above the rest, because every fact
                // below it means something different once this line exists (A11).
                <Detail label={t('fields.impersonator')}>
                  <Badge tone="warning">{entry.impersonatorId}</Badge>
                </Detail>
              ) : null}
              <Detail label={t('fields.entity')}>
                {entry.entity ? (
                  <>
                    <span dir="auto">
                      {entry.entity.label ?? entry.entity.id ?? entry.entity.type}
                    </span>
                    <span dir="ltr" className="text-muted-foreground block text-xs">
                      {entry.entity.type}
                      {entry.entity.id ? ` · ${entry.entity.id}` : ''}
                    </span>
                  </>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </Detail>
              <Detail label={t('fields.ipAddress')}>
                {entry.request.ipAddress ? (
                  <span dir="ltr" className="block">
                    {entry.request.ipAddress}
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </Detail>
              <Detail label={t('fields.requestId')}>
                {/* The link to the application trace behind this entry (11.6). */}
                <code dir="ltr" className="block font-mono text-xs break-all">
                  {entry.request.id ?? '—'}
                </code>
              </Detail>
              {entry.request.userAgent ? (
                <Detail label={t('fields.userAgent')}>
                  <span dir="ltr" className="block text-xs break-words">
                    {entry.request.userAgent}
                  </span>
                </Detail>
              ) : null}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('whatChanged')}</CardTitle>
          </CardHeader>
          <CardContent>
            <FieldDiff
              changes={entry.changes}
              labels={{
                field: t('diff.field'),
                before: t('diff.before'),
                after: t('diff.after'),
                redacted: t('diff.redacted'),
                empty: t('diff.none'),
                caption: t('diff.caption'),
              }}
            />
          </CardContent>
        </Card>

        {metadataEntries.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>{t('context')}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[12rem_1fr]">
                {metadataEntries.map(([key, value]) => (
                  <Detail key={key} label={key}>
                    <span dir="auto" className="text-sm break-words">
                      {value === null || value === undefined ? '—' : String(value)}
                    </span>
                  </Detail>
                ))}
              </dl>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>{t('integrity')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-muted-foreground text-sm">{t('integrityBody')}</p>
            <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[12rem_1fr]">
              <Detail label={t('fields.previousHash')}>
                <code dir="ltr" className="block font-mono text-xs break-all">
                  {entry.previousHash ?? '—'}
                </code>
              </Detail>
              <Detail label={t('fields.hash')}>
                <code dir="ltr" className="block font-mono text-xs break-all">
                  {entry.hash ?? '—'}
                </code>
              </Detail>
            </dl>
            {entry.hash === null ? (
              // Written before the chain existed, or by something that bypassed it. Saying so is
              // better than showing an em dash somebody reads as "fine".
              <p className="text-muted-foreground text-sm">{t('unchained')}</p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </>
  )
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </>
  )
}
