import { env } from '@clinic/config'
import {
  localDateIn,
  type DuplicateCandidate,
  type DuplicateCheckRequest,
  type DuplicateCheckResult,
  type PatientDetail,
  type RegisterPatientRequest,
  type UpdatePatientRequest,
} from '@clinic/contracts'
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
  ValidationError,
  isDomainError,
} from '../../../errors'
import { runInTransaction } from '../../../transaction'
import { recordAudit } from '../../audit'
import { assertCan, findSystemRole, type Actor } from '../../access'
import { getClinicSessionInfo } from '../../clinic'
import { createAccount, findUser, tryIssueInvitation, updateAccountDetails } from '../../identity'
import {
  duplicateReasons,
  matchKeys,
  uncoveredCandidates,
  type MatchInput,
} from '../domain/duplicates'
import { birthDateIssue } from '../domain/records'
import { patientRepository, type StoredPatient } from '../infrastructure/patient.repository'
import { toPatientDetail } from './directory'
import { assertClinicWidePatientRead, patientResource } from './scope'

const matchInputOf = (source: {
  firstName: string
  lastName: string
  dateOfBirth: string | null
  nationalId: string | null
  contact: { phone: string | null; email: string | null }
}): MatchInput => ({
  firstName: source.firstName,
  lastName: source.lastName,
  dateOfBirth: source.dateOfBirth,
  nationalId: source.nationalId,
  phone: source.contact.phone,
  email: source.contact.email,
})

async function candidatesFor(
  clinicId: string,
  input: MatchInput,
  excludeId: string | null,
): Promise<Array<{ patient: StoredPatient; candidate: DuplicateCandidate }>> {
  const rows = await patientRepository.findCandidates(clinicId, matchKeys(input), excludeId)
  return rows
    .map((patient) => ({ patient, reasons: duplicateReasons(input, matchInputOf(patient)) }))
    .filter(({ reasons }) => reasons.length > 0)
    .map(({ patient, reasons }) => ({
      patient,
      candidate: {
        id: patient.id,
        medicalRecordNo: patient.medicalRecordNo,
        firstName: patient.firstName,
        lastName: patient.lastName,
        dateOfBirth: patient.dateOfBirth,
        phone: patient.contact.phone,
        isActive: patient.isActive,
        reasons,
      },
    }))
}

async function assertBirthDate(actor: Actor, dateOfBirth: string | null, now: Date) {
  const clinic = await getClinicSessionInfo(actor.clinicId)
  const issue = birthDateIssue(dateOfBirth, localDateIn(clinic.timezone, now))
  if (issue) {
    throw new ValidationError('The date of birth is not valid.', [{ field: 'dateOfBirth', issue }])
  }
}

/** An account's email field is contact.email on a patient form. */
function onPatientForm(error: unknown): unknown {
  if (isDomainError(error) && error.code === 'EMAIL_TAKEN') {
    return new ConflictError('EMAIL_TAKEN', error.message, [
      { field: 'contact.email', issue: 'EMAIL_TAKEN' },
    ])
  }
  return error
}

const byActor = (actor: Actor) => ({ id: actor.userId, name: actor.displayName })

/** The warning a registration form shows before saving (ADR-0020). */
export async function checkDuplicates(
  actor: Actor,
  input: DuplicateCheckRequest,
): Promise<DuplicateCheckResult> {
  await assertClinicWidePatientRead(actor)
  const found = await candidatesFor(actor.clinicId, matchInputOf(input), input.excludePatientId)
  return { candidates: found.map(({ candidate }) => candidate) }
}

/**
 * Registers a patient (S2). The duplicate check runs again at the moment of saving, and any
 * match the override did not name refuses the save. With `inviteToPortal`, the portal account
 * and the record are written in one transaction, and the activation email goes out after it
 * commits (ADR-0006).
 */
