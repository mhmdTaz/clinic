import type { FileMimeType } from '@clinic/config'

/**
 * What a file actually is, read from its first bytes (section 12.3).
 *
 * A presigned PUT does **not** enforce the content type: the header is not part of what the URL
 * signs, so a client can declare `application/pdf` and upload anything at all. Storage was tested
 * and does accept it. The declared type is therefore a claim, and this is where the claim is
 * checked — on confirm, against the bytes themselves.
 */
const SIGNATURES: ReadonlyArray<{ mime: FileMimeType; at: number; bytes: readonly number[] }> = [
  { mime: 'application/pdf', at: 0, bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  { mime: 'image/jpeg', at: 0, bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/png', at: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  // RIFF....WEBP — the four size bytes in between are part of the container, not the marker.
  { mime: 'image/webp', at: 8, bytes: [0x57, 0x45, 0x42, 0x50] },
  // ....ftypheic / ftypheix / ftypmif1, all of which are HEIF as a browser means it.
  { mime: 'image/heic', at: 4, bytes: [0x66, 0x74, 0x79, 0x70] },
]

function matches(bytes: Uint8Array, at: number, signature: readonly number[]): boolean {
  if (bytes.length < at + signature.length) return false
  return signature.every((byte, index) => bytes[at + index] === byte)
}

export function sniffMimeType(bytes: Uint8Array): FileMimeType | null {
  for (const signature of SIGNATURES) {
    if (matches(bytes, signature.at, signature.bytes)) return signature.mime
  }
  return null
}

/**
 * Whether the bytes back up the declaration.
 *
 * `text/csv` has no signature — a CSV is text, and text looks like anything — so it is accepted
 * when nothing else claims it. Everything else must be recognisable as what it says it is: a
 * declared PDF whose first bytes are not `%PDF` is not a PDF, whatever the upload said.
 */
export function bytesAgree(declared: FileMimeType, bytes: Uint8Array): boolean {
  const sniffed = sniffMimeType(bytes)
  if (declared === 'text/csv') return sniffed === null
  return sniffed === declared
}
