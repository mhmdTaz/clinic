import { z } from 'zod'
import { successResponse } from './envelope'
import { PortalKey, SessionUser } from './auth'

export const MeResponse = successResponse(SessionUser)

export const UpdateMeRequest = z
  .object({
    firstName: z.string().trim().min(1).max(80).optional(),
    lastName: z.string().trim().min(1).max(80).optional(),
    phone: z.string().trim().max(32).nullable().optional(),
    preferredPortal: PortalKey.optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'NOTHING_TO_UPDATE',
  })
export type UpdateMeRequest = z.infer<typeof UpdateMeRequest>

export const PermissionGrant = z.object({
  key: z.string(),
  scope: z.enum(['OWN', 'ASSIGNED', 'CLINIC', 'GLOBAL']),
})
export type PermissionGrant = z.infer<typeof PermissionGrant>

export const MePermissions = z.object({
  permissions: z.array(PermissionGrant),
  permissionVersion: z.number().int(),
})
export type MePermissions = z.infer<typeof MePermissions>
export const MePermissionsResponse = successResponse(MePermissions)

export const NavigationItem = z.object({
  id: z.string(),
  labelKey: z.string(),
  href: z.string(),
  icon: z.string(),
})
export const NavigationSection = z.object({
  id: z.string(),
  labelKey: z.string(),
  items: z.array(NavigationItem),
})
export type NavigationSection = z.infer<typeof NavigationSection>

export const MeNavigationQuery = z.object({ portal: PortalKey.optional() })
export const MeNavigation = z.object({ portal: PortalKey, sections: z.array(NavigationSection) })
export type MeNavigation = z.infer<typeof MeNavigation>
export const MeNavigationResponse = successResponse(MeNavigation)

export const SessionSummary = z.object({
  id: z.string(),
  deviceName: z.string().nullable(),
  userAgent: z.string().nullable(),
  ipAddress: z.string().nullable(),
  /** The original sign-in on this device, unchanged by token rotation. */
  startedAt: z.string().datetime(),
  lastUsedAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime(),
  current: z.boolean(),
})
export type SessionSummary = z.infer<typeof SessionSummary>
export const MeSessionsResponse = successResponse(z.object({ sessions: z.array(SessionSummary) }))

/**
 * Choosing the interface language. Any string up to 16 characters is accepted as a request; the
 * server answers whether it is a language on offer, rather than refusing a tag it does not know.
 */
export const SetLocaleRequest = z.object({ locale: z.string().max(16) }).strict()
export type SetLocaleRequest = z.infer<typeof SetLocaleRequest>

export const SetLocaleResult = z.object({ locale: z.string().nullable(), accepted: z.boolean() })
export type SetLocaleResult = z.infer<typeof SetLocaleResult>
