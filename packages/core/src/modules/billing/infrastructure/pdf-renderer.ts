import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { isZeroAmount } from '@clinic/contracts'
import { winAnsi, wrapText } from '../../../pdf-text'

/**
 * The printable invoice and the printable receipt (S7, S8, P8).
 *
 * Money is drawn right-aligned against the same margin on every row, because a column of figures
 * that does not line up is a column nobody can add up by eye — which is the one thing a printed
 * invoice is for. Text is folded to what the standard fonts can draw (see pdf-text).
 */

export interface Letterhead {
  name: string
  legalName: string | null
  taxId: string | null
  addressLines: string[]
  contact: string | null
}

export interface InvoicePdfData {
  clinic: Letterhead
  number: string
  status: string
  issuedOn: string | null
  dueOn: string | null
  currency: string
  patient: { name: string; medicalRecordNo: string }
  lines: Array<{
    description: string
    quantity: string
    unitPrice: string
    discount: string
    taxRatePercent: string
    lineTotal: string
  }>
  subtotal: string
  discountTotal: string
  taxTotal: string
  total: string
  amountPaid: string
  balanceDue: string
  notes: string | null
}

export interface ReceiptPdfData {
  clinic: Letterhead
  number: string
  receivedOn: string
  currency: string
  patient: { name: string; medicalRecordNo: string }
  amount: string
  refundedAmount: string
  method: string
  reference: string | null
  allocations: Array<{ invoiceNumber: string | null; amount: string }>
  receivedBy: string | null
}

const A4 = [595.28, 841.89] as const
const MARGIN = 56
const INK = rgb(0.1, 0.1, 0.12)
const MUTED = rgb(0.42, 0.45, 0.5)
const RIGHT = A4[0] - MARGIN

/** The columns a line item is laid out on, as x offsets from the left margin. */
const COLUMN = { description: 0, quantity: 268, unitPrice: 330, tax: 410 } as const

interface Painter {
  line: (text: string, options?: TextOptions) => void
  at: (x: number, text: string, options?: TextOptions) => void
  rightAligned: (text: string, options?: TextOptions) => void
  rule: (gap?: number) => void
  down: (amount: number) => void
  moveTo: (y: number) => void
}

interface TextOptions {
  size?: number
  bold?: boolean
  muted?: boolean
  /** Vertical space after the line; pass 0 to draw the next cell on the same row. */
  gap?: number
}

async function painterFor(pdf: PDFDocument): Promise<Painter> {
  const page = pdf.addPage([A4[0], A4[1]])
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  let y = A4[1] - MARGIN

  const draw = (x: number, text: string, options: TextOptions = {}) => {
    const size = options.size ?? 10
    page.drawText(winAnsi(text), {
      x,
      y,
      size,
      font: options.bold ? bold : regular,
      color: options.muted ? MUTED : INK,
    })
    if (options.gap !== 0) y -= size + (options.gap ?? 6)
  }

  const paint: Painter = {
    line: (text, options) => draw(MARGIN, text, options),
    at: (x, text, options) => draw(MARGIN + x, text, { gap: 0, ...options }),
    rightAligned: (text, options) => {
      const size = options?.size ?? 10
      const font = options?.bold ? bold : regular
      const width = font.widthOfTextAtSize(winAnsi(text), size)
      draw(RIGHT - width, text, options)
    },
    rule: (gap = 12) => {
      page.drawLine({
        start: { x: MARGIN, y },
        end: { x: RIGHT, y },
        thickness: 0.75,
        color: MUTED,
      })
      y -= gap
    },
    down: (amount) => {
      y -= amount
    },
    moveTo: (next) => {
      y = next
    },
  }

  return paint
}

function letterhead(paint: Painter, clinic: Letterhead): void {
  paint.line(clinic.name, { size: 18, bold: true, gap: 4 })
  if (clinic.legalName && clinic.legalName !== clinic.name) {
    paint.line(clinic.legalName, { size: 10, muted: true, gap: 3 })
  }
  for (const address of clinic.addressLines) paint.line(address, { size: 10, muted: true, gap: 3 })
  if (clinic.contact) paint.line(clinic.contact, { size: 10, muted: true, gap: 3 })
  if (clinic.taxId) paint.line(`Tax ID  ${clinic.taxId}`, { size: 10, muted: true, gap: 3 })
  paint.down(8)
  paint.rule()
}

