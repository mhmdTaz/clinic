/**
 * Seeds the installation clinic (CLINIC_ID), the four system roles, one active user per
 * portal, and one patient still waiting to activate their account.
 *
 * Idempotent: re-running updates in place rather than duplicating, and only touches
 * what actually differs, so a re-run does not flood the audit log with no-op changes.
 *
 * Every write runs as the SYSTEM actor with audit capture installed — seeding is
 * "something done on the system" like anything else.
 *
 * Demo passwords come from SEED_PASSWORD, or a documented default that is refused
 * outright when NODE_ENV is production.
 */
import './bootstrap-env'
import { env } from '@clinic/config'
import { ClinicModel, RoleModel, UserModel, connect, disconnect, newId } from '@clinic/db'
import { runWithContext, systemContext } from '../src/context/request-context'
import { SYSTEM_ROLES } from '../src/modules/access'
import { flushAudit, installAuditCapture } from '../src/modules/audit'
import { issueInvitation } from '../src/modules/identity'
// Scripts may reach infrastructure directly; application code goes through the module API.
import { passwordHasher } from '../src/modules/identity/infrastructure/password-hasher'

const DEFAULT_DEMO_PASSWORD = 'Clinic-Demo-2026!'
const EMAIL_COLLATION = { locale: 'en', strength: 2 } as const

type RoleKey = (typeof SYSTEM_ROLES)[number]['key']

interface UserSpec {
  email: string
  firstName: string
  lastName: string
  role: RoleKey
}

const ACTIVE_USERS: readonly UserSpec[] = [
  { email: 'admin@clinic.local', firstName: 'Amal', lastName: 'Haddad', role: 'admin' },
  { email: 'staff@clinic.local', firstName: 'Rami', lastName: 'Khoury', role: 'staff' },
  { email: 'doctor@clinic.local', firstName: 'Nabil', lastName: 'Saad', role: 'doctor' },
  { email: 'patient@clinic.local', firstName: 'Sara', lastName: 'Karam', role: 'patient' },
]

/** Registered by staff, not yet activated — exercises the activation flow (ADR-0006). */
const INVITED_USER: UserSpec = {
  email: 'invited@clinic.local',
  firstName: 'Layla',
  lastName: 'Nassar',
  role: 'patient',
}

function demoPassword(): string {
  const configured = process.env.SEED_PASSWORD
  if (configured) return configured
  if (env().NODE_ENV === 'production') {
    throw new Error(
      'Refusing to seed with the default demo password while NODE_ENV=production. ' +
        'Set SEED_PASSWORD — or, better, do not seed a production database at all.',
    )
  }
  return DEFAULT_DEMO_PASSWORD
}

type Grant = { key: string; scope?: string | null }

function sameGrants(a: readonly Grant[], b: readonly Grant[]): boolean {
  const normalise = (grants: readonly Grant[]) =>
    JSON.stringify(
      grants
        .map(({ key, scope }) => ({ key, scope: scope ?? 'CLINIC' }))
        .sort((x, y) => x.key.localeCompare(y.key)),
    )
  return normalise(a) === normalise(b)
}

async function seedClinic(clinicId: string): Promise<{ name: string }> {
  const Clinic = ClinicModel()
  await Clinic.findOneAndUpdate(
    { _id: clinicId },
    {
      $set: {
        name: 'Demo Clinic',
        legalName: 'Demo Clinic SARL',
        contact: { email: 'hello@clinic.local', phone: '+961 1 000 000' },
        address: { line1: '12 Rue Verdun', city: 'Beirut', country: 'LB' },
        timezone: 'Asia/Beirut',
        currency: 'USD',
        locale: 'en',
        isActive: true,
      },
      $setOnInsert: { permissionVersion: 1, branches: [], holidays: [] },
    },
    { upsert: true, new: true },
  )

  // Branches are embedded, so this is one document update rather than a second collection.
  const clinic = await Clinic.findById(clinicId)
  if (!clinic) throw new Error(`Clinic ${clinicId} vanished during seeding`)
  if ((clinic.branches?.length ?? 0) === 0) {
    clinic.branches.push({
      _id: newId(),
      name: 'Main Branch',
      phone: '+961 1 000 001',
      isActive: true,
      workingHours: [1, 2, 3, 4, 5].map((dayOfWeek) => ({
        dayOfWeek,
        opensAt: '09:00',
        closesAt: '17:00',
      })),
    })
    await clinic.save()
  }
  return { name: clinic.name }
}

