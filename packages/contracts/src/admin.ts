import { z } from 'zod'
import { EmailAddress } from './auth'
import { Holiday, WorkingHours } from './clinic'
import {
  Currency,
  IanaTimezone,
  LocalDate,
  LocalTime,
  Locale,
  UserStatus,
  blankToNull,
  nullableCountry,
  nullableEmail,
  nullableText,
  overlappingDayRanges,
  requiredText,
} from './common'
import { PaginationQuery } from './envelope'
import { BookingWindow } from './scheduling'
import { PermissionGrant } from './me'

/** Contracts for the admin control plane: clinic settings, users, roles (section 9.3). */

// ── Clinic profile and settings ──────────────────────────────────────────────

export const ClinicProfileInput = z.object({
  name: requiredText(120),
  legalName: nullableText(160),
  taxId: nullableText(64),
  contact: z.object({ email: nullableEmail, phone: nullableText(32) }),
  address: z.object({
    line1: nullableText(160),
    line2: nullableText(160),
    city: nullableText(80),
    country: nullableCountry,
  }),
  timezone: IanaTimezone,
  currency: Currency,
  locale: Locale,
})
export type ClinicProfileInput = z.infer<typeof ClinicProfileInput>

export const BranchInput = z.object({
  name: requiredText(80),
  phone: nullableText(32),
  address: nullableText(200),
})
export type BranchInput = z.infer<typeof BranchInput>

export const UpdateBranchRequest = BranchInput.extend({ isActive: z.boolean() })
export type UpdateBranchRequest = z.infer<typeof UpdateBranchRequest>

export const WorkingHoursInput = z
  .object({
    dayOfWeek: z.number().int().min(0).max(6),
    opensAt: LocalTime,
    closesAt: LocalTime,
  })
  .refine((entry) => entry.closesAt > entry.opensAt, {
    message: 'CLOSES_BEFORE_OPENS',
    path: ['closesAt'],
  })

/** Indexes of entries that overlap another entry on the same day. "HH:MM" sorts as text. */
export function overlappingHours(
  entries: ReadonlyArray<{ dayOfWeek: number; opensAt: string; closesAt: string }>,
): number[] {
  return overlappingDayRanges(
    entries.map((entry) => ({
      dayOfWeek: entry.dayOfWeek,
      from: entry.opensAt,
      to: entry.closesAt,
    })),
  )
}

export const SetWorkingHoursRequest = z
  .object({ workingHours: z.array(WorkingHoursInput).max(21) })
  .superRefine((value, ctx) => {
    for (const index of overlappingHours(value.workingHours)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'OVERLAPPING_HOURS',
        path: ['workingHours', index, 'opensAt'],
      })
    }
  })
export type SetWorkingHoursRequest = z.infer<typeof SetWorkingHoursRequest>

export const HolidayInput = z.object({
  date: LocalDate,
  name: requiredText(80),
  branchId: z.preprocess(blankToNull, z.string().max(64).nullable()),
})

export const SetHolidaysRequest = z
  .object({ holidays: z.array(HolidayInput).max(200) })
  .superRefine((value, ctx) => {
    const seen = new Set<string>()
    value.holidays.forEach((holiday, index) => {
      const key = `${holiday.date}|${holiday.branchId ?? ''}`
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'DUPLICATE_HOLIDAY',
          path: ['holidays', index, 'date'],
        })
      }
      seen.add(key)
    })
  })
export type SetHolidaysRequest = z.infer<typeof SetHolidaysRequest>

export const BranchDetail = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string().nullable(),
  address: z.string().nullable(),
  isActive: z.boolean(),
  workingHours: z.array(WorkingHours),
})
export type BranchDetail = z.infer<typeof BranchDetail>

export const ClinicSettings = z.object({
  id: z.string(),
  name: z.string(),
  legalName: z.string().nullable(),
  taxId: z.string().nullable(),
  contact: z.object({ email: z.string().nullable(), phone: z.string().nullable() }),
  address: z.object({
    line1: z.string().nullable(),
    line2: z.string().nullable(),
    city: z.string().nullable(),
    country: z.string().nullable(),
  }),
  timezone: z.string(),
  currency: z.string(),
  locale: z.string(),
  branches: z.array(BranchDetail),
  holidays: z.array(Holiday),
  /** Self-service booking limits (ADR-0022). */
  booking: BookingWindow,
})
export type ClinicSettings = z.infer<typeof ClinicSettings>

