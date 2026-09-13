import { z } from 'zod'
import {
  AccountStatement,
  AccountStatementQuery,
  AcceptInvitationRequest,
  AddendumRequest,
  AdjustStockRequest,
  AnalyticsOverview,
  AnalyticsQuery,
  AppointmentDetail,
  AppointmentListQuery,
  AppointmentSummary,
  AuditActorOption,
  AuditEntryDetail,
  AuditEntrySummary,
  AuditExport,
  AuditListQuery,
  BookAppointmentRequest,
  BookingWindow,
  BookOwnAppointmentRequest,
  BranchDetail,
  BranchInput,
  CancelAppointmentRequest,
  ChainStatus,
  ChangePasswordRequest,
  ChangeUserStatusRequest,
  ChartBanner,
  ClinicOverview,
  ClinicProfileInput,
  ClinicSettings,
  ConfirmUploadRequest,
  ConsumptionResult,
  CreateDoctorRequest,
  CreateInvoiceRequest,
  CreateRoleRequest,
  CreateSpecialtyRequest,
  DailyReconciliation,
  DailyReconciliationQuery,
  DaySlots,
  DoctorAvailability,
  DoctorDetail,
  DoctorListQuery,
  DoctorSummary,
  DownloadLink,
  DuplicateCheckRequest,
  DuplicateCheckResult,
  EncounterDetail,
  EncounterListQuery,
  EncounterSummary,
  FileListQuery,
  ForgotPasswordRequest,
  HealthPayload,
  InventoryCategory,
  InventoryCategoryInput,
  InventoryItemDetail,
  InventoryItemInput,
  InventoryItemSummary,
  InventoryListQuery,
  InvitationPreview,
  InvitationPreviewRequest,
  InviteUserRequest,
  InvoiceDetail,
  InvoiceListQuery,
  InvoiceSummary,
  IssueInvoiceRequest,
  IssuePrescriptionRequest,
  LoginRequest,
  LogoutRequest,
  MarkNotificationsReadRequest,
  MeNavigation,
  MeNavigationQuery,
  MePermissions,
  MovementListQuery,
  NotificationFeed,
  NotificationListQuery,
  NotificationPreferenceRow,
  OpenEncounterRequest,
  OpenTicketRequest,
  PaginationQuery,
  PatientDetail,
  PatientListQuery,
  PatientSummary,
  Payment,
  PaymentListQuery,
  PermissionCatalogueEntry,
  Prescription,
  PrescriptionListQuery,
  PresignedUpload,
  PresignUploadRequest,
  ReceiveStockRequest,
  RecordConsumptionRequest,
  RecordPaymentRequest,
  RefreshRequest,
  RefundPaymentRequest,
  RegisterDeviceRequest,
  RegisteredDevice,
  RegisterPatientRequest,
  RegisterWalkInRequest,
  ReplyToTicketRequest,
  RescheduleAppointmentRequest,
  ResetPasswordRequest,
  RoleDetail,
  RoleListItem,
  ServiceInput,
  ServiceListQuery,
  Service,
  SessionResult,
  SessionSummary,
  SessionUser,
  SetAllergiesRequest,
  SetAvailabilityRequest,
  SetConditionsRequest,
  SetDiagnosesRequest,
  SetHolidaysRequest,
  SetLocaleRequest,
  SetLocaleResult,
  SetNotificationPreferencesRequest,
  SetRolePermissionsRequest,
  SetUserRolesRequest,
  SetWorkingHoursRequest,
  SignNoteRequest,
  SlotQuery,
  Specialty,
  StockAlerts,
  StockMovement,
  StoredFile,
  Supplier,
  SupplierInput,
  TicketDetail,
  TicketListQuery,
  TicketSummary,
  TimeOffInput,
  UpdateBookingWindowRequest,
  UpdateBranchRequest,
  UpdateDoctorRequest,
  UpdateEncounterRequest,
  UpdateFileRequest,
  UpdateInvoiceRequest,
  UpdateMeRequest,
  UpdatePatientRequest,
  UpdateRoleRequest,
  UpdateSpecialtyRequest,
  UpdateTicketRequest,
  UpdateUserRequest,
  UserDetail,
  UserListQuery,
  UserSummary,
  VitalsInput,
  VoidInvoiceRequest,
} from '@clinic/contracts'

