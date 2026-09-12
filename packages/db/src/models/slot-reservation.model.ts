import { Schema, type Model, type InferSchemaType } from 'mongoose'
import { getConnection } from '../connection'
import { tenantGuard } from '../plugins/tenant-guard'

/**
 * One document per five-minute grid cell an appointment covers (ADR-0013).
 *
 * The `_id` is deterministic — `${doctorId}:${cellStartISO}` — so two concurrent bookings for
 * the same cell collide on a unique index inside the storage engine. A MongoDB transaction
 * aborts on a write conflict to the same document, never on a phantom read, so an overlap query
 * would let both bookings through. This is infrastructure for that race, not a schedule:
 * availability itself stays computed.
 *
 * Deliberately not audited. A booking is one audited event; twelve reservation rows per hour
 * would bury it.
 */
export const SlotReservationSchema = new Schema(
  {
    _id: { type: String, required: true },
    clinicId: { type: String, required: true },
    doctorId: { type: String, required: true },
    appointmentId: { type: String, required: true },
    cellStartsAt: { type: Date, required: true },
    /** Set only on a provisional hold; MongoDB reclaims it without a sweeper. */
    expiresAt: { type: Date, default: null },
  },
  { collection: 'slotReservations' },
)

SlotReservationSchema.plugin(tenantGuard)

SlotReservationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })
SlotReservationSchema.index({ clinicId: 1, appointmentId: 1 }) // released on cancel or reschedule

export type SlotReservationDoc = InferSchemaType<typeof SlotReservationSchema> & { _id: string }

export const SlotReservationModel = (): Model<SlotReservationDoc> =>
  getConnection().models.SlotReservation ??
  getConnection().model<SlotReservationDoc>('SlotReservation', SlotReservationSchema)
