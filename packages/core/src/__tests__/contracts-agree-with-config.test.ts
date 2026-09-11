import { describe, expect, it } from 'vitest'
import {
  BLOOD_TYPES,
  CURRENCIES,
  GENDERS,
  LOCALES,
  PERMISSION_SCOPES,
  PORTAL_KEYS,
  SLOT_MINUTE_OPTIONS,
  USER_STATUSES,
} from '@clinic/config'
import {
  BloodType,
  Currency,
  Gender,
  Locale,
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
  ])('%s', (_name, contract, config) => {
    expect([...contract]).toEqual([...config])
  })
})
