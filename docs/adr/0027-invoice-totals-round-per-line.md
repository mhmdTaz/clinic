# ADR-0027 — Invoice totals round once per line, and the invoice is the sum of rounded lines

- **Status:** Accepted
- **Date:** 2026-09-14
- **Context:** Sections 8.10 and 9.2, use cases S7 and P8, Phase 5

## Context

An invoice line is `unitPrice × quantity − discount`, plus tax at some percentage of what is left.
Quantities may be fractional ("1.5 hours of physiotherapy"), tax rates carry decimals ("8.25%"),
and the result almost never lands on a whole cent. Something has to round, and **where** it rounds
decides whether the figures printed beside the lines add up to the figure printed at the bottom.

Three places it could happen.

1. **Round only the invoice total.** Each line keeps full precision internally and the total is
   rounded once at the end. The total is then "most accurate" in an abstract sense, and the
   printed lines can be a cent short of it. A patient adding up the column gets a different answer
   from the one on the bill.
2. **Keep full precision everywhere and round only for display.** The same failure, moved into the
   renderer, plus the same arithmetic implemented twice — once for the stored figure, once for the
   printed one — which is how the two drift apart.
3. **Round once per line, and define the invoice as the sum of its rounded lines.**

A related question is the rounding rule itself: half-even ("banker's rounding") or half away from
zero.

## Decision

The third, with half away from zero.

Each line is computed to six decimal places in exact `bigint` arithmetic and rounded **once**, at
the end of its own chain, to the currency's minor unit: `gross = unitPrice × quantity`,
`net = gross − discount`, `tax = net × rate%`, `lineTotal = net + tax`. The invoice's `subtotal`,
`discountTotal` and `taxTotal` are sums of those already-rounded per-line figures, and
`total = subtotal − discountTotal + taxTotal`, which is identically the sum of the `lineTotal`s.

Rounding is half away from zero: `0.005` becomes `0.01`, and `−0.005` becomes `−0.01`.

The arithmetic lives in `@clinic/contracts` (`money.ts`), not in the billing module, because the
browser previews a line total as somebody types it and the server writes the invoice. Both import
the same functions.

## Consequences

- What is printed beside each line adds to what is printed at the bottom, exactly, for every
  combination of odd prices, fractional quantities and awkward tax rates. This is asserted as a
  property in `packages/contracts/src/__tests__/money.test.ts` and again, with hand-worked
  figures, in the billing domain tests — the hand-worked numbers matter, because a property test
  comparing a total to a sum of lines will pass even when both are wrong if the total is _derived_
  from the lines.
- The invoice total may differ by a cent from a full-precision computation of the same invoice.
  That is the trade being made, and it is the right way round: a bill that adds up is worth more
  than a bill that is theoretically nearer some unrounded ideal.
- Half-even would be defensible statistically — it removes the upward bias across many roundings —
  and surprising on a receipt, where `10.005` displayed as `10.00` reads as a missing cent to the
  person holding it. A clinic's bills are read one at a time by the person paying them, not
  aggregated over a million samples.
- Tax is taken on the **discounted** amount, not the gross: a discount reduces what was actually
  charged, and tax authorities tax what was charged.
- Money never passes through a JavaScript number anywhere on the path. Amounts travel as decimal
  strings, are scaled to `bigint` for arithmetic, and are formatted for display only — the one
  place `Number()` is called is inside `Intl.NumberFormat`, where nothing is computed with the
  result.
