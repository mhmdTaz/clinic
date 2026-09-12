import {
  addAmounts,
  localDateIn,
  subtractAmounts,
  zeroAmount,
  type AnalyticsOverview,
  type AnalyticsQuery,
  type AppointmentPoint,
  type DoctorUtilisation,
} from '@clinic/contracts'
import { ValidationError } from '../../../errors'
import { assertCan, type Actor } from '../../access'
import { getClinicFacts, getSchedulingFacts } from '../../clinic'
import { eachDate, instantOf, nextDate, weekdayOf } from '../../scheduling'
import { rate, rosteredMinutes, utilisationPercent } from '../domain/utilisation'
import { reportingRepository } from '../infrastructure/reporting.repository'

/**
 * The admin dashboard (A8).
 *
 * One use case, five queries, run in parallel because none of them needs another's answer. The
 * assembly is here rather than in the repository because "what counts as revenue" and "what
 * counts as a new patient" are business questions, and the day a clinic disagrees with one of
 * them the argument should happen in a file like this.
 *
 * Every figure is derived on read. Nothing is rolled up and stored, so voiding an invoice or
 * marking a no-show is reflected the next time the page opens rather than the next time a job
 * runs — and there is no second copy of the truth to drift.
 */

/** Long enough to show a trend, short enough to stay fast on a first load. */
const DEFAULT_RANGE_DAYS = 30
/** A year. Past this the dashboard is the wrong tool and the CSV export is the right one. */
const MAX_RANGE_DAYS = 366

export async function getAnalyticsOverview(
  actor: Actor,
  query: AnalyticsQuery = {},
  now: Date = new Date(),
): Promise<AnalyticsOverview> {
  await assertCan(actor, 'analytics:read')

  const clinic = await getClinicFacts(actor.clinicId)
  const { from, to } = resolveRange(query, clinic.timezone, now)

  // Half-open in instants, inclusive in dates: `to` is the last day the admin asked for, so the
  // boundary is the start of the day after it. Getting this wrong silently drops the most recent
  // day, which is the one anybody actually checks.
  const fromInstant = instantOf(from, '00:00', clinic.timezone)
  const toInstant = instantOf(nextDate(to), '00:00', clinic.timezone)
  const dates = eachDate(from, to)

  const [scheduling, revenueDays, invoiced, appointmentDays, load, rosters, mix] =
    await Promise.all([
      getSchedulingFacts(actor.clinicId),
      reportingRepository.revenueByDay(actor.clinicId, fromInstant, toInstant, clinic.timezone),
      reportingRepository.invoiced(actor.clinicId, fromInstant, toInstant),
      reportingRepository.appointmentsByDay(
        actor.clinicId,
        fromInstant,
        toInstant,
        clinic.timezone,
      ),
      reportingRepository.doctorLoad(actor.clinicId, fromInstant, toInstant),
      reportingRepository.rosters(actor.clinicId),
      reportingRepository.patientMix(actor.clinicId, fromInstant, toInstant),
    ])

  const currency = clinic.currency
  const collected = addAmounts(currency, ...revenueDays.map((day) => day.collected))
  const refunded = addAmounts(currency, ...revenueDays.map((day) => day.refunded))

  return {
    range: { from, to, days: dates.length },
    revenue: {
      currency,
      collected,
      refunded,
      net: subtractAmounts(currency, collected, refunded),
      invoiced: addAmounts(currency, invoiced.invoiced),
      outstanding: addAmounts(currency, invoiced.outstanding),
      // Every day in the range, including the empty ones: a chart with gaps where nothing was
      // taken reads as missing data, not as a quiet Sunday.
      byDay: dates.map((date) => {
        const day = revenueDays.find((row) => row.date === date)
        return {
          date,
          amount: day
            ? subtractAmounts(currency, day.collected, day.refunded)
            : zeroAmount(currency),
        }
      }),
    },
    appointments: buildAppointments(dates, appointmentDays),
    doctors: buildDoctors(dates, load, rosters, scheduling.closedDates),
    patients: {
      newCount: mix.newCount,
      returningCount: mix.seen - mix.newCount,
      seenCount: mix.seen,
      newPercent: rate(mix.newCount, mix.seen),
    },
    generatedAt: now.toISOString(),
  }
}

