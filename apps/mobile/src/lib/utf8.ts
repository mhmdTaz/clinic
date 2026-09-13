/**
 * UTF-8 to bytes and back, for the offline vault.
 *
 * Written out rather than taken from `TextEncoder`/`TextDecoder` because the vault must work on
 * every engine the app runs on, and a decoder that is missing on one of them fails at the worst
 * moment: launching with no signal, which is the only time the vault is needed. Patient names are
 * not ASCII — "Karam" is, "كرم" is not — so this is tested with both.
 */

export function encodeUtf8(text: string): Uint8Array {
  const bytes: number[] = []
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0
    if (code < 0x80) {
      bytes.push(code)
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      )
    }
  }
  return Uint8Array.from(bytes)
}

export function decodeUtf8(bytes: Uint8Array): string {
  let text = ''
  let index = 0
  while (index < bytes.length) {
    const first = bytes[index] ?? 0
    const next = (offset: number) => (bytes[index + offset] ?? 0) & 0x3f
    let code: number
    if (first < 0x80) {
      code = first
      index += 1
    } else if (first < 0xe0) {
      code = ((first & 0x1f) << 6) | next(1)
      index += 2
    } else if (first < 0xf0) {
      code = ((first & 0x0f) << 12) | (next(1) << 6) | next(2)
      index += 3
    } else {
      code = ((first & 0x07) << 18) | (next(1) << 12) | (next(2) << 6) | next(3)
      index += 4
    }
    text += String.fromCodePoint(code)
  }
  return text
}