/**
 * Every operation `/api` serves, described once (§9.1, ADR-0032).
 *
 * The OpenAPI document is generated from this list and the Zod contracts it names, and a test
 * (`src/lib/__tests__/openapi-catalogue.test.ts`) reads every `route.ts` and fails when an entry is
 * missing, stale, or disagrees with its route about the permission, the body or query contract,
 * idempotency, the status codes or whether the response pages. What that test cannot read from a
 * route is the response type — handlers return use-case results, not schemas — so the response
 * named here is the use case's declared return type, matched by hand.
 *
 * Kept beside the routes rather than in `@clinic/contracts`: the paths, permissions and status
 * codes are the delivery layer's, and the contracts package stays Zod and nothing else.
 */

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export type OperationResponse =
  /** `{ data, meta }` with `data` of this shape. */
  | { kind: 'data'; status: number[]; schema: z.ZodTypeAny }
  /** `{ data: [...], meta: { nextCursor, hasMore } }` — a cursor page (§9.2). */
  | { kind: 'page'; status: number[]; item: z.ZodTypeAny }
  /** `{ data, meta: { nextCursor, hasMore } }` — an object that carries a cursor beside itself. */
  | { kind: 'cursored'; status: number[]; schema: z.ZodTypeAny }
  /** A `303` to a page in the browser; no body. */
  | { kind: 'redirect' }
  /** A document served as it is, with no envelope. */
  | { kind: 'raw'; description: string }

export interface Operation {
  method: HttpMethod
  /** The route directory as an OpenAPI path: `[appointmentId]` becomes `{appointmentId}`. */
  path: string
  summary: string
  description?: string
  /** `required` unless said otherwise, which is `withApi`'s own default. */
  auth: 'required' | 'optional' | 'none'
  /** The coarse permission `withApi` checks before the use case; finer scope is the use case's. */
  permission?: string
  /** Honours `Idempotency-Key` (§9.2). */
  idempotent?: boolean
  query?: z.ZodTypeAny
  body?: z.ZodTypeAny
  /** Request headers other than authentication and the idempotency key. */
  headers?: Record<string, { description: string }>
  response: OperationResponse
}

// ── Builders ─────────────────────────────────────────────────────────────────

type Spec = Omit<Operation, 'method' | 'path' | 'summary' | 'auth' | 'response'> & {
  auth?: Operation['auth']
}

const operation =
  (method: HttpMethod) =>
  (path: string, summary: string, response: OperationResponse, spec: Spec = {}): Operation => ({
    method,
    path,
    summary,
    auth: spec.auth ?? 'required',
    ...spec,
    ...{ response },
  })

const GET = operation('GET')
const POST = operation('POST')
const PUT = operation('PUT')
const PATCH = operation('PATCH')
const DELETE = operation('DELETE')

const data = (schema: z.ZodTypeAny, status = 200): OperationResponse => ({
  kind: 'data',
  status: [status],
  schema,
})
const created = (schema: z.ZodTypeAny): OperationResponse => data(schema, 201)
const list = (item: z.ZodTypeAny): OperationResponse => data(z.array(item))
const page = (item: z.ZodTypeAny): OperationResponse => ({ kind: 'page', status: [200], item })

/** The small acknowledgements some writes answer with. Not worth a name in the contracts. */
const Ok = z.object({ ok: z.literal(true) })
const Accepted = z.object({ accepted: z.literal(true) })
const SignedOut = z.object({ signedOut: z.literal(true) })

// ── The catalogue ────────────────────────────────────────────────────────────

