import { env } from '@clinic/config'
import { ClinicModel, RoleModel, UserModel, newId } from '@clinic/db'
import { SYSTEM_ROLES, type SystemRoleKey } from '../src/modules/access'
import { passwordHasher } from '../src/modules/identity/infrastructure/password-hasher'
import type { RequestMeta } from '../src/modules/session'

export const TEST_PASSWORD = 'Integration-Suite-2026!'
export const NEW_PASSWORD = 'Brand-New-Secret-2026!'

let roleIds: Map<SystemRoleKey, string> | null = null

/** The installation clinic and its four system roles, created once per run. */
export async function ensureClinic(): Promise<Map<SystemRoleKey, string>> {
  if (roleIds) return roleIds
  const clinicId = env().CLINIC_ID

  await ClinicModel().findOneAndUpdate(
    { _id: clinicId },
    {
      $set: {
        name: 'Integration Clinic',
        timezone: 'Asia/Beirut',
        currency: 'USD',
        locale: 'en',
        isActive: true,
      },
      $setOnInsert: { permissionVersion: 1, branches: [], holidays: [] },
    },
    { upsert: true },
  )

  const ids = new Map<SystemRoleKey, string>()
  for (const role of SYSTEM_ROLES) {
    const doc = await RoleModel().findOneAndUpdate(
      { clinicId, key: role.key },
      {
        $set: {
          name: role.name,
          priority: role.priority,
          isSystem: true,
          isDefault: role.isDefault,
          permissions: role.grants.map(({ key, scope }) => ({ key, scope })),
        },
        $setOnInsert: { _id: newId(), clinicId, key: role.key },
      },
      { upsert: true, new: true },
    )
    if (!doc) throw new Error(`could not create role ${role.key}`)
    ids.set(role.key, doc._id)
  }
  roleIds = ids
  return ids
}

let sequence = 0

export async function createUser(
  options: {
    role?: SystemRoleKey
    roleId?: string
    status?: 'ACTIVE' | 'INVITED' | 'SUSPENDED'
    password?: string | null
  } = {},
): Promise<{ id: string; email: string }> {
  const ids = await ensureClinic()
  const roleId = options.roleId ?? ids.get(options.role ?? 'patient')
  if (!roleId) throw new Error('no role for test user')

  sequence += 1
  const email = `member${Date.now()}n${sequence}@itest.local`
  const password = options.password === undefined ? TEST_PASSWORD : options.password

  const doc = await UserModel().create({
    _id: newId(),
    clinicId: env().CLINIC_ID,
    email,
    firstName: 'Maya',
    lastName: 'Haddad',
    status: options.status ?? 'ACTIVE',
    passwordHash: password ? await passwordHasher.hash(password) : undefined,
    roles: [{ roleId }],
    deletedAt: null,
  })
  return { id: doc._id, email }
}

/** A distinct address per call, so per-IP rate limits never couple unrelated tests. */
export function meta(): RequestMeta {
  const octet = () => Math.floor(Math.random() * 254) + 1
  return {
    ipAddress: `10.${octet()}.${octet()}.${octet()}`,
    userAgent: 'vitest integration',
    deviceName: 'integration',
  }
}

export const secondsAfter = (from: Date, seconds: number) =>
  new Date(from.getTime() + seconds * 1000)

/** The error code a promise rejected with, or RESOLVED. */
export async function outcome(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
    return 'RESOLVED'
  } catch (error) {
    return (error as { code?: string }).code ?? String(error)
  }
}
