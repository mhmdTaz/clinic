import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { ApiError, invalidatedBy, queryKeys } from '@clinic/api-client'
import {
  localDateIn,
  type AddendumRequest,
  type BookOwnAppointmentRequest,
  type EncounterDetail,
  type OpenEncounterRequest,
  type OpenTicketRequest,
  type UpdateEncounterRequest,
} from '@clinic/contracts'
import { auth, doctor, portal } from './api'
import { grantsOf } from './clinical'
import { isOwnBooking, shiftDate } from './format'

/**
 * The app's data layer, built on the **shared** keys (§9.4).
 *
 * `queryKeys` and `invalidatedBy` come from `@clinic/api-client`, not from here, and that is the
 * point: when a booking succeeds something has to invalidate the appointments list, and if web and
 * mobile each spelled that key their own way one of them would stop refreshing. Nobody notices
 * until a patient swears they cancelled an appointment that is still on the screen.
 */

const invalidate = (queryClient: QueryClient, keys: ReadonlyArray<readonly unknown[]>) =>
  Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })))

/**
 * What this person may do, as a map from permission to scope.
 *
 * Asked once and kept for a while: grants change when an administrator edits a role, which the
 * server notices on the very next request anyway (§7.7). This only decides which buttons to show.
 */
export function useGrants() {
  const query = useQuery({
    queryKey: queryKeys.myPermissions(),
    queryFn: () => auth.permissions(),
    staleTime: 5 * 60_000,
  })
  return { grants: grantsOf(query.data), known: query.data !== undefined }
}

// ── Patient ──────────────────────────────────────────────────────────────────

/** A window wide enough to be useful on one screen, narrow enough to load on a phone. */
export const APPOINTMENT_WINDOW_DAYS = 60

/**
 * The patient's appointments, either side of today at the clinic.
 *
 * **The key does not contain the dates.** It names the window by its width, and the dates are
 * worked out when the request is made. With the dates in the key, the list this phone kept for
 * offline reading would be filed under yesterday's key after midnight — and a patient opening the
 * app with no signal the next morning, which is the case the offline cache exists for, would find
 * nothing.
 */
export function useMyAppointments(patientId: string | null, timeZone: string) {
  return useQuery({
    queryKey: queryKeys.appointments({ patientId, aroundToday: APPOINTMENT_WINDOW_DAYS }),
    queryFn: () => {
      const today = localDateIn(timeZone)
      return portal.appointments({
        patientId: patientId ?? '',
        from: shiftDate(today, -APPOINTMENT_WINDOW_DAYS),
        to: shiftDate(today, APPOINTMENT_WINDOW_DAYS),
      })
    },
    enabled: patientId !== null,
  })
}

export function useBookableDoctors() {
  return useQuery({
    queryKey: [...queryKeys.doctors(), { status: 'active' }],
    queryFn: () => portal.doctors({ status: 'active' }),
  })
}

export function useOpenTimes(doctorId: string | null, from: string, to: string) {
  return useQuery({
    queryKey: queryKeys.slots(doctorId ?? '', from, to),
    queryFn: () => portal.slots(doctorId ?? '', { from, to }),
    enabled: doctorId !== null,
    // Open times go stale faster than anything else on the screen: somebody else is booking them.
    staleTime: 15_000,
  })
}

export type BookingOutcome =
  | { kind: 'booked'; appointmentId: string }
  /** The retry of a booking that had in fact gone through. See `isOwnBooking`. */
  | { kind: 'alreadyYours'; appointmentId: string }

/**
 * Booking, and telling a patient's own lost-response booking apart from a slot somebody else took.
 *
 * The key is minted by the screen **once per attempt** and reused if the person taps again, which
 * is the only arrangement in which it could ever help. The server does not honour it yet (see
 * `bookForMyself`), so `SLOT_TAKEN` is checked against the patient's own diary before it is
 * believed.
 */
export function useBookAppointment(patientId: string | null, timeZone: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (
      input: BookOwnAppointmentRequest & { idempotencyKey: string },
    ): Promise<BookingOutcome> => {
      const { idempotencyKey, ...booking } = input
      try {
        const booked = await portal.bookForMyself(booking, idempotencyKey)
        return { kind: 'booked', appointmentId: booked.id }
      } catch (caught) {
        if (!(caught instanceof ApiError) || caught.code !== 'SLOT_TAKEN' || !patientId)
          throw caught
        // Just the day of the attempt: that is the only day the appointment could be on.
        const day = localDateIn(timeZone, new Date(booking.startsAt))
        const diary = await portal.appointments({ patientId, from: day, to: day }).catch(() => [])
        const mine = isOwnBooking(diary, booking)
        if (!mine) throw caught
        return { kind: 'alreadyYours', appointmentId: mine.id }
      }
    },
    onSettled: () => invalidate(queryClient, invalidatedBy.booking()),
  })
}

export function useCancelAppointment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { appointmentId: string; reason: string | null }) =>
      portal.cancelAppointment(input.appointmentId, { reason: input.reason }),
    onSuccess: () => invalidate(queryClient, invalidatedBy.cancellation()),
  })
}

/** The patient's document vault. The server's scope decides what is shared (ADR-0025). */
export function useMyDocuments(patientId: string | null) {
  return useQuery({
    queryKey: queryKeys.files({ patientId }),
    queryFn: () => portal.files({}),
    enabled: patientId !== null,
  })
}

export function useNotifications() {
  return useQuery({
    queryKey: queryKeys.notifications({ limit: 30 }),
    queryFn: () => portal.notifications({ limit: 30 }),
  })
}

