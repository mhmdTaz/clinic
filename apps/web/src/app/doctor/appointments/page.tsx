import type { Metadata } from 'next'
import Link from 'next/link'
import { getLocale, getTranslations } from 'next-intl/server'
import { APPOINTMENT_STATUSES } from '@clinic/config'
import { localDateIn, type AppointmentStatus } from '@clinic/contracts'
import { holds } from '@clinic/core/access'
import { listAppointments } from '@clinic/core/appointments'
import { getClinicSessionInfo } from '@clinic/core/clinic'
import { listEncounters } from '@clinic/core/clinical'
import { buttonVariants } from '@clinic/ui'
import { EmptyState } from '@/components/portal/empty-state'
import { PageHeader } from '@/components/portal/page-header'
import { AppointmentActions } from '@/components/scheduling/appointment-actions'
import { AppointmentCard } from '@/components/scheduling/appointment-card'
import { Board, type BoardColumn } from '@/components/scheduling/board'
import { CalendarToolbar } from '@/components/scheduling/calendar-toolbar'
import { StartEncounterButton } from '@/components/clinical/start-encounter-button'
import { requirePortal } from '@/lib/auth/server-session'
import { TruncatedNotice } from '@/components/portal/truncated-notice'
import { collectByIds, collectPages } from '@/lib/server/pages'
import {
  datesBetween,
  formatCalendarDate,
  formatDayHeading,
  isCalendarDate,
  shiftDate,
  startOfWeek,
} from '@/lib/format/dates'
import { groupByDate } from '@/lib/scheduling/group'
import { param, type SearchParams } from '@/lib/server/page-helpers'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('doctor.appointments')
  return { title: t('title') }
}

/** More appointments than any doctor's week holds; a board past it says it stopped short. */
const CALENDAR_MAX = 2000

export default async function DoctorAgendaPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requirePortal('doctor')
  const [values, clinic, locale, t, tScheduling] = await Promise.all([
    searchParams,
    getClinicSessionInfo(actor.clinicId),
    getLocale(),
    getTranslations('doctor.appointments'),
    getTranslations('scheduling'),
  ])

  const today = localDateIn(clinic.timezone)
  const requested = param(values, 'date')
  const date = requested && isCalendarDate(requested) ? requested : today
  const view = param(values, 'view') === 'week' ? 'week' : 'day'
  const status = param(values, 'status')

  // An account with no doctor profile reaches nothing (ADR-0004), and saying so plainly is
  // kinder than the refusal the list would otherwise raise.
  if (!actor.doctorId) {
    return (
      <>
        <PageHeader title={t('title')} />
        <EmptyState title={tScheduling('noDoctorProfile')} body={tScheduling('askAnAdmin')} />
      </>
    )
  }

  const from = view === 'week' ? startOfWeek(date) : date
  const to = view === 'week' ? shiftDate(from, 6) : date
  const { items: appointments, truncated } = await collectPages(
    (page) =>
      listAppointments(actor, {
        from,
        to,
        status: APPOINTMENT_STATUSES.includes(status as AppointmentStatus)
          ? (status as AppointmentStatus)
          : undefined,
        ...page,
      }),
    CALENDAR_MAX,
  )

  /**
   * The visits already recorded against these appointments, so each offers the right next step:
   * open the note that exists, or start the one that does not.
   *
   * By appointment, not by date. The list's date filter is the day a visit *started*, so a visit
   * opened the evening before its appointment was missed, and the agenda offered "Record the visit"
   * for a note that was already signed. Phase 9 worked around that with a week either side; Phase 10
   * gave the encounter list an `appointmentIds` filter, which is the actual question.
   */
  const encounters = holds(actor, 'encounter:read')
    ? await collectByIds(
        appointments.map((appointment) => appointment.id),
        (appointmentIds) => listEncounters(actor, { appointmentIds, limit: appointmentIds.length }),
      )
    : []
  const noteFor = new Map(
    encounters
      .filter((encounter) => encounter.appointmentId)
      .map((encounter) => [encounter.appointmentId ?? '', encounter.id]),
  )

  const dates = view === 'week' ? datesBetween(from, to) : [date]
  const columns: BoardColumn[] = groupByDate(appointments, dates, clinic.timezone).map(
    (column) => ({
      id: column.date,
      heading: formatDayHeading(column.date, locale),
      note: t('count', { count: column.items.length }),
      highlight: column.date === today,
      empty: t('noneThisDay'),
      items: column.items.map((appointment) => (
        <AppointmentCard
          key={appointment.id}
          appointment={appointment}
          locale={locale}
          timeZone={clinic.timezone}
          show={{ patient: true, recordNumber: true }}
          actions={
            view === 'day' ? (
              <div className="flex flex-wrap items-start gap-2">
                <AppointmentActions
                  actor={actor}
                  appointment={appointment}
                  locale={locale}
                  timeZone={clinic.timezone}
                />
                {noteFor.has(appointment.id) ? (
                  <Link
                    href={`/doctor/encounters/${noteFor.get(appointment.id) ?? ''}`}
                    className={buttonVariants({ variant: 'outline', size: 'sm' })}
                  >
                    {t('openNote')}
                  </Link>
                ) : holds(actor, 'encounter:write') ? (
                  <StartEncounterButton
                    patientId={appointment.patient.id}
                    appointmentId={appointment.id}
                    chiefComplaint={appointment.reason}
                    label={t('recordVisit')}
                    variant="secondary"
                  />
                ) : null}
              </div>
            ) : null
          }
        />
      )),
    }),
  )

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={
          view === 'week'
            ? t('weekOf', { date: formatCalendarDate(from, locale) })
            : formatCalendarDate(date, locale, 'full')
        }
      />

      <div className="flex flex-col gap-6">
        <CalendarToolbar
          date={date}
          view={view}
          today={today}
          filters={[
            {
              param: 'status',
              label: t('statusFilter'),
              value: status ?? '',
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
        <TruncatedNotice shown={appointments.length} truncated={truncated} />
        <Board columns={columns} label={t('title')} />
      </div>
    </>
  )
}
