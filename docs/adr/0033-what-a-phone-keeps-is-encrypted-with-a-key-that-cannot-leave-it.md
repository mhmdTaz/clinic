# ADR-0033 — What a phone keeps is encrypted with a key that cannot leave it

**Status:** accepted · Phase 9 · the device-side answer to §16.1's "at rest"

## Context

§9.4 asks the app to "persist the cache for offline reads". The case is specific: a patient
outside the clinic with one bar, wanting their appointment time; a doctor in a basement consulting
room wanting to know who is next. Both are reads of something already shown.

What gets kept is PHI — appointment times, patient names, a doctor's day list — on a device that is
lost far more often than a laptop, backed up to a cloud by default, and sometimes handed to another
person. §16.1 covers the server's data at rest with volume encryption and CSFLE. It says nothing
about a phone, and Phase 9's first commit left it open.

That first commit also got the storage wrong in a way worth recording. It kept each cached read as
a SecureStore item. SecureStore accepts keys of letters, digits, `.`, `-` and `_`, and the cache
keys were JSON; and it warns past 2 KB a value, which a month of appointments exceeds. Nothing
noticed, because nothing ever wrote to it: the store was never attached to the query cache.

## Decision

**Kept reads are one AES-256-GCM sealed file in the OS cache directory, keyed by a random key held in
the keychain as `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`, and destroyed key-first.**

- **An allowlist decides what is kept at all** — the session, the appointment lists, the
  notification feed. Never a chart, a note, a document list, a prescription or a bill.
- **Nothing kept is shown after 24 hours**, or if the device clock has moved backwards. A stale
  appointment list is not "slightly out of date"; it is a different week.
- **Kept reads belong to one person.** The file records whose session produced it; on launch it is
  adopted only by that same person and deleted otherwise.
- **The cache directory**, not documents: the OS excludes it from backups and may clear it when
  space is short. For a cache, both are correct.
- **Authenticated encryption with a purpose string as additional data**, so a tampered or
  mismatched file fails to decrypt rather than decrypting to something plausible.
- **Sign-out deletes the key, then the file.** Once the key is gone the file is noise, so a delete
  that fails, or a copy the OS kept, leaves nothing readable.
- **Writes are never queued offline.** A booking that syncs an hour later may land on a slot
  somebody else took, after the patient was told it was theirs.

## Why not the alternatives

**The OS's own file protection alone** (iOS Data Protection, Android file-based encryption)
protects a powered-off or locked phone. It does not protect a backup, a rooted device, or a file
copied off an unlocked one. The keychain key does, because a `THIS_DEVICE_ONLY` item is never in a
backup and never restored to another phone.

**SQLCipher** would bring a database to hold a few kilobytes of JSON, and a second native
dependency that rebuilds with every React Native upgrade.

**No offline reads at all** would be the most private option, and it fails the one person the
feature exists for, at the one moment it matters.

## Consequences

- A reinstall, a restore from backup, or a wiped keychain makes the file unreadable. That is handled
  as a cache miss, never as a crash on launch — which is the only time the vault is read, and
  often the moment there is no signal.
- A doctor's day list is kept, so a lost phone can hold a day of patient names for up to 24 hours,
  encrypted. That was judged worth it for the doctor between rooms with no signal. Charts and notes
  are not kept.
- The web development preview cannot exercise any of this: `vault.web.ts` and `keychain.web.ts` are
  memory stand-ins. The rules around the vault — what is kept, for whom, for how long, and what a
  failed read does — are unit-tested; the vault itself, the keychain and the cipher have not yet run
  on a device.
