import type { DentalScope, DentalSymbol, ToothRecordStatus, ToothSurface } from '@clinic/contracts'

/**
 * Voice charting's parser (Phase 13, ADR-0037): what the dentist said, as a **draft** for the
 * charting form — never a record. "Sixteen MOD composite done" becomes tooth 16, surfaces M, O and
 * D, the composite filling, status completed; somebody reads it and presses save, or does not.
 *
 * It is forgiving about how a browser's speech service writes numbers and letters down — "16",
 * "sixteen", "one six", "M O D", "mod", "mesial occlusal distal" — and strict about what it is
 * unsure of: no tooth or no treatment means no draft, and two treatments that fit equally well
 * (a "crown", with two crowns on the list) are offered, not guessed.
 */

export interface VoiceTreatment {
  id: string
  code: string
  name: string
  symbol: DentalSymbol
  scope: DentalScope
  isActive: boolean
}

export interface VoiceDraft {
  fdi: string
  surfaces: ToothSurface[]
  treatmentId: string
  /** Null when nothing was said: the form's own default for the treatment applies. */
  status: ToothRecordStatus | null
  /** Other treatments that fit as well as the chosen one — the form points them out. */
  alternatives: string[]
  transcript: string
}

export type VoiceParse =
  | { ok: true; draft: VoiceDraft }
  | { ok: false; reason: 'NO_TOOTH' | 'NO_TREATMENT'; transcript: string }

const UNITS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  // What a speech engine writes for "two" and "four" more often than one would like.
  to: 2,
  too: 2,
  for: 4,
}
const TEENS: Record<string, number> = {
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
}
const TENS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
}

const isTooth = (value: string) => /^([1-4][1-8]|[5-8][1-5])$/.test(value)

/** Front teeth: incisors and canines, permanent and primary. They have an incisal edge, not an occlusal surface. */
const isFront = (fdi: string) => Number(fdi[1]) <= 3

const SURFACE_WORDS: Record<string, ToothSurface> = {
  mesial: 'M',
  distal: 'D',
  occlusal: 'O',
  incisal: 'I',
  buccal: 'B',
  facial: 'B',
  labial: 'B',
  lingual: 'L',
  palatal: 'L',
}
const SURFACE_LETTERS: Record<string, ToothSurface> = {
  m: 'M',
  d: 'D',
  o: 'O',
  i: 'I',
  b: 'B',
  f: 'B',
  l: 'L',
  p: 'L',
}

const STATUS_WORDS: Record<string, ToothRecordStatus> = {
  done: 'COMPLETED',
  completed: 'COMPLETED',
  complete: 'COMPLETED',
  finished: 'COMPLETED',
  placed: 'COMPLETED',
  planned: 'PLANNED',
  plan: 'PLANNED',
  planning: 'PLANNED',
  needs: 'PLANNED',
  todo: 'PLANNED',
  existing: 'EXISTING',
  old: 'EXISTING',
  previous: 'EXISTING',
  found: 'CONDITION',
  finding: 'CONDITION',
  noted: 'CONDITION',
  condition: 'CONDITION',
}

/** Everyday words for what each symbol draws, beyond the treatment's own name. */
const SYMBOL_WORDS: Record<DentalSymbol, readonly string[]> = {
  FILLING: ['filling', 'filled', 'restoration', 'composite', 'resin', 'amalgam'],
  CROWN: ['crown', 'cap'],
  ROOT_CANAL: ['root', 'canal', 'rct', 'endo', 'endodontic'],
  EXTRACTION: ['extraction', 'extract', 'extracted', 'pull', 'pulled', 'removal'],
  IMPLANT: ['implant'],
  BRIDGE: ['bridge'],
  DENTURE: ['denture', 'dentures'],
  VENEER: ['veneer'],
  SEALANT: ['sealant', 'sealed', 'seal', 'fissure'],
  CARIES: ['caries', 'decay', 'cavity', 'carious'],
  FRACTURE: ['fracture', 'fractured', 'broken', 'chipped', 'cracked'],
  MISSING: ['missing', 'absent'],
  IMPACTED: ['impacted'],
  OTHER: [],
}

/** Words in a treatment's name that say nothing about which treatment it is. */
const FILLER = new Set(['treatment', 'tooth', 'teeth', 'the', 'a', 'of', 'to', 'and', 'on'])

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

