# The audit log fails its integrity check

> You are here because an `AUDIT_CHAIN_BROKEN` alert fired, or the banner at the top of
> Admin → Audit log is red.

**Treat this as a security incident until proven otherwise.** The chain only breaks if something
wrote to `auditLogs` outside the application — and the application cannot, because the database
user it runs as has no privileges on that collection (§16.1).

Related: [ARCHITECTURE.md §11.5](../../ARCHITECTURE.md), [ADR-0031](../adr/0031-the-audit-log-is-chained-and-verified.md).

---

## First: do not fix it

The instinct is to make the alarm stop. Resist it.

- **Do not rebuild the chain.** Recomputing the hashes makes a tampered log verify cleanly and
  destroys the only evidence that anything happened.
- **Do not delete the entry named in the alert.** Deleting it changes the verdict from
  HASH_MISMATCH to BROKEN_LINK and tells you less.
- **Do not restart the worker to "see if it clears".** It will not, and the alert is deduplicated
  by the broken entry's id, so a second run will be quiet — which looks like the problem going away.

Take a backup **first**, before anything else:

```bash
pnpm db:backup --out ./backups/incident-$(date +%Y%m%d)
```

---

## What the verdict tells you

The alert, the audit entry (`audit.chain_broken`) and the banner all name a reason. They mean
genuinely different things.

| Reason            | What happened                                                                                                                                             | Where to look                                                                                                                     |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **HASH_MISMATCH** | An entry's content no longer produces its stored hash: it was **edited in place**                                                                         | The named entry. Compare it against the same event elsewhere — an invoice's own history, the application log for that `requestId` |
| **BROKEN_LINK**   | An entry's `previousHash` is not its predecessor's hash: something was **deleted from the middle**                                                        | The gap. `chainSeq` is contiguous, so the missing positions say exactly how many entries went                                     |
| **MISSING_HASH**  | An entry has a chain position but no hash                                                                                                                 | Almost always a write that bypassed the application — a script, a migration, a restore from a partial dump                        |
| **HEAD_MISMATCH** | The log is internally consistent but ends somewhere the recorded head has never been: history was **rewritten**, or the newest entries were **truncated** | The head document (`auditChainHeads`) and the tail of the log. This is the signature of a competent tamper                        |

`checked` in the alert says how many entries verified **before** the break. Everything up to that
point is sound; everything after it is unverified, not necessarily wrong.

---

## Triage

```bash
# 1. What broke, and where.
docker exec clinic-mongo mongosh --port 27018 --quiet --eval '
  const d = db.getSiblingDB("clinic");
  printjson(d.auditLogs.findOne({ _id: "<the id from the alert>" }));
  printjson(d.auditChainHeads.findOne({ _id: "<clinicId>" }));
'

# 2. Is chainSeq contiguous? A gap is a deletion.
docker exec clinic-mongo mongosh --port 27018 --quiet --eval '
  const d = db.getSiblingDB("clinic");
  const seqs = d.auditLogs.find({ clinicId: "<clinicId>", chainSeq: { $exists: true } },
    { chainSeq: 1 }).sort({ chainSeq: 1 }).toArray().map(x => x.chainSeq);
  const gaps = seqs.filter((s, i) => i > 0 && s !== seqs[i-1] + 1);
  print("links:", seqs.length, "gaps at:", JSON.stringify(gaps));
'

# 3. Who has been reading the log? (Reading it is itself audited.)
#    Admin → Audit log → Show: "Only who looked", filtered to the last week.
```

Then answer these, in order:

1. **Was there a deploy or a migration around the time of the break?** `occurredAt` on the named
   entry gives you the window. A migration that touched `auditLogs` is the most likely innocent
   explanation, and it is still a bug worth fixing.
2. **Was there a restore?** A restore from a dump taken without `--oplog` can produce exactly this.
   Check the restore history with whoever ran it.
3. **Does the database have credentials it should not?** The application user must have no
   privileges on `auditLogs`; the audit writer has `insert` and `find` there, plus `update` on
   `auditChainHeads` and nothing else.
   ```bash
   docker exec clinic-mongo mongosh --port 27018 --quiet --eval '
     db.getSiblingDB("clinic").runCommand({ usersInfo: 1, showPrivileges: true })
   '
   ```
   In local development auth is off entirely and this check is meaningless — say so in the
   incident notes rather than recording a pass.
4. **If none of the above:** somebody had direct database access. Rotate credentials, review who
   holds them, and preserve the backup you took at the top of this runbook.

---

## After the investigation

Once you know what happened and the cause is fixed:

- **If the break was legitimate** (a migration, a known restore), record what and why in the
  incident notes, then re-anchor the chain by running a full verification. The head will be
  re-checked from genesis:
  ```bash
  # From a Node REPL with the app's environment:
  # await runChainVerification(clinicId, { force: 'full' })
  ```
  The checkpoint is deliberately **not** moved past a break, so nothing advances until the walk
  actually passes.
- **If the break was tampering**, the log before `checked` is still evidence and still verifiable.
  Preserve it. Restoring over it destroys the only record of the intrusion.
- **Either way**, note in the incident that entries after the break are unverified. The chain does
  not tell you they are wrong; it tells you it can no longer vouch for them.

---

## Why the alert cannot simply be muted

`AUDIT_CHAIN_BROKEN` is in the locked set of notification types (`preferences.ts`), so it cannot
be switched off per user. It reaches everybody holding `audit:read`, on every channel. That is
deliberate: an alert somebody can mute is an alert that will be muted, and this is the one that
must not be.