export const OPERATIONS: readonly Operation[] = [
  // ── Health ──────────────────────────────────────────────────────────────────
  GET(
    '/api/health',
    'Whether the service and its dependencies are up',
    { kind: 'data', status: [200, 503], schema: HealthPayload },
    {
      auth: 'none',
      description: '`503` with the same body when a dependency the service needs is down.',
    },
  ),
  GET(
    '/api/v1/openapi.json',
    'This document',
    { kind: 'raw', description: 'The OpenAPI 3.1 document, generated from the Zod contracts.' },
    { auth: 'none' },
  ),

  // ── Authentication ──────────────────────────────────────────────────────────
  POST('/api/v1/auth/login', 'Sign in', data(SessionResult), {
    auth: 'none',
    body: LoginRequest,
    description:
      'With `tokenDelivery: "body"` the tokens are returned for a device to store; with ' +
      '`"cookie"` they are set as http-only cookies and only the user is returned.',
  }),
  POST('/api/v1/auth/refresh', 'Exchange a refresh token for a new pair', data(SessionResult), {
    auth: 'none',
    body: RefreshRequest,
    description:
      'Refresh tokens rotate: the one presented is retired, and presenting it again ends the session.',
  }),
  GET(
    '/api/v1/auth/refresh',
    'Renew the browser session and return to a page',
    { kind: 'redirect' },
    {
      auth: 'none',
      description:
        'For browsers only. Reads the refresh cookie and redirects to `?next=`, or to sign-in.',
    },
  ),
  POST('/api/v1/auth/logout', 'Sign out, ending the session on the server', data(SignedOut), {
    auth: 'optional',
    body: LogoutRequest,
    description:
      'A device sends its refresh token so a lapsed access token still ends the session, and its ' +
      'push token so the phone stops receiving.',
  }),
  GET(
    '/api/v1/auth/session-ended',
    'Clear the browser session and go to sign-in',
    { kind: 'redirect' },
    {
      auth: 'none',
    },
  ),
  POST('/api/v1/auth/forgot-password', 'Ask for a password reset email', data(Accepted, 202), {
    auth: 'none',
    body: ForgotPasswordRequest,
    description: '`202` whether or not the address has an account, so the answer reveals nothing.',
  }),
  POST('/api/v1/auth/reset-password', 'Set a new password from a reset link', data(Accepted), {
    auth: 'none',
    body: ResetPasswordRequest,
  }),
  POST(
    '/api/v1/auth/invitations/preview',
    'Read an invitation before accepting it',
    data(InvitationPreview),
    {
      auth: 'none',
      body: InvitationPreviewRequest,
    },
  ),
  POST('/api/v1/auth/accept-invite', 'Accept an invitation and sign in', data(SessionResult), {
    auth: 'none',
    body: AcceptInvitationRequest,
  }),

  // ── The signed-in person ────────────────────────────────────────────────────
  GET('/api/v1/me', 'Who is signed in', data(SessionUser)),
  PATCH('/api/v1/me', 'Update my profile', data(SessionUser), { body: UpdateMeRequest }),
  GET('/api/v1/me/permissions', 'What I may do, with the scope of each grant', data(MePermissions)),
  GET('/api/v1/me/navigation', 'The portal navigation I am allowed to see', data(MeNavigation), {
    query: MeNavigationQuery,
  }),
  PUT(
    '/api/v1/me/password',
    'Change my password',
    data(
      z.object({
        changed: z.literal(true),
        accessToken: z.string().optional(),
        accessTokenExpiresAt: z.string().datetime().optional(),
      }),
    ),
    {
      body: ChangePasswordRequest,
      description:
        'Every other session ends. A device is given a new access token in the body; a browser, in a cookie.',
    },
  ),
  POST('/api/v1/me/locale', 'Choose the interface language', data(SetLocaleResult), {
    auth: 'optional',
    body: SetLocaleRequest,
  }),
  GET(
    '/api/v1/me/sessions',
    'My signed-in sessions',
    data(z.object({ sessions: z.array(SessionSummary) })),
  ),
  DELETE('/api/v1/me/sessions', 'Sign out everywhere', data(SignedOut)),
  DELETE(
    '/api/v1/me/sessions/{sessionId}',
    'End one of my sessions',
    data(z.object({ signedOut: z.literal(true), current: z.boolean() })),
  ),
  GET('/api/v1/me/devices', 'My phones registered for push', list(RegisteredDevice), {
    headers: {
      'x-push-token': {
        description:
          'This installation’s push token, to be told which row is this phone. A header so it never ' +
          'appears in a URL or an access log.',
      },
    },
  }),
  POST('/api/v1/me/devices', 'Register this phone for push', data(RegisteredDevice), {
    body: RegisterDeviceRequest,
    description: 'An upsert on the push token: called on every launch.',
  }),
  DELETE('/api/v1/me/devices/{deviceId}', 'Stop a phone receiving push', data(Ok)),
  GET(
    '/api/v1/me/notifications',
    'My notifications, newest first, with the unread count',
    { kind: 'cursored', status: [200], schema: NotificationFeed },
    { query: NotificationListQuery },
  ),
  POST(
    '/api/v1/me/notifications',
    'Mark notifications read',
    data(z.object({ read: z.number().int(), unreadCount: z.number().int() })),
    { body: MarkNotificationsReadRequest, description: 'An empty `ids` marks every one read.' },
  ),
  GET(
    '/api/v1/me/notification-preferences',
    'How I am told about each kind of event',
    list(NotificationPreferenceRow),
  ),
  PUT(
    '/api/v1/me/notification-preferences',
    'Change how I am told',
    list(NotificationPreferenceRow),
    {
      body: SetNotificationPreferencesRequest,
    },
  ),
  POST('/api/v1/me/appointments', 'Book an appointment for myself', created(AppointmentDetail), {
    permission: 'appointment:create',
    idempotent: true,
    body: BookOwnAppointmentRequest,
    description:
      'The patient is the caller’s own record. The clinic’s booking window applies (ADR-0022).',
  }),
  GET(
    '/api/v1/me/patients',
    'Every patient this doctor has treated, most recent visit first',
    page(PatientSummary),
    {
      permission: 'patient:read',
      query: PaginationQuery,
    },
  ),

  // ── The clinic ──────────────────────────────────────────────────────────────
  GET(
    '/api/v1/clinic/booking-window',
    'The rules self-service booking follows',
    data(BookingWindow),
    {
      permission: 'clinic:read',
      description:
        'How far ahead, how much notice, and until when a cancellation is accepted online.',
    },
  ),

  // ── Administration ──────────────────────────────────────────────────────────
  GET('/api/v1/admin/clinic', 'The clinic at a glance', data(ClinicOverview), {
    permission: 'portal.admin:access',
  }),
  GET('/api/v1/admin/clinic/settings', 'The clinic’s settings', data(ClinicSettings), {
    permission: 'portal.admin:access',
  }),
  PUT('/api/v1/admin/clinic/profile', 'Update the clinic’s profile', data(ClinicSettings), {
    permission: 'portal.admin:access',
    body: ClinicProfileInput,
  }),
  PUT('/api/v1/admin/clinic/holidays', 'Replace the clinic’s holidays', data(ClinicSettings), {
    permission: 'portal.admin:access',
    body: SetHolidaysRequest,
  }),
  PUT('/api/v1/admin/clinic/booking-window', 'Change the booking window', data(ClinicSettings), {
    permission: 'clinic:update',
    body: UpdateBookingWindowRequest,
  }),
  GET('/api/v1/admin/branches', 'The clinic’s branches', list(BranchDetail), {
    permission: 'portal.admin:access',
  }),
  POST('/api/v1/admin/branches', 'Add a branch', created(ClinicSettings), {
    permission: 'portal.admin:access',
    body: BranchInput,
  }),
  PUT('/api/v1/admin/branches/{branchId}', 'Update a branch', data(ClinicSettings), {
    permission: 'portal.admin:access',
    body: UpdateBranchRequest,
  }),
  PUT(
    '/api/v1/admin/branches/{branchId}/working-hours',
    'Replace a branch’s working hours',
    data(ClinicSettings),
    {
      permission: 'portal.admin:access',
      body: SetWorkingHoursRequest,
    },
  ),
  GET(
    '/api/v1/admin/permissions',
    'Every permission a role can be granted',
    list(PermissionCatalogueEntry),
    {
      permission: 'portal.admin:access',
    },
  ),
  GET('/api/v1/admin/roles', 'The roles, with how many people hold each', list(RoleListItem), {
    permission: 'portal.admin:access',
  }),
  POST('/api/v1/admin/roles', 'Create a role', created(RoleDetail), {
    permission: 'portal.admin:access',
    body: CreateRoleRequest,
  }),
  GET('/api/v1/admin/roles/{roleId}', 'A role and its grants', data(RoleDetail), {
    permission: 'portal.admin:access',
  }),
  PUT('/api/v1/admin/roles/{roleId}', 'Rename or describe a role', data(RoleDetail), {
    permission: 'portal.admin:access',
    body: UpdateRoleRequest,
  }),
  DELETE(
    '/api/v1/admin/roles/{roleId}',
    'Delete a role',
    data(z.object({ deleted: z.literal(true) })),
    {
      permission: 'portal.admin:access',
      description:
        'A system role is refused `SYSTEM_ROLE_PROTECTED`; a role somebody holds, `ROLE_IN_USE`.',
    },
  ),
  PUT('/api/v1/admin/roles/{roleId}/permissions', 'Replace a role’s grants', data(RoleDetail), {
    permission: 'portal.admin:access',
    body: SetRolePermissionsRequest,
  }),
  GET('/api/v1/admin/users', 'Staff accounts', page(UserSummary), {
    permission: 'portal.admin:access',
    query: UserListQuery,
  }),
  POST('/api/v1/admin/users/invite', 'Invite somebody to an account', created(UserDetail), {
    permission: 'portal.admin:access',
    body: InviteUserRequest,
  }),
  GET('/api/v1/admin/users/{userId}', 'An account', data(UserDetail), {
    permission: 'portal.admin:access',
  }),
  PUT('/api/v1/admin/users/{userId}', 'Update an account', data(UserDetail), {
    permission: 'portal.admin:access',
    body: UpdateUserRequest,
  }),
  POST('/api/v1/admin/users/{userId}/invitation', 'Send the invitation again', data(UserDetail), {
    permission: 'portal.admin:access',
  }),
  POST(
    '/api/v1/admin/users/{userId}/password-reset',
    'Make the person choose a new password',
    data(UserDetail),
    {
      permission: 'portal.admin:access',
    },
  ),
  PUT('/api/v1/admin/users/{userId}/roles', 'Replace an account’s roles', data(UserDetail), {
    permission: 'portal.admin:access',
    body: SetUserRolesRequest,
  }),
  POST('/api/v1/admin/users/{userId}/status', 'Suspend or restore an account', data(UserDetail), {
    permission: 'portal.admin:access',
    body: ChangeUserStatusRequest,
  }),
  GET(
    '/api/v1/admin/analytics/overview',
    'Revenue, appointments and utilisation over a range',
    data(AnalyticsOverview),
    {
      permission: 'analytics:read',
      query: AnalyticsQuery,
    },
  ),
  GET('/api/v1/admin/audit-logs', 'The audit log, newest first', page(AuditEntrySummary), {
    permission: 'audit:read',
    query: AuditListQuery,
    description: 'Reading the log is itself recorded.',
  }),
  GET(
    '/api/v1/admin/audit-logs/{entryId}',
    'One audit entry, with what changed',
    data(AuditEntryDetail),
    {
      permission: 'audit:read',
    },
  ),
  GET(
    '/api/v1/admin/audit-logs/actors',
    'Who appears in the log, for the filter',
    list(AuditActorOption),
    {
      permission: 'audit:read',
    },
  ),
  GET('/api/v1/admin/audit-logs/chain', 'Verify the audit log’s hash chain', data(ChainStatus), {
    permission: 'audit:read',
  }),
  GET('/api/v1/admin/audit-logs/export', 'The filtered log as CSV', data(AuditExport), {
    permission: 'audit:export',
    query: AuditListQuery,
  }),

  // ── Patients ────────────────────────────────────────────────────────────────
  GET('/api/v1/patients', 'Search the patient register', page(PatientSummary), {
    permission: 'patient:read',
    query: PatientListQuery,
  }),
  POST(
    '/api/v1/patients',
    'Register a patient',
    created(z.object({ patient: PatientDetail, invitationSent: z.boolean().nullable() })),
    {
      permission: 'patient:create',
      body: RegisterPatientRequest,
      description: '`invitationSent` is null when no portal invitation was asked for.',
    },
  ),
  POST(
    '/api/v1/patients/check-duplicates',
    'Records that may be the same person',
    data(DuplicateCheckResult),
    {
      permission: 'patient:read',
      body: DuplicateCheckRequest,
    },
  ),
  GET(
    '/api/v1/patients/{patientId}',
    'A patient record, with its chart banner',
    data(PatientDetail),
    {
      permission: 'patient:read',
    },
  ),
  PUT('/api/v1/patients/{patientId}', 'Update a patient record', data(PatientDetail), {
    permission: 'patient:update',
    body: UpdatePatientRequest,
  }),
  PUT(
    '/api/v1/patients/{patientId}/allergies',
    'Replace a patient’s allergies',
    data(ChartBanner),
    {
      permission: 'patient:update',
      body: SetAllergiesRequest,
    },
  ),
  PUT(
    '/api/v1/patients/{patientId}/conditions',
    'Replace a patient’s chronic conditions',
    data(ChartBanner),
    {
      permission: 'patient:update',
      body: SetConditionsRequest,
    },
  ),
  POST('/api/v1/patients/{patientId}/archive', 'Archive a patient record', data(PatientDetail), {
    permission: 'patient:delete',
  }),
  POST(
    '/api/v1/patients/{patientId}/restore',
    'Restore an archived patient record',
    data(PatientDetail),
    {
      permission: 'patient:delete',
    },
  ),
  POST(
    '/api/v1/patients/{patientId}/portal-invitation',
    'Invite a patient to the portal',
    data(z.object({ patient: PatientDetail, invitationSent: z.boolean() })),
    { permission: 'patient:update' },
  ),

  // ── Doctors and their time ──────────────────────────────────────────────────
  GET('/api/v1/doctors', 'The doctors', list(DoctorSummary), {
    permission: 'doctor:read',
    query: DoctorListQuery,
  }),
  POST('/api/v1/doctors', 'Add a doctor', created(DoctorDetail), {
    permission: 'doctor:create',
    body: CreateDoctorRequest,
  }),
  GET('/api/v1/doctors/{doctorId}', 'A doctor', data(DoctorDetail), { permission: 'doctor:read' }),
  PUT('/api/v1/doctors/{doctorId}', 'Update a doctor', data(DoctorDetail), {
    permission: 'doctor:update',
    body: UpdateDoctorRequest,
  }),
  GET(
    '/api/v1/doctors/{doctorId}/availability',
    'A doctor’s weekly hours and time off',
    data(DoctorAvailability),
    {
      permission: 'availability:read',
    },
  ),
  PUT(
    '/api/v1/doctors/{doctorId}/availability',
    'Replace a doctor’s weekly hours',
    data(DoctorAvailability),
    {
      permission: 'availability:manage',
      body: SetAvailabilityRequest,
    },
  ),
  POST('/api/v1/doctors/{doctorId}/time-off', 'Add time off', created(DoctorAvailability), {
    permission: 'availability:manage',
    body: TimeOffInput,
  }),
  DELETE(
    '/api/v1/doctors/{doctorId}/time-off/{timeOffId}',
    'Remove time off',
    data(DoctorAvailability),
    {
      permission: 'availability:manage',
    },
  ),
  GET('/api/v1/doctors/{doctorId}/slots', 'Open times a doctor can be booked', list(DaySlots), {
    permission: 'availability:read',
    query: SlotQuery,
    description:
      'A patient booking for themselves is offered only times past the clinic’s notice period (ADR-0022).',
  }),
  GET('/api/v1/specialties', 'The specialties', list(Specialty), { permission: 'doctor:read' }),
  POST('/api/v1/specialties', 'Add a specialty', created(Specialty), {
    permission: 'specialty:manage',
    body: CreateSpecialtyRequest,
  }),
  PUT('/api/v1/specialties/{specialtyId}', 'Update a specialty', data(Specialty), {
    permission: 'specialty:manage',
    body: UpdateSpecialtyRequest,
  }),

  // ── Appointments ────────────────────────────────────────────────────────────
  GET(
    '/api/v1/appointments',
    'Appointments in a date range, in the order they happen',
    page(AppointmentSummary),
    {
      permission: 'appointment:read',
      query: AppointmentListQuery,
    },
  ),
  POST('/api/v1/appointments', 'Book an appointment for a patient', created(AppointmentDetail), {
    permission: 'appointment:create',
    idempotent: true,
    body: BookAppointmentRequest,
  }),
  POST('/api/v1/appointments/walk-in', 'Register a walk-in', created(AppointmentDetail), {
    permission: 'appointment:create',
    idempotent: true,
    body: RegisterWalkInRequest,
  }),
  GET('/api/v1/appointments/{appointmentId}', 'An appointment', data(AppointmentDetail), {
    permission: 'appointment:read',
  }),
  POST(
    '/api/v1/appointments/{appointmentId}/reschedule',
    'Move an appointment',
    data(AppointmentDetail),
    {
      permission: 'appointment:update',
      idempotent: true,
      body: RescheduleAppointmentRequest,
    },
  ),
  POST(
    '/api/v1/appointments/{appointmentId}/cancel',
    'Cancel an appointment',
    data(AppointmentDetail),
    {
      permission: 'appointment:cancel',
      idempotent: true,
      body: CancelAppointmentRequest,
      description: 'A patient may cancel only before the clinic’s cutoff (ADR-0022).',
    },
  ),
  POST(
    '/api/v1/appointments/{appointmentId}/check-in',
    'Check a patient in',
    data(AppointmentDetail),
    {
      permission: 'appointment:check_in',
    },
  ),
  POST(
    '/api/v1/appointments/{appointmentId}/start',
    'Start the appointment',
    data(AppointmentDetail),
    {
      permission: 'appointment:update',
    },
  ),
  POST(
    '/api/v1/appointments/{appointmentId}/complete',
    'Complete the appointment',
    data(AppointmentDetail),
    {
      permission: 'appointment:update',
    },
  ),
  POST(
    '/api/v1/appointments/{appointmentId}/no-show',
    'Record that the patient did not attend',
    data(AppointmentDetail),
    {
      permission: 'appointment:update',
      body: CancelAppointmentRequest,
    },
  ),

  // ── Visits ──────────────────────────────────────────────────────────────────
  GET('/api/v1/encounters', 'Visits, newest first', page(EncounterSummary), {
    permission: 'encounter:read',
    query: EncounterListQuery,
    description:
      '`appointmentIds` (comma-separated, at most 100) finds the visits recorded against those ' +
      'appointments, whatever day each started.',
  }),
  POST('/api/v1/encounters', 'Open a visit', created(EncounterDetail), {
    permission: 'encounter:write',
    body: OpenEncounterRequest,
    description: 'One per appointment: a second is refused `ENCOUNTER_EXISTS`.',
  }),
  GET('/api/v1/encounters/{encounterId}', 'A visit, with its note', data(EncounterDetail), {
    permission: 'encounter:read',
  }),
  PATCH('/api/v1/encounters/{encounterId}', 'Write to the draft note', data(EncounterDetail), {
    permission: 'encounter:write',
    body: UpdateEncounterRequest,
    description: 'A signed note refuses every change (ADR-0024).',
  }),
  POST('/api/v1/encounters/{encounterId}/vitals', 'Record vitals', data(EncounterDetail), {
    permission: 'encounter:write',
    body: VitalsInput,
  }),
  PUT(
    '/api/v1/encounters/{encounterId}/diagnoses',
    'Replace the diagnoses',
    data(EncounterDetail),
    {
      permission: 'encounter:write',
      body: SetDiagnosesRequest,
    },
  ),
  POST('/api/v1/encounters/{encounterId}/sign', 'Sign the note', data(EncounterDetail), {
    permission: 'encounter:sign',
    body: SignNoteRequest,
  }),
  POST(
    '/api/v1/encounters/{encounterId}/addendum',
    'Add an addendum to a signed note',
    created(EncounterDetail),
    {
      permission: 'encounter:sign',
      body: AddendumRequest,
    },
  ),
  POST('/api/v1/encounters/{encounterId}/complete', 'Complete the visit', data(EncounterDetail), {
    permission: 'encounter:write',
  }),
  GET(
    '/api/v1/encounters/{encounterId}/prescriptions',
    'The visit’s prescriptions',
    page(Prescription),
    {
      permission: 'prescription:read',
      query: PaginationQuery,
    },
  ),
  POST(
    '/api/v1/encounters/{encounterId}/prescriptions',
    'Issue a prescription',
    created(Prescription),
    {
      permission: 'prescription:issue',
      body: IssuePrescriptionRequest,
    },
  ),
  GET('/api/v1/encounters/{encounterId}/consumption', 'Stock the visit used', list(StockMovement), {
    permission: 'inventory:read',
  }),
  POST(
    '/api/v1/encounters/{encounterId}/consumption',
    'Record stock used in the visit',
    created(ConsumptionResult),
    {
      permission: 'inventory:consume',
      body: RecordConsumptionRequest,
    },
  ),

  // ── Prescriptions ───────────────────────────────────────────────────────────
  GET('/api/v1/prescriptions', 'Prescriptions, newest first', page(Prescription), {
    permission: 'prescription:read',
    query: PrescriptionListQuery,
  }),
  GET('/api/v1/prescriptions/{prescriptionId}', 'A prescription', data(Prescription), {
    permission: 'prescription:read',
  }),
  GET(
    '/api/v1/prescriptions/{prescriptionId}/pdf',
    'A short-lived link to the prescription PDF',
    data(DownloadLink),
    {
      permission: 'prescription:read',
    },
  ),

  // ── Documents ───────────────────────────────────────────────────────────────
  GET('/api/v1/files', 'Documents, newest first', page(StoredFile), {
    permission: 'file:read',
    query: FileListQuery,
  }),
  POST('/api/v1/files/presign-upload', 'Start an upload', created(PresignedUpload), {
    permission: 'file:upload',
    body: PresignUploadRequest,
    description:
      'The bytes go straight to storage with the URL returned, then the upload is confirmed.',
  }),
  POST('/api/v1/files/{fileId}/confirm', 'Confirm an upload arrived', data(StoredFile), {
    permission: 'file:upload',
    body: ConfirmUploadRequest,
  }),
  PATCH('/api/v1/files/{fileId}', 'Recategorise, describe or share a document', data(StoredFile), {
    permission: 'file:upload',
    body: UpdateFileRequest,
  }),
  DELETE('/api/v1/files/{fileId}', 'Delete a document', data(Ok), { permission: 'file:delete' }),
  GET(
    '/api/v1/files/{fileId}/download-url',
    'A short-lived link to the document',
    data(DownloadLink),
    {
      permission: 'file:read',
    },
  ),

  // ── Billing ─────────────────────────────────────────────────────────────────
  GET('/api/v1/billing/services', 'The price list', list(Service), {
    permission: 'service:read',
    query: ServiceListQuery,
  }),
  POST('/api/v1/billing/services', 'Add a service', created(Service), {
    permission: 'service:manage',
    body: ServiceInput,
  }),
  PUT('/api/v1/billing/services/{serviceId}', 'Update a service', data(Service), {
    permission: 'service:manage',
    body: ServiceInput,
  }),
  GET('/api/v1/billing/invoices', 'Invoices, newest first', page(InvoiceSummary), {
    permission: 'invoice:read',
    query: InvoiceListQuery,
  }),
  POST('/api/v1/billing/invoices', 'Draft an invoice', created(InvoiceDetail), {
    permission: 'invoice:create',
    body: CreateInvoiceRequest,
  }),
  GET('/api/v1/billing/invoices/{invoiceId}', 'An invoice', data(InvoiceDetail), {
    permission: 'invoice:read',
  }),
  PATCH('/api/v1/billing/invoices/{invoiceId}', 'Change a draft invoice', data(InvoiceDetail), {
    permission: 'invoice:create',
    body: UpdateInvoiceRequest,
  }),
  POST('/api/v1/billing/invoices/{invoiceId}/issue', 'Issue an invoice', data(InvoiceDetail), {
    permission: 'invoice:issue',
    body: IssueInvoiceRequest,
  }),
  POST('/api/v1/billing/invoices/{invoiceId}/void', 'Void an invoice', data(InvoiceDetail), {
    permission: 'invoice:void',
    body: VoidInvoiceRequest,
  }),
  GET(
    '/api/v1/billing/invoices/{invoiceId}/pdf',
    'A short-lived link to the invoice PDF',
    data(DownloadLink),
    {
      permission: 'invoice:read',
    },
  ),
  GET('/api/v1/billing/payments', 'Payments, newest first', page(Payment), {
    permission: 'payment:read',
    query: PaymentListQuery,
  }),
  POST('/api/v1/billing/payments', 'Record a payment', created(Payment), {
    permission: 'payment:record',
    idempotent: true,
    body: RecordPaymentRequest,
    description:
      'Idempotent twice over: by `idempotencyKey` in the body at the index (ADR-0028), and by the ' +
      '`Idempotency-Key` header, which replays the first response.',
  }),
  GET('/api/v1/billing/payments/{paymentId}', 'A payment', data(Payment), {
    permission: 'payment:read',
  }),
  POST('/api/v1/billing/payments/{paymentId}/refund', 'Refund a payment', data(Payment), {
    permission: 'payment:refund',
    idempotent: true,
    body: RefundPaymentRequest,
  }),
  GET(
    '/api/v1/billing/payments/{paymentId}/receipt',
    'A short-lived link to the receipt PDF',
    data(DownloadLink),
    {
      permission: 'payment:read',
    },
  ),
  GET('/api/v1/billing/statement', 'A statement of account', data(AccountStatement), {
    permission: 'invoice:read',
    query: AccountStatementQuery,
    description:
      'Totals over every invoice and payment; the lines are the newest hundred of each, with ' +
      '`hasMoreInvoices` and `hasMorePayments` saying when there are older ones.',
  }),
  GET('/api/v1/billing/reports/daily', 'The day’s takings, by method', data(DailyReconciliation), {
    permission: 'payment:read',
    query: DailyReconciliationQuery,
  }),

  // ── Inventory ───────────────────────────────────────────────────────────────
  GET('/api/v1/inventory/items', 'The catalogue, by name', page(InventoryItemSummary), {
    permission: 'inventory:read',
    query: InventoryListQuery,
  }),
  POST('/api/v1/inventory/items', 'Add an item', created(InventoryItemDetail), {
    permission: 'inventory:manage',
    body: InventoryItemInput,
  }),
  GET('/api/v1/inventory/items/{itemId}', 'An item, with its batches', data(InventoryItemDetail), {
    permission: 'inventory:read',
  }),
  PUT('/api/v1/inventory/items/{itemId}', 'Update an item', data(InventoryItemDetail), {
    permission: 'inventory:manage',
    body: InventoryItemInput,
  }),
  POST('/api/v1/inventory/items/{itemId}/receive', 'Receive stock', created(StockMovement), {
    permission: 'inventory:manage',
    body: ReceiveStockRequest,
  }),
  POST('/api/v1/inventory/items/{itemId}/adjust', 'Adjust stock', created(StockMovement), {
    permission: 'inventory:adjust',
    body: AdjustStockRequest,
  }),
  GET('/api/v1/inventory/movements', 'The stock ledger, newest first', page(StockMovement), {
    permission: 'inventory:read',
    query: MovementListQuery,
  }),
  GET('/api/v1/inventory/alerts', 'What is low, expiring or expired', data(StockAlerts), {
    permission: 'inventory:read',
  }),
  GET('/api/v1/inventory/categories', 'Stock categories', list(InventoryCategory), {
    permission: 'inventory:read',
  }),
  POST('/api/v1/inventory/categories', 'Add a category', created(InventoryCategory), {
    permission: 'inventory:manage',
    body: InventoryCategoryInput,
  }),
  PUT('/api/v1/inventory/categories/{categoryId}', 'Update a category', data(InventoryCategory), {
    permission: 'inventory:manage',
    body: InventoryCategoryInput,
  }),
  GET('/api/v1/inventory/suppliers', 'Suppliers', list(Supplier), { permission: 'inventory:read' }),
  POST('/api/v1/inventory/suppliers', 'Add a supplier', created(Supplier), {
    permission: 'inventory:manage',
    body: SupplierInput,
  }),
  PUT('/api/v1/inventory/suppliers/{supplierId}', 'Update a supplier', data(Supplier), {
    permission: 'inventory:manage',
    body: SupplierInput,
  }),

  // ── Support ─────────────────────────────────────────────────────────────────
  GET('/api/v1/support/tickets', 'Support tickets, newest activity first', page(TicketSummary), {
    permission: 'ticket:read',
    query: TicketListQuery,
  }),
  POST('/api/v1/support/tickets', 'Open a ticket', created(TicketDetail), {
    permission: 'ticket:create',
    body: OpenTicketRequest,
  }),
  GET('/api/v1/support/tickets/{ticketId}', 'A ticket and its thread', data(TicketDetail), {
    permission: 'ticket:read',
  }),
  PATCH(
    '/api/v1/support/tickets/{ticketId}',
    'Change a ticket’s status, priority, category or assignee',
    data(TicketDetail),
    {
      permission: 'ticket:manage',
      body: UpdateTicketRequest,
    },
  ),
  POST('/api/v1/support/tickets/{ticketId}/replies', 'Reply to a ticket', created(TicketDetail), {
    permission: 'ticket:reply',
    body: ReplyToTicketRequest,
    description: 'An internal note is staff-only and never shown to the patient.',
  }),
]
