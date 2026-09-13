import { z } from 'zod'
import { PaginationQuery } from './envelope'
import {
  IdParam,
  LocalDate,
  LocalTime,
  PersonRef,
  SlotMinutes,
  nullableText,
  overlappingDayRanges,
} from './common'

/** Contracts for scheduling: a doctor's week, the slots it produces, and appointments. */

// ── A doctor's week ──────────────────────────────────────────────────────────

/** One working block, local to the clinic (ADR-0010). 0 = Sunday, as everywhere else. */
export const AvailabilityBlockInput = z
  .object({
    dayOfWeek: z.number().int().min(0).max(6),
    startsAt: LocalTime,
    endsAt: LocalTime,
  })
  .refine((block) => block.endsAt > block.startsAt, {
    message: 'ENDS_BEFORE_STARTS',
    path: ['endsAt'],
  })
export type AvailabilityBlockInput = z.infer<typeof AvailabilityBlockInput>

export const SetAvailabilityRequest = z
  .object({
    slotMinutes: SlotMinutes,
    blocks: z.array(AvailabilityBlockInput).max(35),
  })
  .superRefine((value, ctx) => {
    const ranges = value.blocks.map((block) => ({
      dayOfWeek: block.dayOfWeek,
      from: block.startsAt,
      to: block.endsAt,
    }))
    for (const index of overlappingDayRanges(ranges)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'OVERLAPPING_BLOCKS',
        path: ['blocks', index, 'startsAt'],
      })
    }
  })
export type SetAvailabilityRequest = z.infer<typeof SetAvailabilityRequest>

/** Days away. Calendar dates in the clinic's zone, both ends inclusive. */
export const TimeOffInput = z
  .object({ startDate: LocalDate, endDate: LocalDate, reason: nullableText(200) })
  .refine((entry) => entry.endDate >= entry.startDate, {
    message: 'ENDS_BEFORE_STARTS',
    path: ['endDate'],
  })
export type TimeOffInput = z.infer<typeof TimeOffInput>

export const TimeOff = z.object({
  id: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  reason: z.string().nullable(),
})
export type TimeOff = z.infer<typeof TimeOff>

export const AvailabilityBlock = z.object({
  dayOfWeek: z.number(),
  startsAt: z.string(),
  endsAt: z.string(),
})
export type AvailabilityBlock = z.infer<typeof AvailabilityBlock>

export const DoctorAvailability = z.object({
  doctorId: z.string(),
  doctorName: z.string(),
  slotMinutes: z.number(),
  blocks: z.array(AvailabilityBlock),
  timeOff: z.array(TimeOff),
})
export type DoctorAvailability = z.infer<typeof DoctorAvailability>

// ── Slots ────────────────────────────────────────────────────────────────────

const Instant = z.string().datetime()

/** A bounded range: the calendar asks for a week, the patient portal for a fortnight. */
export const SlotQuery = z
  .object({
    from: LocalDate,
    to: LocalDate,
    durationMinutes: z.coerce.number().int().min(5).max(480).optional(),
  })
  .refine((query) => query.to >= query.from, { message: 'ENDS_BEFORE_STARTS', path: ['to'] })
export type SlotQuery = z.infer<typeof SlotQuery>

export const Slot = z.object({ startsAt: Instant, endsAt: Instant })
export type Slot = z.infer<typeof Slot>

/** Grouped by the clinic's calendar day, so a day column renders without regrouping. */
export const DaySlots = z.object({ date: z.string(), slots: z.array(Slot) })
export type DaySlots = z.infer<typeof DaySlots>

// ── The booking window (ADR-0022) ────────────────────────────────────────────

export const BookingWindow = z.object({
  horizonDays: z.coerce.number().int().min(1).max(365),
  minimumNoticeHours: z.coerce.number().int().min(0).max(168),
  cancellationCutoffHours: z.coerce.number().int().min(0).max(168),
})
export type BookingWindow = z.infer<typeof BookingWindow>

export const UpdateBookingWindowRequest = BookingWindow
export type UpdateBookingWindowRequest = z.infer<typeof UpdateBookingWindowRequest>

// ── Appointments ─────────────────────────────────────────────────────────────

