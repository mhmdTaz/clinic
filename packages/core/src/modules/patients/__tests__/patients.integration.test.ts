import { describe, expect, it } from 'vitest'
import { env } from '@clinic/config'
import type { RegisterPatientRequest } from '@clinic/contracts'
import { AuditLogModel, PatientModel, newId } from '@clinic/db'
import {
  createUser,
  failureDetails,
  outcome,
  signedInActor,
  uniqueEmail,
} from '../../../../test/fixtures'
import { flushAudit } from '../../audit'
import { findUser } from '../../identity'
import {
  archivePatient,
  checkDuplicates,
  getPatient,
  invitePatientToPortal,
  listPatients,
  registerPatient,
  restorePatient,
} from '../index'

const clinicId = () => env().CLINIC_ID

/** A phone number no other test uses. */
function uniquePhone(): string {
  const digits = String(Math.floor(Math.random() * 9_000_000) + 1_000_000)
  return `+961 7${digits.slice(0, 1)} ${digits.slice(1, 4)} ${digits.slice(4)}`
}

function patient(overrides: Partial<RegisterPatientRequest> = {}): RegisterPatientRequest {
  return {
    firstName: 'Omar',
    lastName: `Fakhoury${newId().slice(0, 8)}`,
    dateOfBirth: '1975-06-30',
    gender: 'MALE',
    nationalId: null,
    bloodType: 'UNKNOWN',
    contact: { phone: null, email: null },
    address: { line1: null, city: 'Beirut', country: 'LB' },
    emergencyContacts: [],
    adminNotes: null,
    duplicateOverride: null,
    inviteToPortal: false,
    ...overrides,
  }
}

async function auditCount(filter: Record<string, unknown>): Promise<number> {
  await flushAudit()
  return AuditLogModel().countDocuments({ clinicId: clinicId(), ...filter })
}

describe('registering a patient', () => {
  it('allocates a record number and records the creation', async () => {
    const { actor: staff } = await signedInActor({ role: 'staff' })
    const input = patient()
    const { patient: created, invitationSent } = await registerPatient(staff, input)

    expect(created.medicalRecordNo).toMatch(/^MRN-\d{6,}$/)
    expect(invitationSent).toBeNull()
    expect(await auditCount({ action: 'patient.created', 'entity.id': created.id })).toBe(1)
    // The same lookup the rollback test relies on, proven to find an entry when there is one.
    expect(await auditCount({ action: 'patient.created', 'after.lastName': input.lastName })).toBe(
      1,
    )
  })

  it('refuses a birth date that is still in the future in the clinic’s timezone', async () => {
    const { actor: staff } = await signedInActor({ role: 'staff' })
    expect(
      await failureDetails(registerPatient(staff, patient({ dateOfBirth: '2999-01-01' }))),
    ).toEqual([{ field: 'dateOfBirth', issue: 'IN_FUTURE' }])
  })
})

describe('possible duplicates (ADR-0020)', () => {
  it('warns about the same phone written another way, and saves only with a reason', async () => {
    const { actor: staff } = await signedInActor({ role: 'staff' })
    const phone = uniquePhone()
    const { patient: first } = await registerPatient(
      staff,
      patient({ contact: { phone, email: null } }),
    )

    const spelledDifferently = `0${phone.replace('+961 ', '').replaceAll(' ', '-')}`
    const second = patient({
      firstName: 'Rana',
      contact: { phone: spelledDifferently, email: null },
    })
    const { candidates } = await checkDuplicates(staff, { ...second, excludePatientId: null })
    expect(candidates.map((candidate) => [candidate.id, candidate.reasons])).toEqual([
      [first.id, ['PHONE']],
    ])

    expect(await outcome(registerPatient(staff, second))).toBe('POSSIBLE_DUPLICATE')

    const { patient: saved } = await registerPatient(staff, {
      ...second,
      duplicateOverride: { reason: 'Sister sharing the family phone', candidateIds: [first.id] },
    })
    expect(await auditCount({ action: 'patient.duplicate_override', 'entity.id': saved.id })).toBe(
      1,
    )
  })

  it('matches name and birth date, but never a shared name alone', async () => {
    const { actor: staff } = await signedInActor({ role: 'staff' })
    const original = patient()
    const { patient: first } = await registerPatient(staff, original)

    const twin = await checkDuplicates(staff, {
      ...original,
      firstName: original.firstName.toUpperCase(),
      excludePatientId: null,
    })
    expect(twin.candidates.map((candidate) => candidate.id)).toEqual([first.id])

    const namesake = await checkDuplicates(staff, {
      ...original,
      dateOfBirth: '1980-01-01',
      excludePatientId: null,
    })
    expect(namesake.candidates).toEqual([])
  })
})

