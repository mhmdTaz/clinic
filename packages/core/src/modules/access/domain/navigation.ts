import type { FeatureFlagKey, FeatureFlags, PortalKey } from '@clinic/config'
import type { PermissionKey } from './permissions.catalog'
import { scopeAtLeast, type PermissionMap, type Scope } from './scopes'

export const NAV_ICONS = [
  'building',
  'clipboard-list',
  'contact',
  'heart-pulse',
  'key-round',
  'layout-dashboard',
  'settings',
  'shield',
  'shield-check',
  'stethoscope',
  'users',
] as const
export type NavIcon = (typeof NAV_ICONS)[number]

export interface NavItemDefinition {
  id: string
  labelKey: string
  href: string
  icon: NavIcon
  /** null means any signed-in user. */
  permission: PermissionKey | null
  /**
   * The narrowest scope at which the page is any use. A directory of every patient is no use
   * to someone who may see only their own record, so the item stays hidden rather than lead
   * to a refusal.
   */
  minScope?: Scope
  flag?: FeatureFlagKey
}

export interface NavSectionDefinition {
  id: string
  labelKey: string
  items: readonly NavItemDefinition[]
}

/**
 * Navigation is data, not markup (section 14.2). The sidebar, the mobile tab bar and
 * GET /api/v1/me/navigation all render from this one definition, so a new role gets a
 * correct menu without anyone editing a component.
 *
 * Only routes that exist are listed. Each later phase adds its items together with
 * the pages they point to, so the menu never offers a link that 404s.
 */
const accountSection: NavSectionDefinition = {
  id: 'account',
  labelKey: 'nav.sections.account',
  items: [
    {
      id: 'account.security',
      labelKey: 'nav.items.account',
      href: '/account',
      icon: 'shield-check',
      permission: null,
    },
  ],
}

export const NAVIGATION: Readonly<Record<PortalKey, readonly NavSectionDefinition[]>> = {
  admin: [
    {
      id: 'admin.main',
      labelKey: 'nav.sections.administration',
      items: [
        {
          id: 'admin.overview',
          labelKey: 'nav.items.clinicOverview',
          href: '/admin',
          icon: 'building',
          permission: 'portal.admin:access',
        },
        {
          id: 'admin.clinic',
          labelKey: 'nav.items.clinicSettings',
          href: '/admin/clinic',
          icon: 'settings',
          permission: 'clinic:update',
        },
        {
          id: 'admin.users',
          labelKey: 'nav.items.users',
          href: '/admin/users',
          icon: 'users',
          permission: 'user:read',
          minScope: 'CLINIC',
        },
        {
          id: 'admin.roles',
          labelKey: 'nav.items.roles',
          href: '/admin/roles',
          icon: 'key-round',
          permission: 'role:read',
        },
      ],
    },
    accountSection,
  ],
  staff: [
    {
      id: 'staff.main',
      labelKey: 'nav.sections.frontDesk',
      items: [
        {
          id: 'staff.overview',
          labelKey: 'nav.items.overview',
          href: '/staff',
          icon: 'layout-dashboard',
          permission: 'portal.staff:access',
        },
        {
          id: 'staff.patients',
          labelKey: 'nav.items.patients',
          href: '/staff/patients',
          icon: 'contact',
          permission: 'patient:read',
          minScope: 'CLINIC',
        },
        {
          id: 'staff.doctors',
          labelKey: 'nav.items.doctors',
          href: '/staff/doctors',
          icon: 'stethoscope',
          permission: 'doctor:read',
        },
      ],
    },
    accountSection,
  ],
  doctor: [
    {
      id: 'doctor.main',
      labelKey: 'nav.sections.practice',
      items: [
        {
          id: 'doctor.overview',
          labelKey: 'nav.items.overview',
          href: '/doctor',
          icon: 'stethoscope',
          permission: 'portal.doctor:access',
        },
      ],
    },
    accountSection,
  ],
  patient: [
    {
      id: 'patient.main',
      labelKey: 'nav.sections.myCare',
      items: [
        {
          id: 'patient.overview',
          labelKey: 'nav.items.overview',
          href: '/patient',
          icon: 'heart-pulse',
          permission: 'portal.patient:access',
        },
      ],
    },
    accountSection,
  ],
}

function itemVisible(
  item: NavItemDefinition,
  permissions: PermissionMap,
  flags: FeatureFlags,
): boolean {
  if (item.flag !== undefined && !flags[item.flag]) return false
  if (item.permission === null) return true
  const scope = permissions.get(item.permission)
  if (!scope) return false
  return item.minScope === undefined || scopeAtLeast(scope, item.minScope)
}

/** Sections left with no visible items disappear entirely, so there are no empty headers. */
export function visibleNavigation(
  portal: PortalKey,
  permissions: PermissionMap,
  flags: FeatureFlags,
): NavSectionDefinition[] {
  return NAVIGATION[portal]
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => itemVisible(item, permissions, flags)),
    }))
    .filter((section) => section.items.length > 0)
}
