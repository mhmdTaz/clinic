import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { localDateIn, type AppointmentSummary } from '@clinic/contracts'
import { holds, type Actor } from '@clinic/core/access'
import { holdsSlot, listAppointments } from '@clinic/core/appointments'
import { listInvoices } from '@clinic/core/billing'
import { listEncounters } from '@clinic/core/clinical'
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  buttonVariants,
} from '@clinic/ui'
import { StartEncounterButton } from '@/components/clinical/start-encounter-button'
import { AppointmentActions } from '@/components/scheduling/appointment-actions'
import { AppointmentCard } from '@/components/scheduling/appointment-card'
import { formatCalendarDate, formatInstant, shiftDate } from '@/lib/format/dates'
import { formatMoney } from '@/lib/format/money'

/**
 * What each role came to the home page to do next (audit F08). Before, all three home pages
 * showed the clinic's address and opening hours and nothing else.
 *
 * Each section is shown only to someone holding the permission its data needs, and reads through
 * the same use cases — and so the same scopes — as the page it links to. A custom role missing
 * one permission loses that section, not the page. Every read is one bounded page: a home page
 * must not grow with the clinic.
 */

/** "Today" is the clinic's today, wherever the person looking is. */
const todayIn = (timeZone: string) => localDateIn(timeZone)

/** Enough to act on from the home page; the full list is a link away. */
const QUEUE_LIMIT = 100
const SHOWN = 6

const STILL_AHEAD = (appointment: AppointmentSummary) => holdsSlot(appointment.status)

// ── Staff ────────────────────────────────────────────────────────────────────

