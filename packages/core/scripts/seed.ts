/**
 * Seeds the installation clinic (CLINIC_ID), the four system roles, one active user per portal,
 * one account with no role yet, one patient still waiting to activate their account, the
 * specialty vocabulary, a doctor profile and a handful of patient records.
 *
 * Idempotent: re-running updates in place rather than duplicating, and only touches what
 * actually differs, so a re-run does not flood the audit log with no-op changes. Records an
 * administrator may have changed during a demo — roles given to the unassigned account, a
 * renamed specialty — are left as they are.
 *
 * Every write runs as the SYSTEM actor with audit capture installed — seeding is "something
 * done on the system" like anything else.
 *
 * Demo passwords come from SEED_PASSWORD, or a documented default that is refused outright
 * when NODE_ENV is production.
 */
import './bootstrap-env'
import { env, nameKey, type BloodType, type Gender } from '@clinic/config'
import {
  ClinicModel,
  DoctorModel,
  PatientModel,
  RoleModel,
  SpecialtyModel,
  UserModel,
  connect,
  disconnect,
  newId,
  nextFormatted,
} from '@clinic/db'
import { runWithContext, systemContext } from '../src/context/request-context'
import { SYSTEM_ROLES } from '../src/modules/access'
import { flushAudit, installAuditCapture } from '../src/modules/audit'
import { issueInvitation } from '../src/modules/identity'
// Scripts may reach infrastructure directly; application code goes through the module API.
import { passwordHasher } from '../src/modules/identity/infrastructure/password-hasher'

const DEFAULT_DEMO_PASSWORD = 'Clinic-Demo-2026!'
const EMAIL_COLLATION = { locale: 'en', strength: 2 } as const
const SEEDED_BY = { id: 'system', name: 'Seed' }

type RoleKey = (typeof SYSTEM_ROLES)[number]['key']

interface UserSpec {
  email: string
  firstName: string
  lastName: string
  role: RoleKey | null
}

const ACTIVE_USERS: ReadonlyArray<UserSpec & { role: RoleKey }> = [
  { email: 'admin@clinic.local', firstName: 'Amal', lastName: 'Haddad', role: 'admin' },
  { email: 'staff@clinic.local', firstName: 'Rami', lastName: 'Khoury', role: 'staff' },
  { email: 'doctor@clinic.local', firstName: 'Nabil', lastName: 'Saad', role: 'doctor' },
  { email: 'patient@clinic.local', firstName: 'Sara', lastName: 'Karam', role: 'patient' },
]

/** Signed in, but holding no role: the account the Head Nurse walkthrough gives a role to. */
const UNASSIGNED_USER: UserSpec = {
  email: 'nurse@clinic.local',
  firstName: 'Hana',
  lastName: 'Aoun',
  role: null,
}

/** Registered by staff, not yet activated — exercises the activation flow (ADR-0006). */
const INVITED_USER: UserSpec & { role: RoleKey } = {
  email: 'invited@clinic.local',
  firstName: 'Layla',
  lastName: 'Nassar',
  role: 'patient',
}

const SPECIALTIES = [
  'General Practice',
  'Pediatrics',
  'Cardiology',
  'Dermatology',
  'Gynecology',
  'Orthopedics',
  'Ophthalmology',
  'Ear, Nose and Throat',
] as const

interface PatientSpec {
  firstName: string
  lastName: string
  dateOfBirth: string
  gender: Gender
  phone: string | null
  email: string | null
  /** The portal account this record belongs to, by its email. */
  account?: string
  nationalId?: string
  bloodType?: BloodType
  emergencyContacts?: Array<{ name: string; relationship: string; phone: string }>
}

const PATIENTS: readonly PatientSpec[] = [
  {
    firstName: 'Sara',
    lastName: 'Karam',
    dateOfBirth: '1991-03-14',
    gender: 'FEMALE',
    phone: '+961 3 214 587',
    email: 'patient@clinic.local',
    account: 'patient@clinic.local',
    bloodType: 'O+',
  },
  {
    firstName: 'Layla',
    lastName: 'Nassar',
    dateOfBirth: '1988-11-02',
    gender: 'FEMALE',
    phone: '+961 71 408 233',
    email: 'invited@clinic.local',
    account: 'invited@clinic.local',
  },
  {
    firstName: 'Omar',
    lastName: 'Fakhoury',
    dateOfBirth: '1975-06-30',
    gender: 'MALE',
    phone: '+961 70 555 010',
    email: null,
    nationalId: 'LB-1975-44821',
    bloodType: 'A-',
  },
  {
    firstName: 'Rana',
    lastName: 'Haddad',
    dateOfBirth: '2012-01-09',
    gender: 'FEMALE',
    phone: null,
    email: null,
    emergencyContacts: [{ name: 'Ziad Haddad', relationship: 'Father', phone: '+961 3 887 120' }],
  },
]

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

