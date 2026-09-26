# ADR-0035 — A tooth chart is a log, and the picture is derived from it

**Status:** accepted · Phase 11 · the tooth chart a dental practice switches for

## Context

A dental practice charts a mouth. A dentist fixes a tooth; someone marks it on a picture of the
jaw — a crown on 11, a root canal on 16, decay on 26 — with a note; and at the next visit the
dentist looks at the picture before looking at anything else. Every dental practice system has
this (Open Dental, Dentrix, CareStack, EXACT, Curve). The practice this app is being built for will
not move without it.

Two ways to store it suggest themselves. A **snapshot**: one document per patient, each tooth's
current state, rewritten on every change. Or an **event log**: one row per thing charted, never
rewritten, and the picture worked out from the rows.

## Decision

**The tooth chart is an event log.** Each crown, filling, finding or extraction is a `tooth_records`
row naming the teeth, surfaces, treatment, status, visit, day, dentist and notes. Rows are never
edited:

- **Finishing planned work adds a row.** A COMPLETED row with the same teeth and treatment points at
  the PLANNED row through `completesRecordId`. The plan stays as it was.
- **A mistake is voided, with a reason.** The row stays, marked voided, with who voided it and when,
  and drops out of the picture. Nothing is deleted.
- **The picture is a pure function of the rows** (`deriveChart`). The rows are read, the voided ones
  dropped, a carried-out plan replaced by the row that carried it out. Each tooth is then drawn with
  the marks that remain, and shown as in the mouth or out of it.

Around that:

- **Four statuses, as the industry uses them:** CONDITION (found), PLANNED, COMPLETED (done here),
  EXISTING (done before the patient came). Red is still to do, blue is done.
- **FDI numbering (ISO 3950),** 11–48 permanent and 51–85 primary, with a per-patient dentition
  (permanent, primary, mixed). A tooth charted outside the dentition is still drawn: a chart never
  hides a row.
- **Multi-tooth work is one row.** A bridge names its abutments and pontic; a denture names the
  teeth of one jaw it replaces.
- **The treatment is snapshotted into the row.** The clinic's catalogue can be renamed and repriced
  without restating history. What a treatment _draws_ — its symbol and scope — cannot change once
  it exists.
- **The chart is patient-wide for access.** `dental:read` at ASSIGNED reaches the whole chart of a
  patient the dentist has treated, a colleague's work included — wider than a visit's note
  (ADR-0004), on purpose. A dentist who cannot see that 16 already has a root canal is a danger,
  not a privacy gain. Files use the same rule.
- **The front desk may write it.** Section 7.4 keeps clinical writes from staff. The tooth chart is
  the exception: in a dental practice the receptionist or nurse charts the visit after the dentist
  dictates it. `recordedBy` names who typed it; `doctor` names who did the work.

## Why

**The history is the feature.** "What was done to 16, and when, and by whom" is the question the
dentist asks. A snapshot answers "what is 16 now" and forgets the rest; a log answers both.

**Replaying a day is free.** The chart as it stood on any date is the same function over fewer rows.
The time slider, the "changed since last visit" highlight and — in Phase 12 — the list of plans left
undone all read rows that are already there. None needs a second store.

**It is how a signed note already works.** Evidence is added to, not edited (ADR-0024). A chart the
clinic can be asked about later should behave the same way.

**It is bounded.** One mouth, one lifetime, one clinic: in practice a few hundred rows. Reading all
of them to draw the picture is one indexed query, with the notes left behind.

## Consequences

- The precedence between marks on one tooth — does an extraction hide what came before it, does a
  crown hide an older filling — is a clinical rule in one function, `supersedes`. It is decided with
  the practice, not guessed. Until it is written, every mark is drawn: safe, only cluttered.
- A voided row is still read by the chart query and dropped in memory. That is the price of keeping
  the query simple; it is negligible at these sizes.
- **The 3D jaw is a view over the same data.** The teeth are sculpted in code from millimetre
  measurements and meshed in the browser, so there is no model file and no licence to track. The 2D
  chart draws to the same measurements and is the fallback and the accessible view.
