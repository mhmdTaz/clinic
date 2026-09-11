import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { localDateIn, type PatientListQuery } from '@clinic/contracts'
import { holds } from '@clinic/core/access'
import { getClinicSessionInfo } from '@clinic/core/clinic'
import { listPatients } from '@clinic/core/patients'
import { Badge, buttonVariants } from '@clinic/ui'
import { DataTable } from '@/components/data-table/data-table'
import { PageHeader } from '@/components/portal/page-header'
import { requirePortal } from '@/lib/auth/server-session'
import { ageOn, formatCalendarDate } from '@/lib/format/dates'
import { isInvalidCursor, param, type SearchParams } from '@/lib/server/page-helpers'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('staff.patients')
  return { title: t('title') }
}

export default async function PatientsPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requirePortal('staff')
  const values = await searchParams
  const query: PatientListQuery = {
    q: param(values, 'q')?.slice(0, 80),
    status: param(values, 'status') === 'archived' ? 'archived' : 'active',
    cursor: param(values, 'cursor'),
    limit: 25,
  }

  const page = await listPatients(actor, query).catch((error: unknown) => {
    if (query.cursor && isInvalidCursor(error)) redirect('/staff/patients')
    throw error
  })
  const [clinic, t, tCommon, locale] = await Promise.all([
    getClinicSessionInfo(actor.clinicId),
    getTranslations('staff.patients'),
    getTranslations('common'),
    getLocale(),
  ])
  const today = localDateIn(clinic.timezone)

  const register = holds(actor, 'patient:create') ? (
    <Link href="/staff/patients/new" className={buttonVariants()}>
      {t('register')}
    </Link>
  ) : null

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} actions={register} />
      <DataTable
        label={t('title')}
        columns={[
          { id: 'patient', header: t('columns.patient'), priority: 1 },
          { id: 'born', header: t('columns.born'), priority: 2 },
          { id: 'phone', header: t('columns.phone'), priority: 2 },
          { id: 'portal', header: t('columns.portal'), priority: 3 },
        ]}
        rows={page.items.map((patient) => ({
          id: patient.id,
          href: `/staff/patients/${patient.id}`,
          cells: {
            patient: (
              <span className="flex min-w-0 flex-col">
                <span className="font-medium break-words">
                  {patient.firstName} {patient.lastName}
                </span>
                <span className="text-muted-foreground text-xs font-normal tabular-nums">
                  {patient.medicalRecordNo}
                </span>
              </span>
            ),
            born: patient.dateOfBirth ? (
              <span className="tabular-nums">
                {formatCalendarDate(patient.dateOfBirth, locale)} ·{' '}
                {t('age', { age: ageOn(patient.dateOfBirth, today) })}
              </span>
            ) : (
              <span className="text-muted-foreground">{tCommon('notSet')}</span>
            ),
            phone: patient.phone ? (
              <span className="tabular-nums" dir="ltr">
                {patient.phone}
              </span>
            ) : (
              <span className="text-muted-foreground">{tCommon('notSet')}</span>
            ),
            portal: patient.hasPortalAccount ? (
              <Badge tone="success">{t('portalAccess')}</Badge>
            ) : (
              <span className="text-muted-foreground">{t('noPortal')}</span>
            ),
          },
        }))}
        search={{ placeholder: t('searchPlaceholder'), value: query.q ?? '' }}
        filters={[
          {
            param: 'status',
            label: t('statusFilter'),
            value: query.status === 'archived' ? 'archived' : '',
            options: [
              { value: '', label: t('active') },
              { value: 'archived', label: t('archived') },
            ],
          },
        ]}
        nextCursor={page.nextCursor}
        empty={{ title: t('emptyTitle'), body: t('emptyBody'), action: register }}
      />
    </>
  )
}