export async function registerPatient(
  actor: Actor,
  input: RegisterPatientRequest,
  now: Date = new Date(),
): Promise<{ patient: PatientDetail; invitationSent: boolean | null }> {
  await assertCan(actor, 'patient:create')
  await assertBirthDate(actor, input.dateOfBirth, now)
  if (input.inviteToPortal && !input.contact.email) {
    throw new ValidationError('An email address is needed for portal access.', [
      { field: 'contact.email', issue: 'REQUIRED_FOR_PORTAL' },
    ])
  }

  const found = await candidatesFor(actor.clinicId, matchInputOf(input), null)
  const uncovered = uncoveredCandidates(
    found.map(({ candidate }) => candidate.id),
    input.duplicateOverride,
  )
  if (uncovered.length > 0) {
    throw new ConflictError(
      'POSSIBLE_DUPLICATE',
      'This may be a patient who is already registered.',
      [{ field: 'duplicateOverride', issue: 'POSSIBLE_DUPLICATE' }],
    )
  }

  const role = input.inviteToPortal ? await findSystemRole(actor.clinicId, 'patient') : null
  if (input.inviteToPortal && !role) {
    throw new BusinessRuleError('PATIENT_ROLE_MISSING', 'The Patient role has not been set up.')
  }

  // Allocated before the transaction: a retried attempt must not burn a second number.
  const medicalRecordNo = await patientRepository.nextMedicalRecordNo(actor.clinicId)

  let created: { patient: StoredPatient; accountId: string | null }
  try {
    created = await runInTransaction(async (tx) => {
      const account =
        input.inviteToPortal && role && input.contact.email
          ? await createAccount(
              {
                clinicId: actor.clinicId,
                email: input.contact.email,
                firstName: input.firstName,
                lastName: input.lastName,
                phone: input.contact.phone,
                roleIds: [role.id],
                assignedBy: actor.userId,
              },
              now,
              tx,
            )
          : null
      const patient = await patientRepository.create(
        {
          ...input,
          clinicId: actor.clinicId,
          medicalRecordNo,
          userId: account?.id ?? null,
          createdBy: byActor(actor),
        },
        tx,
      )
      return { patient, accountId: account?.id ?? null }
    })
  } catch (error) {
    throw onPatientForm(error)
  }

  if (input.duplicateOverride) {
    await recordAudit({
      action: 'patient.duplicate_override',
      category: 'CLINICAL',
      severity: 'NOTICE',
      clinicId: actor.clinicId,
      entity: { type: 'Patient', id: created.patient.id, label: medicalRecordNo },
      metadata: {
        reason: input.duplicateOverride.reason,
        candidates: found.map(({ candidate }) => ({
          id: candidate.id,
          medicalRecordNo: candidate.medicalRecordNo,
          reasons: candidate.reasons,
        })),
      },
    })
  }

  let invitationSent: boolean | null = null
  if (created.accountId) {
    const clinic = await getClinicSessionInfo(actor.clinicId)
    invitationSent = await tryIssueInvitation(
      {
        clinicId: actor.clinicId,
        userId: created.accountId,
        invitedBy: byActor(actor),
        appUrl: env().APP_URL,
        clinicName: clinic.name,
      },
      now,
    )
  }

  const account = created.accountId ? await findUser(actor.clinicId, created.accountId) : null
  return { patient: toPatientDetail(created.patient, account), invitationSent }
}

/**
 * Edits the record. A linked portal account follows the name and phone; its email does not, since
 * an activated account's address is its sign-in identity (ADR-0006).
 */
export async function updatePatient(
  actor: Actor,
  patientId: string,
  input: UpdatePatientRequest,
  now: Date = new Date(),
): Promise<PatientDetail> {
  const facts = await patientRepository.findAccessFacts(actor.clinicId, patientId)
  await assertCan(actor, 'patient:update', patientResource(actor, patientId, facts?.userId ?? null))
  if (!facts) throw new NotFoundError('Patient')
  await assertBirthDate(actor, input.dateOfBirth, now)

  const updated = await patientRepository.update(actor.clinicId, patientId, input, byActor(actor))
  if (!updated) throw new NotFoundError('Patient')

  let account = updated.userId ? await findUser(actor.clinicId, updated.userId) : null
  if (account) {
    const synced = await updateAccountDetails(
      actor.clinicId,
      account.id,
      {
        firstName: input.firstName,
        lastName: input.lastName,
        phone: input.contact.phone,
        email: account.email,
      },
      now,
    )
    account = synced.user
  }
  return toPatientDetail(updated, account)
}
