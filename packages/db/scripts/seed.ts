/**
 * Seeds a demo clinic, the four system roles and four users — one per portal.
 *
 * Idempotent: re-running updates rather than duplicating, so `pnpm db:seed` is safe
 * to run against an existing database.
 *
 * Users are seeded as INVITED with no passwordHash, which is exactly what that status
 * means in the schema ("null while an invite is pending"). Credentials and the full
 * permission catalogue arrive with Phase 1 — this phase only proves the wiring.
 */
import './bootstrap-env'
import { connect, disconnect, newId } from '../src/index'
import { ClinicModel, RoleModel, UserModel } from '../src/models/index'

const CLINIC_ID = 'seed_clinic_demo'

const ROLES = [
  { key: 'admin', name: 'Administrator', priority: 40, permissions: ['portal.admin:access'] },
  { key: 'staff', name: 'Staff', priority: 30, permissions: ['portal.staff:access'] },
  { key: 'doctor', name: 'Doctor', priority: 20, permissions: ['portal.doctor:access'] },
  {
    key: 'patient',
    name: 'Patient',
    priority: 10,
    permissions: ['portal.patient:access'],
    isDefault: true,
  },
] as const

const USERS = [
  { email: 'admin@clinic.local', firstName: 'Amal', lastName: 'Haddad', role: 'admin' },
  { email: 'staff@clinic.local', firstName: 'Rami', lastName: 'Khoury', role: 'staff' },
  { email: 'doctor@clinic.local', firstName: 'Nabil', lastName: 'Saad', role: 'doctor' },
  { email: 'patient@clinic.local', firstName: 'Sara', lastName: 'Karam', role: 'patient' },
] as const

async function main() {
  await connect()
  console.warn('seeding…')

  const Clinic = ClinicModel()
  const Role = RoleModel()
  const User = UserModel()

  await Clinic.findByIdAndUpdate(
    CLINIC_ID,
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
  const clinic = await Clinic.findById(CLINIC_ID)
  if (clinic && (clinic.branches?.length ?? 0) === 0) {
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

  const roleIdByKey = new Map<string, string>()
  for (const role of ROLES) {
    const doc = await Role.findOneAndUpdate(
      { clinicId: CLINIC_ID, key: role.key },
      {
        $set: {
          name: role.name,
          priority: role.priority,
          isSystem: true,
          isDefault: 'isDefault' in role ? role.isDefault : false,
          permissions: role.permissions.map((key) => ({ key, scope: 'CLINIC' })),
        },
        $setOnInsert: { _id: newId(), clinicId: CLINIC_ID, key: role.key },
      },
      { upsert: true, new: true },
    )
    roleIdByKey.set(role.key, doc!._id)
  }

  for (const user of USERS) {
    const roleId = roleIdByKey.get(user.role)!
    await User.findOneAndUpdate(
      { clinicId: CLINIC_ID, email: user.email },
      {
        $set: {
          firstName: user.firstName,
          lastName: user.lastName,
          status: 'INVITED',
          roles: [{ roleId, assignedAt: new Date() }],
          preferredPortal: user.role,
        },
        $setOnInsert: { _id: newId(), clinicId: CLINIC_ID, email: user.email, deletedAt: null },
      },
      { upsert: true, new: true, collation: { locale: 'en', strength: 2 } },
    )
  }

  console.warn(`seeded clinic "${CLINIC_ID}" with ${ROLES.length} roles and ${USERS.length} users`)
  await disconnect()
}

main().catch(async (error) => {
  console.error(error)
  await disconnect().catch(() => {})
  process.exit(1)
})
