import { createHash } from 'node:crypto'
import type { NoteStatus } from '@clinic/config'

/**
 * The clinical note (D9, ADR-0024).
 *
 * A note is a draft the doctor owns until they sign it. After that it is evidence: the content
 * never changes again, and a correction is an addendum appended beneath it. This is not a
 * preference about tidiness — a medical record that can be edited after the fact cannot be used
 * to defend the care it describes.
 */
export interface NoteContent {
  subjective: string | null
  objective: string | null
  assessment: string | null
  plan: string | null
}

export const NOTE_SECTIONS = ['subjective', 'objective', 'assessment', 'plan'] as const

/**
 * The fingerprint stored at signing (section 11.5). Sections are hashed in a fixed order with
 * their names, so moving text from one section to another changes the hash: a signature is a
 * claim about *this* content in *these* places, not about a bag of words.
 */
export function noteContentHash(note: NoteContent, signedBy: string, signedAt: Date): string {
  const canonical = JSON.stringify({
    sections: NOTE_SECTIONS.map((section) => [section, note[section] ?? '']),
    signedBy,
    signedAt: signedAt.toISOString(),
  })
  return createHash('sha256').update(canonical).digest('hex')
}

/** A note with nothing in it is not a note. Signing one would be a signature on a blank page. */
export function hasContent(note: NoteContent): boolean {
  return NOTE_SECTIONS.some((section) => (note[section] ?? '').trim().length > 0)
}

export function isSigned(status: NoteStatus): boolean {
  return status === 'SIGNED'
}

/**
 * Whether the note's content may still be written. Deliberately a question about the note and
 * not about the actor: a signed note is closed to its own author too.
 */
export function isEditable(status: NoteStatus): boolean {
  return status === 'DRAFT'
}
