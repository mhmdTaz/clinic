import {
  AppointmentDetail,
  RegisteredDevice,
  AppointmentSummary,
  DaySlots,
  DownloadLink,
  DoctorSummary,
  InvoiceSummary,
  NotificationFeed,
  PatientDetail,
  Prescription,
  StoredFile,
  TicketDetail,
  TicketSummary,
  AccountStatement,
} from '@clinic/contracts'
import type {
  AppointmentListQuery,
  RegisterDeviceRequest,
  BookOwnAppointmentRequest,
  CancelAppointmentRequest,
  DoctorListQuery,
  FileListQuery,
  InvoiceListQuery,
  NotificationListQuery,
  OpenTicketRequest,
  PrescriptionListQuery,
  ReplyToTicketRequest,
  SlotQuery,
  TicketListQuery,
} from '@clinic/contracts'
import { z } from 'zod'
import type { ApiClient } from '../client'

/**
 * Everything the patient portal does, as one typed surface (P1–P14, section 9.1).
 *
 * **Every call here is a plain `/api/v1` endpoint that already existed.** That is the point of
 * Phase 9 rather than an incidental property of it: if any of these needed a Server Action, a
 * bespoke route or a shape the web computes on the server, the mobile app would need backend work
 * and §9.1's promise would be false. Building this file is how that claim gets tested. It needed
 * push registration, which §9.4 predicted, and one thing it did not: the session had to start
 * naming the patient record the account is (ARCHITECTURE §17, Phase 9).
 *
 * The doctor's calls are in `doctor-portal.ts`.
 */
