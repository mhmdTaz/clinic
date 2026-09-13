/**
 * TanStack Query cache keys, shared by web and mobile (section 9.4).
 *
 * **Shared rather than duplicated, because invalidation is the thing that silently rots.** When a
 * booking succeeds, something has to invalidate the appointments list; if web and mobile each
 * spell that key their own way, one of them stops refreshing and nobody notices until a patient
 * swears they cancelled an appointment that is still on screen.
 *
 * Keys are arrays, hierarchical, and narrow to wide: invalidating `['appointments']` clears every
 * filtered list beneath it, which is almost always what a mutation wants.
 */
export const queryKeys = {
  me: () => ['me'] as const,
  myPermissions: () => ['me', 'permissions'] as const,
  /**
   * A doctor's caseload. Under `patients`, not under `me`: the mobile app keeps some `me` data
   * for offline reading, and a doctor's whole list of patients is not something to leave on a
   * phone by accident of a key's spelling.
   */
  patientsITreat: () => ['patients', { treatedByMe: true }] as const,
  patient: (patientId: string) => ['patients', patientId] as const,

  appointments: (filter: Record<string, unknown> = {}) => ['appointments', filter] as const,
  appointment: (appointmentId: string) => ['appointments', appointmentId] as const,
  slots: (doctorId: string, from: string, to: string) =>
    ['doctors', doctorId, 'slots', from, to] as const,
  doctors: () => ['doctors'] as const,
  /** Clinic-wide rules, not the person's: changed by an administrator, so read rarely. */
  bookingWindow: () => ['clinic', 'booking-window'] as const,

  files: (filter: Record<string, unknown> = {}) => ['files', filter] as const,
  prescriptions: (filter: Record<string, unknown> = {}) => ['prescriptions', filter] as const,
  invoices: (filter: Record<string, unknown> = {}) => ['invoices', filter] as const,
  statement: (patientId: string) => ['billing', 'statement', patientId] as const,

  encounters: (filter: Record<string, unknown> = {}) => ['encounters', filter] as const,
  encounter: (encounterId: string) => ['encounters', encounterId] as const,

  tickets: (filter: Record<string, unknown> = {}) => ['tickets', filter] as const,
  ticket: (ticketId: string) => ['tickets', ticketId] as const,

  notifications: (filter: Record<string, unknown> = {}) => ['notifications', filter] as const,
} as const

/**
 * The prefixes a mutation invalidates.
 *
 * Named here rather than written out at each call site, so "what does booking affect" has one
 * answer that both apps get. Booking changes the list, the slots it came from, and the bell.
 */
export const invalidatedBy = {
  booking: () => [['appointments'], ['doctors'], ['notifications']],
  cancellation: () => [['appointments'], ['doctors'], ['notifications']],
  ticketActivity: () => [['tickets'], ['notifications']],
  payment: () => [['invoices'], ['billing'], ['notifications']],
  /**
   * Anything written to a visit. The day list shows whether each appointment has a note and
   * whether it is signed, and the chart lists the visits, so both go stale with the note.
   */
  noteActivity: () => [['encounters'], ['patients']],
  /** Opening a visit also changes what the day offers for that appointment. */
  visitOpened: () => [['encounters'], ['appointments'], ['patients']],
} as const
