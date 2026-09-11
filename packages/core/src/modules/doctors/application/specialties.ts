import type { CreateSpecialtyRequest, Specialty, UpdateSpecialtyRequest } from '@clinic/contracts'
import { NotFoundError } from '../../../errors'
import { recordAudit } from '../../audit'
import { assertCan, type Actor } from '../../access'
import { doctorRepository } from '../infrastructure/doctor.repository'
import { specialtyRepository } from '../infrastructure/specialty.repository'

export async function listSpecialties(actor: Actor): Promise<Specialty[]> {
  await assertCan(actor, 'doctor:read')
  const [specialties, counts] = await Promise.all([
    specialtyRepository.list(actor.clinicId),
    doctorRepository.countBySpecialty(actor.clinicId),
  ])
  return specialties.map((specialty) => ({
    ...specialty,
    doctorCount: counts.get(specialty.id) ?? 0,
  }))
}

export async function createSpecialty(
  actor: Actor,
  input: CreateSpecialtyRequest,
): Promise<Specialty> {
  await assertCan(actor, 'specialty:manage')
  const specialty = await specialtyRepository.create(actor.clinicId, input.name)
  return { ...specialty, doctorCount: 0 }
}

/**
 * Renames or retires a specialty. A rename refreshes the name every doctor card shows (section
 * 8.3); retiring keeps it on the doctors who have it and stops offering it for new ones.
 */
export async function updateSpecialty(
  actor: Actor,
  specialtyId: string,
  input: UpdateSpecialtyRequest,
): Promise<Specialty> {
  await assertCan(actor, 'specialty:manage')
  const [current] = await specialtyRepository.findByIds(actor.clinicId, [specialtyId])
  if (!current) throw new NotFoundError('Specialty')

  const updated = await specialtyRepository.update(actor.clinicId, specialtyId, input)
  if (!updated) throw new NotFoundError('Specialty')

  if (updated.name !== current.name) {
    const doctorsUpdated = await doctorRepository.renameSpecialty(
      actor.clinicId,
      specialtyId,
      updated.name,
    )
    // The refresh is a bulk write, which the audit middleware cannot see (section 8.15).
    await recordAudit({
      action: 'specialty.renamed',
      category: 'ADMIN',
      clinicId: actor.clinicId,
      entity: { type: 'Specialty', id: specialtyId, label: updated.name },
      metadata: { from: current.name, to: updated.name, doctorsUpdated },
    })
  }

  const counts = await doctorRepository.countBySpecialty(actor.clinicId)
  return { ...updated, doctorCount: counts.get(specialtyId) ?? 0 }
}