export async function StaffToday({
  actor,
  locale,
  timeZone,
}: {
  actor: Actor
  locale: string
  timeZone: string
}) {
  const t = await getTranslations('home')
  const today = todayIn(timeZone)
  const canRead = holds(actor, 'appointment:read')
  const page = canRead
    ? await listAppointments(actor, { from: today, to: today, limit: QUEUE_LIMIT })
    : null
  const items = page?.items ?? []
  const count = (...statuses: AppointmentSummary['status'][]) =>
    items.filter((appointment) => statuses.includes(appointment.status)).length
  const next = items.filter(STILL_AHEAD).slice(0, SHOWN)

  const quick = [
    holds(actor, 'appointment:create')
      ? { href: '/staff/appointments', label: t('staff.book') }
      : null,
    holds(actor, 'patient:create')
      ? { href: '/staff/patients/new', label: t('staff.register') }
      : null,
  ].filter((entry) => entry !== null)

  if (!canRead && quick.length === 0) return null

  return (
    <div className="flex flex-col gap-4">
      {quick.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {quick.map((entry, index) => (
            <Link
              key={entry.href}
              href={entry.href}
              className={buttonVariants({ variant: index === 0 ? 'primary' : 'outline' })}
            >
              {entry.label}
            </Link>
          ))}
        </div>
      ) : null}

      {canRead ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('staff.todayTitle')}</CardTitle>
            <CardDescription>{formatCalendarDate(today, locale, 'full')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {(
                [
                  ['expected', count('SCHEDULED')],
                  ['arrived', count('CHECKED_IN')],
                  ['withDoctor', count('IN_PROGRESS')],
                  ['done', count('COMPLETED')],
                ] as const
              ).map(([key, value]) => (
                <div key={key} className="bg-muted/50 rounded-md p-3">
                  <dt className="text-muted-foreground text-xs">{t(`staff.counts.${key}`)}</dt>
                  <dd className="text-2xl font-semibold tabular-nums">
                    {page?.nextCursor ? `${value}+` : value}
                  </dd>
                </div>
              ))}
            </dl>

            {next.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                {items.length === 0 ? t('staff.noneToday') : t('staff.allSeen')}
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                <h3 className="text-sm font-semibold">{t('staff.nextUp')}</h3>
                {next.map((appointment) => (
                  <AppointmentCard
                    key={appointment.id}
                    appointment={appointment}
                    locale={locale}
                    timeZone={timeZone}
                    href={`/staff/appointments/${appointment.id}`}
                    show={{ patient: true, doctor: true }}
                  />
                ))}
              </div>
            )}

            <Link
              href="/staff/appointments"
              className={buttonVariants({
                variant: 'outline',
                size: 'sm',
                className: 'self-start',
              })}
            >
              {t('staff.seeAll')}
            </Link>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

// ── Doctor ───────────────────────────────────────────────────────────────────

export async function DoctorToday({
  actor,
  locale,
  timeZone,
}: {
  actor: Actor
  locale: string
  timeZone: string
}) {
  // No profile, no caseload (ADR-0004): the appointments page says so; here there is nothing.
  if (!actor.doctorId) return null
  const t = await getTranslations('home')
  const today = todayIn(timeZone)
  const canReadAppointments = holds(actor, 'appointment:read')
  const canReadNotes = holds(actor, 'encounter:read')

  const [day, unsigned] = await Promise.all([
    canReadAppointments
      ? listAppointments(actor, { from: today, to: today, limit: QUEUE_LIMIT })
      : null,
    canReadNotes ? listEncounters(actor, { noteStatus: 'DRAFT', limit: SHOWN }) : null,
  ])
  const ahead = (day?.items ?? []).filter(STILL_AHEAD)
  const shown = ahead.slice(0, SHOWN)
  // Which of today's appointments already have a visit: open that, or start one.
  const visits =
    canReadNotes && shown.length > 0
      ? await listEncounters(actor, {
          appointmentIds: shown.map((appointment) => appointment.id),
          limit: shown.length,
        })
      : null
  const noteFor = new Map(
    (visits?.items ?? []).map((visit) => [visit.appointmentId ?? '', visit.id] as const),
  )

  if (!day && !unsigned) return null

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {day ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('doctor.todayTitle')}</CardTitle>
            <CardDescription>
              {t('doctor.todayCount', { count: ahead.length })}
              {day.nextCursor ? '+' : ''}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {shown.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t('doctor.noneToday')}</p>
            ) : (
              shown.map((appointment) => {
                const note = noteFor.get(appointment.id)
                return (
                  <AppointmentCard
                    key={appointment.id}
                    appointment={appointment}
                    locale={locale}
                    timeZone={timeZone}
                    show={{ patient: true }}
                    actions={
                      note ? (
                        <Link
                          href={`/doctor/encounters/${note}`}
                          className={buttonVariants({ variant: 'outline', size: 'sm' })}
                        >
                          {t('doctor.openNote')}
                        </Link>
                      ) : holds(actor, 'encounter:write') ? (
                        <StartEncounterButton
                          patientId={appointment.patient.id}
                          appointmentId={appointment.id}
                          chiefComplaint={appointment.reason}
                          label={t('doctor.recordVisit')}
                          variant="secondary"
                        />
                      ) : null
                    }
                  />
                )
              })
            )}
            <Link
              href={`/doctor/appointments?date=${today}`}
              className={buttonVariants({
                variant: 'outline',
                size: 'sm',
                className: 'self-start',
              })}
            >
              {t('doctor.seeDay')}
            </Link>
          </CardContent>
        </Card>
      ) : null}

      {unsigned ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('doctor.unsignedTitle')}</CardTitle>
            <CardDescription>{t('doctor.unsignedHint')}</CardDescription>
          </CardHeader>
          <CardContent>
            {unsigned.items.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t('doctor.noneUnsigned')}</p>
            ) : (
              <ul className="divide-border flex flex-col divide-y">
                {unsigned.items.map((visit) => (
                  <li key={visit.id} className="flex flex-wrap items-center gap-3 py-2.5">
                    <div className="flex min-w-0 flex-1 flex-col">
                      <Link
                        href={`/doctor/encounters/${visit.id}`}
                        className="truncate font-medium hover:underline"
                      >
                        {visit.patient.name}
                      </Link>
                      <span className="text-muted-foreground text-xs">
                        {t('doctor.startedAt', {
                          number: visit.number,
                          when: formatInstant(visit.startedAt, locale, timeZone),
                        })}
                      </span>
                    </div>
                    <Badge tone="warning">{t('doctor.draft')}</Badge>
                  </li>
                ))}
              </ul>
            )}
            {unsigned.nextCursor ? (
              <p className="text-muted-foreground mt-2 text-xs">{t('doctor.moreUnsigned')}</p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

// ── Patient ──────────────────────────────────────────────────────────────────

/** How far ahead "your next appointment" looks: the booking horizon is never longer. */
const AHEAD_DAYS = 365

export async function PatientNext({
  actor,
  locale,
  timeZone,
  clinicPhone,
}: {
  actor: Actor
  locale: string
  timeZone: string
  clinicPhone: string | null
}) {
  if (!actor.patientId) return null
  const t = await getTranslations('home')
  const today = todayIn(timeZone)
  const canRead = holds(actor, 'appointment:read')
  const canBook = holds(actor, 'appointment:create')
  const canSeeBills = holds(actor, 'invoice:read')

  const [upcoming, bills] = await Promise.all([
    canRead
      ? listAppointments(actor, { from: today, to: shiftDate(today, AHEAD_DAYS), limit: 20 })
      : null,
    canSeeBills ? listInvoices(actor, { outstanding: true, limit: 5 }) : null,
  ])
  const now = Date.now()
  const next = upcoming?.items.find(
    (appointment) => STILL_AHEAD(appointment) && new Date(appointment.endsAt).getTime() >= now,
  )
  const book = canBook ? (
    <Link href="/patient/appointments/new" className={buttonVariants()}>
      {t('patient.book')}
    </Link>
  ) : null

  if (!upcoming && !bills && !book) return null

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {upcoming ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('patient.nextTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {next ? (
              <AppointmentCard
                appointment={next}
                locale={locale}
                timeZone={timeZone}
                show={{ doctor: true, date: true }}
                actions={
                  <AppointmentActions
                    actor={actor}
                    appointment={next}
                    locale={locale}
                    timeZone={timeZone}
                    clinicPhone={clinicPhone}
                  />
                }
              />
            ) : (
              <p className="text-muted-foreground text-sm">{t('patient.noneBooked')}</p>
            )}
            <div className="flex flex-wrap gap-2">
              {book}
              <Link href="/patient/appointments" className={buttonVariants({ variant: 'outline' })}>
                {t('patient.allAppointments')}
              </Link>
            </div>
          </CardContent>
        </Card>
      ) : book ? (
        <div>{book}</div>
      ) : null}

      {bills ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('patient.billsTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {bills.items.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t('patient.noBills')}</p>
            ) : (
              <ul className="divide-border flex flex-col divide-y text-sm">
                {bills.items.map((invoice) => (
                  <li key={invoice.id} className="flex items-center justify-between gap-3 py-2">
                    <span className="flex flex-col">
                      <span className="font-medium tabular-nums">{invoice.number}</span>
                      {invoice.isOverdue ? (
                        <span className="text-danger text-xs font-medium">
                          {t('patient.overdue')}
                        </span>
                      ) : null}
                    </span>
                    <span className="font-medium tabular-nums">
                      {formatMoney(
                        { amount: invoice.balanceDue, currency: invoice.currency },
                        locale,
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <Link
              href="/patient/billing"
              className={buttonVariants({
                variant: 'outline',
                size: 'sm',
                className: 'self-start',
              })}
            >
              {t('patient.seeBills')}
            </Link>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
