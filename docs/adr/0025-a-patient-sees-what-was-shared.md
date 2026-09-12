# ADR-0025 — A patient sees what was shared with them, and only once it is final

- **Status:** Accepted
- **Date:** 2026-09-13
- **Context:** Sections 7.5 and 8.8, use cases P4, P6, P10, Phase 4

## Context

The patient portal shows a medical timeline: visits, diagnoses, prescriptions, documents. Some of
that is plainly the patient's — their appointment, their prescription. The clinical note is not
obviously either way. A note is written for clinicians, in clinical shorthand, and may contain a
differential the doctor has not yet discussed with the person it is about.

Two wrong answers were available. Show everything, and a patient reads "?lymphoma — await
histology" on their phone at 11pm. Show nothing, and the portal fails the use case it exists for.

## Decision

Clinical content reaches a patient when **both** are true:

1. Someone at the clinic deliberately shared it — `isPatientVisible`, off by default, on every
   note and every uploaded document.
2. It is final — for a note, that means **signed**. A shared draft stays hidden.

What a patient always sees, because it is a record of their own care rather than a clinical
opinion: that the visit happened, when, with whom, the chief complaint, the coded diagnoses, and
their own prescriptions.

Hidden content is **never loaded**, not loaded and filtered. The repository takes a projection
that excludes the note's sections and addenda, and the decision about which projection to use is
made from access facts read beforehand — facts that carry no PHI and record no PHI read.

## Consequences

- Sharing is reversible and both directions are audited (`file.shared_with_patient`,
  `file.unshared`). A decision that can be taken can be taken back.
- Sharing a note is metadata, not content, so it stays changeable after signing: a clinic can
  decide to share a note with the patient the day after it was written, without that being an
  edit to the note.
- A doctor reading their own note, and the clinic reading any note, are unaffected — the gate is
  on the patient's `OWN` grant, not on the note.
- The e2e journey for this phase asserts the negative as well as the positive: a patient sees the
  visit and not the words.
