import { emailKey, nameKey } from '@clinic/config'
import type { DoctorDetail, DoctorListQuery, DoctorSummary } from '@clinic/contracts'
import { NotFoundError } from '../../../errors'
import { assertCan, type Actor } from '../../access'
import { getClinicFacts } from '../../clinic'
import { displayNameOf, findAccounts, findUser, type AuthUser } from '../../identity'
import { doctorRepository, type StoredDoctor } from '../infrastructure/doctor.repository'

const iso = (date: Date | null) => (date ? date.toISOString() : null)

export function toDoctorSummary(
  doctor: StoredDoctor,
  account: AuthUser,
  currency: string,
): DoctorSummary {
  return {
    id: doctor.id,
    userId: doctor.userId,
    firstName: account.firstName,
    lastName: account.lastName,
    displayName: displayNameOf(account),
    title: doctor.title,
    email: account.email,
    phone: account.phone,
    specialties: doctor.specialties,
    consultationFee: doctor.consultationFee ? { amount: doctor.consultationFee, currency } : null,
    defaultSlotMinutes: doctor.defaultSlotMinutes,
    isAcceptingNew: doctor.isAcceptingNew,
    isActive: doctor.isActive,
    accountStatus: account.status,
  }
}

export function toDoctorDetail(
  doctor: StoredDoctor,
  account: AuthUser,
  currency: string,
): DoctorDetail {
  return {
    ...toDoctorSummary(doctor, account, currency),
    licenseNumber: doctor.licenseNumber,
    bio: doctor.bio,
    yearsOfExperience: doctor.yearsOfExperience,
    branchIds: doctor.branchIds,
    createdAt: iso(doctor.createdAt),
    updatedAt: iso(doctor.updatedAt),
  }
}

/** Name, email and licence number, matched anywhere in the word — the list is small. */
function matches(summary: DoctorSummary, licenseNumber: string | null, q: string): boolean {
  const name = nameKey(q)
  const email = emailKey(q)
  const names = [summary.firstName, summary.lastName, summary.displayName].map(nameKey)
  return (
    (name !== null && names.some((value) => value?.includes(name))) ||
    (email !== null && summary.email.startsWith(email)) ||
    (licenseNumber !== null && licenseNumber.toLowerCase().includes(q.trim().toLowerCase()))
  )
}

/**
 * The doctor directory, in name order. Doctors are few enough to read whole and search in
 * memory (section 8.6), which keeps names on the User document with no copy to drift.
 */
export async function listDoctors(actor: Actor, query: DoctorListQuery): Promise<DoctorSummary[]> {
  await assertCan(actor, 'doctor:read')
  const [doctors, clinic] = await Promise.all([
    doctorRepository.list(actor.clinicId, {
      specialtyId: query.specialtyId,
      isActive: query.status === 'all' ? undefined : query.status === 'active',
    }),
    getClinicFacts(actor.clinicId),
  ])
  const accounts = new Map(
    (
      await findAccounts(
        actor.clinicId,
        doctors.map((doctor) => doctor.userId),
      )
    ).map((account) => [account.id, account]),
  )

  return doctors
    .flatMap((doctor) => {
      const account = accounts.get(doctor.userId)
      if (!account) return []
      const summary = toDoctorSummary(doctor, account, clinic.currency)
      return !query.q || matches(summary, doctor.licenseNumber, query.q) ? [summary] : []
    })
    .sort(
      (a, b) =>
        (nameKey(a.lastName) ?? '').localeCompare(nameKey(b.lastName) ?? '') ||
        (nameKey(a.firstName) ?? '').localeCompare(nameKey(b.firstName) ?? ''),
    )
}

export async function getDoctor(actor: Actor, doctorId: string): Promise<DoctorDetail> {
  await assertCan(actor, 'doctor:read')
  const doctor = await doctorRepository.findById(actor.clinicId, doctorId)
  if (!doctor) throw new NotFoundError('Doctor')
  const [account, clinic] = await Promise.all([
    findUser(actor.clinicId, doctor.userId),
    getClinicFacts(actor.clinicId),
  ])
  if (!account) throw new NotFoundError('Doctor')
  return toDoctorDetail(doctor, account, clinic.currency)
}