// ── Users ────────────────────────────────────────────────────────────────────

export const RoleRef = z.object({ id: z.string(), key: z.string(), name: z.string() })
export type RoleRef = z.infer<typeof RoleRef>

export const UserListQuery = PaginationQuery.extend({
  q: z.string().trim().max(80).optional(),
  status: UserStatus.optional(),
  roleId: z.string().max(64).optional(),
})
export type UserListQuery = z.infer<typeof UserListQuery>

export const UserSummary = z.object({
  id: z.string(),
  email: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  displayName: z.string(),
  phone: z.string().nullable(),
  status: UserStatus,
  roles: z.array(RoleRef),
  lastLoginAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime().nullable(),
})
export type UserSummary = z.infer<typeof UserSummary>

export const UserDetail = UserSummary.extend({
  /** The newest activation link that can still be used, while the account is INVITED. */
  invitation: z
    .object({ sentAt: z.string().datetime(), expiresAt: z.string().datetime() })
    .nullable(),
  /** False while no password is set: invited, or waiting on a forced reset. */
  hasPassword: z.boolean(),
  isSelf: z.boolean(),
})
export type UserDetail = z.infer<typeof UserDetail>

export const InviteUserRequest = z.object({
  firstName: requiredText(80),
  lastName: requiredText(80),
  email: EmailAddress,
  phone: nullableText(32),
  roleIds: z.array(z.string().min(1).max(64)).min(1, 'SELECT_AT_LEAST_ONE').max(10),
})
export type InviteUserRequest = z.infer<typeof InviteUserRequest>

/** The email can change only while the account is waiting to be activated. */
export const UpdateUserRequest = z.object({
  firstName: requiredText(80),
  lastName: requiredText(80),
  phone: nullableText(32),
  email: EmailAddress,
})
export type UpdateUserRequest = z.infer<typeof UpdateUserRequest>

export const SetUserRolesRequest = z.object({
  roleIds: z.array(z.string().min(1).max(64)).max(10),
})
export type SetUserRolesRequest = z.infer<typeof SetUserRolesRequest>

export const ChangeUserStatusRequest = z.object({
  action: z.enum(['suspend', 'restore']),
  reason: nullableText(300),
})
export type ChangeUserStatusRequest = z.infer<typeof ChangeUserStatusRequest>

// ── Roles and the permission catalogue ───────────────────────────────────────

export const RoleListItem = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  isSystem: z.boolean(),
  priority: z.number().int(),
  grantCount: z.number().int(),
  memberCount: z.number().int(),
})
export type RoleListItem = z.infer<typeof RoleListItem>

export const RoleDetail = RoleListItem.extend({
  permissions: z.array(PermissionGrant),
})
export type RoleDetail = z.infer<typeof RoleDetail>

export const CreateRoleRequest = z.object({
  name: requiredText(60),
  description: nullableText(200),
  copyFromRoleId: z.preprocess(blankToNull, z.string().max(64).nullable()).default(null),
})
export type CreateRoleRequest = z.infer<typeof CreateRoleRequest>

export const UpdateRoleRequest = z.object({
  name: requiredText(60),
  description: nullableText(200),
})
export type UpdateRoleRequest = z.infer<typeof UpdateRoleRequest>

export const SetRolePermissionsRequest = z
  .object({ permissions: z.array(PermissionGrant).max(200) })
  .superRefine((value, ctx) => {
    const seen = new Set<string>()
    value.permissions.forEach((grant, index) => {
      if (seen.has(grant.key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'DUPLICATE_PERMISSION',
          path: ['permissions', index, 'key'],
        })
      }
      seen.add(grant.key)
    })
  })
export type SetRolePermissionsRequest = z.infer<typeof SetRolePermissionsRequest>

export const PermissionCatalogueEntry = z.object({
  key: z.string(),
  group: z.string(),
  scopable: z.boolean(),
  dangerous: z.boolean(),
  phi: z.boolean(),
})
export type PermissionCatalogueEntry = z.infer<typeof PermissionCatalogueEntry>
