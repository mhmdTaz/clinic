import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

/**
 * The printable prescription (D8, P7).
 *
 * Rendered with pdf-lib and the standard fonts, which are WinAnsi-encoded: any character outside
 * that set would throw rather than draw. Text is therefore folded to what the font can render,
 * and the Arabic pass (section 13.6) is where a Unicode font gets embedded — the alternative
 * today would be a PDF that crashes on a patient whose name is written in Arabic.
 */
function winAnsi(text: string): string {
  return [...text]
    .map((character) => (character.charCodeAt(0) <= 0xff ? character : '?'))
    .join('')
    .replace(/\?{2,}/g, '?')
}

export interface PrescriptionPdfData {
  clinicName: string
  clinicContact: string | null
  number: string
  issuedOn: string
  validUntil: string | null
  patient: { name: string; medicalRecordNo: string }
  doctor: { name: string; licenseNumber: string | null }
  notes: string | null
  items: Array<{
    drugName: string
    strength: string | null
    form: string | null
    dosage: string
    frequency: string
    durationDays: number | null
    quantity: number | null
    instructions: string | null
  }>
}

const A4 = [595.28, 841.89] as const
const MARGIN = 56
const INK = rgb(0.1, 0.1, 0.12)
const MUTED = rgb(0.42, 0.45, 0.5)

export async function renderPrescriptionPdf(data: PrescriptionPdfData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(`Prescription ${data.number}`)
  pdf.setProducer('Clinic')

  const page = pdf.addPage([A4[0], A4[1]])
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const right = A4[0] - MARGIN
  let y = A4[1] - MARGIN

  const line = (
    text: string,
    options: { size?: number; font?: typeof regular; colour?: typeof INK; gap?: number } = {},
  ) => {
    const size = options.size ?? 11
    page.drawText(winAnsi(text), {
      x: MARGIN,
      y,
      size,
      font: options.font ?? regular,
      color: options.colour ?? INK,
    })
    y -= size + (options.gap ?? 6)
  }

  const rule = (gap = 12) => {
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: right, y },
      thickness: 0.75,
      color: MUTED,
    })
    y -= gap
  }

  line(data.clinicName, { size: 18, font: bold, gap: 4 })
  if (data.clinicContact) line(data.clinicContact, { size: 10, colour: MUTED })
  y -= 6
  rule()

  line('PRESCRIPTION', { size: 13, font: bold, gap: 10 })
  line(`Reference  ${data.number}`, { size: 10, colour: MUTED, gap: 3 })
  line(`Issued  ${data.issuedOn}`, { size: 10, colour: MUTED, gap: 3 })
  if (data.validUntil) line(`Valid until  ${data.validUntil}`, { size: 10, colour: MUTED, gap: 3 })
  y -= 8

  line(`Patient  ${data.patient.name}`, { size: 11, font: bold, gap: 3 })
  line(`Record number  ${data.patient.medicalRecordNo}`, { size: 10, colour: MUTED })
  y -= 4
  rule()

  for (const [index, item] of data.items.entries()) {
    const heading = [item.drugName, item.strength, item.form].filter(Boolean).join(' · ')
    line(`${index + 1}.  ${heading}`, { size: 12, font: bold, gap: 4 })
    line(`     ${item.dosage} — ${item.frequency}`, { size: 11, gap: 3 })

    const duration = [
      item.durationDays === null ? null : `for ${item.durationDays} day(s)`,
      item.quantity === null ? null : `quantity ${item.quantity}`,
    ]
      .filter(Boolean)
      .join(', ')
    if (duration) line(`     ${duration}`, { size: 10, colour: MUTED, gap: 3 })
    if (item.instructions) line(`     ${item.instructions}`, { size: 10, colour: MUTED, gap: 3 })
    y -= 8
  }

  if (data.notes) {
    rule()
    line('Notes', { size: 11, font: bold, gap: 4 })
    for (const chunk of wrap(data.notes, 92)) line(chunk, { size: 10, gap: 3 })
  }

  // The signature block sits at the foot of the page, where a prescription is read from.
  y = MARGIN + 72
  rule(14)
  line(data.doctor.name, { size: 11, font: bold, gap: 3 })
  if (data.doctor.licenseNumber) {
    line(`Licence ${data.doctor.licenseNumber}`, { size: 10, colour: MUTED })
  }

  return pdf.save()
}

/** Crude but predictable: the standard font is monospaced enough at this size for a note. */
function wrap(text: string, width: number): string[] {
  const lines: string[] = []
  let current = ''
  for (const word of text.split(/\s+/)) {
    if ((current + ' ' + word).trim().length > width) {
      if (current) lines.push(current.trim())
      current = word
    } else {
      current = `${current} ${word}`
    }
  }
  if (current.trim()) lines.push(current.trim())
  return lines.slice(0, 12)
}
