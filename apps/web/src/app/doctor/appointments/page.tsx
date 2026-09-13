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
  const appointments = await listAppointments(actor, {
    from,
    to,
    status: APPOINTMENT_STATUSES.includes(status as AppointmentStatus)
      ? (status as AppointmentStatus)
      : undefined,
  })

  /**
   * The visits already recorded for this range, so each appointment offers the right next step:
   * open the note that exists, or start the one that does not. One query for the range rather
   * than one per card.
   *
   * A week wider on each side, because the list filters by the day a visit *started*: a visit
   * opened the evening before its appointment, or written up the morning after, is on another day,
   * and matching on the range alone offered "Record the visit" for an appointment whose note was
   * already signed — which the server then refused. Found by the mobile app (Phase 9).
   */
  const encounters = holds(actor, 'encounter:read')
    ? await listEncounters(actor, { from: shiftDate(from, -7), to: shiftDate(to, 7) })
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
        <Board columns={columns} label={t('title')} />
      </div>
    </>
  )
}
