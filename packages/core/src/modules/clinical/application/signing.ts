import type { AddendumRequest, EncounterDetail, SignNoteRequest } from '@clinic/contracts'
import { BusinessRuleError, NotFoundError } from '../../../errors'
import { recordAudit } from '../../audit'
import { assertCan, type Actor } from '../../access'
import { hasContent, noteContentHash } from '../domain/note'
import { encounterRepository } from '../infrastructure/encounter.repository'
import { toEncounterDetail } from './directory'
import { encounterResource } from './scope'

/**
 * Signing and its only sequel (D9, ADR-0024).
 *
 * After this, the note's text is closed to everyone, including the person who wrote it. A
 * correction is an addendum appended beneath the signature — the original stays legible, because
 * a record that can be quietly rewritten cannot defend the care it describes.
 */

async function loadForSigning(actor: Actor, encounterId: string) {
  const facts = await encounterRepository.findAccessFacts(actor.clinicId, encounterId)
  if (!facts) throw new NotFoundError('Encounter')
  await assertCan(
    actor,
    'encounter:sign',
    encounterResource(actor, {
      id: facts.id,
      patientId: facts.patientId,
      doctorId: facts.doctorId,
    }),
  )
  return facts
}

export async function signNote(
  actor: Actor,
  encounterId: string,
  input: SignNoteRequest,
  now: Date = new Date(),
): Promise<EncounterDetail> {
  const facts = await loadForSigning(actor, encounterId)
  if (facts.noteStatus === 'SIGNED') {
    throw new BusinessRuleError('NOTE_ALREADY_SIGNED', 'This note has already been signed.')
  }

  // Read the content that is about to be frozen, so the hash is of what was actually signed.
  const encounter = await encounterRepository.findById(actor.clinicId, encounterId)
  if (!encounter) throw new NotFoundError('Encounter')
  if (!hasContent(encounter.note)) {
    throw new BusinessRuleError('NOTE_IS_EMPTY', 'There is nothing in this note to sign.')
  }

  const signedBy = { id: actor.userId, name: input.signature.trim() }
  const signed = await encounterRepository.sign(actor.clinicId, encounterId, {
    signedAt: now,
    signedBy,
    signatureHash: noteContentHash(encounter.note, signedBy.name, now),
  })
  // The filter carried the precondition, so a null here is someone else's signature landing
  // first — not a lost update (section 8.15).
  if (!signed) {
    throw new BusinessRuleError('NOTE_ALREADY_SIGNED', 'This note has already been signed.')
  }

  await recordAudit({
    action: 'encounter.note_signed',
    category: 'CLINICAL',
    severity: 'NOTICE',
    clinicId: actor.clinicId,
    entity: { type: 'Encounter', id: encounterId },
    metadata: {
      number: signed.number,
      patientId: signed.patientId,
      signatureHash: signed.note.signatureHash,
    },
  })

  return toEncounterDetail(signed, { includeNote: true })
}

/**
 * The only way to change a signed record. A `$push` cannot reach the content above it, so
 * append-only is a property of the write rather than a rule someone has to remember.
 */
export async function addAddendum(
  actor: Actor,
  encounterId: string,
  input: AddendumRequest,
): Promise<EncounterDetail> {
  const facts = await loadForSigning(actor, encounterId)
  if (facts.noteStatus !== 'SIGNED') {
    throw new BusinessRuleError(
      'NOTE_NOT_SIGNED',
      'A draft is still editable — an addendum belongs to a signed note.',
    )
  }

  const updated = await encounterRepository.addAddendum(actor.clinicId, encounterId, {
    body: input.body,
    author: { id: actor.userId, name: actor.displayName },
  })
  if (!updated) throw new NotFoundError('Encounter')

  await recordAudit({
    action: 'encounter.addendum_added',
    category: 'CLINICAL',
    severity: 'NOTICE',
    clinicId: actor.clinicId,
    entity: { type: 'Encounter', id: encounterId },
    metadata: { number: updated.number, patientId: updated.patientId },
  })

  return toEncounterDetail(updated, { includeNote: true })
}

/**
 * Whether a signed note still matches what was signed (section 11.5). Nothing in the application
 * can rewrite it, so a mismatch means the database was edited underneath us — which is exactly
 * the question tamper evidence exists to answer.
 */
export async function verifyNoteSignature(
  actor: Actor,
  encounterId: string,
): Promise<{ signed: boolean; intact: boolean }> {
  const facts = await loadForSigning(actor, encounterId)
  if (facts.noteStatus !== 'SIGNED') return { signed: false, intact: true }

  const encounter = await encounterRepository.findById(actor.clinicId, encounterId)
  if (!encounter?.note.signedAt || !encounter.note.signedBy) {
    return { signed: false, intact: false }
  }
  const expected = noteContentHash(
    encounter.note,
    encounter.note.signedBy.name,
    encounter.note.signedAt,
  )
  return { signed: true, intact: expected === encounter.note.signatureHash }
}
