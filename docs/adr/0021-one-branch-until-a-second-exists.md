# ADR-0021 — One branch until a second one exists

- **Status:** Accepted
- **Date:** 2026-09-11
- **Decided by:** the product owner, on recommendation

## Context

The feature matrix (A2) plans for several physical locations, with appointments and stock held per
location, and the data model embeds branches in the clinic document. Nothing in the original brief
mentioned more than one location. Asking a single-site clinic to pick "Main Branch" on every doctor,
every appointment and every stock movement adds a field that can only ever have one answer.

## Decision

Every clinic has at least one branch, created with the clinic. While there is exactly one active
branch, the interface never asks for a branch: it is implied. Clinic settings always show the
locations list, with "Add a location"; branch fields appear everywhere else only once a second
active branch exists.

The data model is unchanged. Records that carry a `branchId` get the single branch's id written for
them, so data entered before a second branch opens is already correct afterwards.

## Consequences

- The last active branch cannot be deactivated (`LAST_ACTIVE_BRANCH`): a clinic with no open
  location could not take a booking.
- Doctor profiles accept `branchIds` from Phase 2, but the field is shown only in a multi-branch
  clinic.
- Adding a second location later is a settings change, with no migration and no backfill.
