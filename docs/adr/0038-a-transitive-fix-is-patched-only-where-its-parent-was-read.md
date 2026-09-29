# ADR-0038 — A transitive fix is patched only where its parent was read

**Status:** accepted · audit F03 (29 Sep 2026) · extends the dependency row of §17 ·
**the Metro patch and `metro>image-size` override were removed by ADR-0039** — aligning React
Native with Expo SDK 56 left no Metro in the tree that depends on `image-size`. The principle and
the `xcode>uuid` override stand.

## Context

`pnpm audit --prod` failed on two high advisories in `image-size@1.2.1` —
[GHSA-5p2g-fcmc-qvqq](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq) (JXL/HEIF parser loop) and
[GHSA-w3rx-r6r6-pgpr](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr) (ICNS parser loop), fixed
in 2.0.3 — and two moderate ones: `uuid@7.0.3` (missing bounds check when `buf` is passed to
v3/v5/v6, fixed in 11.1.1) and `decode-uri-component@0.2.2` (exponential decoding, fixed in 0.5.0).

All four are reached only through the mobile app's toolchain. None is a dependency of the web server.
No upstream release fixes them: the newest `metro` (0.87.1) still asks for `image-size@^1`, the
newest `xcode` (3.0.1) for `uuid@^7`, and `query-string@7` — which `expo-router` requires — for
`decode-uri-component@^0.2`.

A blanket `overrides` entry would have turned the audit green and broken the build. Metro's
`getAssetData` (`src/Assets.js`) hands `image-size` a **file path**; 1.x read the file itself, 2.x
measures only bytes and moved file reading to `image-size/fromFile`.

## Decision

**A transitive dependency is overridden only after its parent's use of it has been read, the
override is scoped to that parent, and the parent is patched where its use does not fit.**

- `metro>image-size: ^2.0.4`, with `patches/metro@0.87.0.patch` making `getAssetData` read the file
  and pass its bytes. The zip-path branch already did exactly that; the patch makes it the only
  branch.
- `xcode>uuid: ^11.1.1`. `xcode` calls `require('uuid').v4()` and nothing else; 11.x still ships a
  CommonJS build with `v4`. `v4` without a buffer never reached the advisory in the first place.
- `decode-uri-component` is **not** overridden. Every fixed release (0.3.0 onwards) is ESM-only,
  and `query-string@7` loads it with `require()` inside the app bundle. It remains the one moderate
  finding, with its risk stated below, until `expo-router` moves off `query-string@7`.

Validated by exporting the Android bundle before and after the change
(`expo export --platform android --no-bytecode`): all 30 output files are byte-identical, including
the bundle, whose 17 registered assets carry the width and height `image-size` measured. `xcode`
still generates 24-character object ids with `uuid@11`.

## Consequences

- `pnpm audit --prod --audit-level high` passes with the mobile workspace included and the
  threshold unchanged. One moderate advisory remains, reported by the full audit.
- **Residual risk — decode-uri-component.** `expo-router` decodes the query string of links the
  app opens. A crafted deep link could make that decoding slow on the device that opened it. It
  cannot reach the server or another user, and the app only opens links to its own screens.
- **The patch is pinned to `metro@0.87.0`.** pnpm refuses to install when the patched version
  changes, which is the reminder to re-read `Assets.js` — and to drop the patch and the override
  once Metro depends on `image-size@^2` itself.
- **Not caused by this change, found while validating it:** a Hermes bytecode export
  (`expo export --platform android` without `--no-bytecode`) fails in `hermesc` with "private
  properties are not supported" — before and after this change alike. The JavaScript bundle is
  built; its compilation to bytecode for a release build is not. It needs its own fix before a
  release build is made, and native runtime on a device or emulator was not tested here.
