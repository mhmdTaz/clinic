# ADR-0037 — Voice charting is a draft, and the clinic chooses where the audio goes

**Status:** accepted · Phase 13 · charting with gloved hands

## Context

A dentist at the chair has gloves on and a mirror in one hand. Charting means stopping, or saying
it aloud for the front desk to type later. Dental systems offer voice charting for that reason:
"sixteen MOD composite done" and the chart fills itself in.

Two things make it risky. **Speech recognition gets things wrong** — "fifteen" for "fifty", a
surface missed — and a wrong row on a chart is a clinical error that stays on the record, voided
or not. And **the recognition has to run somewhere.** The browser's Web Speech API is free and
needs no install, but in Chrome and Edge it sends the audio to Google's or Microsoft's servers to
be transcribed. That is patient-adjacent audio leaving the clinic, under the browser maker's terms.

## Decision

**What is said is a draft, never a record.** The parser (`lib/dental/voice.ts`) turns a sentence
into a tooth, surfaces, a treatment from the clinic's own list and, if one was said, a status.
That fills in the tooth's ordinary charting form, with what was heard shown above it. A person
reads it and presses save, or changes it, or walks away. Nothing is written from speech alone,
and the row that is saved is an ordinary row, checked by the server like any other (ADR-0035).

- **It refuses rather than guesses.** No tooth or no treatment means no draft, and a message saying
  what was heard. When two treatments fit equally — "crown", with two crowns on the list — the
  first is proposed and the other is named beside it.
- **It is forgiving about transcription** — "16", "sixteen", "one six"; "MOD", "M O D", "mesial
  occlusal distal" — and puts O and I right for front and back teeth.
- **English only, for now.** The recogniser is asked for en-US, and the words it matches are
  English.

**The clinic turns it on, knowingly.** Voice charting is a feature flag (`dentalVoice`), off by
default. The administrator turns it on from Admin → Dental chart, after ticking a statement that
spoken audio goes to the browser maker's speech service. The server refuses to turn it on without
that acknowledgement. The change is written through the clinic document, which is audited, so who
turned it on and when is on the record. Turning it off needs nothing.

**The browser does the listening; this app never receives audio.** Only the transcript reaches the
page, and only the saved row reaches the server.

## Why

**A draft is the only safe shape for a guess.** Recognition error rates for numbers and short
letter strings are high. A misheard tooth that fills a form is caught by the person reading it; a
misheard tooth that writes a row is caught, if at all, at the next visit.

**The privacy decision is the clinic's, not ours.** Whether a practice may send audio to Google is
a question for its own data-protection position and its patients' consent, and differs between
clinics and countries. We make the consequence explicit and the default safe, and record the
choice.

## Consequences

- The dentist should not speak patients' names; the statement the administrator ticks says so.
- **The upgrade path is on-device recognition** — Whisper compiled to WebAssembly, or the browsers'
  own on-device models as they arrive. It would keep audio on the machine, and would let the
  acknowledgement go. The parser does not change: it takes text.
- Firefox has no Web Speech recognition; the button does not appear there.
- A spoken span — a bridge "from 45 to 47" — is not parsed; the draft is one tooth, and the form
  takes it from there.
