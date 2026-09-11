import { describe, expect, it } from 'vitest'
import { FEATURE_FLAGS, PORTAL_KEYS } from '@clinic/config'
import { NAVIGATION, visibleNavigation } from '../domain/navigation'
import { isPermissionKey } from '../domain/permissions.catalog'
import {
  NO_PORTAL_PATH,
  PORTALS,
  isPortalKey,
  landingPath,
  landingPortal,
  orderPortals,
  portalFromPath,
} from '../domain/portals'
import type { PermissionMap } from '../domain/scopes'

const holding = (...keys: string[]): PermissionMap =>
  new Map(keys.map((key) => [key, 'CLINIC'])) as PermissionMap

describe('orderPortals', () => {
  it('puts the portal of the highest-priority role first', () => {
    const permissions = holding('portal.admin:access', 'portal.doctor:access')
    const roles = [
      { priority: 20, permissionKeys: ['portal.doctor:access'] },
      { priority: 40, permissionKeys: ['portal.admin:access'] },
    ]
    expect(orderPortals(permissions, roles)).toEqual(['admin', 'doctor'])
  })

  it('lets priority override the fixed portal order', () => {
    const permissions = holding('portal.admin:access', 'portal.patient:access')
    const roles = [
      { priority: 90, permissionKeys: ['portal.patient:access'] },
      { priority: 10, permissionKeys: ['portal.admin:access'] },
    ]
    expect(orderPortals(permissions, roles)).toEqual(['patient', 'admin'])
  })

  it('breaks ties with the fixed portal order, so the result is deterministic', () => {
    const permissions = holding('portal.patient:access', 'portal.staff:access')
    const roles = [
      { priority: 5, permissionKeys: ['portal.patient:access', 'portal.staff:access'] },
    ]
    expect(orderPortals(permissions, roles)).toEqual(['staff', 'patient'])
  })

  it('only offers portals whose permission is actually held', () => {
    const roles = [{ priority: 50, permissionKeys: ['portal.admin:access'] }]
    expect(orderPortals(holding('portal.staff:access'), roles)).toEqual(['staff'])
  })
})

describe('landing', () => {
  it('honours a saved preference the user can still use', () => {
    expect(landingPortal(['admin', 'doctor'], 'doctor')).toBe('doctor')
  })

  it('ignores a saved preference for a portal that was taken away', () => {
    expect(landingPortal(['staff'], 'admin')).toBe('staff')
  })

  it('sends a user with no portal to the no-access page, not into a loop', () => {
    expect(landingPortal([], null)).toBeNull()
    expect(landingPath([], 'admin')).toBe(NO_PORTAL_PATH)
  })

  it('maps each portal to its home path', () => {
    expect(landingPath(['patient'], null)).toBe('/patient')
  })
})

describe('portalFromPath', () => {
  it('reads the first path segment', () => {
    expect(portalFromPath('/staff')).toBe('staff')
    expect(portalFromPath('/doctor/patients/p1')).toBe('doctor')
  })

  it('does not mistake a longer word for a portal', () => {
    expect(portalFromPath('/administrators')).toBeNull()
    expect(portalFromPath('/account')).toBeNull()
    expect(portalFromPath('/')).toBeNull()
  })

  it('agrees with isPortalKey', () => {
    expect(PORTAL_KEYS.every((key) => isPortalKey(key))).toBe(true)
    expect(isPortalKey('superadmin')).toBe(false)
  })
})

describe('navigation', () => {
  it('shows a portal’s own section only to someone who can enter it', () => {
    const withAccess = visibleNavigation('patient', holding('portal.patient:access'), FEATURE_FLAGS)
    expect(withAccess.map((section) => section.id)).toEqual(['patient.main', 'account'])

    const without = visibleNavigation('patient', holding(), FEATURE_FLAGS)
    expect(without.map((section) => section.id)).toEqual(['account'])
  })

  it('hides a directory from someone who may read only their own record in it', () => {
    const ownOnly = new Map([
      ['portal.staff:access', 'CLINIC'],
      ['patient:read', 'OWN'],
    ]) as PermissionMap
    const clinicWide = new Map([
      ['portal.staff:access', 'CLINIC'],
      ['patient:read', 'CLINIC'],
    ]) as PermissionMap

    const itemIds = (permissions: PermissionMap) =>
      visibleNavigation('staff', permissions, FEATURE_FLAGS).flatMap((section) =>
        section.items.map((item) => item.id),
      )
    expect(itemIds(ownOnly)).not.toContain('staff.patients')
    expect(itemIds(clinicWide)).toContain('staff.patients')
  })

  it('gives every portal the account section', () => {
    for (const portal of PORTAL_KEYS) {
      expect(NAVIGATION[portal].some((section) => section.id === 'account')).toBe(true)
    }
  })

  it('references only real permissions and internal paths', () => {
    for (const portal of PORTAL_KEYS) {
      for (const item of NAVIGATION[portal].flatMap((section) => section.items)) {
        if (item.permission !== null) expect(isPermissionKey(item.permission)).toBe(true)
        expect(item.href.startsWith('/')).toBe(true)
      }
    }
  })

  it('links each portal home to the path the portal routes to', () => {
    for (const portal of PORTAL_KEYS) {
      const hrefs = NAVIGATION[portal].flatMap((section) => section.items.map((item) => item.href))
      expect(hrefs).toContain(PORTALS[portal].homePath)
    }
  })
})
