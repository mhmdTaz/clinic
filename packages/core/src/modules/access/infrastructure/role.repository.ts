import { RoleModel, UserModel, newId } from '@clinic/db'
import { sessionOf, type Transaction } from '../../../transaction'

export interface StoredRole {
  id: string
  key: string
  name: string
  description: string | null
  isSystem: boolean
  priority: number
  permissions: Array<{ key: string; scope: string | null }>
}

interface RoleRecord {
  _id: string
  key: string
  name: string
  description?: string | null
  isSystem?: boolean | null
  priority?: number | null
  permissions?: Array<{ key: string; scope?: string | null }> | null
}

function toRole(doc: RoleRecord): StoredRole {
  return {
    id: doc._id,
    key: doc.key,
    name: doc.name,
    description: doc.description ?? null,
    isSystem: doc.isSystem === true,
    priority: doc.priority ?? 0,
    permissions: (doc.permissions ?? []).map((grant) => ({
      key: grant.key,
      scope: grant.scope ?? null,
    })),
  }
}

export const roleRepository = {
  async findByIds(clinicId: string, ids: readonly string[]): Promise<StoredRole[]> {
    if (ids.length === 0) return []
    const docs = await RoleModel()
      .find({ clinicId, _id: { $in: [...ids] } })
      .lean()
    return (docs as unknown as RoleRecord[]).map(toRole)
  },

  async findById(clinicId: string, id: string): Promise<StoredRole | null> {
    const doc = await RoleModel().findOne({ clinicId, _id: id }).lean()
    return doc ? toRole(doc as unknown as RoleRecord) : null
  },

  async findByKey(clinicId: string, key: string): Promise<StoredRole | null> {
    const doc = await RoleModel().findOne({ clinicId, key }).lean()
    return doc ? toRole(doc as unknown as RoleRecord) : null
  },

  /** Every role in the clinic. Bounded: a clinic has tens of roles, not thousands. */
  async listAll(clinicId: string): Promise<StoredRole[]> {
    const docs = await RoleModel().find({ clinicId }).sort({ priority: -1, name: 1 }).lean()
    return (docs as unknown as RoleRecord[]).map(toRole)
  },

  async listWithMemberCounts(
    clinicId: string,
  ): Promise<Array<StoredRole & { memberCount: number }>> {
    const [docs, counts] = await Promise.all([
      RoleModel().find({ clinicId }).sort({ priority: -1, name: 1 }).lean(),
      // Soft-delete filtering does not apply to aggregations, so it is spelled out here.
      UserModel().aggregate<{ _id: string; count: number }>([
        { $match: { clinicId, deletedAt: null } },
        { $unwind: '$roles' },
        { $group: { _id: '$roles.roleId', count: { $sum: 1 } } },
      ]),
    ])

    const countByRole = new Map(counts.map((row) => [row._id, row.count]))
    return (docs as unknown as RoleRecord[]).map((doc) => ({
      ...toRole(doc),
      memberCount: countByRole.get(doc._id) ?? 0,
    }))
  },

  async countMembers(clinicId: string, roleId: string): Promise<number> {
    return UserModel().countDocuments({ clinicId, 'roles.roleId': roleId })
  },

  /** Active users holding any of `roleIds`, with all of their roles. */
  async activeMemberships(
    clinicId: string,
    roleIds: readonly string[],
  ): Promise<Array<{ id: string; roleIds: string[] }>> {
    if (roleIds.length === 0) return []
    const docs = await UserModel()
      .find({ clinicId, status: 'ACTIVE', 'roles.roleId': { $in: [...roleIds] } })
      .select({ roles: 1 })
      .lean()
    return (docs as unknown as Array<{ _id: string; roles?: Array<{ roleId: string }> }>).map(
      (doc) => ({ id: doc._id, roleIds: (doc.roles ?? []).map((role) => role.roleId) }),
    )
  },

  async create(input: {
    clinicId: string
    key: string
    name: string
    description: string | null
    permissions: ReadonlyArray<{ key: string; scope: string }>
  }): Promise<StoredRole> {
    const doc = await RoleModel().create({
      _id: newId(),
      clinicId: input.clinicId,
      key: input.key,
      name: input.name,
      description: input.description,
      isSystem: false,
      isDefault: false,
      priority: 0,
      permissions: input.permissions.map(({ key, scope }) => ({ key, scope })),
    })
    return toRole(doc.toObject() as unknown as RoleRecord)
  },

  async updateDetails(
    clinicId: string,
    id: string,
    patch: { name: string; description: string | null },
  ): Promise<StoredRole | null> {
    const doc = await RoleModel()
      .findOneAndUpdate({ clinicId, _id: id }, { $set: patch }, { new: true })
      .lean()
    return doc ? toRole(doc as unknown as RoleRecord) : null
  },

  async setPermissions(
    clinicId: string,
    id: string,
    permissions: ReadonlyArray<{ key: string; scope: string }>,
    tx?: Transaction,
  ): Promise<StoredRole | null> {
    const doc = await RoleModel()
      .findOneAndUpdate(
        { clinicId, _id: id },
        { $set: { permissions: permissions.map(({ key, scope }) => ({ key, scope })) } },
        { new: true, session: sessionOf(tx) },
      )
      .lean()
    return doc ? toRole(doc as unknown as RoleRecord) : null
  },

  async delete(clinicId: string, id: string): Promise<boolean> {
    const result = await RoleModel().deleteOne({ clinicId, _id: id, isSystem: false })
    return result.deletedCount === 1
  },
}
