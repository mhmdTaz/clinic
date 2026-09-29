# ADR-0036 — A plan owns the price and the answer; the chart owns the work

**Status:** accepted · Phase 12 · a plan the patient can say yes to

## Context

After the chart (ADR-0035) a dentist has planned work on teeth: a crown on 16, an extraction on 48.
The patient then has to be shown it — what, in what order, for how much — and has to agree before
most of it is done. The practice prints the plan, presents it on a tablet at the chair, has the
patient sign, and later chases the patients who agreed and never came back. Done work has to reach
the bill at the price that was agreed, not at whatever the price list says that day.

The planned work already exists, as PLANNED rows of the chart. The question is what a plan stores
beside them, and how the two are kept honest with each other.

## Decision

**A treatment plan is its own document, `treatment_plans`, and each item points at one PLANNED row
of the chart.** It groups the rows into phases, prices them, and records the patient's answer.

- **The plan owns the money.** Each item's price is a snapshot, taken from the price list through
  the treatment's service when the plan is drawn up, or typed in. It is rounded per line and summed
  exactly as an invoice is (ADR-0027) — the same `computeLine` and `computeTotals`. A price-list
  change after the patient agreed does not change what they agreed to.
- **The plan owns the answer.** DRAFT → PRESENTED → ACCEPTED (with the name the patient signed as
  and the drawn signature, stored as a consent document on their file) or DECLINED; CANCELLED, with
  a reason, before it is finished. Editing a presented plan sends it back to DRAFT: what the patient
  saw is no longer what it says.
- **The chart owns the work.** Whether an item is done is read from the chart's log: a COMPLETED row
  that carries out its PLANNED row. The plan keeps a copy — the state, the day, the visit — because
  a plan is listed and printed without re-reading the chart. That copy is **rewritten from the log**
  whenever one of its rows is completed or voided (`syncPlansFor`), never edited by hand, and
  rewriting it twice changes nothing. An agreed plan completes itself when nothing is left open and
  something was done; voiding the completion reopens it.
- **A voided planned row drops its item.** The dentist decided it was a mistake, and the patient is
  not asked to pay for it. A plan whose every item was dropped is not "completed"; it stays agreed,
  for somebody to cancel with a reason.
- **One agreed plan per piece of work.** Several drafts may offer the same crown — option A and
  option B — but accepting a plan is refused when any of its work is already in an agreed one.
- **Billing is a person's decision.** Done work in an agreed plan is billable; somebody holding
  `invoice:create` puts it on a visit's invoice, at the agreed price, through billing's own seam
  (`billToEncounter`). The item is claimed in the same transaction, so it is billed once, whoever
  presses the button and however often.
- **No new permissions.** A plan is the chart's planned work, read and written under `dental:read`
  and `dental:write` and the same scope resolver. Billing asks for `invoice:create` as well. The
  recall list is clinic-wide, so it asks for `dental:read` at clinic scope.

## Why

**The work must not live in two places.** If the plan held its own "done" flag, the chart and the
plan would disagree the first time somebody completed a tooth from the chart instead of the plan —
and the plan would bill work the chart says was voided. With the chart as the only source of "done"
and the plan's copy rebuilt from it, they cannot drift.

**The price must live in exactly one place too, and that place is the plan.** An invoice line is a
snapshot of a price (section 8.10). A plan is the same promise made earlier: the patient signs a
number. Pricing it again at billing time would bill a different number than the one signed.

**Nothing is billed on its own.** The practice asked for completed work to _suggest_ a line, not to
create one. A silent charge is the thing a patient disputes; a person confirming it is the thing
the clinic can defend.

## Consequences

- A plan is printed by the browser from a page laid out for paper; there is no PDF service to run.
  The portal's navigation is hidden in print.
- The recall list reads agreed plans with `openItems > 0`, and drops patients who already have a
  visit booked. It reads further rows to fill a page, bounded to ten batches.
- `defaultQuantity` prices a bridge per unit and everything else as one. It is a rule the practice
  may want to change — a denture priced per tooth, say.
- A plan is in English on every locale, as the other clinical screens are (Phase 8).
