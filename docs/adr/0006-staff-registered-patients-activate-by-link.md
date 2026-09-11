# ADR-0006 — Staff register patients; patients activate by emailed link

- **Status:** Accepted
- **Date:** 2026-09-11
- **Decided by:** the product owner, on recommendation

## Context

Patients need portal accounts to see their records and book appointments. A public sign-up page
would mean verifying the identity of strangers, handling duplicate and fake accounts, and matching
self-registered accounts to the records staff already keep — in a system holding medical data.
The original specification already has staff adding patients.

## Decision

There is no public sign-up. Staff create the patient's account (user management, Phase 2) and the
system emails an activation link. Following it sets the first password, marks the email address
verified, and signs the patient in.

## Consequences

- An invitation never creates a user; it only activates one that already exists. A leaked or
  guessed link cannot mint accounts.
- Links carry 256 bits of randomness, are stored only as a SHA-256 hash, work once, expire after 7
  days, and are superseded when a new one is sent. The token travels in the URL fragment, which
  browsers do not send to servers, so it never lands in an access log.
- Activation is atomic: a link submitted from two tabs at once activates the account exactly once.
- Self-registration can still be added later, behind the existing `patientSelfRegistration`
  feature flag. The `isDefault` role already marks which role such accounts would receive.