export const AppointmentStatus = z.enum([
  'SCHEDULED',
  'CHECKED_IN',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
])
export type AppointmentStatus = z.infer<typeof AppointmentStatus>

export const AppointmentSource = z.enum(['STAFF', 'PATIENT', 'WALK_IN'])
export type AppointmentSource = z.infer<typeof AppointmentSource>

const Duration = z.coerce.number().int().min(5).max(480)

export const BookAppointmentRequest = z.object({
  patientId: IdParam,
  doctorId: IdParam,
  startsAt: Instant,
  /** Defaults to the doctor's own slot length. */
  durationMinutes: Duration.optional(),
  branchId: z.string().max(64).nullable().default(null),
  reason: nullableText(300),
  internalNote: nullableText(500),
})
export type BookAppointmentRequest = z.infer<typeof BookAppointmentRequest>

/**
 * Someone who arrived without an appointment (ADR-0023). No time is sent: the server puts them
 * in the doctor's next open slot today, so a walk-in never lands off the booking grid.
 */
export const RegisterWalkInRequest = z.object({
  patientId: IdParam,
  doctorId: IdParam,
  branchId: z.string().max(64).nullable().default(null),
  reason: nullableText(300),
  internalNote: nullableText(500),
})
export type RegisterWalkInRequest = z.infer<typeof RegisterWalkInRequest>

/** The patient portal books for the signed-in patient; the server supplies who that is (P5). */
export const BookOwnAppointmentRequest = z.object({
  doctorId: IdParam,
  startsAt: Instant,
  reason: nullableText(300),
})
export type BookOwnAppointmentRequest = z.infer<typeof BookOwnAppointmentRequest>

export const RescheduleAppointmentRequest = z.object({
  startsAt: Instant,
  durationMinutes: Duration.optional(),
  reason: nullableText(300),
})
export type RescheduleAppointmentRequest = z.infer<typeof RescheduleAppointmentRequest>

export const CancelAppointmentRequest = z.object({ reason: nullableText(300) })
export type CancelAppointmentRequest = z.infer<typeof CancelAppointmentRequest>

export const AppointmentListQuery = PaginationQuery.extend({
  from: LocalDate,
  to: LocalDate,
  doctorId: z.string().max(64).optional(),
  patientId: z.string().max(64).optional(),
  status: AppointmentStatus.optional(),
  branchId: z.string().max(64).optional(),
}).refine((query) => query.to >= query.from, { message: 'ENDS_BEFORE_STARTS', path: ['to'] })
export type AppointmentListQuery = z.infer<typeof AppointmentListQuery>

export const AppointmentSummary = z.object({
  id: z.string(),
  number: z.string(),
  status: AppointmentStatus,
  source: AppointmentSource,
  startsAt: Instant,
  endsAt: Instant,
  durationMinutes: z.number(),
  patient: z.object({
    id: z.string(),
    name: z.string(),
    medicalRecordNo: z.string(),
    phone: z.string().nullable(),
  }),
  doctor: z.object({ id: z.string(), name: z.string() }),
  branchId: z.string().nullable(),
  reason: z.string().nullable(),
})
export type AppointmentSummary = z.infer<typeof AppointmentSummary>

export const AppointmentStatusChange = z.object({
  fromStatus: AppointmentStatus.nullable(),
  toStatus: AppointmentStatus,
  reason: z.string().nullable(),
  changedBy: PersonRef.nullable(),
  changedAt: Instant,
})
export type AppointmentStatusChange = z.infer<typeof AppointmentStatusChange>

export const AppointmentDetail = AppointmentSummary.extend({
  internalNote: z.string().nullable(),
  checkedInAt: Instant.nullable(),
  startedAt: Instant.nullable(),
  completedAt: Instant.nullable(),
  cancelledAt: Instant.nullable(),
  cancelReason: z.string().nullable(),
  rescheduledToId: z.string().nullable(),
  statusHistory: z.array(AppointmentStatusChange),
  createdAt: Instant.nullable(),
  createdBy: PersonRef.nullable(),
})
export type AppointmentDetail = z.infer<typeof AppointmentDetail>
