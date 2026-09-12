import { ClinicModel, RoleModel, UserModel, newId } from '@clinic/db'
import type {
  BookingWindow,
  BranchDetail,
  ClinicProfile,
  ClinicProfileInput,
  ClinicSettings,
  Holiday,
  WorkingHours,
} from '@clinic/contracts'
import type { Clinic, ClinicSessionInfo } from '../domain/clinic'

interface BranchRecord {
  _id: string
  name?: string | null
  phone?: string | null
  address?: string | null
  isActive?: boolean | null
  workingHours?: Array<{ dayOfWeek: number; opensAt: string; closesAt: string }> | null
}

interface ClinicRecord {
  _id: string
  name: string
  legalName?: string | null
  taxId?: string | null
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
  branches?: BranchRecord[] | null
  holidays?: Array<{ date: string; name: string; branchId?: string | null }> | null
}

/** Lean reads return Map fields as plain objects; hydrated documents return real Maps. */
function flagsOf(value: ClinicRecord['featureFlags']): Record<string, boolean> {
  if (!value) return {}
  return value instanceof Map ? Object.fromEntries(value) : { ...value }
}

function hoursOf(entries: BranchRecord['workingHours']): WorkingHours[] {
  return [...(entries ?? [])]
    .map(({ dayOfWeek, opensAt, closesAt }) => ({ dayOfWeek, opensAt, closesAt }))
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.opensAt.localeCompare(b.opensAt))
}

function branchOf(branch: BranchRecord): BranchDetail {
  return {
    id: String(branch._id),
    name: branch.name ?? '',
    phone: branch.phone ?? null,
    address: branch.address ?? null,
    isActive: branch.isActive ?? true,
    workingHours: hoursOf(branch.workingHours),
  }
}

function holidaysOf(entries: ClinicRecord['holidays']): Holiday[] {
  return [...(entries ?? [])]
    .map(({ date, name, branchId }) => ({ date, name, branchId: branchId ?? null }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

export type ClinicProfileRecord = Omit<ClinicProfile, 'upcomingHolidays'> & { holidays: Holiday[] }

/**
 * Mongoose lives here and nowhere else. A document never leaves this file — it is
 * mapped to a plain domain object first (section 2.4), which is what keeps the
 * weaker typing of Mongoose contained to one layer.
 *
 * Settings are written through a loaded document and save(), so the audit plugin records a
 * field-level diff of exactly what an administrator changed (section 11.3).
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

  async findProfile(clinicId: string): Promise<ClinicProfileRecord | null> {
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
      branches: (doc.branches ?? []).map((branch) => {
        const { address: _address, ...detail } = branchOf(branch)
        return detail
      }),
      holidays: holidaysOf(doc.holidays),
    }
  },

  /** Everything but the booking window, which is stored apart and defaulted by the use case. */
  async findSettings(clinicId: string): Promise<Omit<ClinicSettings, 'booking'> | null> {
    const doc = (await ClinicModel().findById(clinicId).lean()) as ClinicRecord | null
    if (!doc) return null
    return {
      id: doc._id,
      name: doc.name,
      legalName: doc.legalName ?? null,
      taxId: doc.taxId ?? null,
      contact: { email: doc.contact?.email ?? null, phone: doc.contact?.phone ?? null },
      address: {
        line1: doc.address?.line1 ?? null,
        line2: doc.address?.line2 ?? null,
        city: doc.address?.city ?? null,
        country: doc.address?.country ?? null,
      },
      timezone: doc.timezone ?? 'UTC',
      currency: doc.currency ?? 'USD',
      locale: doc.locale ?? 'en',
      branches: (doc.branches ?? []).map(branchOf),
      holidays: holidaysOf(doc.holidays),
    }
  },

  /** Self-service limits (ADR-0022). Absent fields mean the clinic keeps the defaults. */
  async findBookingWindow(clinicId: string): Promise<Partial<BookingWindow>> {
    const doc = (await ClinicModel().findById(clinicId).select({ settings: 1 }).lean()) as {
      settings?: { booking?: Partial<BookingWindow> | null } | null
    } | null
    return doc?.settings?.booking ?? {}
  },

  async setBookingWindow(clinicId: string, window: BookingWindow): Promise<boolean> {
    const doc = await ClinicModel().findById(clinicId)
    if (!doc) return false
    doc.set('settings.booking', window)
    await doc.save()
    return true
  },

  async countMembers(clinicId: string): Promise<{ users: number; roles: number }> {
    const [users, roles] = await Promise.all([
      UserModel().countDocuments({ clinicId }),
      RoleModel().countDocuments({ clinicId }),
    ])
    return { users, roles }
  },

  async updateProfile(clinicId: string, input: ClinicProfileInput): Promise<boolean> {
    const doc = await ClinicModel().findById(clinicId)
    if (!doc) return false
    doc.set({
      name: input.name,
      legalName: input.legalName,
      taxId: input.taxId,
      contact: input.contact,
      address: input.address,
      timezone: input.timezone,
      currency: input.currency,
      locale: input.locale,
    })
    await doc.save()
    return true
  },

  /** A new location starts closed all week; its hours are set next, from the same screen. */
  async addBranch(
    clinicId: string,
    input: { name: string; phone: string | null; address: string | null },
  ): Promise<string | null> {
    const doc = await ClinicModel().findById(clinicId)
    if (!doc) return null
    const id = newId()
    doc.branches.push({ _id: id, ...input, isActive: true, workingHours: [] })
    await doc.save()
    return id
  },

  async updateBranch(
    clinicId: string,
    branchId: string,
    input: { name: string; phone: string | null; address: string | null; isActive: boolean },
  ): Promise<boolean> {
    const doc = await ClinicModel().findById(clinicId)
    const branch = doc?.branches.id(branchId)
    if (!doc || !branch) return false
    branch.set(input)
    await doc.save()
    return true
  },

  async setWorkingHours(
    clinicId: string,
    branchId: string,
    hours: readonly WorkingHours[],
  ): Promise<boolean> {
    const doc = await ClinicModel().findById(clinicId)
    const branch = doc?.branches.id(branchId)
    if (!doc || !branch) return false
    branch.set(
      'workingHours',
      hours.map(({ dayOfWeek, opensAt, closesAt }) => ({ dayOfWeek, opensAt, closesAt })),
    )
    await doc.save()
    return true
  },

  async setHolidays(clinicId: string, holidays: readonly Holiday[]): Promise<boolean> {
    const doc = await ClinicModel().findById(clinicId)
    if (!doc) return false
    doc.set(
      'holidays',
      holidays.map(({ date, name, branchId }) => ({ date, name, branchId })),
    )
    await doc.save()
    return true
  },
}
