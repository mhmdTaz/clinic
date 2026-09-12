# ADR-0031 — The audit log is chained, and something walks the chain

**Status:** accepted · Phase 8 · supersedes nothing · relates to
[ADR-0016](0016-the-audit-writer-has-its-own-credentials.md)

## Context

Section 11.5 names four layers of tamper protection for the audit log. Three were already in
place: the restricted database user that may only insert and find (ADR-0016), the application
never holding credentials that could update or delete, and per-document retention that nothing
manual reclaims.

The fourth is **tamper evidence**: what happens if somebody gets past the first three — a stolen
database credential, a rogue DBA, a restore from a doctored dump. Those layers prevent; none of
them notices.

MongoDB has no table triggers outside Atlas, so "the log cannot be modified" is not enforceable in
the database itself. What is enforceable is "a modification cannot go unnoticed".

## Decision

**Each entry stores `hash = sha256(previousHash + canonical(entry))`, chained per clinic, and a
job walks the chain on a schedule.**

Six decisions make that work, and each of them was made because the obvious alternative fails.

### The chain is per clinic, not global

A single sequence would make every audit write in the system contend on one document. Per-clinic,
one clinic's volume cannot slow another's, and a clinic is the unit an auditor asks about anyway.

### A compare-and-swap on a head document, not a read-then-write

Two concurrent writes both read the same head; without a CAS both claim the same predecessor and
produce a **fork**, which a verifier reports as tampering that never happened. The loser of the
swap has written nothing yet, so it re-reads and recomputes.

The head lives on the **audit connection**, governed by the same restricted role. A head the
application could rewrite would make the chain worth nothing.

### Claims are queued per clinic, and then batched

The CAS alone is not enough under load. One request produces several capture entries, and a
handful of concurrent requests has twenty writers racing for one document. Retrying alone is a
thundering herd, and a writer that exhausts its retries **drops an audit entry** — the one thing
this subsystem may never do.

So claims are serialised per clinic within the process first. Nearly all of a clinic's audit
writes come from one process, so the queue removes nearly all contention, and the CAS is left
doing what it is actually for: settling races _between_ processes.

**Serialising alone was a performance bug, and it shipped before it was caught.** A queue where
each claim costs two round trips caps a whole clinic at a few hundred audit writes a second — and
`recordAudit` is _awaited_ on paths that matter: replying to a ticket, recording a payment. Every
one of those then waits behind the entire backlog of fire-and-forget capture writes, so a busy
clinic makes its own requests slow, without bound. It passed locally and hung an end-to-end
journey in CI, which is how this class of fault presents.

Batching removes the ceiling: whatever is waiting when the drainer comes round is chained together
in memory and the head advanced **once**, so N entries cost two round trips instead of 2N.
Measured against the local cluster, an awaited write behind 300 queued ones went from **1,738 ms
to 438 ms** — and the unbatched figure grows with queue depth while the batched one does not,
which is the property that actually matters.

`planBatch` is pure and separately tested, because the chaining _within_ a batch is the part that
would be silently wrong: one shared `previousHash` across a batch, or colliding positions, would
fork the chain and read as tampering.

### The chain's order is `chainSeq`, not `occurredAt`

`occurredAt` is stamped at the call site; the claim happens later. Two concurrent writes can
therefore be timestamped in one order and chained in the other, and a verifier walking by
timestamp finds entry A pointing at entry B's hash and reports tampering that never happened.

`chainSeq` is handed out by the swap itself, so it **is** the chain's order rather than an
approximation of it. A unique partial index on `(clinicId, chainSeq)` means a duplicated position
cannot enter the log even if the CAS were somehow bypassed.

### The walk is compared against the recorded head

A chain that verifies against itself proves less than it appears to. An attacker who edits one
entry and recomputes every hash after it produces a chain that walks perfectly — and ends
somewhere the head has never been. Comparing the computed final hash against the stored head is
what turns "these entries are consistent" into "these entries are the ones that were written".
That verdict is `HEAD_MISMATCH`, and it is also what catches truncation, which a walk alone
cannot see at all.

### Entries written before the chain existed are counted, not condemned

The chain was introduced over a log that already had entries in it. Treating those as breaks
would leave every existing installation permanently reporting tampering — the fastest way to
make a tamper alarm ignored. An entry with no `chainSeq` is outside the chain; the status reports
how many, beside how many were verified, so "12,000 entries verified" is never mistaken for a
statement about all of them.

That leniency is safe because it is narrow: stripping the fields from an entry in the middle
still breaks the _following_ entry's link, and stripping them from the last one is truncation,
which the head catches. An entry that has a position but no hash is `MISSING_HASH` — tampering,
not legacy.

## Consequences

**A break is an incident, not a failed job.** The verifier runs every six hours (not nightly at a
fixed hour — a worker that was down at 3am would silently skip it) and a failure is written to the
audit log at CRITICAL, sent to everybody holding `audit:read` on a notification type that cannot
be switched off, and logged to stderr where platform alerting sees it.

**A run that finds a break does not move its bookmark.** Otherwise the next run resumes past the
damage and reports a clean chain over a broken one — the alert would fire exactly once and then
go quiet, which is worse than never firing.

**Incremental most runs, full weekly.** Re-walking seven years every night would eventually take
longer than a night. But the bookmark is not evidence — anybody able to forge it could already
move the head — so a walk from genesis runs weekly and on demand. An incremental pass that never
re-examined history would be a check an attacker only has to beat once.

**The audit schema sets `minimize: false`.** Mongoose silently drops empty objects on save, so a
diff recording `settings: {}` was hashed with that field and stored without it — and every such
entry failed verification, a false alarm caused entirely by the ORM. It is also simply wrong for a
log: "this field was set to an empty object" is a real change.

**The restore rehearsal gained its strongest check.** Row counts prove a collection came back;
recomputing the chain over restored documents proves every covered entry came back
byte-identical, because a single altered field anywhere breaks a hash. `packages/db/scripts/restore.ts`
reimplements the canonical form independently rather than importing `@clinic/core` — asking the
code that wrote the hashes whether it likes them is a weaker question.

**The explorer lives in its own module.** Section 5.2 forbids `audit` from importing a feature
module, and gating a read needs `access`, which already depends on `audit` to record denials.
`audit-explorer` sits above both; `audit` exposes actor-free reads and keeps the writing.

## Alternatives considered

**A signature per entry instead of a chain.** Signing each entry with a key the database never
holds detects edits but not deletions: remove an entry and every remaining signature still
verifies. The chain's value is that it makes entries depend on each other.

**A Merkle tree.** Cheaper to verify a single entry's membership, and genuinely better at scale.
It is also a great deal more machinery, and the question this log gets asked is "has anything
been touched", which a linear walk answers directly. Worth revisiting if verification time becomes
the constraint.

**Writing to an append-only external store (S3 object lock, a managed ledger).** Stronger, because
the evidence leaves the machine an attacker controls. It is also a second system to operate and a
second thing that can be down while the clinic is trying to write an audit entry. The chain is the
version that ships with v1; shipping the log off the box is the natural next step, and the chain
makes that shipment verifiable when it happens.

**Publishing the head hash somewhere external** (a daily email, a git commit, a timestamping
service) would defeat the head-rewriting attack entirely, because the attacker cannot reach the
external copy. It costs almost nothing and is the recommended follow-up; it is not in v1 only
because the destination is a deployment decision rather than a code one.
