import { env } from '@clinic/config'
import type {
  CreateDoctorRequest,
  DoctorDetail,
  DoctorProfileInput,
  UpdateDoctorRequest,
} from '@clinic/contracts'
import { BusinessRuleError, NotFoundError, ValidationError } from '../../../errors'
import { runInTransaction } from '../../../transaction'
import { assertCan, findSystemRole, type Actor } from '../../access'
import { getClinicFacts, type Clinic } from '../../clinic'
import { createAccount, findUser, tryIssueInvitation, updateAccountDetails } from '../../identity'
import { normalizeAmount } from '../domain/money'
import { doctorRepository, type DoctorWrite } from '../infrastructure/doctor.repository'
import { specialtyRepository } from '../infrastructure/specialty.repository'
import { toDoctorDetail } from './directory'
import { doctorResource } from './scope'

/**
 * Turns submitted profile fields into what is stored: specialty names snapshotted, the fee
 * written to the currency's exact minor digits, and branches implied while there is one
 * (ADR-0021). `keepSpecialties` lets an existing doctor keep a specialty since retired.
 */
async function resolveProfile(
  clinicId: string,
  input: DoctorProfileInput,
  clinic: Clinic,
  keepSpecialties: ReadonlySet<string> = new Set(),
): Promise<DoctorWrite> {
  const specialtyIds = [...new Set(input.specialtyIds)]
  const found = new Map(
    (await specialtyRepository.findByIds(clinicId, specialtyIds)).map((specialty) => [
      specialty.id,
      specialty,
    ]),
  )
  const unusable = specialtyIds.filter((id) => {
    const specialty = found.get(id)
    return !specialty || (!specialty.isActive && !keepSpecialties.has(id))
  })

  const consultationFee =
    input.consultationFee === null ? null : normalizeAmount(input.consultationFee, clinic.currency)

  const activeBranches = clinic.branches.filter((branch) => branch.isActive)
  const knownBranches = new Set(clinic.branches.map((branch) => branch.id))
  const branchIds =
    activeBranches.length <= 1
      ? activeBranches.map((branch) => branch.id)
      : [...new Set(input.branchIds)]

  const issues = [
    ...(unusable.length > 0 ? [{ field: 'specialtyIds', issue: 'UNKNOWN_SPECIALTY' }] : []),
    ...(input.consultationFee !== null && consultationFee === null
      ? [{ field: 'consultationFee', issue: 'TOO_MANY_DECIMALS' }]
      : []),
    ...(activeBranches.length > 1 && branchIds.length === 0
      ? [{ field: 'branchIds', issue: 'SELECT_AT_LEAST_ONE' }]
      : []),
    ...(branchIds.some((id) => !knownBranches.has(id))
      ? [{ field: 'branchIds', issue: 'UNKNOWN_BRANCH' }]
      : []),
  ]
  if (issues.length > 0) throw new ValidationError('Some profile fields are not valid.', issues)

  return {
    title: input.title,
    licenseNumber: input.licenseNumber,
    bio: input.bio,
    yearsOfExperience: input.yearsOfExperience,
    consultationFee,
    defaultSlotMinutes: input.defaultSlotMinutes,
    specialties: specialtyIds.map((id) => ({ id, name: found.get(id)?.name ?? '' })),
    branchIds,
    isAcceptingNew: input.isAcceptingNew,
  }
}

/**
 * Onboards a doctor (S3): an account holding the system Doctor role and the practice profile,
 * written in one transaction, then the activation email. doctor:create is what allows the Doctor
 * role to be given here — it is a fixed system role, so this cannot hand out anything else.
 */
export async function createDoctor(
  actor: Actor,
  input: CreateDoctorRequest,
  now: Date = new Date(),
): Promise<{ doctor: DoctorDetail; invitationSent: boolean }> {
  await assertCan(actor, 'doctor:create')
  const clinic = await getClinicFacts(actor.clinicId)
  const profile = await resolveProfile(actor.clinicId, input, clinic)
  const role = await findSystemRole(actor.clinicId, 'doctor')
  if (!role)
    throw new BusinessRuleError('DOCTOR_ROLE_MISSING', 'The Doctor role has not been set up.')

  const createdBy = { id: actor.userId, name: actor.displayName }
  const created = await runInTransaction(async (tx) => {
    const account = await createAccount(
      {
        clinicId: actor.clinicId,
        email: input.email,
        firstName: input.firstName,
        lastName: input.lastName,
        phone: input.phone,
        roleIds: [role.id],
        assignedBy: actor.userId,
      },
      now,
      tx,
    )
    const doctor = await doctorRepository.create(
      { ...profile, clinicId: actor.clinicId, userId: account.id, createdBy },
      tx,
    )
    return { account, doctor }
  })

  const invitationSent = await tryIssueInvitation(
    {
      clinicId: actor.clinicId,
      userId: created.account.id,
      invitedBy: createdBy,
      appUrl: env().APP_URL,
      clinicName: clinic.name,
    },
    now,
  )
  return {
    doctor: toDoctorDetail(created.doctor, created.account, clinic.currency),
    invitationSent,
  }
}

/**
 * Edits a doctor. doctor:update at OWN lets a doctor edit their own profile; deactivating needs
 * doctor:delete as well, so nobody takes themselves off the booking list by accident.
 */
export async function updateDoctor(
  actor: Actor,
  doctorId: string,
  input: UpdateDoctorRequest,
  now: Date = new Date(),
): Promise<DoctorDetail> {
  const facts = await doctorRepository.findAccessFacts(actor.clinicId, doctorId)
  const resource = doctorResource(actor, doctorId, facts?.userId ?? null)
  await assertCan(actor, 'doctor:update', resource)
  const current = facts ? await doctorRepository.findById(actor.clinicId, doctorId) : null
  if (!current) throw new NotFoundError('Doctor')
  if (input.isActive !== current.isActive) await assertCan(actor, 'doctor:delete', resource)

  const [clinic, account] = await Promise.all([
    getClinicFacts(actor.clinicId),
    findUser(actor.clinicId, current.userId),
  ])
  if (!account) throw new NotFoundError('Doctor')

  const profile = await resolveProfile(
    actor.clinicId,
    input,
    clinic,
    new Set(current.specialties.map((specialty) => specialty.id)),
  )
  const updated = await doctorRepository.update(
    actor.clinicId,
    doctorId,
    { ...profile, isActive: input.isActive },
    { id: actor.userId, name: actor.displayName },
  )
  if (!updated) throw new NotFoundError('Doctor')

  const synced = await updateAccountDetails(
    actor.clinicId,
    account.id,
    {
      firstName: input.firstName,
      lastName: input.lastName,
      phone: input.phone,
      email: account.email,
    },
    now,
  )
  return toDoctorDetail(updated, synced.user, clinic.currency)
}