export async function renderInvoicePdf(data: InvoicePdfData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(`Invoice ${data.number}`)
  pdf.setProducer('Clinic')
  const paint = await painterFor(pdf)

  letterhead(paint, data.clinic)

  paint.line(data.status === 'VOID' ? 'INVOICE — VOID' : 'INVOICE', {
    size: 13,
    bold: true,
    gap: 10,
  })
  paint.line(`Number  ${data.number}`, { size: 10, muted: true, gap: 3 })
  if (data.issuedOn) paint.line(`Issued  ${data.issuedOn}`, { size: 10, muted: true, gap: 3 })
  if (data.dueOn) paint.line(`Due  ${data.dueOn}`, { size: 10, muted: true, gap: 3 })
  paint.down(8)

  paint.line(`Billed to  ${data.patient.name}`, { size: 11, bold: true, gap: 3 })
  paint.line(`Record number  ${data.patient.medicalRecordNo}`, { size: 10, muted: true })
  paint.down(6)
  paint.rule(10)

  paint.at(COLUMN.description, 'Description', { size: 9, bold: true, muted: true })
  paint.at(COLUMN.quantity, 'Qty', { size: 9, bold: true, muted: true })
  paint.at(COLUMN.unitPrice, 'Unit', { size: 9, bold: true, muted: true })
  paint.at(COLUMN.tax, 'Tax', { size: 9, bold: true, muted: true })
  paint.rightAligned('Amount', { size: 9, bold: true, muted: true, gap: 8 })
  paint.rule(10)

  for (const item of data.lines) {
    paint.at(COLUMN.description, truncate(item.description, 44), { size: 10 })
    paint.at(COLUMN.quantity, item.quantity, { size: 10 })
    paint.at(COLUMN.unitPrice, item.unitPrice, { size: 10 })
    paint.at(COLUMN.tax, `${item.taxRatePercent}%`, { size: 10 })
    paint.rightAligned(item.lineTotal, { size: 10, gap: 5 })
    if (!isZeroAmount(item.discount)) {
      paint.line(`     less discount ${item.discount}`, { size: 9, muted: true, gap: 5 })
    }
  }

  paint.down(4)
  paint.rule(10)
  total(paint, 'Subtotal', data.subtotal, data.currency)
  if (!isZeroAmount(data.discountTotal)) {
    total(paint, 'Discount', `-${data.discountTotal}`, data.currency)
  }
  total(paint, 'Tax', data.taxTotal, data.currency)
  paint.down(2)
  total(paint, 'Total', data.total, data.currency, true)
  total(paint, 'Paid', data.amountPaid, data.currency)
  total(paint, 'Balance due', data.balanceDue, data.currency, true)

  if (data.notes) {
    paint.down(10)
    paint.rule(10)
    paint.line('Notes', { size: 10, bold: true, gap: 4 })
    for (const chunk of wrapText(data.notes, 96, 8)) {
      paint.line(chunk, { size: 9, muted: true, gap: 3 })
    }
  }

  return pdf.save()
}

export async function renderReceiptPdf(data: ReceiptPdfData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(`Receipt ${data.number}`)
  pdf.setProducer('Clinic')
  const paint = await painterFor(pdf)

  letterhead(paint, data.clinic)

  paint.line('RECEIPT', { size: 13, bold: true, gap: 10 })
  paint.line(`Number  ${data.number}`, { size: 10, muted: true, gap: 3 })
  paint.line(`Received  ${data.receivedOn}`, { size: 10, muted: true, gap: 3 })
  paint.line(`Method  ${data.method}`, { size: 10, muted: true, gap: 3 })
  if (data.reference) paint.line(`Reference  ${data.reference}`, { size: 10, muted: true, gap: 3 })
  paint.down(8)

  paint.line(`Received from  ${data.patient.name}`, { size: 11, bold: true, gap: 3 })
  paint.line(`Record number  ${data.patient.medicalRecordNo}`, { size: 10, muted: true })
  paint.down(6)
  paint.rule(10)

  paint.at(COLUMN.description, 'Applied to', { size: 9, bold: true, muted: true })
  paint.rightAligned('Amount', { size: 9, bold: true, muted: true, gap: 8 })
  paint.rule(10)

  for (const allocation of data.allocations) {
    paint.at(COLUMN.description, allocation.invoiceNumber ?? 'Account', { size: 10 })
    paint.rightAligned(allocation.amount, { size: 10, gap: 5 })
  }

  paint.down(4)
  paint.rule(10)
  total(paint, 'Received', data.amount, data.currency, true)
  if (!isZeroAmount(data.refundedAmount)) {
    total(paint, 'Refunded', `-${data.refundedAmount}`, data.currency)
  }

  if (data.receivedBy) {
    paint.moveTo(MARGIN + 56)
    paint.rule(14)
    paint.line(`Taken by  ${data.receivedBy}`, { size: 10, muted: true })
  }

  return pdf.save()
}

/** A label on the left of the totals block and its figure against the right margin. */
function total(
  paint: Painter,
  label: string,
  amount: string,
  currency: string,
  emphasis = false,
): void {
  paint.at(COLUMN.unitPrice, label, { size: emphasis ? 11 : 10, bold: emphasis, muted: !emphasis })
  paint.rightAligned(`${amount} ${currency}`, {
    size: emphasis ? 11 : 10,
    bold: emphasis,
    gap: 5,
  })
}

// "..." rather than a single ellipsis character: the standard fonts are WinAnsi and would
// draw that as a question mark.
const truncate = (text: string, width: number): string =>
  text.length <= width ? text : `${text.slice(0, width - 3)}...`
