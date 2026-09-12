# ADR-0024 — A signed note is closed to everyone, including its author

- **Status:** Accepted
- **Date:** 2026-09-13
- **Context:** Sections 8.8 and 8.15, use case D9, Phase 4

## Context

A clinical note is a draft while the doctor is writing it and evidence once they have signed it.
The question is what "signed" is allowed to mean afterwards.

The tempting implementation is a `signedAt` timestamp plus a rule that the editor hides the form
once it is set. That is a UI convention, not a property of the record: the update endpoint still
accepts the write, so anyone with the doctor's session — or a later feature that forgets the
rule — can rewrite what was signed, and nothing in the database would show it had happened.

## Decision

Signing closes the note's content permanently, and the closure is enforced by the write itself.

- The update carries its precondition in the **filter**, not in a prior read:
  `{ _id, clinicId, 'note.status': 'DRAFT' }`. A note signed between the permission check and the
  write matches nothing and is not written to. There is no window to lose.
- Signing is one atomic document update, so the status, the time, the signer and the content hash
  can never be partially applied. There is no moment where a note reads SIGNED with no signature.
- A correction is an **addendum**, appended with `$push`. Append-only is then a property of the
  operation rather than a rule somebody has to remember: a `$push` cannot reach the content above
  it, whatever the caller intended.
- The signature stores a SHA-256 of the note's content **by section**, plus who signed and when.
  Hashing the sections separately matters: the same sentences filed under different headings are
  a different clinical claim, and a hash of the concatenated text would call them identical.

## Consequences

- `verifyNoteSignature` can answer, at any time, whether a signed note still says what was signed.
  Nothing in the application can rewrite it, so a mismatch means the database was edited
  underneath the application — which is exactly the question tamper evidence exists to answer.
- Closing a visit and signing its note are separate acts. A doctor finishes with the patient and
  writes the note up afterwards, so the note's editability follows the **note's** status, not the
  encounter's.
- A note with nothing in it cannot be signed. A signature on a blank page is worse than no
  signature, because it looks like a record.
- The document validator repeats the constraint (section 8.15). The conditional update is the
  mechanism; the validator is the belt to that brace.
