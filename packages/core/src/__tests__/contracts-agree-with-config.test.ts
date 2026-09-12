import { describe, expect, it } from 'vitest'
import {
  ALLERGY_SEVERITIES,
  APPOINTMENT_SOURCES,
  APPOINTMENT_STATUSES,
  BLOOD_TYPES,
  CURRENCIES,
  ENCOUNTER_STATUSES,
  ENCOUNTER_TYPES,
  FILE_CATEGORIES,
  FILE_MIME_TYPES,
  FILE_OWNER_TYPES,
  FILE_STATUSES,
  GENDERS,
  LOCALES,
  NOTE_STATUSES,
  PERMISSION_SCOPES,
  PORTAL_KEYS,
  SLOT_MINUTE_OPTIONS,
  USER_STATUSES,
} from '@clinic/config'
import {
  AllergySeverity,
  AppointmentSource,
  AppointmentStatus,
  BloodType,
  Currency,
  EncounterStatus,
  EncounterType,
  FileCategory,
  FileMimeType,
  FileOwnerType,
  FileStatus,
  Gender,
  Locale,
  NoteStatus,
  PermissionGrant,
  PortalKey,
  SLOT_MINUTES,
  UserStatus,
} from '@clinic/contracts'

/**
 * @clinic/contracts carries no dependencies, so the mobile app can take it as it is — which means
 * its closed sets are written out a second time. This is what stops the copies drifting apart.
 */
describe('contracts and config list the same values', () => {
  it.each([
    ['genders', Gender.options, GENDERS],
    ['blood types', BloodType.options, BLOOD_TYPES],
    ['currencies', Currency.options, CURRENCIES],
    ['locales', Locale.options, LOCALES],
    ['user statuses', UserStatus.options, USER_STATUSES],
    ['portals', PortalKey.options, PORTAL_KEYS],
    ['permission scopes', PermissionGrant.shape.scope.options, PERMISSION_SCOPES],
    ['slot lengths', SLOT_MINUTES, SLOT_MINUTE_OPTIONS],
    ['appointment statuses', AppointmentStatus.options, APPOINTMENT_STATUSES],
    ['appointment sources', AppointmentSource.options, APPOINTMENT_SOURCES],
    ['encounter statuses', EncounterStatus.options, ENCOUNTER_STATUSES],
    ['encounter types', EncounterType.options, ENCOUNTER_TYPES],
    ['note statuses', NoteStatus.options, NOTE_STATUSES],
    ['allergy severities', AllergySeverity.options, ALLERGY_SEVERITIES],
    ['file statuses', FileStatus.options, FILE_STATUSES],
    ['file owner types', FileOwnerType.options, FILE_OWNER_TYPES],
    ['file categories', FileCategory.options, FILE_CATEGORIES],
    ['file mime types', FileMimeType.options, FILE_MIME_TYPES],
  ])('%s', (_name, contract, config) => {
    expect([...contract]).toEqual([...config])
  })
})