async function seedClinic(
  clinicId: string,
): Promise<{ name: string; mainBranchId: string | null }> {
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
  return { name: clinic.name, mainBranchId: clinic.branches[0]?._id ?? null }
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
  roleId: string | null,
  password: string | null,
): Promise<{ id: string; status: string }> {
  const User = UserModel()
  const existing = await User.findOne({ clinicId, email: spec.email })
    .collation(EMAIL_COLLATION)
    .lean()

  const set: Record<string, unknown> = { firstName: spec.firstName, lastName: spec.lastName }
  if (spec.role) set.preferredPortal = spec.role
  if (roleId && !existing?.roles?.some((role) => role.roleId === roleId)) {
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

  const onInsert: Record<string, unknown> = {
    _id: newId(),
    clinicId,
    email: spec.email,
    deletedAt: null,
  }
  // The unassigned account starts with no role, and keeps whatever a demo gave it since.
  if (!roleId) onInsert.roles = []

  const doc = await User.findOneAndUpdate(
    { clinicId, email: spec.email },
    { $set: set, $setOnInsert: onInsert },
    { upsert: true, new: true, collation: EMAIL_COLLATION },
  ).lean()
  if (!doc) throw new Error(`User ${spec.email} could not be seeded`)
  return { id: doc._id, status: doc.status ?? 'INVITED' }
}

async function seedSpecialties(clinicId: string): Promise<Map<string, string>> {
  const ids = new Map<string, string>()
  for (const name of SPECIALTIES) {
    const existing = await SpecialtyModel()
      .findOne({ clinicId, 'search.name': nameKey(name) })
      .lean()
    const id =
      existing?._id ??
      (await SpecialtyModel().create({ _id: newId(), clinicId, name, isActive: true }))._id
    ids.set(name, id)
  }
  return ids
}

/** Weekdays, mornings and afternoons: enough of a week for the calendar to have shape. */
const DOCTOR_WEEK = [1, 2, 3, 4, 5].flatMap((dayOfWeek) => [
  { dayOfWeek, startsAt: '09:00', endsAt: '13:00' },
  { dayOfWeek, startsAt: '14:00', endsAt: '17:00' },
])

async function seedDoctorProfile(
  clinicId: string,
  userId: string,
  specialty: { id: string; name: string },
  branchId: string | null,
): Promise<void> {
  const existing = await DoctorModel().findOne({ clinicId, userId })
  if (existing) {
    // A profile seeded before Phase 3 has no week; give it one without touching anything else.
    if ((existing.get('availability') ?? []).length === 0) {
      existing.set('availability', DOCTOR_WEEK)
      await existing.save()
    }
    return
  }
  await DoctorModel().create({
    _id: newId(),
    clinicId,
    userId,
    title: 'Dr',
    licenseNumber: 'LB-MD-10421',
    bio: 'Family medicine, with a particular interest in preventive care.',
    yearsOfExperience: 12,
    consultationFee: '40.00',
    defaultSlotMinutes: 20,
    specialties: [specialty],
    branchIds: branchId ? [branchId] : [],
    availability: DOCTOR_WEEK,
    timeOff: [],
    isAcceptingNew: true,
    isActive: true,
    createdBy: SEEDED_BY,
    updatedBy: SEEDED_BY,
    deletedAt: null,
  })
}

async function seedPatients(
  clinicId: string,
  accounts: ReadonlyMap<string, string>,
): Promise<number> {
  let created = 0
  for (const spec of PATIENTS) {
    const exists = await PatientModel()
      .exists({
        clinicId,
        'search.lastName': nameKey(spec.lastName),
        'search.firstName': nameKey(spec.firstName),
        dateOfBirth: spec.dateOfBirth,
      })
      .setOptions({ skipAudit: true })
    if (exists) continue

    await PatientModel().create({
      _id: newId(),
      clinicId,
      userId: spec.account ? (accounts.get(spec.account) ?? null) : null,
      medicalRecordNo: await nextFormatted(`mrn:${clinicId}`, 'MRN', 6),
      firstName: spec.firstName,
      lastName: spec.lastName,
      dateOfBirth: spec.dateOfBirth,
      gender: spec.gender,
      nationalId: spec.nationalId ?? null,
      bloodType: spec.bloodType ?? 'UNKNOWN',
      contact: { phone: spec.phone, email: spec.email },
      address: { line1: null, city: 'Beirut', country: 'LB' },
      emergencyContacts: spec.emergencyContacts ?? [],
      adminNotes: null,
      isActive: true,
      createdBy: SEEDED_BY,
      updatedBy: SEEDED_BY,
      deletedAt: null,
    })
    created += 1
  }
  return created
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
  let patientsCreated = 0

  await runWithContext(context, async () => {
    const clinic = await seedClinic(clinicId)
    const roleIds = await seedRoles(clinicId)
    const password = demoPassword()

    const roleId = (key: RoleKey) => {
      const id = roleIds.get(key)
      if (!id) throw new Error(`Role ${key} was not seeded`)
      return id
    }

    const accounts = new Map<string, string>()
    for (const spec of ACTIVE_USERS) {
      const { id } = await seedUser(clinicId, spec, roleId(spec.role), password)
      accounts.set(spec.email, id)
    }
    await seedUser(clinicId, UNASSIGNED_USER, null, password)

    const invited = await seedUser(clinicId, INVITED_USER, roleId(INVITED_USER.role), null)
    accounts.set(INVITED_USER.email, invited.id)
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

    const specialties = await seedSpecialties(clinicId)
    const generalPractice = specialties.get('General Practice')
    const doctorUserId = accounts.get('doctor@clinic.local')
    if (generalPractice && doctorUserId) {
      await seedDoctorProfile(
        clinicId,
        doctorUserId,
        { id: generalPractice, name: 'General Practice' },
        clinic.mainBranchId,
      )
    }

    patientsCreated = await seedPatients(clinicId, accounts)
  })

  await flushAudit()
  await disconnect()

  console.warn(
    [
      `seeded clinic "${clinicId}": ${SYSTEM_ROLES.length} roles, ${ACTIVE_USERS.length} active users, ` +
        `${SPECIALTIES.length} specialties, ${patientsCreated} new patient records`,
      `  sign in as ${ACTIVE_USERS.map((user) => user.email).join(', ')}`,
      `  ${UNASSIGNED_USER.email} can sign in but has no role yet — give it one in Admin → Users`,
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
