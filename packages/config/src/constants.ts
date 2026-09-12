/** Portals, in the order they are considered when resolving a landing page (section 10.1). */
export const PORTAL_KEYS = ['admin', 'staff', 'doctor', 'patient'] as const
export type PortalKey = (typeof PORTAL_KEYS)[number]

/** Scope of a permission grant — which rows a permission reaches (section 7.3). */
export const PERMISSION_SCOPES = ['OWN', 'ASSIGNED', 'CLINIC', 'GLOBAL'] as const
export type PermissionScope = (typeof PERMISSION_SCOPES)[number]

export const USER_STATUSES = ['INVITED', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED'] as const
export type UserStatus = (typeof USER_STATUSES)[number]

/**
 * Audit taxonomy (section 8.13). Declared here because both the model in @clinic/db
 * and the recorder in @clinic/core need it, and neither may import the other's
 * internals.
 */
export const AUDIT_CATEGORIES = [
  'AUTH',
  'ACCESS_CONTROL',
  'CLINICAL',
  'FINANCIAL',
  'INVENTORY',
  'ADMIN',
  'FILE',
  'SUPPORT',
  'SYSTEM',
] as const
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number]

export const AUDIT_SEVERITIES = ['INFO', 'NOTICE', 'WARNING', 'CRITICAL'] as const
export type AuditSeverity = (typeof AUDIT_SEVERITIES)[number]

export const AUDIT_OUTCOMES = ['SUCCESS', 'FAILURE', 'DENIED'] as const
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number]

export const ACTOR_TYPES = ['USER', 'SYSTEM', 'API_CLIENT', 'ANONYMOUS'] as const
export type ActorType = (typeof ACTOR_TYPES)[number]

/**
 * What stands in for a sensitive value in an audit diff (section 11.3).
 *
 * Declared here because the capture plugin in @clinic/db writes it and the explorer in
 * @clinic/core has to recognise it — a field whose value was never stored still has to render
 * as "changed, value withheld" rather than as a literal string somebody could mistake for data.
 */
export const REDACTED_MARKER = '[redacted]'

/** Smallest bookable increment, and the slot-reservation grid size (section 8.7). */
export const SLOT_GRID_MINUTES = 5

/** Appointment lengths a doctor can default to. Every one sits on the booking grid. */
export const SLOT_MINUTE_OPTIONS = [10, 15, 20, 30, 45, 60] as const
export type SlotMinutes = (typeof SLOT_MINUTE_OPTIONS)[number]

/** Appointment lifecycle (section 8.7). COMPLETED, CANCELLED and NO_SHOW are terminal. */
export const APPOINTMENT_STATUSES = [
  'SCHEDULED',
  'CHECKED_IN',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
] as const
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number]

/** Who booked. Self-service is held to the clinic's window; the front desk is not (ADR-0022). */
export const APPOINTMENT_SOURCES = ['STAFF', 'PATIENT', 'WALK_IN'] as const
export type AppointmentSource = (typeof APPOINTMENT_SOURCES)[number]

/** Self-service booking limits, overridable per clinic (ADR-0022). */
export const BOOKING_WINDOW_DEFAULTS = {
  horizonDays: 60,
  minimumNoticeHours: 2,
  cancellationCutoffHours: 24,
} as const

/** A visit (section 8.8). OPEN until the doctor finishes it; the other two are terminal. */
export const ENCOUNTER_STATUSES = ['OPEN', 'COMPLETED', 'CANCELLED'] as const
export type EncounterStatus = (typeof ENCOUNTER_STATUSES)[number]

export const ENCOUNTER_TYPES = [
  'CONSULTATION',
  'FOLLOW_UP',
  'PROCEDURE',
  'EMERGENCY',
  'TELEHEALTH',
] as const
export type EncounterType = (typeof ENCOUNTER_TYPES)[number]

/** A clinical note is editable until it is signed, and never again after (D9, ADR-0024). */
export const NOTE_STATUSES = ['DRAFT', 'SIGNED'] as const
export type NoteStatus = (typeof NOTE_STATUSES)[number]

