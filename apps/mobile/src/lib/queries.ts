import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import {
  ApiError,
  PAGE_LIMIT_MAX,
  collectByIds,
  collectPages,
  invalidatedBy,
  queryKeys,
} from '@clinic/api-client'
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
import { shiftDate } from './format'

/**
 * The app's data layer, built on the **shared** keys (§9.4).
 *
 * `queryKeys` and `invalidatedBy` come from `@clinic/api-client`, not from here, and that is the
 * point: when a booking succeeds something has to invalidate the appointments list, and if web and
 * mobile each spelled that key their own way one of them would stop refreshing. Nobody notices
 * until a patient swears they cancelled an appointment that is still on the screen.
 *
 * ## Lists page, and a screen that shows one whole says when it stopped
 *
 * Every collection pages with a cursor (§9.2). A list with a natural bound — a diary window, one
 * day, one patient's chart — is read whole with `collectPages`, up to a cap named below, and comes
 * back as `{ items, truncated }` so the screen can say it stopped short. The feed of updates grows
 * without bound, so it is read a page at a time as somebody scrolls back through it.
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

/** One person's diary over the window. Far past anything a patient books; said if it is reached. */
const DIARY_MAX = 500

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
      return collectPages(
        (page) =>
          portal.appointments({
            patientId: patientId ?? '',
            from: shiftDate(today, -APPOINTMENT_WINDOW_DAYS),
            to: shiftDate(today, APPOINTMENT_WINDOW_DAYS),
            ...page,
          }),
        DIARY_MAX,
      )
    },
    enabled: patientId !== null,
  })
}

/**
 * How far ahead this clinic lets somebody book, and with how much notice (ADR-0022).
 *
 * Read from the server rather than assumed. Until Phase 10 a phone could not read it — the
 * settings sat behind the admin portal — and the booking screen offered eight weeks whatever the
 * clinic had set.
 */
export function useBookingWindow() {
  return useQuery({
    queryKey: queryKeys.bookingWindow(),
    queryFn: () => portal.bookingWindow(),
    staleTime: 10 * 60_000,
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

/**
 * Booking for oneself.
 *
 * The key is minted by the screen **once per attempt** and reused if the person taps again, which
 * is the only arrangement in which it can help: the server answers a repeat with the appointment
 * the first attempt booked (§9.2), so a response lost to a weak signal costs a retry, never a
 * second appointment and never a "somebody else took it" about the patient's own slot.
 */
export function useBookAppointment() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: BookOwnAppointmentRequest & { idempotencyKey: string }) => {
      const { idempotencyKey, ...booking } = input
      return portal.bookForMyself(booking, idempotencyKey)
    },
    onSettled: () => invalidate(queryClient, invalidatedBy.booking()),
  })
}

export function useCancelAppointment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { appointmentId: string; reason: string | null; idempotencyKey: string }) =>
      portal.cancelAppointment(input.appointmentId, { reason: input.reason }, input.idempotencyKey),
    onSettled: () => invalidate(queryClient, invalidatedBy.cancellation()),
  })
}

/** Everything shared with one patient over the years. Past it, the screen says it stopped. */
const DOCUMENTS_MAX = 500

/** The patient's document vault. The server's scope decides what is shared (ADR-0025). */
export function useMyDocuments(patientId: string | null) {
  return useQuery({
    queryKey: queryKeys.files({ patientId }),
    queryFn: () => collectPages((page) => portal.files(page), DOCUMENTS_MAX),
    enabled: patientId !== null,
  })
}

/** One page of the feed. The home screen reads only the first; the updates screen scrolls on. */
export const NOTIFICATIONS_PAGE = 30

/**
 * The feed of updates, newest first, a page at a time.
 *
 * An infinite query rather than a collected list, because a feed has no natural end: every
 * reminder adds to it. The unread count travels on every page; the first page's is the current
 * one, because a refetch reloads the pages in order.
 */
