import type { Metadata } from 'next'
import { getLocale, getTranslations } from 'next-intl/server'
import { localDateIn } from '@clinic/contracts'
import { listMyPatients } from '@clinic/core/clinical'
import { getClinicSessionInfo } from '@clinic/core/clinic'
import { DataTable } from '@/components/data-table/data-table'
import { EmptyState } from '@/components/portal/empty-state'
import { PageHeader } from '@/components/portal/page-header'
import { requirePortal } from '@/lib/auth/server-session'
import { ageOn, formatCalendarDate } from '@/lib/format/dates'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('doctor.patients')
  return { title: t('title') }
}

/**
 * "My patients" (D3): everyone this doctor has treated, newest visit first.
 *
 * Not the clinic's directory filtered down — a query over this doctor's own visits, which is what
 * the question actually is. A doctor holding `patient:read` at ASSIGNED is refused the directory
 * and given this instead (ADR-0004, Phase 4 addendum).
 */
export default async function MyPatientsPage() {
  const actor = await requirePortal('doctor')
  const [patients, clinic, locale, t, tCommon] = await Promise.all([
    listMyPatients(actor),
    getClinicSessionInfo(actor.clinicId),
    getLocale(),
    getTranslations('doctor.patients'),
    getTranslations('common'),
  ])

  const today = localDateIn(clinic.timezone)

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      {patients.length === 0 ? (
        <EmptyState title={t('emptyTitle')} body={t('emptyBody')} />
      ) : (
        <DataTable
          label={t('title')}
          columns={[
            { id: 'patient', header: t('columns.patient'), priority: 1 },
            { id: 'age', header: t('columns.age'), priority: 2 },
            { id: 'contact', header: t('columns.contact'), priority: 3 },
          ]}
          rows={patients.map((patient) => ({
            id: patient.id,
            href: `/doctor/patients/${patient.id}`,
            cells: {
              patient: (
                <span className="flex min-w-0 flex-col">
                  <span className="font-medium">
                    {patient.firstName} {patient.lastName}
                  </span>
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {patient.medicalRecordNo}
                  </span>
                </span>
              ),
              age: patient.dateOfBirth ? (
                <span className="flex min-w-0 flex-col">
                  <span className="tabular-nums">
                    {t('years', { count: ageOn(patient.dateOfBirth, today) })}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {formatCalendarDate(patient.dateOfBirth, locale)}
                  </span>
                </span>
              ) : (
                <span className="text-muted-foreground">{tCommon('notSet')}</span>
              ),
              contact: patient.phone ?? (
                <span className="text-muted-foreground">{tCommon('notSet')}</span>
              ),
            },
          }))}
          empty={{ title: t('emptyTitle'), body: t('emptyBody') }}
        />
      )}
    </>
  )
}
