import { env } from '@clinic/config'
import { ClinicModel, RoleModel, UserModel, newId } from '@clinic/db'
import { SYSTEM_ROLES, type Actor, type SystemRoleKey } from '../src/modules/access'
import { passwordHasher } from '../src/modules/identity/infrastructure/password-hasher'
import { authenticateAccessToken, login, type RequestMeta } from '../src/modules/session'

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

export async function roleIdOf(key: SystemRoleKey): Promise<string> {
  const id = (await ensureClinic()).get(key)
  if (!id) throw new Error(`no role ${key}`)
  return id
}

let sequence = 0

export function uniqueEmail(prefix = 'member'): string {
  sequence += 1
  return `${prefix}${Date.now()}n${sequence}@itest.local`
}

export async function createUser(
  options: {
    role?: SystemRoleKey
    roleId?: string
    /** Exactly these roles — possibly none. Wins over `role` and `roleId`. */
    roleIds?: string[]
    status?: 'ACTIVE' | 'INVITED' | 'SUSPENDED'
    password?: string | null
    firstName?: string
    lastName?: string
  } = {},
): Promise<{ id: string; email: string }> {
  const ids = await ensureClinic()
  let assigned: string[]
  if (options.roleIds) {
    assigned = options.roleIds
  } else {
    const roleId = options.roleId ?? ids.get(options.role ?? 'patient')
    if (!roleId) throw new Error('no role for test user')
    assigned = [roleId]
  }

  const email = uniqueEmail()
  const password = options.password === undefined ? TEST_PASSWORD : options.password
  const status = options.status ?? 'ACTIVE'

  const doc = await UserModel().create({
    _id: newId(),
    clinicId: env().CLINIC_ID,
    email,
    firstName: options.firstName ?? 'Maya',
    lastName: options.lastName ?? 'Haddad',
    status,
    passwordHash: password ? await passwordHasher.hash(password) : undefined,
    emailVerifiedAt: status === 'ACTIVE' ? new Date() : null,
    roles: assigned.map((roleId) => ({ roleId })),
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

/**
 * The actor a real request would run as: an account created, signed in, and its access token
 * authenticated — not a hand-built object that could hold permissions no role grants.
 */
export async function signedInActor(
  options: Parameters<typeof createUser>[0] = {},
): Promise<{ actor: Actor; user: { id: string; email: string }; accessToken: string }> {
  const user = await createUser(options)
  const session = await login({ email: user.email, password: TEST_PASSWORD, meta: meta() })
  const { actor } = await authenticateAccessToken(session.accessToken)
  return { actor, user, accessToken: session.accessToken }
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

/** The details a promise rejected with — the field and issue a form would show. */
export async function failureDetails(
  promise: Promise<unknown>,
): Promise<Array<{ field: string; issue: string }>> {
  try {
    await promise
    return []
  } catch (error) {
    return (error as { details?: Array<{ field: string; issue: string }> }).details ?? []
  }
}