async function seedRoles(clinicId: string): Promise<Map<RoleKey, string>> {
  const Role = RoleModel()
  const ids = new Map<RoleKey, string>()
  let grantsChanged = false

  for (const role of SYSTEM_ROLES) {
    const grants = role.grants.map(({ key, scope }) => ({ key, scope }))
    const existing = await Role.findOne({ clinicId, key: role.key }).lean()
    if (!existing || !sameGrants(existing.permissions ?? [], grants)) grantsChanged = true

    const doc = await Role.findOneAndUpdate(
      { clinicId, key: role.key },
      {
        $set: {
          name: role.name,
          description: role.description,
          priority: role.priority,
          isSystem: true,
          isDefault: role.isDefault,
          permissions: grants,
        },
        $setOnInsert: { _id: newId(), clinicId, key: role.key },
      },
      { upsert: true, new: true },
    )
    if (!doc) throw new Error(`Role ${role.key} could not be seeded`)
    ids.set(role.key, doc._id)
  }

  // Sessions already signed in must see changed grants on their next request (7.7).
  if (grantsChanged) {
    await ClinicModel().updateOne({ _id: clinicId }, { $inc: { permissionVersion: 1 } })
  }
  return ids
}

async function seedUser(
  clinicId: string,
  spec: UserSpec,
  roleId: string,
  password: string | null,
): Promise<{ id: string; status: string }> {
  const User = UserModel()
  const existing = await User.findOne({ clinicId, email: spec.email })
    .collation(EMAIL_COLLATION)
    .lean()

  const set: Record<string, unknown> = {
    firstName: spec.firstName,
    lastName: spec.lastName,
    preferredPortal: spec.role,
  }
  if (!existing?.roles?.some((role) => role.roleId === roleId)) {
    set.roles = [{ roleId, assignedAt: new Date() }]
  }

  if (password) {
    const current = existing?.passwordHash
    if (!current || !(await passwordHasher.verify(current, password))) {
      set.passwordHash = await passwordHasher.hash(password)
    }
    if (existing?.status !== 'ACTIVE') {
      set.status = 'ACTIVE'
      set.emailVerifiedAt = new Date()
    }
    // A demo account locked out during manual testing becomes usable again.
    set['security.failedLoginCount'] = 0
    set['security.lastFailedLoginAt'] = null
    set['security.lockedUntil'] = null
  } else if (!existing) {
    set.status = 'INVITED'
  }

  const doc = await User.findOneAndUpdate(
    { clinicId, email: spec.email },
    { $set: set, $setOnInsert: { _id: newId(), clinicId, email: spec.email, deletedAt: null } },
    { upsert: true, new: true, collation: EMAIL_COLLATION },
  ).lean()
  if (!doc) throw new Error(`User ${spec.email} could not be seeded`)
  return { id: doc._id, status: doc.status ?? 'INVITED' }
}

async function main(): Promise<void> {
  const clinicId = env().CLINIC_ID
  await connect()
  installAuditCapture()

  const context = {
    ...systemContext(`seed-${newId()}`, clinicId),
    actorId: 'system',
    actorLabel: 'seed',
  }
  const activationLinks: string[] = []

  await runWithContext(context, async () => {
    const clinic = await seedClinic(clinicId)
    const roleIds = await seedRoles(clinicId)
    const password = demoPassword()

    const roleId = (key: RoleKey) => {
      const id = roleIds.get(key)
      if (!id) throw new Error(`Role ${key} was not seeded`)
      return id
    }

    for (const spec of ACTIVE_USERS) await seedUser(clinicId, spec, roleId(spec.role), password)

    const invited = await seedUser(clinicId, INVITED_USER, roleId(INVITED_USER.role), null)
    if (invited.status === 'INVITED') {
      const { link } = await issueInvitation({
        clinicId,
        userId: invited.id,
        invitedBy: { id: 'system', name: 'Seed' },
        appUrl: env().APP_URL,
        clinicName: clinic.name,
      })
      activationLinks.push(`${INVITED_USER.email}: ${link}`)
    }
  })

  await flushAudit()
  await disconnect()

  console.warn(
    [
      `seeded clinic "${clinicId}": ${SYSTEM_ROLES.length} roles, ${ACTIVE_USERS.length} active users`,
      `  sign in as ${ACTIVE_USERS.map((user) => user.email).join(', ')}`,
      process.env.SEED_PASSWORD
        ? '  with the password from SEED_PASSWORD'
        : `  with the demo password ${DEFAULT_DEMO_PASSWORD}`,
      ...(activationLinks.length > 0
        ? [
            '  awaiting activation (the email is in Mailpit at http://localhost:8025):',
            ...activationLinks.map((l) => `    ${l}`),
          ]
        : []),
    ].join('\n'),
  )
}

main().catch(async (error: unknown) => {
  console.error(error)
  await flushAudit().catch(() => undefined)
  await disconnect().catch(() => undefined)
  process.exit(1)
})
