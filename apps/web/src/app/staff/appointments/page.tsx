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
import { WalkInDialog } from '@/components/scheduling/walk-in-dialog'
import { requirePortal } from '@/lib/auth/server-session'
import { TruncatedNotice } from '@/components/portal/truncated-notice'
import { collectPages } from '@/lib/server/pages'
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

/** The whole clinic's week on one board. Past it, the board says it stopped short. */
const CALENDAR_MAX = 2000

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
  const query: Omit<AppointmentListQuery, 'limit'> = {
    from,
    to,
    doctorId,
    status: APPOINTMENT_STATUSES.includes(status as AppointmentStatus)
      ? (status as AppointmentStatus)
      : undefined,
  }

  // The waiting room is asked for separately so a status filter on the calendar cannot empty
  // it: who is sitting in the clinic right now is not a view of the diary.
  const [calendar, waiting, doctors, t, tScheduling] = await Promise.all([
    collectPages((page) => listAppointments(actor, { ...query, ...page }), CALENDAR_MAX),
    view === 'day'
      ? collectPages(
          (page) =>
            listAppointments(actor, {
              from: date,
              to: date,
              status: 'CHECKED_IN',
              doctorId,
              ...page,
            }),
          CALENDAR_MAX,
        ).then((result) => result.items)
      : [],
    holds(actor, 'doctor:read') ? listDoctors(actor, { status: 'active' }) : [],
    getTranslations('staff.appointments'),
    getTranslations('scheduling'),
  ])

  const appointments = calendar.items

  const doctorOptions = doctors.map((doctor) => ({
    id: doctor.id,
    name: [doctor.title, doctor.displayName].filter(Boolean).join(' '),
  }))
  const mayBook = holds(actor, 'appointment:create') && doctorOptions.length > 0
  const book = mayBook ? (
    <BookAppointmentDialog
      doctors={doctorOptions}
      date={date}
      locale={locale}
      timeZone={clinic.timezone}
      label={tScheduling('actions.book')}
      followDate
    />
  ) : null
  const walkIn =
    mayBook && holds(actor, 'appointment:check_in') ? (
      <WalkInDialog
        doctors={doctorOptions}
        label={tScheduling('actions.walkIn')}
        onDay={{ date, today }}
      />
    ) : null

  const card = (
    appointment: (typeof appointments)[number],
    withActions: boolean,
    // The waiting room always names the doctor: the question there is who this person is for.
    showDoctor = view === 'week',
  ) => (
    <AppointmentCard
      key={appointment.id}
      appointment={appointment}
      locale={locale}
      timeZone={clinic.timezone}
      href={`/staff/appointments/${appointment.id}`}
      show={{ patient: true, doctor: showDoctor, recordNumber: true }}
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
      <PageHeader
        title={t('title')}
        subtitle={heading}
        actions={
          <>
            {walkIn}
            {book}
          </>
        }
      />

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

        {waiting.length > 0 ? (
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">
              {t('waiting')}{' '}
              <span className="text-muted-foreground text-sm font-normal">
                {t('waitingCount', { count: waiting.length })}
              </span>
            </h2>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {waiting.map((appointment) => card(appointment, true, true))}
            </div>
          </section>
        ) : null}

        {columns.length === 0 ? (
          <EmptyState title={t('emptyTitle')} body={t('emptyBody')} action={book} />
        ) : (
          <>
            <TruncatedNotice shown={appointments.length} truncated={calendar.truncated} />
            <Board columns={columns} label={t('title')} />
          </>
        )}
      </div>
    </>
  )
}