/**
 * The range the admin asked for, or the last 30 days.
 *
 * Refused rather than clamped when it is backwards or too long: silently returning a different
 * range than the one on screen is how a number gets quoted in a meeting and turns out to mean
 * something else.
 */
function resolveRange(
  query: AnalyticsQuery,
  timezone: string,
  now: Date,
): { from: string; to: string } {
  const today = localDateIn(timezone, now)
  const to = query.to ?? today
  const from = query.from ?? shiftDays(to, -(DEFAULT_RANGE_DAYS - 1))

  if (from > to) {
    throw new ValidationError('The start of the range is after its end.', [
      { field: 'from', issue: 'RANGE_INVERTED' },
    ])
  }
  if (eachDate(from, to).length > MAX_RANGE_DAYS) {
    throw new ValidationError(`A range may cover at most ${MAX_RANGE_DAYS} days.`, [
      { field: 'from', issue: 'RANGE_TOO_LONG' },
    ])
  }
  return { from, to }
}

function shiftDays(date: string, days: number): string {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number)
  const cursor = new Date(Date.UTC(year, month - 1, day))
  cursor.setUTCDate(cursor.getUTCDate() + days)
  return cursor.toISOString().slice(0, 10)
}

function buildAppointments(
  dates: string[],
  rows: Array<{ date: string; status: string; count: number }>,
): AnalyticsOverview['appointments'] {
  const byStatus: Record<string, number> = {}
  for (const row of rows) byStatus[row.status] = (byStatus[row.status] ?? 0) + row.count

  const total = rows.reduce((sum, row) => sum + row.count, 0)
  const byDay: AppointmentPoint[] = dates.map((date) => {
    const forDate = rows.filter((row) => row.date === date)
    const count = (status: string) => forDate.find((row) => row.status === status)?.count ?? 0
    return {
      date,
      booked: forDate.reduce((sum, row) => sum + row.count, 0),
      completed: count('COMPLETED'),
      cancelled: count('CANCELLED'),
      noShow: count('NO_SHOW'),
    }
  })

  return {
    total,
    byStatus,
    completionRate: rate(byStatus.COMPLETED ?? 0, total),
    noShowRate: rate(byStatus.NO_SHOW ?? 0, total),
    cancellationRate: rate(byStatus.CANCELLED ?? 0, total),
    byDay,
  }
}

/**
 * Utilisation, doctor by doctor.
 *
 * Built from the **roster** side, not the appointment side, so a doctor who was scheduled all
 * month and saw nobody appears with a zero — the row worth finding. A doctor who saw patients
 * without a roster still appears, with a null percentage, because the data says they worked and
 * refusing to show them would be worse than admitting the denominator is missing.
 */
function buildDoctors(
  dates: string[],
  load: Array<{
    doctorId: string
    name: string | null
    appointments: number
    completed: number
    minutes: number
  }>,
  rosters: Array<{
    doctorId: string
    name: string | null
    availability: Array<{ dayOfWeek: number; startsAt: string; endsAt: string }>
    timeOff: Array<{ startDate: string; endDate: string }>
  }>,
  closedDates: string[],
): DoctorUtilisation[] {
  const loadById = new Map(load.map((row) => [row.doctorId, row]))
  const rosterById = new Map(rosters.map((row) => [row.doctorId, row]))
  const doctorIds = [...new Set([...rosterById.keys(), ...loadById.keys()])]

  return (
    doctorIds
      .map((doctorId) => {
        const booked = loadById.get(doctorId)
        const roster = rosterById.get(doctorId)
        const availableMinutes = roster
          ? rosteredMinutes(dates, weekdayOf, roster.availability, roster.timeOff, closedDates)
          : 0

        return {
          doctorId,
          name: roster?.name ?? booked?.name ?? doctorId,
          appointments: booked?.appointments ?? 0,
          completed: booked?.completed ?? 0,
          bookedMinutes: booked?.minutes ?? 0,
          availableMinutes,
          utilisationPercent: utilisationPercent(booked?.minutes ?? 0, availableMinutes),
        }
      })
      // Busiest first; a doctor with no roster sorts last rather than above everybody at "null".
      .sort(
        (left, right) =>
          (right.utilisationPercent ?? -1) - (left.utilisationPercent ?? -1) ||
          left.name.localeCompare(right.name),
      )
  )
}