/** Diagnosis coding system. One entry today; the field is the FHIR mapping seam (16.3). */
export const CODE_SYSTEMS = ['ICD10'] as const
export type CodeSystem = (typeof CODE_SYSTEMS)[number]

/** How badly a patient reacts. UNKNOWN is honest and still shows on the banner. */
export const ALLERGY_SEVERITIES = ['MILD', 'MODERATE', 'SEVERE', 'UNKNOWN'] as const
export type AllergySeverity = (typeof ALLERGY_SEVERITIES)[number]

/**
 * A stored file's lifecycle (section 12.1). PENDING is a presigned upload nobody confirmed;
 * only CLEAN is downloadable.
 */
export const FILE_STATUSES = ['PENDING', 'SCANNING', 'CLEAN', 'INFECTED', 'FAILED'] as const
export type FileStatus = (typeof FILE_STATUSES)[number]

/** What a file hangs off. Polymorphic by design — natural in a document store (section 8.9). */
export const FILE_OWNER_TYPES = ['PATIENT', 'ENCOUNTER', 'PRESCRIPTION'] as const
export type FileOwnerType = (typeof FILE_OWNER_TYPES)[number]

/** What a file is, for the document vault's filters (P6). */
export const FILE_CATEGORIES = [
  'LAB_RESULT',
  'IMAGING',
  'REFERRAL',
  'CONSENT',
  'PRESCRIPTION',
  'INSURANCE',
  'OTHER',
] as const
export type FileCategory = (typeof FILE_CATEGORIES)[number]

/**
 * What may be uploaded, checked server-side before a presigned URL is issued (section 12.3).
 * The sniffed type is checked again on confirm: a client's content-type header is a claim.
 */
export const FILE_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'text/csv',
] as const
export type FileMimeType = (typeof FILE_MIME_TYPES)[number]

/** 25 MB, the default cap in section 12.3. Enforced in the presign policy, not just here. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024

/** How long the presigned URLs live (section 12.1): long enough to upload, short enough to leak. */
export const UPLOAD_URL_SECONDS = 300
export const DOWNLOAD_URL_SECONDS = 60

/**
 * An invoice's life (section 8.10). OVERDUE is deliberately absent: whether an invoice is late is
 * a question about today and its due date, so it is derived on read rather than stored and swept
 * by a nightly job that can silently stop running.
 */
export const INVOICE_STATUSES = ['DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'VOID'] as const
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number]

/** How the money arrived. Reference data a clinic may extend later (section 2.3). */
export const PAYMENT_METHODS = ['CASH', 'CARD', 'TRANSFER', 'INSURANCE'] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

export const PAYMENT_STATUSES = ['COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED'] as const
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number]

/** How long an issued invoice has before it counts as late, unless the clinic says otherwise. */
export const INVOICE_DUE_DAYS_DEFAULT = 14

/**
 * Support tickets (section 8.12). OPEN and PENDING are both "not finished", but they differ in
 * who is holding the ball: PENDING means the clinic has replied and is waiting on the person who
 * asked. A queue that cannot tell those apart tells a front desk to chase itself.
 */
export const TICKET_STATUSES = ['OPEN', 'IN_PROGRESS', 'PENDING', 'RESOLVED', 'CLOSED'] as const
export type TicketStatus = (typeof TICKET_STATUSES)[number]

export const TICKET_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const
export type TicketPriority = (typeof TICKET_PRIORITIES)[number]

/** Where a ticket came from, so the inbox can be read by subject rather than by person. */
export const TICKET_CATEGORIES = [
  'APPOINTMENT',
  'BILLING',
  'MEDICAL_RECORDS',
  'TECHNICAL',
  'OTHER',
] as const
export type TicketCategory = (typeof TICKET_CATEGORIES)[number]

/**
 * How a notification reaches somebody (section 8.12). IN_APP always works because it is a row in
 * our own database; EMAIL depends on somebody else's server, which is why delivery is tracked
 * per channel rather than per notification.
 */
