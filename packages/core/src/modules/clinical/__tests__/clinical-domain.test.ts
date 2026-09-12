import { describe, expect, it } from 'vitest'
import { slugify, storageKeyFor } from '../../files'
import { canTransition, isIcd10Code, withOnePrimary } from '../domain/encounter'
import { hasContent, isEditable, noteContentHash } from '../domain/note'

const note = {
  subjective: 'Sore throat for three days.',
  objective: 'Pharynx red, no exudate.',
  assessment: 'Viral pharyngitis.',
  plan: 'Fluids, paracetamol, review if not settling.',
}
const signedAt = new Date('2026-09-13T09:00:00.000Z')

describe('the note signature', () => {
  it('is the same for the same content signed by the same person at the same moment', () => {
    expect(noteContentHash(note, 'Dr Nabil Saad', signedAt)).toBe(
      noteContentHash({ ...note }, 'Dr Nabil Saad', signedAt),
    )
  })

  it('changes when a word changes', () => {
    const edited = { ...note, assessment: 'Bacterial pharyngitis.' }
    expect(noteContentHash(edited, 'Dr Nabil Saad', signedAt)).not.toBe(
      noteContentHash(note, 'Dr Nabil Saad', signedAt),
    )
  })

  /**
   * The part that a naive "hash the concatenated text" would miss: the same sentences filed
   * under different headings are a different clinical claim.
   */
  it('changes when text moves between sections, even though the words are identical', () => {
    const moved = { ...note, objective: note.assessment, assessment: note.objective }
    expect(noteContentHash(moved, 'Dr Nabil Saad', signedAt)).not.toBe(
      noteContentHash(note, 'Dr Nabil Saad', signedAt),
    )
  })

  it('changes when someone else signs it, or when it is signed at another time', () => {
    expect(noteContentHash(note, 'Dr Other', signedAt)).not.toBe(
      noteContentHash(note, 'Dr Nabil Saad', signedAt),
    )
    expect(noteContentHash(note, 'Dr Nabil Saad', new Date('2026-09-13T09:00:01.000Z'))).not.toBe(
      noteContentHash(note, 'Dr Nabil Saad', signedAt),
    )
  })

  it('treats a null section and an empty one as the same nothing', () => {
    expect(noteContentHash({ ...note, plan: null }, 'Dr A', signedAt)).toBe(
      noteContentHash({ ...note, plan: '' }, 'Dr A', signedAt),
    )
  })
})

describe('an empty note', () => {
  it('has nothing to sign', () => {
    expect(hasContent({ subjective: null, objective: null, assessment: null, plan: null })).toBe(
      false,
    )
    expect(hasContent({ subjective: '   ', objective: '', assessment: null, plan: null })).toBe(
      false,
    )
    expect(
      hasContent({ subjective: null, objective: null, assessment: 'Viral.', plan: null }),
    ).toBe(true)
  })

  it('is editable only while it is a draft', () => {
    expect(isEditable('DRAFT')).toBe(true)
    expect(isEditable('SIGNED')).toBe(false)
  })
})

describe('the visit lifecycle', () => {
  it('ends once, and nothing follows', () => {
    expect(canTransition('OPEN', 'COMPLETED')).toBe(true)
    expect(canTransition('OPEN', 'CANCELLED')).toBe(true)
    expect(canTransition('COMPLETED', 'CANCELLED')).toBe(false)
    expect(canTransition('CANCELLED', 'COMPLETED')).toBe(false)
  })
})

describe('diagnoses', () => {
  const diagnosis = (code: string, isPrimary = false) => ({
    code,
    description: code,
    isPrimary,
    isChronic: false,
    notes: null,
  })

  it('takes the first entry as primary when nobody said', () => {
    const result = withOnePrimary([diagnosis('J06.9'), diagnosis('R50.9')])
    expect(result.map((entry) => entry.isPrimary)).toEqual([true, false])
  })

  it('keeps the one that was marked, and only that one', () => {
    const result = withOnePrimary([
      diagnosis('J06.9'),
      diagnosis('R50.9', true),
      diagnosis('E11.9', true),
    ])
    expect(result.map((entry) => entry.isPrimary)).toEqual([false, true, false])
  })

  it('has nothing to make primary in an empty list', () => {
    expect(withOnePrimary([])).toEqual([])
  })

  it('recognises an ICD-10 code, and refuses what only looks like one', () => {
    expect(isIcd10Code('J06.9')).toBe(true)
    expect(isIcd10Code('e11.9')).toBe(true)
    expect(isIcd10Code('A00')).toBe(true)
    expect(isIcd10Code('U07.1')).toBe(true)
    expect(isIcd10Code('J069')).toBe(false)
    expect(isIcd10Code('sore throat')).toBe(false)
    expect(isIcd10Code('')).toBe(false)
  })
})

describe('storage keys', () => {
  it('leads with the clinic, so a tenant is a prefix (section 12.2)', () => {
    const key = storageKeyFor({
      clinicId: 'c1',
      ownerType: 'ENCOUNTER',
      ownerId: 'enc1',
      fileId: 'f1',
      fileName: 'Chest X-Ray (final).JPG',
    })
    expect(key).toBe('clinics/c1/encounters/enc1/attachments/f1-chest-x-ray-final.jpg')
  })

  it('keeps two identical file names apart, because the id is in the name', () => {
    const one = storageKeyFor({
      clinicId: 'c1',
      ownerType: 'PATIENT',
      ownerId: 'p1',
      fileId: 'f1',
      fileName: 'scan.pdf',
    })
    const two = storageKeyFor({
      clinicId: 'c1',
      ownerType: 'PATIENT',
      ownerId: 'p2',
      fileId: 'f2',
      fileName: 'scan.pdf',
    })
    expect(one).not.toBe(two)
  })

  it('never produces an empty name, whatever it is given', () => {
    expect(slugify('...')).toBe('file')
    expect(slugify('صورة.pdf')).toBe('file.pdf')
    expect(slugify('a'.repeat(200))).toHaveLength(60)
  })
})