export function useMarkNotificationsRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (ids: string[] = []) => portal.markNotificationsRead(ids),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.notifications() }),
  })
}

// ── Support ──────────────────────────────────────────────────────────────────

/** Everything the person has asked, open or not — their own history, not a queue. */
export function useMyTickets() {
  return useQuery({
    queryKey: queryKeys.tickets({ view: 'all' }),
    queryFn: () => portal.tickets({ view: 'all' }),
  })
}

export function useTicket(ticketId: string) {
  return useQuery({
    queryKey: queryKeys.ticket(ticketId),
    queryFn: () => portal.ticket(ticketId),
  })
}

export function useOpenTicket() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: Pick<OpenTicketRequest, 'subject' | 'category' | 'body'>) =>
      portal.openTicket({ ...input, priority: 'NORMAL', fileIds: [], requesterId: null }),
    onSuccess: (ticket) => {
      queryClient.setQueryData(queryKeys.ticket(ticket.id), ticket)
      return invalidate(queryClient, invalidatedBy.ticketActivity())
    },
  })
}

export function useReplyToTicket(ticketId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: string) =>
      portal.replyToTicket(ticketId, { body, isInternal: false, fileIds: [] }),
    onSuccess: (ticket) => {
      queryClient.setQueryData(queryKeys.ticket(ticketId), ticket)
      return invalidate(queryClient, invalidatedBy.ticketActivity())
    },
  })
}

// ── Doctor ───────────────────────────────────────────────────────────────────

/** One day of the doctor's diary, a calendar date at the clinic. */
export function useDoctorDay(date: string) {
  return useQuery({
    queryKey: queryKeys.appointments({ day: date }),
    queryFn: () => doctor.appointments({ from: date, to: date }),
  })
}

/**
 * How far either side of a day to look for the visits recorded against its appointments.
 *
 * The encounter list filters by the day a visit **started**, not by its appointment's day, and
 * the API has no appointment filter. A visit opened the evening before — or written up the morning
 * after — is on a different day from its appointment, and a list for the appointment's day alone
 * misses it: the day then offered "Record the visit" for an appointment whose note was already
 * signed. Found by running the app; the web agenda had the same gap (ARCHITECTURE §17).
 */
export const VISIT_MATCH_DAYS = 7

/** The visits near a day — whether each of its appointments offers "open the note" or "start". */
export function useVisitsAround(date: string) {
  return useQuery({
    queryKey: queryKeys.encounters({ around: date, days: VISIT_MATCH_DAYS }),
    queryFn: () =>
      doctor.encounters({
        from: shiftDate(date, -VISIT_MATCH_DAYS),
        to: shiftDate(date, VISIT_MATCH_DAYS),
      }),
  })
}

export function useCaseload() {
  return useQuery({ queryKey: queryKeys.patientsITreat(), queryFn: () => doctor.patientsITreat() })
}

export function useChart(patientId: string, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.patient(patientId),
    queryFn: () => doctor.patient(patientId),
    enabled: options.enabled ?? true,
  })
}

export function usePatientVisits(patientId: string) {
  return useQuery({
    queryKey: queryKeys.encounters({ patientId }),
    queryFn: () => doctor.encounters({ patientId }),
  })
}

export function usePatientPrescriptions(patientId: string) {
  return useQuery({
    queryKey: queryKeys.prescriptions({ patientId }),
    queryFn: () => doctor.prescriptions({ patientId }),
  })
}

export function usePatientFiles(patientId: string) {
  return useQuery({
    queryKey: queryKeys.files({ patientId }),
    queryFn: () => doctor.files({ patientId }),
  })
}

export function useEncounter(encounterId: string) {
  return useQuery({
    queryKey: queryKeys.encounter(encounterId),
    queryFn: () => doctor.encounter(encounterId),
  })
}

/**
 * Opening the visit for an appointment — or finding the one that already exists.
 *
 * `ENCOUNTER_EXISTS` is not an error to show. It is what a second tap, or a retry after a lost
 * response, returns; the doctor wants the note, and the note is there.
 */
export function useOpenVisit() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (request: OpenEncounterRequest): Promise<string> => {
      try {
        return (await doctor.openEncounter(request)).id
      } catch (caught) {
        if (!(caught instanceof ApiError) || caught.code !== 'ENCOUNTER_EXISTS') throw caught
        // By patient, never by date: the visit may have been started on another day entirely.
        const visits = await doctor.encounters({ patientId: request.patientId })
        const existing = visits.find((visit) => visit.appointmentId === request.appointmentId)
        if (!existing) throw caught
        return existing.id
      }
    },
    onSettled: () => invalidate(queryClient, invalidatedBy.visitOpened()),
  })
}

/** Every write to a visit answers with the whole visit, which becomes the cache's copy at once. */
function useVisitWrite<TInput>(
  encounterId: string,
  write: (input: TInput) => Promise<EncounterDetail>,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: write,
    onSuccess: (encounter) => {
      queryClient.setQueryData(queryKeys.encounter(encounterId), encounter)
      return invalidate(queryClient, invalidatedBy.noteActivity())
    },
  })
}

export const useSaveNote = (encounterId: string) =>
  useVisitWrite(encounterId, (input: UpdateEncounterRequest) =>
    doctor.updateEncounter(encounterId, input),
  )

export const useSignNote = (encounterId: string) =>
  useVisitWrite(encounterId, (signature: string) => doctor.signNote(encounterId, { signature }))

export const useAddAddendum = (encounterId: string) =>
  useVisitWrite(encounterId, (input: AddendumRequest) => doctor.addAddendum(encounterId, input))
