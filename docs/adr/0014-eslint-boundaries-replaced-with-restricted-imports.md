# ADR-0014 — eslint-plugin-boundaries replaced by restricted-import zones

- **Status:** Accepted
- **Date:** 2026-09-11
- **Supersedes:** the tooling named in ARCHITECTURE.md section 5.3

## Context

Section 5.3 specified `eslint-plugin-boundaries` as the first of three boundary
enforcement mechanisms. It was configured during Phase 0 and then tested with a
deliberate violation: an `apps/web` file importing `@clinic/db`.

**It did not fail.** The plugin matches its `boundaries/elements` patterns against
resolved file paths, and without an import resolver it cannot map a workspace
specifier like `@clinic/db` onto `packages/db`. Every cross-package rule was
silently passing. Making it work would have meant adding `eslint-plugin-import`
plus `eslint-import-resolver-typescript` and a path mapping kept in sync with the
workspace — a second copy of information pnpm already owns.

A rule that passes when it should fail is worse than no rule, because it is trusted.

## Decision

Enforce boundaries with two mechanisms instead of three:

1. **`@typescript-eslint/no-restricted-imports` zones** for fast in-editor feedback
   on the package-level rules (apps must not import the database, `packages/core`
   must not import a framework, contracts and UI stay free of both).
2. **dependency-cruiser** as the authoritative graph gate in CI — it additionally
   catches cycles, deep cross-module imports and unresolvable imports, none of
   which a per-file lint rule can see.

Each rule was verified by introducing a real violation and confirming a non-zero
exit, then removing it. The matrix is in the Phase 0 report.

## Consequences

- One fewer dependency, and the rules are readable inline with their rationale.
- ESLint zones must be repeated where flat config blocks overlap: flat config
  **replaces** a rule's options rather than merging them, so a narrower `files`
  block silently drops the wider block's patterns. This bit us once and is now
  commented at the site.
- dependency-cruiser is the gate that must stay green; lint is the fast signal.
