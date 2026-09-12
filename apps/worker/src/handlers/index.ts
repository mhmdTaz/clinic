import type { EventName, OutboxEnvelope } from '@clinic/events'
import { onAppointmentBooked, onAppointmentCancelled } from './appointments'
import { onInvoiceIssued, onPaymentRecorded } from './billing'
import { onStockLow } from './inventory'
import { onTicketAssigned, onTicketCreated, onTicketReplied } from './tickets'

/**
 * What reacts to what (section 13.4).
 *
 * **Adding "SMS the patient when an invoice is issued" means adding a handler here.** It does not
 * mean editing the billing module, which is the whole point of the outbox: a module says what
 * happened and has no idea who is listening.
 *
 * An event with no handler is not an error. Plenty of events exist for the audit trail or for a
 * reaction somebody has not written yet, and treating "nobody cared" as a failure would fill the
 * dead-letter queue with events working exactly as intended.
 */
export type EventHandler = (envelope: OutboxEnvelope) => Promise<void>

const HANDLERS: Partial<Record<EventName, EventHandler>> = {
  'appointment.booked': onAppointmentBooked,
  'appointment.cancelled': onAppointmentCancelled,
  'invoice.issued': onInvoiceIssued,
  'payment.recorded': onPaymentRecorded,
  'stock.low': onStockLow,
  'ticket.created': onTicketCreated,
  'ticket.replied': onTicketReplied,
  'ticket.assigned': onTicketAssigned,
}

export const handlerFor = (name: EventName): EventHandler | undefined => HANDLERS[name]

export const HANDLED_EVENTS = Object.keys(HANDLERS) as EventName[]