describe('portal access (ADR-0006)', () => {
  it('creates the account and the record together, or neither', async () => {
    const { actor: staff } = await signedInActor({ role: 'staff' })
    const taken = await createUser({ role: 'patient' })
    const input = patient({ contact: { phone: null, email: taken.email }, inviteToPortal: true })

    expect(await failureDetails(registerPatient(staff, input))).toEqual([
      { field: 'contact.email', issue: 'EMAIL_TAKEN' },
    ])
    // The transaction rolled back: no record, and no audit entry for a record that never existed.
    expect(
      await PatientModel().countDocuments({ clinicId: clinicId(), lastName: input.lastName }),
    ).toBe(0)
    expect(await auditCount({ action: 'patient.created', 'after.lastName': input.lastName })).toBe(
      0,
    )
  })

  it('invites a registered patient, linking an account that holds the Patient role', async () => {
    const { actor: staff } = await signedInActor({ role: 'staff' })
    const { patient: created } = await registerPatient(
      staff,
      patient({ contact: { phone: null, email: uniqueEmail('portal') } }),
    )

    const { patient: invited, invitationSent } = await invitePatientToPortal(staff, created.id)
    expect(invitationSent).toBe(true)
    expect(invited.portalAccount?.status).toBe('INVITED')

    const account = await findUser(clinicId(), invited.portalAccount?.userId ?? '')
    expect(account?.firstName).toBe(created.firstName)
  })
})

describe('who can see which record', () => {
  it('shows a patient their own record and nobody else’s — and a refusal is not a view', async () => {
    const { actor: staff } = await signedInActor({ role: 'staff' })
    const { actor: portalUser } = await signedInActor({ role: 'patient' })
    const { patient: own } = await registerPatient(staff, patient())
    const { patient: other } = await registerPatient(staff, patient())
    await PatientModel().updateOne(
      { clinicId: clinicId(), _id: own.id },
      { $set: { userId: portalUser.userId } },
    )

    const mine = await listPatients(portalUser, { status: 'active', limit: 25 })
    expect(mine.items.map((item) => item.id)).toEqual([own.id])
    expect((await getPatient(portalUser, own.id)).id).toBe(own.id)

    expect(await outcome(getPatient(portalUser, other.id))).toBe('FORBIDDEN')
    expect(
      await auditCount({
        action: 'patient.viewed',
        'entity.id': other.id,
        'actor.id': portalUser.userId,
      }),
    ).toBe(0)
  })

  it('refuses the ASSIGNED scope until ADR-0004 decides what it means', async () => {
    const { actor: doctor } = await signedInActor({ role: 'doctor' })
    expect(await outcome(listPatients(doctor, { status: 'active', limit: 25 }))).toBe('FORBIDDEN')
  })
})

describe('archiving', () => {
  it('moves a record out of the directory without losing it, and back', async () => {
    const { actor: staff } = await signedInActor({ role: 'staff' })
    const { patient: created } = await registerPatient(staff, patient())
    const byNumber = { q: created.medicalRecordNo, limit: 25 } as const

    await archivePatient(staff, created.id)
    expect((await listPatients(staff, { ...byNumber, status: 'active' })).items).toEqual([])
    expect(
      (await listPatients(staff, { ...byNumber, status: 'archived' })).items.map((item) => item.id),
    ).toEqual([created.id])

    const restored = await restorePatient(staff, created.id)
    expect(restored.isActive).toBe(true)
  })
})
