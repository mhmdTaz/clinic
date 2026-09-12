# ADR-0026 — Prescription PDFs are rendered on first request, then stored

- **Status:** Accepted
- **Date:** 2026-09-13
- **Context:** Sections 12 and 13.5, use cases D8 and P7, Phase 4

## Context

Section 13.5 puts prescription PDFs on a `documents` queue. The queue, and the worker that drains
it, do not exist yet — Phase 4 ships no background processor. Three options followed.

1. **Build the worker now.** A queue, a runner, retries, a dead-letter path and an admin alert, in
   order to render a one-page document that takes a few milliseconds.
2. **Render on every request.** No storage, no file row, and a document whose bytes could differ
   between two downloads of the same prescription — which is precisely what a prescription must
   never do.
3. **Render once, on first request, and store the result.**

## Decision

The third. The first request for a prescription's PDF renders it, writes it to object storage as
an ordinary `File` owned by the prescription, and records the file's id on the prescription. Every
later request serves that stored file through the same presigned download every other document
uses.

The claim on the file id is a conditional update with `pdfFileId: null` in the filter, so two
requests racing to render the same prescription cannot both claim it; whichever id wins is the one
served, and the loser's object is simply unused.

## Consequences

- The end state is exactly what the queued job would have produced: a file in the store, its id on
  the prescription, one immutable document per prescription. Moving this to a worker later changes
  **when** it runs, not what exists afterwards — the worker pre-renders instead of a reader
  triggering it, and the read path does not change at all.
- The first reader pays a few milliseconds. That reader is a doctor or a patient pressing
  "download", not a page render.
- The PDF is marked patient-visible on creation, because a patient's own prescription is theirs
  (P7). It is the one document type where sharing is not a separate decision.
- The renderer uses pdf-lib's standard fonts, which are WinAnsi-encoded. Text is folded to what
  they can draw, so a name written in Arabic renders as `?` rather than crashing the request. The
  Arabic pass (section 13.6) is where a Unicode font gets embedded; that is a real limitation
  today and is noted in the renderer itself.
