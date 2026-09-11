import { describe, expect, it } from 'vitest'
import { env } from '@clinic/config'
import type { CreateDoctorRequest } from '@clinic/contracts'
import { AuditLogModel, DoctorModel, newId } from '@clinic/db'
import {
  createUser,
  failureDetails,
  outcome,
  roleIdOf,
  signedInActor,
  uniqueEmail,
} from '../../../../test/fixtures'
import type { Actor } from '../../access'
import { flushAudit } from '../../audit'
import { getClinicSettings } from '../../clinic'
import { findUser } from '../../identity'
import {
  createDoctor,
  createSpecialty,
  getDoctor,
  normalizeAmount,
  updateDoctor,
  updateSpecialty,
} from '../index'

const clinicId = () => env().CLINIC_ID

/** Other suites may add branches; a doctor needs branches only once there are several open. */
async function openBranchIds(actor: Actor): Promise<string[]> {
  const settings = await getClinicSettings(actor)
  const open = settings.branches.filter((branch) => branch.isActive).map((branch) => branch.id)
  return open.length > 1 ? open.slice(0, 1) : []
}

async function doctorInput(
  actor: Actor,
  overrides: Partial<CreateDoctorRequest> = {},
): Promise<CreateDoctorRequest> {
  return {
    firstName: 'Nour',
    lastName: `Saliba${newId().slice(0, 8)}`,
    email: uniqueEmail('doctor'),
    phone: null,
    title: 'Dr',
    licenseNumber: 'LB-MD-1001',
    specialtyIds: [],
    consultationFee: null,
    defaultSlotMinutes: 30,
    yearsOfExperience: 9,
    bio: null,
    isAcceptingNew: true,
    branchIds: await openBranchIds(actor),
    ...overrides,
  }
}

describe('specialties', () => {
  it('treats names that differ only in case or accents as one specialty', async () => {
    const { actor: staff } = await signedInActor({ role: 'staff' })
    const suffix = newId().slice(0, 6)
    await createSpecialty(staff, { name: `Pédiatrie ${suffix}` })
    expect(await outcome(createSpecialty(staff, { name: `PEDIATRIE ${suffix}` }))).toBe(
      'SPECIALTY_EXISTS',
    )
  })
})

describe('onboarding a doctor', () => {
  it('creates the account with the Doctor role and the profile, with the fee to the cent', async () => {
    const { actor: staff } = await signedInActor({ role: 'staff' })
    const specialty = await createSpecialty(staff, { name: `Cardiology ${newId().slice(0, 6)}` })
    const settings = await getClinicSettings(staff)

    const { doctor, invitationSent } = await createDoctor(
      staff,
      await doctorInput(staff, { specialtyIds: [specialty.id], consultationFee: '45' }),
    )

    expect(invitationSent).toBe(true)
    expect(doctor.accountStatus).toBe('INVITED')
    expect(doctor.specialties).toEqual([{ id: specialty.id, name: specialty.name }])
    expect(doctor.consultationFee).toEqual({
      amount: normalizeAmount('45', settings.currency),
      currency: settings.currency,
    })

    const account = await findUser(clinicId(), doctor.userId)
    expect(account?.roleIds).toEqual([await roleIdOf('doctor')])
  })

  it('refuses a fee with more decimals than any currency has', async () => {
    const { actor: staff } = await signedInActor({ role: 'staff' })
    expect(
      await failureDetails(
        createDoctor(staff, await doctorInput(staff, { consultationFee: '45.0005' })),
      ),
    ).toEqual([{ field: 'consultationFee', issue: 'TOO_MANY_DECIMALS' }])
  })

  it('writes the account and the profile together, or neither', async () => {
    const { actor: staff } = await signedInActor({ role: 'staff' })
    const taken = await createUser({ role: 'staff' })
    const input = await doctorInput(staff, { email: taken.email })

    expect(await outcome(createDoctor(staff, input))).toBe('EMAIL_TAKEN')
    expect(
      await DoctorModel().countDocuments({
        clinicId: clinicId(),
        licenseNumber: input.licenseNumber,
        'createdBy.id': staff.userId,
      }),
    ).toBe(0)
  })
})

describe('renaming a specialty', () => {
  it('refreshes the name on every doctor card, and records the bulk refresh', async () => {
    const { actor: staff } = await signedInActor({ role: 'staff' })
    const specialty = await createSpecialty(staff, { name: `Dermatology ${newId().slice(0, 6)}` })
    const { doctor } = await createDoctor(
      staff,
      await doctorInput(staff, { specialtyIds: [specialty.id] }),
    )

    const renamed = `Skin clinic ${newId().slice(0, 6)}`
    await updateSpecialty(staff, specialty.id, { name: renamed, isActive: true })

    expect((await getDoctor(staff, doctor.id)).specialties).toEqual([
      { id: specialty.id, name: renamed },
    ])
    await flushAudit()
    expect(
      await AuditLogModel().countDocuments({
        clinicId: clinicId(),
        action: 'specialty.renamed',
        'entity.id': specialty.id,
      }),
    ).toBe(1)
  })
})

describe('a doctor editing their own profile', () => {
  it('may change their details, but not take themselves off the list', async () => {
    const { actor: staff } = await signedInActor({ role: 'staff' })
    const { actor: self, user } = await signedInActor({ role: 'doctor' })
    const profile = await DoctorModel().create({
      _id: newId(),
      clinicId: clinicId(),
      userId: user.id,
      title: 'Dr',
      defaultSlotMinutes: 20,
      deletedAt: null,
    })

    const edit = {
      ...(await doctorInput(staff)),
      firstName: 'Nabil',
      lastName: 'Saad',
      bio: 'Family medicine, twelve years.',
      isActive: true,
    }
    const updated = await updateDoctor(self, profile._id, edit)
    expect(updated.bio).toBe('Family medicine, twelve years.')

    expect(await outcome(updateDoctor(self, profile._id, { ...edit, isActive: false }))).toBe(
      'FORBIDDEN',
    )
    expect(await outcome(updateDoctor(staff, profile._id, { ...edit, isActive: false }))).toBe(
      'RESOLVED',
    )
  })
})
