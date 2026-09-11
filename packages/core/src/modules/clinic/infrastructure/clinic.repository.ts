import { ClinicModel, RoleModel, UserModel } from '@clinic/db'
import type { Clinic } from '../domain/clinic'

/**
 * Mongoose lives here and nowhere else. A document never leaves this file — it is
 * mapped to a plain domain object first (section 2.4), which is what keeps the
 * weaker typing of Mongoose contained to one layer.
 */
export const clinicRepository = {
  async findById(clinicId: string): Promise<Clinic | null> {
    const doc = await ClinicModel().findById(clinicId).lean()
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

  async countMembers(clinicId: string): Promise<{ users: number; roles: number }> {
    const [users, roles] = await Promise.all([
      UserModel().countDocuments({ clinicId }),
      RoleModel().countDocuments({ clinicId }),
    ])
    return { users, roles }
  },
}
