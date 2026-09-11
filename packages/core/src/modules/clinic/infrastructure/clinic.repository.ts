import { ClinicModel, RoleModel, UserModel } from '@clinic/db'
import type { ClinicProfile } from '@clinic/contracts'
import type { Clinic, ClinicSessionInfo } from '../domain/clinic'

interface ClinicRecord {
  _id: string
  name: string
  timezone?: string | null
  currency?: string | null
  locale?: string | null
  permissionVersion?: number | null
  featureFlags?: Map<string, boolean> | Record<string, boolean> | null
  contact?: { email?: string | null; phone?: string | null } | null
  address?: {
    line1?: string | null
    line2?: string | null
    city?: string | null
    country?: string | null
  } | null
  branches?: Array<{
    _id: string
    name?: string | null
    phone?: string | null
    isActive?: boolean | null
    workingHours?: Array<{ dayOfWeek: number; opensAt: string; closesAt: string }> | null
  }> | null
}

/** Lean reads return Map fields as plain objects; hydrated documents return real Maps. */
function flagsOf(value: ClinicRecord['featureFlags']): Record<string, boolean> {
  if (!value) return {}
  return value instanceof Map ? Object.fromEntries(value) : { ...value }
}

/**
 * Mongoose lives here and nowhere else. A document never leaves this file — it is
 * mapped to a plain domain object first (section 2.4), which is what keeps the
 * weaker typing of Mongoose contained to one layer.
 */
export const clinicRepository = {
  async findById(clinicId: string): Promise<Clinic | null> {
    const doc = (await ClinicModel().findById(clinicId).lean()) as ClinicRecord | null
    if (!doc) return null
    return {
      id: doc._id,
      name: doc.name,
      timezone: doc.timezone ?? 'UTC',
      currency: doc.currency ?? 'USD',
      locale: doc.locale ?? 'en',
      branches: (doc.branches ?? []).map((b) => ({
        id: String(b._id),
        name: b.name ?? '',
        isActive: b.isActive ?? true,
      })),
    }
  },

  async findSessionInfo(clinicId: string): Promise<ClinicSessionInfo | null> {
    const doc = (await ClinicModel()
      .findById(clinicId)
      .select({ name: 1, timezone: 1, locale: 1, permissionVersion: 1, featureFlags: 1 })
      .lean()) as ClinicRecord | null
    if (!doc) return null
    return {
      id: doc._id,
      name: doc.name,
      timezone: doc.timezone ?? 'UTC',
      locale: doc.locale ?? 'en',
      permissionVersion: doc.permissionVersion ?? 1,
      featureFlags: flagsOf(doc.featureFlags),
    }
  },

  async findProfile(clinicId: string): Promise<ClinicProfile | null> {
    const doc = (await ClinicModel().findById(clinicId).lean()) as ClinicRecord | null
    if (!doc) return null
    return {
      id: doc._id,
      name: doc.name,
      timezone: doc.timezone ?? 'UTC',
      locale: doc.locale ?? 'en',
      contact: { email: doc.contact?.email ?? null, phone: doc.contact?.phone ?? null },
      address: {
        line1: doc.address?.line1 ?? null,
        line2: doc.address?.line2 ?? null,
        city: doc.address?.city ?? null,
        country: doc.address?.country ?? null,
      },
      branches: (doc.branches ?? []).map((branch) => ({
        id: String(branch._id),
        name: branch.name ?? '',
        phone: branch.phone ?? null,
        isActive: branch.isActive ?? true,
        workingHours: [...(branch.workingHours ?? [])]
          .map(({ dayOfWeek, opensAt, closesAt }) => ({ dayOfWeek, opensAt, closesAt }))
          .sort((a, b) => a.dayOfWeek - b.dayOfWeek),
      })),
    }
  },

  async countMembers(clinicId: string): Promise<{ users: number; roles: number }> {
    const [users, roles] = await Promise.all([
      UserModel().countDocuments({ clinicId }),
      RoleModel().countDocuments({ clinicId }),
    ])
    return { users, roles }
  },
}
