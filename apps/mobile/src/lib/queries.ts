import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { invalidatedBy, queryKeys } from '@clinic/api-client'
import type { BookOwnAppointmentRequest } from '@clinic/contracts'
import { portal } from './api'

/**
 * The app's data layer, built on the **shared** keys (§9.4).
 *
 * `queryKeys` and `invalidatedBy` come from `@clinic/api-client`, not from here, and that is the
 * point: when a booking succeeds, something has to invalidate the appointments list, and if web
 * and mobile each spell that key their own way one of them stops refreshing. Nobody notices until
 * a patient swears they cancelled an appointment that is still on the screen.
 */

/** A window wide enough to be useful on one screen, narrow enough to load on a phone. */
export const APPOINTMENT_WINDOW_DAYS = 60

const isoDate = (offsetDays = 0): string => {
  const date = new Date()
  date.setDate(date.getDate() + offsetDays)
  return date.toISOString().slice(0, 10)
}

export function useMyAppointments(patientId: string) {
  const from = isoDate(-APPOINTMENT_WINDOW_DAYS)
  const to = isoDate(APPOINTMENT_WINDOW_DAYS)

  return useQuery({
    queryKey: queryKeys.appointments({ patientId, from, to }),
    queryFn: () => portal.appointments({ patientId, from, to }),
  })
}

export function useNotifications() {
  return useQuery({
    queryKey: queryKeys.notifications({ limit: 30 }),
    queryFn: () => portal.notifications({ limit: 30 }),
  })
}

export function useMyRecord(patientId: string) {
  return useQuery({
    queryKey: queryKeys.patient(patientId),
    queryFn: () => portal.patient(patientId),
  })
}

export function usePrescriptions(patientId: string) {
  return useQuery({
    queryKey: queryKeys.prescriptions({ patientId, active: true }),
    queryFn: () => portal.prescriptions({ patientId, active: true }),
  })
}

export function useTickets() {
  return useQuery({ queryKey: queryKeys.tickets(), queryFn: () => portal.tickets() })
}

/**
 * Booking, with an idempotency key minted **once per attempt** rather than per retry.
 *
 * The key is generated when the mutation starts and reused if React Query retries, which is the
 * only arrangement that helps: a fresh key on each retry would make the server treat a resend as
 * a second booking, which is exactly the failure the header exists to prevent.
 */
export function useBookAppointment() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: BookOwnAppointmentRequest & { idempotencyKey: string }) => {
      const { idempotencyKey, ...booking } = input
      return portal.bookForMyself(booking, idempotencyKey)
    },
    onSuccess: async () => {
      await Promise.all(
        invalidatedBy.booking().map((key) => queryClient.invalidateQueries({ queryKey: key })),
      )
    },
  })
}

export function useCancelAppointment() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: { appointmentId: string; reason: string | null }) =>
      portal.cancelAppointment(input.appointmentId, { reason: input.reason }),
    onSuccess: async () => {
      await Promise.all(
        invalidatedBy.cancellation().map((key) => queryClient.invalidateQueries({ queryKey: key })),
      )
    },
  })
}

export function useMarkNotificationsRead() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (ids: string[] = []) => portal.markNotificationsRead(ids),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.notifications() })
    },
  })
}
