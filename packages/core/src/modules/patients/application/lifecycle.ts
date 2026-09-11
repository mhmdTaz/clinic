import { env } from '@clinic/config'
import type { PatientDetail } from '@clinic/contracts'
import { BusinessRuleError, ConflictError, NotFoundError, isDomainError } from '../../../errors'
import { runInTransaction } from '../../../transaction'
import { assertCan, findSystemRole, type Actor } from '../../access'
import { getClinicSessionInfo } from '../../clinic'
import { createAccount, findUser, tryIssueInvitation } from '../../identity'
import { patientRepository } from '../infrastructure/patient.repository'
import { getPatient } from './directory'
import { patientResource } from './scope'

/**
 * Archiving hides a record from the directory and keeps every word of it: medical records are
 * never deleted (section 8.3). Restoring brings it back unchanged.
 */
async function setArchived(actor: Actor, patientId: string, isActive: boolean) {
  const facts = await patientRepository.findAccessFacts(actor.clinicId, patientId)
  await assertCan(actor, 'patient:delete', patientResource(actor, patientId, facts?.userId ?? null))
  if (!facts) throw new NotFoundError('Patient')
  if (facts.isActive !== isActive) {
    await patientRepository.setActive(actor.clinicId, patientId, isActive, {
      id: actor.userId,
      name: actor.displayName,
    })
  }
  return getPatient(actor, patientId)
}

export function archivePatient(actor: Actor, patientId: string): Promise<PatientDetail> {
  return setArchived(actor, patientId, false)
}

export function restorePatient(actor: Actor, patientId: string): Promise<PatientDetail> {
  return setArchived(actor, patientId, true)
}

/**
 * Gives a registered patient portal access (ADR-0006): creates the account and links it in one
 * transaction, or — when an invitation is already waiting — sends a fresh link.
 */
export async function invitePatientToPortal(
  actor: Actor,
  patientId: string,
  now: Date = new Date(),
): Promise<{ patient: PatientDetail; invitationSent: boolean }> {
  const facts = await patientRepository.findAccessFacts(actor.clinicId, patientId)
  await assertCan(actor, 'patient:update', patientResource(actor, patientId, facts?.userId ?? null))
  if (!facts) throw new NotFoundError('Patient')

  const patient = await patientRepository.findById(actor.clinicId, patientId)
  if (!patient) throw new NotFoundError('Patient')
  if (!patient.isActive) {
    throw new BusinessRuleError(
      'PATIENT_ARCHIVED',
      'Restore the record before inviting the patient.',
    )
  }
  const email = patient.contact.email
  if (!email) {
    throw new BusinessRuleError(
      'EMAIL_REQUIRED_FOR_PORTAL',
      'Add an email address to the record first.',
      [{ field: 'contact.email', issue: 'EMAIL_REQUIRED_FOR_PORTAL' }],
    )
  }

  let userId = patient.userId
  if (userId) {
    const account = await findUser(actor.clinicId, userId)
    if (account && account.status !== 'INVITED') {
      throw new BusinessRuleError(
        'PORTAL_ACCOUNT_EXISTS',
        'This patient already has a portal account.',
      )
    }
  } else {
    const role = await findSystemRole(actor.clinicId, 'patient')
    if (!role) {
      throw new BusinessRuleError('PATIENT_ROLE_MISSING', 'The Patient role has not been set up.')
    }
    try {
      userId = await runInTransaction(async (tx) => {
        const account = await createAccount(
          {
            clinicId: actor.clinicId,
            email,
            firstName: patient.firstName,
            lastName: patient.lastName,
            phone: patient.contact.phone,
            roleIds: [role.id],
            assignedBy: actor.userId,
          },
          now,
          tx,
        )
        if (!(await patientRepository.linkUser(actor.clinicId, patient.id, account.id, tx))) {
          throw new ConflictError(
            'PORTAL_ACCOUNT_EXISTS',
            'This patient was given a portal account a moment ago.',
          )
        }
        return account.id
      })
    } catch (error) {
      if (isDomainError(error) && error.code === 'EMAIL_TAKEN') {
        throw new ConflictError('EMAIL_TAKEN', error.message, [
          { field: 'contact.email', issue: 'EMAIL_TAKEN' },
        ])
      }
      throw error
    }
  }

  const clinic = await getClinicSessionInfo(actor.clinicId)
  const invitationSent = await tryIssueInvitation(
    {
      clinicId: actor.clinicId,
      userId,
      invitedBy: { id: actor.userId, name: actor.displayName },
      appUrl: env().APP_URL,
      clinicName: clinic.name,
    },
    now,
  )
  return { patient: await getPatient(actor, patientId), invitationSent }
}