/**
 * How a notification reaches somebody.
 *
 * PUSH arrives with the mobile app (Phase 9). ARCHITECTURE §9.4 said it was "already in the
 * enum"; it was not, which is the sort of claim a plan makes and an implementation has to settle.
 */
export const NOTIFICATION_CHANNELS = ['IN_APP', 'EMAIL', 'PUSH'] as const
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number]

/**
 * What a notification is about. This is the key a person's preferences switch on, so it is
 * deliberately coarser than the event catalogue: nobody wants to configure fourteen toggles.
 */
export const NOTIFICATION_TYPES = [
  'APPOINTMENT_CONFIRMED',
  'APPOINTMENT_REMINDER',
  'APPOINTMENT_CANCELLED',
  'INVOICE_ISSUED',
  'PAYMENT_RECEIVED',
  'TICKET_REPLY',
  'TICKET_ASSIGNED',
  'STOCK_LOW',
  /** The audit chain failed verification. A tamper alert, and it cannot be switched off. */
  'AUDIT_CHAIN_BROKEN',
] as const
export type NotificationType = (typeof NOTIFICATION_TYPES)[number]

export const NOTIFICATION_STATUSES = ['PENDING', 'SENT', 'FAILED'] as const
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number]

/**
 * How long before an appointment a reminder goes out, in hours (section 13.5).
 *
 * Measured in elapsed time rather than wall clock: "24 hours before" means 24 hours, even across
 * a daylight-saving change, because that is what somebody being reminded understands by it.
 */
export const REMINDER_OFFSETS_HOURS = [24, 2] as const

/** A read in-app notification is swept by TTL after this long (section 8.16). */
export const NOTIFICATION_RETENTION_DAYS = 90

/** How long a processed outbox event sticks around before its TTL index reclaims it. */
export const OUTBOX_RETENTION_HOURS = 24

/**
 * Why stock moved (section 8.11). Every movement is signed — positive in, negative out — so the
 * ledger sums to the balance and nothing has to remember which types add and which subtract.
 *
 * ADJUSTMENT is the only one that may be either sign: it is a correction to a count, and a count
 * can be wrong in both directions.
 */
export const STOCK_MOVEMENT_TYPES = [
  'RECEIPT',
  'CONSUMPTION',
  'WASTAGE',
  'RETURN',
  'ADJUSTMENT',
] as const
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number]

/** Which way each type must move. ADJUSTMENT is absent because it may go either way. */
export const STOCK_MOVEMENT_DIRECTION: Readonly<Record<string, 'IN' | 'OUT'>> = {
  RECEIPT: 'IN',
  RETURN: 'IN',
  CONSUMPTION: 'OUT',
  WASTAGE: 'OUT',
}

/** How far ahead "expiring soon" looks, unless a clinic says otherwise. */
export const EXPIRING_SOON_DAYS = 90

/** Patient demographics (section 8.6): closed sets, so an enum in both layers. */
export const GENDERS = ['FEMALE', 'MALE', 'OTHER', 'UNDISCLOSED'] as const
export type Gender = (typeof GENDERS)[number]

export const BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'UNKNOWN'] as const
export type BloodType = (typeof BLOOD_TYPES)[number]

/** Currencies a clinic can bill in (ISO 4217). */
export const CURRENCIES = [
  'USD',
  'EUR',
  'LBP',
  'GBP',
  'AED',
  'SAR',
  'QAR',
  'KWD',
  'JOD',
  'EGP',
  'TRY',
  'CAD',
  'AUD',
] as const
export type Currency = (typeof CURRENCIES)[number]

/** Interface languages with a complete message catalogue. Arabic joins with the i18n pass. */
export const LOCALES = ['en'] as const
export type Locale = (typeof LOCALES)[number]

/** Pagination ceiling enforced by every list endpoint (section 9.2). */
export const MAX_PAGE_SIZE = 100
export const DEFAULT_PAGE_SIZE = 25

/**
 * Build/runtime version, surfaced by the health endpoint. Lives here because
 * @clinic/config is the only package permitted to read process.env (section 13.1).
 */
export const APP_VERSION: string = process.env.npm_package_version ?? '0.0.0'
