import type { AuditCategory, AuditSeverity } from '@clinic/config'

/**
 * How an automatically captured write is named and filed. Clinical and financial models
 * join this map as their phases land.
 */
const MODEL_CATEGORY: Readonly<Record<string, AuditCategory>> = {
  Clinic: 'ADMIN',
  User: 'ADMIN',
  Role: 'ACCESS_CONTROL',
  // A patient record is personal health information: 7-year retention, clinical category.
  Patient: 'CLINICAL',
  Doctor: 'ADMIN',
  // An appointment names a patient and a reason: clinical, 7-year retention.
  Appointment: 'CLINICAL',
  Specialty: 'ADMIN',
  // The record itself, and what was prescribed from it.
  Encounter: 'CLINICAL',
  Prescription: 'CLINICAL',
  // A document has its own category, because "who downloaded what" is its own question.
  File: 'FILE',
}

/**
 * An unmapped model files as ADMIN, a 7-year category. Defaulting to a 2-year one would
 * let a forgotten clinical model quietly lose five years of history.
 */
const FALLBACK_CATEGORY: AuditCategory = 'ADMIN'

/** "PasswordResetToken" -> "password_reset_token" */
export function modelSlug(model: string): string {
  return model.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
}

/** "Role", "updated" -> "role.updated" */
export function captureAction(model: string, operation: string): string {
  return `${modelSlug(model)}.${operation}`
}

export function captureCategory(model: string): AuditCategory {
  return MODEL_CATEGORY[model] ?? FALLBACK_CATEGORY
}

/** Access-control changes and deletions are what an auditor looks for first. */
export function captureSeverity(model: string, operation: string): AuditSeverity {
  if (captureCategory(model) === 'ACCESS_CONTROL') return 'NOTICE'
  if (operation === 'deleted') return 'NOTICE'
  return 'INFO'
}
