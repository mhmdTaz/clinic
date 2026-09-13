import {
  AppointmentSummary,
  DownloadLink,
  EncounterDetail,
  EncounterSummary,
  PatientDetail,
  PatientSummary,
  Prescription,
  StoredFile,
} from '@clinic/contracts'
import type {
  AddendumRequest,
  EncounterListQuery,
  FileListQuery,
  OpenEncounterRequest,
  PrescriptionListQuery,
  SignNoteRequest,
  UpdateEncounterRequest,
} from '@clinic/contracts'
import type { ApiClient } from '../client'
import type { PageRequest } from '../pages'
import type { AppointmentsRequest } from './patient-portal'

/**
 * What the doctor portal does on a phone: the day, the chart, and the note (D2–D9).
 *
 * The same rule as the patient portal, and the same test: **every call here is an `/api/v1`
 * endpoint the web already had.** The web's doctor pages are server components that call the use
 * cases directly, so nothing forced these endpoints to be complete — which makes this file the
 * first real proof that they are. `tests/e2e/specs/mobile-api-parity.spec.ts` drives every method.
 *
 * Deliberately narrower than the web workspace. Vitals, diagnoses, prescribing and stock
 * consumption stay on the desk: each is a form with a pick-list or a table, and a doctor who
 * reaches for a phone between patients wants to read the chart and get the note down.
 */
export function doctorPortal(client: ApiClient) {
  return {
    // ── The day (D3) ─────────────────────────────────────────────────────────
    /**
     * The doctor's appointments over a window. The server scopes the list to the doctor's own
     * diary (ADR-0004); a `doctorId` here would only ever narrow it, never widen it.
     */
    appointments(query: AppointmentsRequest) {
      return client.paged('/api/v1/appointments', {
        query: { ...query },
        schema: AppointmentSummary,
      })
    },

    // ── Patients and the chart (D2, D4) ──────────────────────────────────────
    /**
     * Everyone this doctor has treated, newest visit first.
     *
     * **Summaries, not full records.** The first version of this client parsed the response as
     * `PatientDetail[]`, which the endpoint never returned; a patient's session gets an empty array
     * here, and an empty array satisfies any array schema, so the patient parity suite could not
     * have noticed. The doctor's suite did, on its first run.
     */
    patientsITreat(page: PageRequest = {}) {
      return client.paged('/api/v1/me/patients', { query: { ...page }, schema: PatientSummary })
    },

    /** The chart. The banner — allergies and chronic conditions — is embedded on the record. */
    patient(patientId: string) {
      return client.request(`/api/v1/patients/${patientId}`, { schema: PatientDetail })
    },

    // ── Visits and the note (D6–D9) ──────────────────────────────────────────
    /**
     * Visits, newest first. `appointmentIds` (at most 100) finds the visits recorded against a
     * day's appointments whatever day each visit started on — which the date filter cannot.
     */
    encounters(query: Partial<EncounterListQuery> = {}) {
      const { appointmentIds, ...rest } = query
      return client.paged('/api/v1/encounters', {
        // Comma-separated, which is how the contract reads a list from a query string.
        query: { ...rest, appointmentIds: appointmentIds?.join(',') },
        schema: EncounterSummary,
      })
    },

    encounter(encounterId: string) {
      return client.request(`/api/v1/encounters/${encounterId}`, { schema: EncounterDetail })
    },

    /**
     * Opening a visit. One per appointment: a second attempt is refused with `ENCOUNTER_EXISTS`,
     * which is what makes a retried tap safe — the caller finds the visit that already exists
     * rather than the server writing the record in two halves.
     */
    openEncounter(input: OpenEncounterRequest) {
      return client.request('/api/v1/encounters', {
        method: 'POST',
        body: input,
        schema: EncounterDetail,
      })
    },

    /** Writing the draft. A signed note refuses every part of this (ADR-0024). */
    updateEncounter(encounterId: string, input: UpdateEncounterRequest) {
      return client.request(`/api/v1/encounters/${encounterId}`, {
        method: 'PATCH',
        body: input,
        schema: EncounterDetail,
      })
    },

    /** Signing freezes the note's content for good. Corrections become addenda. */
    signNote(encounterId: string, input: SignNoteRequest) {
      return client.request(`/api/v1/encounters/${encounterId}/sign`, {
        method: 'POST',
        body: input,
        schema: EncounterDetail,
      })
    },

    addAddendum(encounterId: string, input: AddendumRequest) {
      return client.request(`/api/v1/encounters/${encounterId}/addendum`, {
        method: 'POST',
        body: input,
        schema: EncounterDetail,
      })
    },

    /** The visit is over. Separate from signing: the note may still be written up afterwards. */
    completeEncounter(encounterId: string) {
      return client.request(`/api/v1/encounters/${encounterId}/complete`, {
        method: 'POST',
        schema: EncounterDetail,
      })
    },

    // ── What else the chart shows ────────────────────────────────────────────
    prescriptions(query: Partial<PrescriptionListQuery> = {}) {
      return client.paged('/api/v1/prescriptions', { query: { ...query }, schema: Prescription })
    },

    files(query: Partial<FileListQuery> = {}) {
      return client.paged('/api/v1/files', { query: { ...query }, schema: StoredFile })
    },

    downloadLink(fileId: string) {
      return client.request(`/api/v1/files/${fileId}/download-url`, { schema: DownloadLink })
    },
  }
}
