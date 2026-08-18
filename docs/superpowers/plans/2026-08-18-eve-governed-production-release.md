# Eve-First Governed Production Release Implementation Plan

## Goal

Build the deterministic release authority, common release verifier, receipt graph, and Eve 0.39.0 mission needed for one post-supervision production release of Reelier 0.32.1. The eventual mission candidate is restricted to the CLI help fix (`src/cli.ts`, one dedicated test, and `CHANGELOG.md`); the infrastructure in this branch is prerequisite construction and is not represented as part of that candidate authorization.

## Global constraints

- Work from `e600ad5c2dc5e1bde0714915e7a84980c8d5602b` in the isolated `codex/eve-governed-production-release` worktree.
- Preserve the original dirty checkout and selectively port only Eve descendant cleanup and required certification-manifest preparation.
- Use test-driven development, closed parsers, deterministic canonical digests, durable journals, exact readback reconciliation, and no resend after ambiguous writes.
- Agents receive only opaque references and choices. Provider credentials and all destination identity remain Authority Cell-owned.
- `pending`, `absent`, `unchecked`, ambiguity, and missing evidence never pass.
- Do not publish, merge, or tag until the complete implementation, rehearsal, current provider/admin configuration, and signed production artifacts have independently verified.

## Task 1 — CLI help product contract

- Add a dedicated exhaustive command-surface test that first demonstrates subcommand `--help` and `-h` invoke handlers or side effects.
- Implement the earliest possible read-only help exit for every command in the dispatch switch.
- Assert exit 0, usage output, no subprocess/network calls, no home/workspace/state changes, bounded runtime and memory, and unchanged normal command behavior.
- Record the fix in `CHANGELOG.md`.

## Task 2 — Eve 0.39.0 continuity baseline

- Upgrade the real-process fixture from Eve 0.37.1 to 0.39.0.
- Selectively port descendant-process cleanup and its regression test from `codex/linux-eve-cleanup-followup`.
- Prepare real certification input manifests only if the customer-held Cell path requires them.
- Run all ten continuity scenarios; retain older reports as historical evidence only.

## Task 3 — Multi-definition signed Job Cards

- Remove the local host’s exactly-one-definition restriction.
- Return one deterministic opaque `jobRef` per signed definition.
- Resolve search/load/invoke only inside the authenticated task, principal, child allocation, and signed Job Card.
- Add refusal tests for cross-task/tenant/allocation references, conflicting references, stale grants, request-ID semantic conflicts, and restart recovery.

## Task 4 — Closed release contracts

Files touched:

- `docs/superpowers/plans/2026-08-18-eve-governed-production-release.md`
- `src/authority/release-contracts.ts`
- `src/authority/types.ts`
- `src/authority/index.ts`
- `test/authority/release-contracts.test.ts`
- `SPEC.md`
- `docs/specs/release-contracts-v1.md`

- Add closed, canonical, signed `ReleaseAuthorizationBundleV1`, staged candidate manifest, release policy, and `ReleaseReceiptGraphV1` contracts.
- Bind all identities, digests, paths, size limits, expiry, four effect allocations, destinations, CI evidence, tarball, and workflow.
- Keep completeness explicitly `unchecked` and prevent any non-verified required lane from producing success.

## Task 5 — Four governed GitHub release Outcomes

- Add reviewed definitions for candidate publication, draft-PR ensure, exact-SHA squash merge, and non-force tag creation.
- Implement exact Git Data/PR/ref readback reconciliation with durable crash boundaries.
- Add hermetic provider tests for duplicates, every internal timeout point, conflicts, drift, failed checks, stale authority, tampering, and ambiguous no-resend behavior.

## Task 6 — Common tag-release authorization verifier

- Implement one offline verifier used by npm, MCP Registry, and GHCR workflows.
- Verify bundle, tag, commit, tree, version, tarball, expiry, CI, receipts, destination preflight, and default-branch ancestry.
- Convert npm publication to workflow-bound OIDC trusted publishing on GitHub-hosted Node 24 and a `production-release` environment.
- Retain the existing Action `@v1` runtime and add per-version concurrency plus destination reconciliation.

## Task 7 — Real Eve mission and rehearsal

- Implement the Eve 0.39.0 root orchestrator and eight single-purpose roles without provider credentials.
- Root may decompose, collect evidence, and invoke signed jobs, but never edit the candidate.
- Run the same signed transitions in a disposable repository with injected timeouts, duplicate invocations, restart recovery, dummy registries, and offline receipt verification.

## Task 8 — Integrated verification and production gate

- Run supported Windows checks and the full Ubuntu suite, packed-consumer checks, continuity, coverage comparison, mutation score >=90, release preflight, and offline receipt-graph verification.
- Obtain independent whole-branch review and resolve every Critical/Important finding through fresh implementer/reviewer cycles.
- Verify external branch/tag rules, GitHub App installation, npm trusted publisher, environment, and signing-key setup without exposing credentials.
- Only then create the immutable signed mission inputs and execute branch, PR, merge, tag, and three-surface publication. Reconcile fresh Windows and Ubuntu installations before the human’s post-release review.
