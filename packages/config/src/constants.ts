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
export const APPOINTMENT_SOURCES = ['STAFF', 'PATIENT'] as const
export type AppointmentSource = (typeof APPOINTMENT_SOURCES)[number]

/** Self-service booking limits, overridable per clinic (ADR-0022). */
export const BOOKING_WINDOW_DEFAULTS = {
  horizonDays: 60,
  minimumNoticeHours: 2,
  cancellationCutoffHours: 24,
} as const

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
