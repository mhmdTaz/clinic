import { PrescriptionModel, newId, nextFormatted } from '@clinic/db'
import type { PersonRef } from '@clinic/contracts'

export interface StoredPrescriptionItem {
  id: string
  drugName: string
  strength: string | null
  form: string | null
  dosage: string
  frequency: string
  durationDays: number | null
  quantity: number | null
  instructions: string | null
  isRefillable: boolean
}

export interface StoredPrescription {
  id: string
  number: string
  encounterId: string
  patientId: string
  doctorId: string
  patient: { name: string; medicalRecordNo: string }
  doctor: { name: string; licenseNumber: string | null }
  issuedAt: Date
  validUntil: string | null
  notes: string | null
  items: StoredPrescriptionItem[]
  pdfFileId: string | null
  issuedBy: PersonRef | null
}

interface PrescriptionRecord {
  _id: string
  number: string
  encounterId: string
  patientId: string
  doctorId: string
  patient: { name: string; medicalRecordNo: string }
  doctor: { name: string; licenseNumber: string | null }
  issuedAt: Date
  validUntil: string | null
  notes: string | null
  items?: Array<Omit<StoredPrescriptionItem, 'id'> & { _id: string }>
  pdfFileId: string | null
  issuedBy: PersonRef | null
}

function toPrescription(doc: PrescriptionRecord): StoredPrescription {
  return {
    id: doc._id,
    number: doc.number,
    encounterId: doc.encounterId,
    patientId: doc.patientId,
    doctorId: doc.doctorId,
    patient: doc.patient,
    doctor: { name: doc.doctor.name, licenseNumber: doc.doctor.licenseNumber ?? null },
    issuedAt: doc.issuedAt,
    validUntil: doc.validUntil ?? null,
    notes: doc.notes ?? null,
    items: (doc.items ?? []).map(({ _id, ...item }) => ({ id: _id, ...item })),
    pdfFileId: doc.pdfFileId ?? null,
    issuedBy: doc.issuedBy ?? null,
  }
}

const LIST_LIMIT = 200

export const prescriptionRepository = {
  nextNumber(clinicId: string): Promise<string> {
    return nextFormatted(`prescription:${clinicId}`, 'RX', 6)
  },

  async create(input: {
    clinicId: string
    number: string
    encounterId: string
    patientId: string
    doctorId: string
    patient: { name: string; medicalRecordNo: string }
    doctor: { name: string; licenseNumber: string | null }
    issuedAt: Date
    validUntil: string | null
    notes: string | null
    items: Array<Omit<StoredPrescriptionItem, 'id'>>
    issuedBy: PersonRef
  }): Promise<StoredPrescription> {
    const doc = await PrescriptionModel().create({
      _id: newId(),
      ...input,
      items: input.items.map((item) => ({ _id: newId(), ...item })),
    })
    return toPrescription(doc.toObject() as unknown as PrescriptionRecord)
  },

  async findById(clinicId: string, prescriptionId: string): Promise<StoredPrescription | null> {
    const doc = (await PrescriptionModel()
      .findOne({ clinicId, _id: prescriptionId })
      .lean()) as unknown as PrescriptionRecord | null
    return doc ? toPrescription(doc) : null
  },

  /** Who it belongs to, with no PHI read: the question authorisation asks (section 11.3). */
  async findAccessFacts(
    clinicId: string,
    prescriptionId: string,
  ): Promise<{ id: string; patientId: string; doctorId: string; pdfFileId: string | null } | null> {
    const doc = (await PrescriptionModel()
      .findOne({ clinicId, _id: prescriptionId })
      .select({ patientId: 1, doctorId: 1, pdfFileId: 1 })
      .setOptions({ skipAudit: true })
      .lean()) as unknown as PrescriptionRecord | null
    if (!doc) return null
    return {
      id: doc._id,
      patientId: doc.patientId,
      doctorId: doc.doctorId,
      pdfFileId: doc.pdfFileId ?? null,
    }
  },

  async list(
    clinicId: string,
    filter: { patientId?: string; doctorId?: string; encounterId?: string; activeOn?: string },
  ): Promise<StoredPrescription[]> {
    const where: Record<string, unknown> = { clinicId }
    if (filter.patientId) where.patientId = filter.patientId
    if (filter.doctorId) where.doctorId = filter.doctorId
    if (filter.encounterId) where.encounterId = filter.encounterId
    // "Still taking it": no end date, or an end date that has not arrived (ADR-0010 dates).
    if (filter.activeOn) {
      where.$or = [{ validUntil: null }, { validUntil: { $gte: filter.activeOn } }]
    }

    const docs = await PrescriptionModel()
      .find(where)
      .sort({ issuedAt: -1 })
      .limit(LIST_LIMIT)
      .lean()
    return (docs as unknown as PrescriptionRecord[]).map(toPrescription)
  },

  /**
   * The PDF is attached once. `pdfFileId: null` is in the filter, so two requests racing to
   * render the same prescription cannot both claim it — the loser's file is simply unused.
   */
  async attachPdf(
    clinicId: string,
    prescriptionId: string,
    fileId: string,
  ): Promise<string | null> {
    const doc = (await PrescriptionModel()
      .findOneAndUpdate(
        { clinicId, _id: prescriptionId, pdfFileId: null },
        { $set: { pdfFileId: fileId } },
        { new: true },
      )
      .select({ pdfFileId: 1 })
      .setOptions({ skipAudit: true })
      .lean()) as unknown as { pdfFileId: string } | null
    return doc?.pdfFileId ?? null
  },
}
