/**
 * Text folded to what pdf-lib's standard fonts can actually draw.
 *
 * The standard fonts are WinAnsi (CP1252) encoded, and pdf-lib throws rather than substitutes
 * when asked to draw a character outside that set — so a patient whose name is written in Arabic
 * would crash the render rather than produce an imperfect PDF. Everything printable is passed
 * through and everything else becomes a question mark, runs of them collapsed.
 *
 * The subtlety is that WinAnsi is **not** Latin-1. Twenty-seven characters sit in CP1252's
 * 0x80-0x9F range whose Unicode code points are far above 0xFF — the em dash, the curly quotes,
 * the euro sign, the ellipsis. A naive `charCodeAt() <= 0xff` test rejects all of them, which
 * turns every em dash in a document into "?". They are listed here because the font can draw
 * them and a dash is not an encoding error.
 *
 * Section 13.6 is where a Unicode font gets embedded and this stops being necessary.
 */
const WIN_ANSI_ABOVE_LATIN1 = new Set([
  '€', // €
  '‚', // ‚
  'ƒ', // ƒ
  '„', // „
  '…', // …
  '†', // †
  '‡', // ‡
  'ˆ', // ˆ
  '‰', // ‰
  'Š', // Š
  '‹', // ‹
  'Œ', // Œ
  'Ž', // Ž
  '‘', // '
  '’', // '
  '“', // "
  '”', // "
  '•', // •
  '–', // –
  '—', // —
  '˜', // ˜
  '™', // ™
  'š', // š
  '›', // ›
  'œ', // œ
  'ž', // ž
  'Ÿ', // Ÿ
])

export function winAnsi(text: string): string {
  return [...text]
    .map((character) =>
      character.charCodeAt(0) <= 0xff || WIN_ANSI_ABOVE_LATIN1.has(character) ? character : '?',
    )
    .join('')
    .replace(/\?{2,}/g, '?')
}

/** Crude but predictable: the standard font is even enough at document sizes for a note. */
export function wrapText(text: string, width: number, maxLines: number): string[] {
  const lines: string[] = []
  let current = ''
  for (const word of text.split(/\s+/)) {
    if (`${current} ${word}`.trim().length > width) {
      if (current) lines.push(current.trim())
      current = word
    } else {
      current = `${current} ${word}`
    }
  }
  if (current.trim()) lines.push(current.trim())
  return lines.slice(0, maxLines)
}