export function patientPortal(client: ApiClient) {
  return {
    /**
     * One patient record.
     *
     * Note on shapes: most of this portal's collections are **filtered lists, not cursor pages**.
     * §9.2 states cursor pagination as the convention and only `patients` and `users` actually
     * follow it; the rest are bounded by a date range or by belonging to one patient. That is a
     * real limit for a device — recorded as a deviation in ARCHITECTURE §9.2 — and the client
     * reflects what the API does rather than pretending otherwise.
     */
    patient(patientId: string) {
      return client.request(`/api/v1/patients/${patientId}`, { schema: PatientDetail })
    },

    // ── Appointments (P3, P5) ────────────────────────────────────────────────
    /**
     * Bounded by a date range rather than by a cursor, which is how the endpoint is defined:
     * `from` and `to` are required (`AppointmentListQuery`). A diary is read a window at a time,
     * and the window is the bound.
     */
    appointments(query: AppointmentListQuery) {
      return client.request('/api/v1/appointments', {
        query: { ...query },
        schema: z.array(AppointmentSummary),
      })
    },

    appointment(appointmentId: string) {
      return client.request(`/api/v1/appointments/${appointmentId}`, { schema: AppointmentDetail })
    },

    /** Open times for a doctor, which is what a booking screen is built from. */
    slots(doctorId: string, query: SlotQuery) {
      return client.request(`/api/v1/doctors/${doctorId}/slots`, {
        query: { ...query },
        schema: z.array(DaySlots),
      })
    },

    doctors(query: Partial<DoctorListQuery> = {}) {
      return client.request('/api/v1/doctors', {
        query: { ...query },
        schema: z.array(DoctorSummary),
      })
    },

    /**
     * Booking for oneself, which is a different permission from booking for somebody else and so
     * is a different endpoint (§9.2: transitions are explicit, not a status field).
     *
     * The key is sent because §9.2 says an `Idempotency-Key` is honoured on every POST that
     * creates a booking. **The server does not honour it yet** — found while building the booking
     * screen, and recorded in ARCHITECTURE §17 rather than quietly fixed, because it is backend
     * work. What protects a patient today is the slot hold: a repeat of a booking that went through
     * is refused `SLOT_TAKEN`, which the app then has to recognise as *its own* booking rather
     * than somebody else's (see `isOwnBooking` in the mobile app).
     */
    bookForMyself(input: BookOwnAppointmentRequest, idempotencyKey: string) {
      return client.request('/api/v1/me/appointments', {
        method: 'POST',
        body: input,
        idempotencyKey,
        schema: AppointmentDetail,
      })
    },

    cancelAppointment(appointmentId: string, input: CancelAppointmentRequest) {
      return client.request(`/api/v1/appointments/${appointmentId}/cancel`, {
        method: 'POST',
        body: input,
        schema: AppointmentDetail,
      })
    },

    // ── Documents (P8) ───────────────────────────────────────────────────────
    files(query: Partial<FileListQuery> = {}) {
      return client.request('/api/v1/files', { query: { ...query }, schema: z.array(StoredFile) })
    },

    /**
     * A short-lived URL the device downloads from directly.
     *
     * The bytes never pass through the API — the same presigned mechanism the browser uses
     * (§9.4), which is why a 40 MB scan on a phone costs the server nothing.
     */
    downloadLink(fileId: string) {
      return client.request(`/api/v1/files/${fileId}/download-url`, { schema: DownloadLink })
    },

    // ── Prescriptions (P7) ───────────────────────────────────────────────────
    prescriptions(query: Partial<PrescriptionListQuery> = {}) {
      return client.request('/api/v1/prescriptions', {
        query: { ...query },
        schema: z.array(Prescription),
      })
    },

    // ── Money (P9) ───────────────────────────────────────────────────────────
    invoices(query: Partial<InvoiceListQuery> = {}) {
      return client.request('/api/v1/billing/invoices', {
        query: { ...query },
        schema: z.array(InvoiceSummary),
      })
    },

    statement(patientId: string) {
      return client.request('/api/v1/billing/statement', {
        query: { patientId },
        schema: AccountStatement,
      })
    },

    // ── Support (P12) ────────────────────────────────────────────────────────
    tickets(query: Partial<TicketListQuery> = {}) {
      return client.request('/api/v1/support/tickets', {
        query: { ...query },
        schema: z.array(TicketSummary),
      })
    },

    ticket(ticketId: string) {
      return client.request(`/api/v1/support/tickets/${ticketId}`, { schema: TicketDetail })
    },

    openTicket(input: OpenTicketRequest) {
      return client.request('/api/v1/support/tickets', {
        method: 'POST',
        body: input,
        schema: TicketDetail,
      })
    },

    replyToTicket(ticketId: string, input: ReplyToTicketRequest) {
      return client.request(`/api/v1/support/tickets/${ticketId}/replies`, {
        method: 'POST',
        body: input,
        schema: TicketDetail,
      })
    },

    // ── The bell (section 8.12) ──────────────────────────────────────────────
    notifications(query: Partial<NotificationListQuery> = {}) {
      return client.request('/api/v1/me/notifications', {
        query: { ...query },
        schema: NotificationFeed,
      })
    },

    /** An empty list marks everything read — the "clear all" the bell offers. */
    markNotificationsRead(ids: string[] = []) {
      return client.request('/api/v1/me/notifications', {
        method: 'POST',
        body: { ids },
        schema: z.object({ read: z.number(), unreadCount: z.number() }),
      })
    },

    // ── Push (§9.4) ──────────────────────────────────────────────────────────
    /**
     * Registers this installation for push.
     *
     * Called on **every launch**, not once. A push token is reissued on reinstall, on a restore
     * from backup, and sometimes for no reason the app is told; registration is an upsert on the
     * token, so calling it repeatedly is free and calling it rarely is a bug.
     */
    registerDevice(input: RegisterDeviceRequest) {
      // POST /api/v1/me/devices. This route was missing from the first Phase 9 commit — only the
      // DELETE beside it existed — and nothing noticed, because the core tests call the use case
      // directly and the parity suite never registered a device. It does now.
      return client.request('/api/v1/me/devices', {
        method: 'POST',
        body: input,
        schema: RegisteredDevice,
      })
    },

    /**
     * The person's devices. Pass this installation's push token to be told which row is this
     * phone; it travels in a header so it never appears in a URL or an access log.
     */
    myDevices(pushToken?: string) {
      return client.request('/api/v1/me/devices', {
        schema: z.array(RegisteredDevice),
        headers: pushToken ? { 'x-push-token': pushToken } : undefined,
      })
    },

    removeDevice(deviceId: string) {
      return client.request(`/api/v1/me/devices/${deviceId}`, {
        method: 'DELETE',
        schema: z.object({ ok: z.boolean() }),
      })
    },
  }
}
