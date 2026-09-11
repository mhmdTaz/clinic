# ADR-0020 — Possible duplicate patients: warn, and require a reason to continue

- **Status:** Accepted
- **Date:** 2026-09-11
- **Decided by:** the product owner, on recommendation

## Context

Two records for one person split their history: allergies recorded on one, the prescription
written against the other. Front desks create duplicates mostly by searching badly under pressure.
But a hard block is wrong too — twins share a birth date and a family shares a phone number, and a
receptionist who cannot register a real patient will invent a fake phone number to get past the
check, which is worse than the duplicate.

## Decision

Before a patient is saved, the registration is compared with existing records — archived ones
included — on four signals:

| Signal                 | Match                                                                               |
| ---------------------- | ----------------------------------------------------------------------------------- |
| National ID            | Equal after removing spaces, dots, dashes and slashes, case-insensitive             |
| Phone                  | The last seven digits are equal, so `+961 3 123 456` matches `03 123 456`           |
| Email                  | Equal, case-insensitive                                                             |
| Name and date of birth | First and last name equal ignoring case and accents, **and** the same date of birth |

A match is a warning, never a block. To save anyway, the person registering types a reason. The
server repeats the check at the moment of saving — it does not trust the form's earlier result — and
refuses with `POSSIBLE_DUPLICATE` if new matches appear that the reason did not cover. A save that
overrides a warning writes a `patient.duplicate_override` audit entry naming the candidates and the
reason.

National ID and email were added to the phone and name-plus-birth-date signals first proposed,
because section 1.1 (S2) lists them and both are stronger identifiers than a phone number.

## Consequences

- Matching runs on normalised keys stored beside the original values and served by indexes, so the
  check stays fast as the directory grows.
- Merging two records that turn out to be one person is not in v1. The audit trail of overrides is
  what a later merge tool will work from.
- A shared family phone number will warn on every family member's registration. That is the
  intended trade: a few seconds of confirmation against a split medical history.
