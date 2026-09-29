# ADR-0039 — The app runs the React Native its Expo SDK expects

**Status:** accepted · 29 Sep 2026 · supersedes the Metro patch of ADR-0038

## Context

A release export of the app (`expo export --platform android`, Hermes bytecode) failed in
`hermesc` with "private properties are not supported" — on React Native's own `DOMRectReadOnly`,
not on anything of ours. Metro bundling succeeded; only the bytecode step failed.

The cause was a version mismatch, not a missing Babel plugin:

- Expo SDK 56 targets **React Native 0.85** and **Hermes V1** by default. Its Babel preset
  therefore leaves `#private` class fields alone, because Hermes V1 runs them natively.
- The app pinned **React Native 0.83.3**, whose `hermes-compiler` is **0.14.1 — classic Hermes**,
  which does not support them. `expo export` takes `hermesc` from React Native's own
  `hermes-compiler` dependency.
- `expo install --check` listed `react-native@0.83.3 - expected version: 0.85.3`, with React
  19.2.3 and patch releases of the Expo packages.

Lowering private fields with Babel, or overriding `hermes-compiler` onto 0.83, would have made the
export pass while leaving the app on a combination the SDK does not support — and bytecode must
match the Hermes runtime built into the app, which is chosen by the React Native version.

## Decision

**The mobile workspace uses the versions `expo install --check` expects for its SDK.** For SDK 56:
`react-native@0.85.3`, `react`/`react-dom@19.2.3`, the matching Expo package patches,
`react-native-safe-area-context ~5.7.0`, `react-native-screens ~4.26.0`, `@types/react ~19.2.14`,
and `@react-native/metro-config@0.85.3` declared explicitly — pnpm had auto-installed 0.87.1 for
React Native's CLI plugin, which pulled a second Metro into the tree.

The web app keeps its own React (19.3.0); workspaces resolve React independently.

## Consequences

- `expo export` with bytecode succeeds for Android and iOS. The bytecode (Hermes format version 98) comes from `hermes-compiler@250829098.0.10`, the same Hermes V1 version React Native 0.85.3
  builds into the app (`sdks/hermes-engine/version.properties`, `HERMES_V1_VERSION_NAME`).
- One Metro remains (0.84.5, via `@expo/metro`). It measures images with its own parser, so
  `image-size` is gone from the tree, and with it ADR-0038's patch and override. Asset dimensions
  in the bundle are unchanged (checked on the same asset and hash).
- **TypeScript stays at 5.x** although the SDK suggests ~6.0.3: it is a compiler for this repo,
  not part of the app, and a major upgrade across every workspace is its own change.
- **Not tested on a device or emulator.** Exports, typecheck, lint and unit tests pass; native
  runtime behaviour on React Native 0.85 and Hermes V1 is unverified here. Expo's SDK 56 notes
  record a Hermes V1 memory regression with `react-native-worklets`/`reanimated`, fixed in SDK 57;
  this app has `react-native-worklets` in its tree through Expo, so memory is worth watching on a
  device.
- On the next SDK upgrade, run `expo install --check` (or `--fix`) before anything else.
