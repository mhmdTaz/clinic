import { AppointmentModel, DoctorModel, InvoiceModel, PaymentModel } from '@clinic/db'

/**
 * The reporting reads, kept apart from every transactional repository on purpose (section 13.5).
 *
 * Two reasons, and the second is the one that bites in production:
 *
 *  1. **They run on a secondary.** An admin exporting a year of revenue must not make the front
 *     desk's calendar feel slow. `secondaryPreferred` is safe here and nowhere else — a report is
 *     allowed to be a few seconds stale; a booking is not.
 *  2. **They group by the clinic's local day, not by UTC.** A payment taken at 22:00 in Beirut
 *     belongs to that day's takings, and `$dateToString` with a timezone is the only thing that
 *     gets that right without pulling every payment across the wire to re-bucket it in
 *     JavaScript.
 *
 * Money stays Decimal128 the whole way down: `$sum` over Decimal128 is exact, so the totals that
 * reach the application are the ones an accountant would reach by hand. Adding the per-day
 * figures back up is the application's job, through the same `addAmounts` every invoice uses —
 * a second implementation of decimal addition is a second place for it to be wrong.
 */

/** A report may lag; a booking may not. */
const REPORTING = { readPreference: 'secondaryPreferred' as const }

const decimalString = (value: unknown): string =>
  value === null || value === undefined ? '0' : String(value)

export interface DailyRevenue {
  date: string
  collected: string
  refunded: string
}

export interface DoctorLoad {
  doctorId: string
  name: string | null
  appointments: number
  completed: number
  minutes: number
}

export interface DoctorRoster {
  doctorId: string
  name: string | null
  availability: Array<{ dayOfWeek: number; startsAt: string; endsAt: string }>
  timeOff: Array<{ startDate: string; endDate: string }>
}

