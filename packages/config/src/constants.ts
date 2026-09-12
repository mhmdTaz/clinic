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
