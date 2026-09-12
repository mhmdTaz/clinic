import type { Metadata } from 'next'
import { getLocale, getTranslations } from 'next-intl/server'
import { APPOINTMENT_STATUSES } from '@clinic/config'
import { localDateIn, type AppointmentListQuery, type AppointmentStatus } from '@clinic/contracts'
import { holds } from '@clinic/core/access'
import { listAppointments } from '@clinic/core/appointments'
import { getClinicSessionInfo } from '@clinic/core/clinic'
import { listDoctors } from '@clinic/core/doctors'
import { EmptyState } from '@/components/portal/empty-state'
import { PageHeader } from '@/components/portal/page-header'
import { AppointmentActions } from '@/components/scheduling/appointment-actions'
import { AppointmentCard } from '@/components/scheduling/appointment-card'
import { Board, type BoardColumn } from '@/components/scheduling/board'
import { BookAppointmentDialog } from '@/components/scheduling/book-appointment-dialog'
import { CalendarToolbar } from '@/components/scheduling/calendar-toolbar'
import { requirePortal } from '@/lib/auth/server-session'
import {
  datesBetween,
  formatCalendarDate,
  formatDayHeading,
  isCalendarDate,
  shiftDate,
  startOfWeek,
} from '@/lib/format/dates'
import { groupByDate, groupByDoctor } from '@/lib/scheduling/group'
import { param, type SearchParams } from '@/lib/server/page-helpers'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('staff.appointments')
  return { title: t('title') }
}

export default async function StaffCalendarPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requirePortal('staff')
  const [values, clinic, locale] = await Promise.all([
    searchParams,
    getClinicSessionInfo(actor.clinicId),
    getLocale(),
  ])

  const today = localDateIn(clinic.timezone)
  const requested = param(values, 'date')
  const date = requested && isCalendarDate(requested) ? requested : today
  const view = param(values, 'view') === 'week' ? 'week' : 'day'
  const status = param(values, 'status')
  const doctorId = param(values, 'doctorId')

  const from = view === 'week' ? startOfWeek(date) : date
  const to = view === 'week' ? shiftDate(from, 6) : date
  const query: AppointmentListQuery = {
    from,
    to,
    doctorId,
    status: APPOINTMENT_STATUSES.includes(status as AppointmentStatus)
      ? (status as AppointmentStatus)
      : undefined,
  }

  const [appointments, doctors, t, tScheduling] = await Promise.all([
    listAppointments(actor, query),
    holds(actor, 'doctor:read') ? listDoctors(actor, { status: 'active' }) : [],
    getTranslations('staff.appointments'),
    getTranslations('scheduling'),
  ])

  const doctorOptions = doctors.map((doctor) => ({
    id: doctor.id,
    name: [doctor.title, doctor.displayName].filter(Boolean).join(' '),
  }))
  const book =
    holds(actor, 'appointment:create') && doctorOptions.length > 0 ? (
      <BookAppointmentDialog
        doctors={doctorOptions}
        date={date}
        locale={locale}
        timeZone={clinic.timezone}
        label={tScheduling('actions.book')}
        followDate
      />
    ) : null

  const card = (appointment: (typeof appointments)[number], withActions: boolean) => (
    <AppointmentCard
      key={appointment.id}
      appointment={appointment}
      locale={locale}
      timeZone={clinic.timezone}
      href={`/staff/appointments/${appointment.id}`}
      show={{ patient: true, doctor: view === 'week', recordNumber: true }}
      actions={
        withActions ? (
          <AppointmentActions
            actor={actor}
            appointment={appointment}
            locale={locale}
            timeZone={clinic.timezone}
          />
        ) : null
      }
    />
  )

  const columns: BoardColumn[] =
    view === 'week'
      ? groupByDate(appointments, datesBetween(from, to), clinic.timezone).map((column) => ({
          id: column.date,
          heading: formatDayHeading(column.date, locale),
          note: t('count', { count: column.items.length }),
          highlight: column.date === today,
          empty: t('noneThisDay'),
          // A week is for seeing the shape of it; a single day is where the day is worked.
          items: column.items.map((appointment) => card(appointment, false)),
        }))
      : groupByDoctor(appointments).map((column) => ({
          id: column.id,
          heading: column.name,
          note: t('count', { count: column.items.length }),
          empty: t('noneThisDay'),
          items: column.items.map((appointment) => card(appointment, true)),
        }))

  const heading =
    view === 'week'
      ? t('weekOf', { date: formatCalendarDate(from, locale) })
      : formatCalendarDate(date, locale, 'full')

  return (
    <>
      <PageHeader title={t('title')} subtitle={heading} actions={book} />

      <div className="flex flex-col gap-6">
        <CalendarToolbar
          date={date}
          view={view}
          today={today}
          filters={[
            ...(doctorOptions.length > 1
              ? [
                  {
                    param: 'doctorId',
                    label: t('doctorFilter'),
                    value: doctorId ?? '',
                    options: [
                      { value: '', label: t('allDoctors') },
                      ...doctorOptions.map((doctor) => ({ value: doctor.id, label: doctor.name })),
                    ],
                  },
                ]
              : []),
            {
              param: 'status',
              label: t('statusFilter'),
              value: query.status ?? '',
              options: [
                { value: '', label: t('allStatuses') },
                ...APPOINTMENT_STATUSES.map((key) => ({
                  value: key,
                  label: tScheduling(`statuses.${key}`),
                })),
              ],
            },
          ]}
        />

        {columns.length === 0 ? (
          <EmptyState title={t('emptyTitle')} body={t('emptyBody')} action={book} />
        ) : (
          <Board columns={columns} label={t('title')} />
        )}
      </div>
    </>
  )
}
