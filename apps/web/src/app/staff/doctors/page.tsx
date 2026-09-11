import type { Metadata } from 'next'
import Link from 'next/link'
import { getLocale, getTranslations } from 'next-intl/server'
import type { DoctorListQuery } from '@clinic/contracts'
import { holds } from '@clinic/core/access'
import { listDoctors, listSpecialties } from '@clinic/core/doctors'
import { Badge, buttonVariants } from '@clinic/ui'
import { DataTable } from '@/components/data-table/data-table'
import { PageHeader } from '@/components/portal/page-header'
import { UserStatusBadge } from '@/components/portal/status-badges'
import { requirePortal } from '@/lib/auth/server-session'
import { formatMoney } from '@/lib/format/money'
import { param, type SearchParams } from '@/lib/server/page-helpers'
import { SpecialtiesCard } from './specialties-card'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('staff.doctors')
  return { title: t('title') }
}

export default async function DoctorsPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requirePortal('staff')
  const values = await searchParams
  const status = param(values, 'status')
  const query: DoctorListQuery = {
    q: param(values, 'q')?.slice(0, 80),
    specialtyId: param(values, 'specialtyId'),
    status: status === 'inactive' || status === 'all' ? status : 'active',
  }

  const [doctors, specialties, t, tStatus, tCommon, locale] = await Promise.all([
    listDoctors(actor, query),
    listSpecialties(actor),
    getTranslations('staff.doctors'),
    getTranslations('status'),
    getTranslations('common'),
    getLocale(),
  ])

  const add = holds(actor, 'doctor:create') ? (
    <Link href="/staff/doctors/new" className={buttonVariants()}>
      {t('add')}
    </Link>
  ) : null

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} actions={add} />
      <div className="flex flex-col gap-6">
        <DataTable
          label={t('title')}
          columns={[
            { id: 'doctor', header: t('columns.doctor'), priority: 1 },
            { id: 'specialties', header: t('columns.specialties'), priority: 2 },
            { id: 'fee', header: t('columns.fee'), priority: 3, align: 'end' },
            { id: 'accepting', header: t('columns.accepting'), priority: 3 },
            { id: 'account', header: t('columns.account'), priority: 2 },
          ]}
          rows={doctors.map((doctor) => ({
            id: doctor.id,
            href: `/staff/doctors/${doctor.id}`,
            cells: {
              doctor: (
                <span className="flex min-w-0 flex-col">
                  <span className="flex flex-wrap items-center gap-2 font-medium">
                    {[doctor.title, doctor.displayName].filter(Boolean).join(' ')}
                    {doctor.isActive ? null : <Badge tone="neutral">{t('inactiveBadge')}</Badge>}
                  </span>
                  <span className="text-muted-foreground text-xs font-normal break-all">
                    {doctor.email}
                  </span>
                </span>
              ),
              specialties:
                doctor.specialties.length > 0 ? (
                  doctor.specialties.map((specialty) => specialty.name).join(', ')
                ) : (
                  <span className="text-muted-foreground">{tCommon('notSet')}</span>
                ),
              fee: doctor.consultationFee ? (
                <span className="tabular-nums">{formatMoney(doctor.consultationFee, locale)}</span>
              ) : (
                <span className="text-muted-foreground">{tCommon('notSet')}</span>
              ),
              accepting: doctor.isAcceptingNew ? t('accepting') : t('notAccepting'),
              account: (
                <UserStatusBadge
                  status={doctor.accountStatus}
                  label={tStatus(doctor.accountStatus)}
                />
              ),
            },
          }))}
          search={{ placeholder: t('searchPlaceholder'), value: query.q ?? '' }}
          filters={[
            {
              param: 'specialtyId',
              label: t('specialtyFilter'),
              value: query.specialtyId ?? '',
              options: [
                { value: '', label: t('allSpecialties') },
                ...specialties.map((specialty) => ({ value: specialty.id, label: specialty.name })),
              ],
            },
            {
              param: 'status',
              label: t('statusFilter'),
              value: query.status === 'active' ? '' : query.status,
              options: [
                { value: '', label: t('active') },
                { value: 'inactive', label: t('inactive') },
                { value: 'all', label: t('all') },
              ],
            },
          ]}
          empty={{ title: t('emptyTitle'), body: t('emptyBody'), action: add }}
        />

        <SpecialtiesCard specialties={specialties} canManage={holds(actor, 'specialty:manage')} />
      </div>
    </>
  )
}