export const reportingRepository = {
  /**
   * Money that arrived, by the clinic's calendar day.
   *
   * `refundedAmount` lives on the payment rather than on a dated refund row, so a refund lands on
   * the day of the payment it reversed — not the day it was given back. The range totals are
   * exact either way; only the shape of the daily line differs, and the dashboard says so.
   */
  async revenueByDay(
    clinicId: string,
    from: Date,
    to: Date,
    timezone: string,
  ): Promise<DailyRevenue[]> {
    const rows = await PaymentModel()
      .aggregate<{ _id: string; collected: unknown; refunded: unknown }>(
        [
          { $match: { clinicId, receivedAt: { $gte: from, $lt: to }, deletedAt: null } },
          {
            $group: {
              _id: { $dateToString: { format: '%Y-%m-%d', date: '$receivedAt', timezone } },
              collected: { $sum: '$amount' },
              refunded: { $sum: { $ifNull: ['$refundedAmount', 0] } },
            },
          },
          { $sort: { _id: 1 } },
        ],
        REPORTING,
      )
      .exec()

    return rows.map((row) => ({
      date: row._id,
      collected: decimalString(row.collected),
      refunded: decimalString(row.refunded),
    }))
  },

  /** What was billed in the range, and what is still owed on it. */
  async invoiced(
    clinicId: string,
    from: Date,
    to: Date,
  ): Promise<{ invoiced: string; outstanding: string }> {
    const [row] = await InvoiceModel()
      .aggregate<{ invoiced: unknown; outstanding: unknown }>(
        [
          {
            $match: {
              clinicId,
              issuedAt: { $gte: from, $lt: to },
              // A void invoice was billed in error. Counting it would overstate money that was
              // never owed, let alone collected.
              status: { $ne: 'VOID' },
              deletedAt: null,
            },
          },
          {
            $group: {
              _id: null,
              invoiced: { $sum: '$total' },
              outstanding: { $sum: '$balanceDue' },
            },
          },
        ],
        REPORTING,
      )
      .exec()

    return { invoiced: decimalString(row?.invoiced), outstanding: decimalString(row?.outstanding) }
  },

  /** Appointment counts by clinic-local day and status. */
  async appointmentsByDay(
    clinicId: string,
    from: Date,
    to: Date,
    timezone: string,
  ): Promise<Array<{ date: string; status: string; count: number }>> {
    return AppointmentModel()
      .aggregate<{ date: string; status: string; count: number }>(
        [
          { $match: { clinicId, startsAt: { $gte: from, $lt: to }, deletedAt: null } },
          {
            $group: {
              _id: {
                date: { $dateToString: { format: '%Y-%m-%d', date: '$startsAt', timezone } },
                status: '$status',
              },
              count: { $sum: 1 },
            },
          },
          { $project: { _id: 0, date: '$_id.date', status: '$_id.status', count: 1 } },
          { $sort: { date: 1 } },
        ],
        REPORTING,
      )
      .exec()
  },

  /** Per doctor: how many appointments, how many finished, and how many minutes were held. */
  async doctorLoad(clinicId: string, from: Date, to: Date): Promise<DoctorLoad[]> {
    const rows = await AppointmentModel()
      .aggregate<{
        _id: string
        name: string | null
        appointments: number
        completed: number
        minutes: number
      }>(
        [
          {
            $match: {
              clinicId,
              startsAt: { $gte: from, $lt: to },
              // Cancelled time was released and could be rebooked, so it is not load. A no-show
              // is: the slot was held, the doctor waited, and nobody else could have it.
              status: { $ne: 'CANCELLED' },
              deletedAt: null,
            },
          },
          {
            $group: {
              _id: '$doctorId',
              name: { $last: '$doctor.name' },
              appointments: { $sum: 1 },
              completed: { $sum: { $cond: [{ $eq: ['$status', 'COMPLETED'] }, 1, 0] } },
              minutes: { $sum: '$durationMinutes' },
            },
          },
        ],
        REPORTING,
      )
      .exec()

    return rows.map((row) => ({
      doctorId: String(row._id),
      name: row.name ?? null,
      appointments: row.appointments,
      completed: row.completed,
      minutes: row.minutes,
    }))
  },

  /**
   * Every active doctor's roster, for the utilisation denominator.
   *
   * The name is joined from the user rather than read off the doctor, because a doctor *is* a
   * user with a profile — and a doctor rostered but never booked has no denormalised appointment
   * row to borrow a name from. Without the join they would appear on the dashboard as an id,
   * which is precisely the row an admin most wants to recognise: rostered, and empty.
   */
  async rosters(clinicId: string): Promise<DoctorRoster[]> {
    const rows = await DoctorModel()
      .aggregate<{
        _id: string
        availability: Array<Record<string, unknown>> | null
        timeOff: Array<Record<string, unknown>> | null
        firstName: string | null
        lastName: string | null
      }>(
        [
          { $match: { clinicId, isActive: true, deletedAt: null } },
          {
            $lookup: {
              from: 'users',
              localField: 'userId',
              foreignField: '_id',
              as: 'user',
              pipeline: [{ $project: { firstName: 1, lastName: 1 } }],
            },
          },
          {
            $project: {
              availability: 1,
              timeOff: 1,
              firstName: { $first: '$user.firstName' },
              lastName: { $first: '$user.lastName' },
            },
          },
        ],
        REPORTING,
      )
      .exec()

    return rows.map((row) => ({
      doctorId: String(row._id),
      name: [row.firstName, row.lastName].filter(Boolean).join(' ') || null,
      availability: (row.availability ?? []).map((block) => ({
        dayOfWeek: Number(block.dayOfWeek),
        startsAt: String(block.startsAt),
        endsAt: String(block.endsAt),
      })),
      timeOff: (row.timeOff ?? []).map((period) => ({
        startDate: String(period.startDate),
        endDate: String(period.endDate),
      })),
    }))
  },

  /**
   * New versus returning, among the patients actually seen in the range.
   *
   * "Seen" is an appointment that was not cancelled — a patient who never turned up still took a
   * place in the day. "New" compares the patient's registration against the start of the range,
   * so somebody registered in March and first seen in April counts as returning, which is what a
   * clinic means by the word.
   */
  async patientMix(
    clinicId: string,
    from: Date,
    to: Date,
  ): Promise<{ seen: number; newCount: number }> {
    const [row] = await AppointmentModel()
      .aggregate<{ seen: number; newCount: number }>(
        [
          {
            $match: {
              clinicId,
              startsAt: { $gte: from, $lt: to },
              status: { $ne: 'CANCELLED' },
              deletedAt: null,
            },
          },
          { $group: { _id: '$patientId' } },
          {
            $lookup: {
              from: 'patients',
              localField: '_id',
              foreignField: '_id',
              as: 'patient',
              pipeline: [{ $project: { createdAt: 1 } }],
            },
          },
          { $set: { registeredAt: { $first: '$patient.createdAt' } } },
          {
            $group: {
              _id: null,
              seen: { $sum: 1 },
              // A patient row with no createdAt (imported history) is not "new": $gte against a
              // missing field is false, which is the conservative answer.
              newCount: { $sum: { $cond: [{ $gte: ['$registeredAt', from] }, 1, 0] } },
            },
          },
        ],
        REPORTING,
      )
      .exec()

    return { seen: row?.seen ?? 0, newCount: row?.newCount ?? 0 }
  },
}
