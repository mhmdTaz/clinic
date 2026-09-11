import { RoleModel, UserModel } from '@clinic/db'

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
}