/** The first tooth said, and where it ended — "16", "sixteen", "one six", "twenty four". */
function findTooth(words: readonly string[]): { fdi: string; end: number } | null {
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i]!
    const next = words[i + 1]
    if (isTooth(word)) return { fdi: word, end: i + 1 }
    if (TEENS[word] && isTooth(String(TEENS[word]))) return { fdi: String(TEENS[word]), end: i + 1 }
    if (TENS[word] && next && UNITS[next]) {
      const value = String(TENS[word] + UNITS[next])
      if (isTooth(value)) return { fdi: value, end: i + 2 }
    }
    // "One six", or "1 6": a digit at a time. "To" and "for" count as digits only beside a real
    // one, so "planned for six weeks" is not tooth 46.
    const digit = (value: string | undefined) =>
      value === undefined ? null : /^[1-8]$/.test(value) ? Number(value) : (UNITS[value] ?? null)
    const loose = (value: string) => value === 'to' || value === 'too' || value === 'for'
    const first = digit(word)
    const second = digit(next)
    if (first !== null && second !== null && !(loose(word) && loose(next!))) {
      const trusted = !loose(word) || /^[1-8]$/.test(next!)
      const value = `${first}${second}`
      if (trusted && isTooth(value)) return { fdi: value, end: i + 2 }
    }
  }
  return null
}

/**
 * Surfaces said right after the tooth, or named in full anywhere: "MOD", "M O D", "mesial
 * occlusal". A run of letters counts only next to the tooth, where "do" and "I" cannot be words.
 */
function findSurfaces(words: readonly string[], from: number, fdi: string): ToothSurface[] {
  const found: ToothSurface[] = []
  const add = (surface: ToothSurface) => {
    const adjusted = isFront(fdi)
      ? surface === 'O'
        ? 'I'
        : surface
      : surface === 'I'
        ? 'O'
        : surface
    if (!found.includes(adjusted)) found.push(adjusted)
  }
  for (let i = from; i < words.length; i += 1) {
    const word = words[i]!
    const letters = word.split('')
    if (
      word.length <= 5 &&
      letters.every((letter) => SURFACE_LETTERS[letter]) &&
      new Set(letters).size === letters.length &&
      !SYMBOL_WORDS.FILLING.includes(word)
    ) {
      letters.forEach((letter) => add(SURFACE_LETTERS[letter]!))
      continue
    }
    break
  }
  for (const word of words) if (SURFACE_WORDS[word]) add(SURFACE_WORDS[word])
  return found
}

function findStatus(words: readonly string[]): ToothRecordStatus | null {
  for (let i = words.length - 1; i >= 0; i -= 1) {
    const word = words[i]!
    if (word === 'do' && words[i - 1] === 'to') return 'PLANNED'
    if (STATUS_WORDS[word]) return STATUS_WORDS[word]
  }
  return null
}

/**
 * The treatment whose words were said most. A word of its own name counts twice — "composite"
 * picks the composite over the amalgam — and an everyday word for what it draws counts once, so
 * "decay" still finds Caries. Ties are kept, and the first on the clinic's list is proposed.
 */
function findTreatment(
  words: readonly string[],
  treatments: readonly VoiceTreatment[],
): { chosen: VoiceTreatment; alternatives: VoiceTreatment[] } | null {
  const said = new Set(words)
  const scored = treatments
    .filter((treatment) => treatment.isActive)
    .map((treatment) => {
      const own = tokens(treatment.name).filter((word) => !FILLER.has(word))
      const score =
        own.filter((word) => said.has(word)).length * 2 +
        SYMBOL_WORDS[treatment.symbol].filter((word) => said.has(word)).length
      return { treatment, score }
    })
    .filter((entry) => entry.score > 0)
  if (scored.length === 0) return null
  const best = Math.max(...scored.map((entry) => entry.score))
  const top = scored.filter((entry) => entry.score === best).map((entry) => entry.treatment)
  return { chosen: top[0]!, alternatives: top.slice(1) }
}

export function parseVoiceCharting(
  transcript: string,
  treatments: readonly VoiceTreatment[],
): VoiceParse {
  const words = tokens(transcript)
  const tooth = findTooth(words)
  if (!tooth) return { ok: false, reason: 'NO_TOOTH', transcript }
  const rest = [...words.slice(0, tooth.end - 1), ...words.slice(tooth.end)]
  const treatment = findTreatment(rest, treatments)
  if (!treatment) return { ok: false, reason: 'NO_TREATMENT', transcript }

  const surfaces =
    treatment.chosen.scope === 'SURFACE' ? findSurfaces(words, tooth.end, tooth.fdi) : []
  return {
    ok: true,
    draft: {
      fdi: tooth.fdi,
      surfaces,
      treatmentId: treatment.chosen.id,
      status: findStatus(rest),
      alternatives: treatment.alternatives.map((entry) => entry.name),
      transcript,
    },
  }
}
