import type { FeatureFlagKey, FeatureFlags, PortalKey } from '@clinic/config'
import type { PermissionKey } from './permissions.catalog'
import type { PermissionMap } from './scopes'

export const NAV_ICONS = [
  'building',
  'clipboard-list',
  'heart-pulse',
  'layout-dashboard',
  'shield',
  'shield-check',
  'stethoscope',
] as const
export type NavIcon = (typeof NAV_ICONS)[number]

export interface NavItemDefinition {
  id: string
  labelKey: string
  href: string
  icon: NavIcon
  /** null means any signed-in user. */
  permission: PermissionKey | null
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

/** Sections left with no visible items disappear entirely, so there are no empty headers. */
export function visibleNavigation(
  portal: PortalKey,
  permissions: PermissionMap,
  flags: FeatureFlags,
): NavSectionDefinition[] {
  return NAVIGATION[portal]
    .map((section) => ({
      ...section,
      items: section.items.filter(
        (item) =>
          (item.permission === null || permissions.has(item.permission)) &&
          (item.flag === undefined || flags[item.flag]),
      ),
    }))
    .filter((section) => section.items.length > 0)
}