export function useNotifications() {
  return useInfiniteQuery({
    queryKey: queryKeys.notifications({ limit: NOTIFICATIONS_PAGE }),
    queryFn: ({ pageParam }) =>
      portal.notifications({ limit: NOTIFICATIONS_PAGE, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
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

/** A person's own questions to the clinic, ever. The web's help page reads the same amount. */
const TICKETS_MAX = 500

/** Everything the person has asked, open or not — their own history, not a queue. */
export function useMyTickets() {
  return useQuery({
    queryKey: queryKeys.tickets({ view: 'all' }),
    queryFn: () => collectPages((page) => portal.tickets({ view: 'all', ...page }), TICKETS_MAX),
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

/** One doctor's day. No clinic books this many; if one ever does, the day says so. */
const DAY_MAX = 500

/** One day of the doctor's diary, a calendar date at the clinic. */
export function useDoctorDay(date: string) {
  return useQuery({
    queryKey: queryKeys.appointments({ day: date }),
    queryFn: () =>
      collectPages((page) => doctor.appointments({ from: date, to: date, ...page }), DAY_MAX),
  })
}

/**
 * The visits recorded against a day's appointments — whether each offers "open the note" or
 * "record the visit".
 *
 * Asked **by appointment**, not by date. The date filter is the day a visit *started*, and a visit
 * opened the evening before or written up the morning after is on a different day from its
 * appointment. Phase 9 worked around that by reading a fortnight of visits either side of the day;
 * the API now answers the actual question. Disabled until the day is known, since the question is
 * about its appointments.
 */
export function useVisitsFor(date: string, appointmentIds: readonly string[] | undefined) {
  const ids = appointmentIds ? [...new Set(appointmentIds)].sort() : []
  return useQuery({
    queryKey: queryKeys.encounters({ day: date, appointmentIds: ids }),
    queryFn: () =>
      collectByIds(ids, (slice) =>
        doctor.encounters({ appointmentIds: slice, limit: PAGE_LIMIT_MAX }),
      ),
    enabled: appointmentIds !== undefined,
  })
}

/**
 * Everyone one doctor has treated. Read whole because the search box filters on the phone — a
 * search that waited on the network between letters is unusable on a weak signal — and a caseload
 * this long is said to be cut short rather than searched incompletely without a word.
 */
const CASELOAD_MAX = 2000

export function useCaseload() {
  return useQuery({
    queryKey: queryKeys.patientsITreat(),
    queryFn: () => collectPages((page) => doctor.patientsITreat(page), CASELOAD_MAX),
  })
}

export function useChart(patientId: string, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.patient(patientId),
    queryFn: () => doctor.patient(patientId),
    enabled: options.enabled ?? true,
  })
}

/** Each section of a chart on a phone. Past it, the section says it stopped short. */
const CHART_MAX = 200

export function usePatientVisits(patientId: string) {
  return useQuery({
    queryKey: queryKeys.encounters({ patientId }),
    queryFn: () => collectPages((page) => doctor.encounters({ patientId, ...page }), CHART_MAX),
  })
}

export function usePatientPrescriptions(patientId: string) {
  return useQuery({
    queryKey: queryKeys.prescriptions({ patientId }),
    queryFn: () => collectPages((page) => doctor.prescriptions({ patientId, ...page }), CHART_MAX),
  })
}

export function usePatientFiles(patientId: string) {
  return useQuery({
    queryKey: queryKeys.files({ patientId }),
    queryFn: () => collectPages((page) => doctor.files({ patientId, ...page }), CHART_MAX),
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
 * response, returns; the doctor wants the note, and the note is there. Found by its appointment,
 * which is exact whatever day the visit was started on.
 */
export function useOpenVisit() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (request: OpenEncounterRequest): Promise<string> => {
      try {
        return (await doctor.openEncounter(request)).id
      } catch (caught) {
        if (
          !(caught instanceof ApiError) ||
          caught.code !== 'ENCOUNTER_EXISTS' ||
          !request.appointmentId
        ) {
          throw caught
        }
        const visits = await doctor.encounters({ appointmentIds: [request.appointmentId] })
        const existing = visits.items.find((visit) => visit.appointmentId === request.appointmentId)
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
