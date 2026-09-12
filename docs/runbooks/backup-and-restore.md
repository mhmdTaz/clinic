# Backup and restore

> An untested backup is a hope, not a backup. This runbook exists to be rehearsed, not read.

Related: [ARCHITECTURE.md §16.1](../../ARCHITECTURE.md), [ADR-0031](../adr/0031-the-audit-log-is-chained-and-verified.md).

---

## What a backup is here

`pnpm db:backup` writes one directory containing two files:

| File              | What it is                                                                                                 |
| ----------------- | ---------------------------------------------------------------------------------------------------------- |
| `dump.archive.gz` | A gzipped `mongodump --archive --oplog` of the **whole cluster**                                           |
| `manifest.json`   | The database name, the migration the schema was at, every collection's row count, and the archive's sha256 |

Three decisions are worth knowing before an incident, because each one changes what you can do:

**It is a whole-cluster dump, not a single database.** `--oplog` is only supported on a full dump,
and a full dump is the right thing anyway: the application data and the audit log are separate
connections, and a backup that captured one without the other would restore an invoice whose audit
trail stops mid-sentence.

**`--oplog` is what makes it a point in time.** Without it a dump is a set of collections read at
slightly different instants, and restoring one gives a database that never existed. With it, the
archive carries the oplog span it covers and `--oplogReplay` collapses that span on restore.

**The manifest is the only way to know the restore worked.** A restore is correct if what comes
back matches what went in, which requires having written down what went in.

---

## Taking a backup

```bash
pnpm db:backup
```

Options: `--out <directory>` (default `./backups`), `--keep <n>` (default 7 — older backups of the
same database are pruned).

The script finds `mongodump` on `PATH`, or falls back to `docker exec` into the `clinic-mongo`
container. Set `MONGO_TOOLS_CONTAINER` to point it elsewhere.

**In production**, run this from a scheduled job with `--out` pointing at a mount that is
replicated off the machine. A backup on the same disk as the database is not a backup.

---

## Rehearsing a restore — do this quarterly

This is the drill. It touches nothing that is in use.

```bash
pnpm db:restore --from ./backups/<the backup directory> --verify
```

It restores into `<database>_restore` beside the live one and then checks four things:

1. the archive's size and sha256 against the manifest — **before** touching the database;
2. every collection's row count;
3. the migration the schema is at;
4. **the audit hash chain, recomputed over the restored documents.**

The fourth is the one that matters. Row counts prove a collection came back; they say nothing
about whether the rows inside it are the rows that went in. The chain is a hash over the content
of every audit entry, so if the restore altered a single field anywhere, the walk fails.

A healthy run looks like this:

```
✓ archive matches its manifest (165.9 KiB)
✓ mongorestore finished
✓ 30 collection count(s)
✓ schema is at 20260917000011-audit-chain-and-explorer.js
✓ audit chain for clinic_itest: 142 link(s) verified
✓ restore verified — the data came back intact
```

### What to do about each failure

| Message                                                      | What it means                                                              | What to do                                                                                                                 |
| ------------------------------------------------------------ | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `The archive is N bytes; the manifest says M`                | Truncated in transit or on disk                                            | The backup is unusable. Take a fresh one and find out what truncated it — a full disk and a killed job look identical here |
| `The archive's checksum does not match`                      | The bytes changed                                                          | As above. Check the storage medium before trusting any other backup from the same place                                    |
| `<collection>: N rows, expected M`                           | A collection did not come back whole                                       | Do not use this backup for recovery. Check `mongorestore`'s output for the collection named                                |
| `migration state: X, expected Y`                             | The dump was taken at a different schema version than the manifest records | Suspect a backup taken mid-migration. Take a fresh one outside a deploy window                                             |
| `audit chain: hash mismatch at <id>`                         | A restored entry's content no longer produces its hash                     | The data is **not** intact. Escalate — this is either a corrupted backup or tampering                                      |
| `no audit entry carries a hash, so the chain proved nothing` | Every entry predates Phase 8                                               | Expected on an old database. Counts and schema were checked; the content was not                                           |

Clean up the scratch database when you are done:

```bash
docker exec clinic-mongo mongosh --port 27018 --quiet \
  --eval 'db.getSiblingDB("<database>_restore").dropDatabase()'
```

---

## Recovering for real

**Different procedure.** `mongorestore` will not replay the oplog alongside a namespace filter, so
a true point-in-time recovery restores the whole archive under its original names, onto an **empty**
cluster.

1. **Stop the writers.** The web app and the worker both write; a restore underneath a running
   worker produces a database that disagrees with the queue.
   ```bash
   docker compose stop         # or scale the deployment to zero
   ```
2. **Bring up an empty cluster**, or drop the databases you are replacing. Do not restore over
   live data you have not first backed up — a bad recovery on top of a bad state leaves nothing.
3. **Restore with the oplog replayed:**
   ```bash
   pnpm db:restore --from ./backups/<directory> --to <the live database name> \
     --point-in-time --yes-overwrite-the-live-database --verify
   ```
   Both flags are deliberate friction. The script refuses to write over the live database without
   the second one.
4. **Verify before letting anybody in.** The `--verify` output above is the gate. In particular the
   audit chain line: if it does not pass, the data is not what was backed up, and the clinic should
   not be told otherwise.
5. **Check the chain from the application as well**, which also confirms the restored head:
   ```bash
   # Admin → Audit log. The banner at the top says whether the chain holds.
   ```
6. **Start the worker last.** It will pick up any outbox events that were unprocessed at the
   moment of the backup and deliver them. That is correct — those events did happen — but it means
   people may receive notifications about things that happened before the outage. Say so.

---

## What is not covered

Stated plainly, because a runbook that implies more coverage than it has is worse than none:

- **Object storage is not in this backup.** Uploaded documents live in S3/MinIO (§12) and are
  backed up by that service's own mechanism. A database restore without the matching bucket state
  gives you file records pointing at objects that are not there.
- **Secrets are not in this backup**, by design. Restoring into a cluster without the same
  encryption key material gives you rows you cannot read — see §16.1 on CSFLE.
- **The restore rehearsal does not test the application against restored data.** It proves the
  data came back. Pointing a staging deployment at the restored database is a separate, larger
  drill worth doing before a major release.
