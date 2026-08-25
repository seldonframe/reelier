# Genuine Governed Outcome Composition

## Status and purpose

Task 5 is paused. Independent review proved that `createGitHubLinearMissionRuntimeV1` fabricated an `AuthorityLedger`, reserved handles, activation, authorization, and neutral receipt heads. This prerequisite deletes that substitute path and makes the two reviewed missions execute through the real signed local authority chain:

> signed contracts and Job Card → authenticated opaque reference → AuthorityGate → FsAuthorityLedger → prepared DispatchCoordinator with durable publication → OutcomeKernel → branded GitHub/Linear executors.

The prerequisite is hermetic and performs no external provider writes. It proves authority, recovery, and composition; it does not certify live GitHub or Linear behavior.

## Non-negotiable invariants

- The canonical `TransportEffect` stored by `FsAuthorityLedger` is the durable authority bridge. It commits the exact alias, signed Path-C contract digest, Task-4 `ToolEffectContract` digest, transport-binding digest, compiled-effect-input digest, and model/request commitment in a closed `GovernedEffectCommitmentV1` precondition.
- A WeakMap capability may protect a live call, but it is never restart authority. On restart the bridge is rederived from verified signed contracts, canonical ledger effect bytes, and compiled Task-4 inputs.
- Existing reservations never receive a re-minted dispatch handle. Exact-existing, ambiguous, dispatched, and restarted work is readback-only. A send-capable handle exists only for a newly accepted reservation.
- Current authority is revalidated by the same admitted gate/state composition immediately before consequential dispatch. Expired, revoked, drifted, or substituted authority refuses before credential resolution or provider invocation.
- Prepared dispatch carries the coordinator's exact one-call capability through commit and revokes it in `finally`. It also owns the existing durable publication head. No journal event may substitute for a coordinator receipt/publication head.
- Signed journal storage is only a tamper-evident lifecycle index. Verified Outcomes must bind the exact coordinator publication head for their reservation and effect.
- Aggregate GitHub+Linear authority is derived only from five compatible verified signed reservations. Raw caller authority, aliases, provider scopes, or credentials are never accepted.
- The existing one-definition governed Cell behavior remains the default. A new reviewed profile admits only the exact five-alias set below; arbitrary multi-definition governed Cells remain refused.
- Legacy release, gate, dispatch, kernel, transport, job, MCP/HTTP, package, and packed-consumer paths remain source-compatible.

## Exact reviewed alias set

- `github_release_candidate_publish_v1`
- `github_release_pr_ensure_v1`
- `github_release_pr_merge_v1`
- `linear_evidence_comment_v1`
- `linear_status_transition_v1`

Do not change the existing four-alias `githubReleaseAliases` constant, which still includes tag creation for the release runtime. Add a separate exact composition alias constant.

## Implementation phases

### 1. Canonical durable digest join

Add a closed, inert `GovernedEffectCommitmentV1` parser/digest in `src/authority/governed-effect-commitment.ts`. Static GitHub-release and Linear compilers must emit its digest as a named `TransportEffect.preconditions` entry. The commitment binds:

- definition alias and signed Path-C contract digest;
- Task-4 contract and transport-binding digests;
- canonical compiled-effect-input digest;
- request/model commitment and operation kind;
- reviewed policy/pack/definition digests.

The compiler builds this from the actual signed `OutcomeContract`, validated policy, projected source, and closed choices. It may not accept any commitment digest directly from model input.

Add an internal gate reservation authority keyed to the genuine `AuthorityGate` instance and newly accepted handle. It exposes verified reservation metadata to the local composition without consuming or cloning the handle. Existing decisions expose status/linkage only and never a handle.

The internal governed binding revalidates every field against the canonical ledger effect and signed contract. Structural copies, proxies, JSON, provider results, cross-alias, cross-reservation, and cross-Cell substitutions refuse.

### 2. Prepared coordinator authority and publication

Extend prepared dispatch so the coordinator mints the same exact one-call capability used by the non-prepared path and passes it through commit. A failed delegate bind refuses before host-binding or executor calls. Cleanup occurs on success, refusal, and throw.

Add an all-or-none governed publication resolver. It returns a receipt reference only when the durable coordinator head matches the exact reservation, effect digest, result/evidence digest, and publication chain. Missing, pending, conflicting, forked, or mismatched heads are not verified.

OutcomeKernel's governed option is closed and opaque. Without it, retain the existing equal-digest legacy invariant. With it, validate the durable commitment join, genuine reservation, current gate revalidation, exact prepared coordinator call, and publication resolver. Existing/restarted reservations can reconcile/read back but cannot dispatch.

### 3. Signed Linear definitions and governed Cell profile

Add the two-definition Linear static pack. Each definition emits a canonical Path-C `TransportEffect` carrying the durable commitment above and a one-effect allocation policy. The status definition binds the exact comment predecessor alias/contract/receipt requirements.

Register the pack, sources, import allowlists, build-pack manifest handling, exact alias/source conformance inventories, and package exports.

Add a reviewed governed-Outcome Cell profile that admits exactly the five aliases in canonical order, verifies all five signed contracts/Job Card bindings, preserves profile-governed receipt publication, and derives a single compatible aggregate scope. Any missing, extra, duplicate, tag, reordered, cross-repository, cross-workspace, cross-project, or incompatible reservation refuses startup or pre-dispatch.

### 4. Tamper-evident lifecycle and genuine runtime

Keep `createFileOutcomeKernelStorage` and its on-disk ABI unchanged. Add a separate signed-journal-backed governed storage constructor using `createSignedJournal.withLease` and `durability.syncDirectory`. Normalize journal IDs; do not use raw `sha256:` reservation IDs as filenames/IDs.

Journal events may record mission/effect/attempt/observation/outcome/review phases and reference coordinator heads, but cannot create authority or publication. Folding verifies signatures, chain/head, exact identities, monotonic phases, semantic conflicts, and the referenced coordinator head.

Replace the Task-5 runtime implementation:

- delete `RuntimeLedger`, direct handle minting, unconditional authorization, self-created activation, raw authority input, generic provider dispatch, and neutral unsigned publication;
- compose only the signed local governed-Outcome Cell, genuine gate/FsLedger/prepared coordinator/publication, OutcomeKernel governed binding, `createGitHubReleaseOutcomeExecutorV1`, `createLinearOutcomeExecutorV1`, and the Task-4 predecessor capability;
- derive opaque Outcome refs through the existing gate-keyed task/principal/grant/allocation/session/Cell/Job-Card binding;
- make Linear-only reserve/execute exactly two Linear effects and zero GitHub effects;
- make raw legacy Task-5 options fail before filesystem, credentials, or provider calls.

Task 5 resumes only after this prerequisite independently ships. Its Eve recovery test must then route the replacement runtime instance and validate native action outputs plus durable coordinator/Outcome/receipt evidence.

## Files

Create:

- `src/authority/governed-effect-commitment.ts`
- `src/authority/host/governed-outcome-composition.ts`
- `src/packs/linear-outcomes/manifest.ts`
- `src/packs/linear-outcomes/compile.ts`
- `src/packs/linear-outcomes/source.ts`
- `src/packs/linear-outcomes/reconcile.ts`
- `src/packs/linear-outcomes/index.ts`
- `test/authority/governed-effect-commitment.test.ts`
- `test/authority/governed-outcome-composition.test.ts`
- `test/authority/linear-outcomes-pack.test.ts`

Modify:

- `src/authority/gate.ts`
- `src/authority/pack.ts`
- `src/authority/packs/github-linear-outcomes.ts`
- `src/authority/host/local.ts`
- `src/authority/host/governed-cell.ts`
- `src/authority/host/dispatch.ts`
- `src/authority/host/prepared-dispatch.ts` only to preserve the exact optional bounded deterministic-refusal `reason` through its closed outcome sanitizer
- `src/authority/host/outcome-kernel.ts`
- `src/authority/host/effect-transports.ts`
- `src/authority/host/outcome-kernel-fs-storage.ts`
- `src/authority/host/github-linear-mission-runtime.ts`
- `src/authority/host/github-release-runner.ts` only to preserve and forward the exact optional `CoordinatorDispatchCallV1` through its prepared fallback adapter
- `src/authority/host/linear-outcome-runner.ts` only to require and consume the exact coordinator call capability for both reviewed Linear writes
- `src/authority/host/index.ts`
- `src/authority/host/receipts.ts` only if the existing publication-head resolver cannot express the exact governed query without change
- `src/packs/github-release/manifest.ts`
- `src/packs/github-release/compile.ts`
- `src/packs/index.ts`
- `src/packs/conformance.ts` only to extend the exact reviewed alias/source inventory for the two signed Linear definitions
- `scripts/build-packs.mjs`
- `test/authority/gate.test.ts`
- `test/authority/governed-cell.test.ts`
- `test/authority/dispatch-coordinator.test.ts`
- `test/authority/prepared-dispatch.test.ts` only to pin closed refusal-reason preservation and all existing ambiguity behavior
- `test/authority/outcome-kernel.test.ts`
- `test/authority/effect-transports.test.ts`
- `test/authority/outcome-kernel-fs-storage.test.ts`
- `test/authority/github-linear-mission-runtime.test.ts`
- `test/authority/github-release-runner.test.ts` only to pin prepared fallback call-capability forwarding and existing GitHub behavior
- `test/authority/github-linear-outcomes.test.ts` to pin genuine branded GitHub/Linear executor composition and exact coordinator-call consumption for comment and status
- `test/authority/github-release-serve-fixture.ts` only to add an opt-in executable-candidate variant whose real file bytes and digests are signed by the existing fixture authority for the full governed composite test
- `test/authority/local-multi-definition-jobs.test.ts`
- `test/authority/receipts.test.ts` only if `receipts.ts` changes
- `test/authority/package.test.ts`
- `test/packs/conformance.test.ts`
- `test/acceleration-preflight.test.ts` only to update the exact generated first-party manifest count from eleven to twelve, retain uniqueness, preserve one-definition status for every other pack, and pin the only two multi-definition exceptions: GitHub release with its existing four aliases and Linear outcomes with its exact two aliases
- the focused GitHub-release pack tests that pin its closed policy/effect commitment
- `.superpowers/sdd/2026-08-21-genuine-governed-outcome-composition/task-4c-report.md`

Do not modify `src/authority/host/signed-journal.ts` unless a RED test proves its existing identity/lease semantics cannot support the index. Any such scope change requires a tracked amendment first.

### Independent-review fix round

Before Task 4C may ship, close these exact blockers without widening the architecture:

- aggregate all five effect Outcomes; any failed, partial, pending, absent, missing publication, or missing predecessor prevents reconciled mission success;
- revalidate the same signed gate authority after asynchronous prepare/host resolution and immediately before prepared CAS/send;
- require the exact coordinator call capability in the three GitHub writes and both Linear writes, and construct the runtime only from the branded GitHub and Linear executors;
- expose an opaque readback-only linkage for exact-existing accepted reservations so crash after gate acceptance/before mission indexing can recover without reminting a handle or resending;
- bind the publication resolver object and exact query identity to the durable governed join, refusing duck-typed/cross-reservation/effect/head substitutions.

Add deterministic RED tests for every blocker, including failure in candidate/PR/comment groups, revocation during prepare, direct/copy/replay call attempts for all five writes, crash at the accepted-before-index boundary, restart after verified comment before status, and publication resolver/query substitution.

The signed GitHub release authorization must bind one canonical digest of the exact reviewed candidate/PR/merge operation pack, not a digest derived from whichever operation is active. The branded GitHub executor must prove that each active alias, Task-4 contract, transport binding, and reviewed policy is an exact member of that immutable three-operation pack before provider access. Per-reservation effect identity and authenticated request identity remain independently exact; tag and any fourth/substituted operation are not members.

## Required falsifiers

- Every commitment field substitution refuses before host binding/provider calls.
- The durable ledger effect alone is sufficient to rederive the digest join after a full process recreation; deleting all WeakMap state does not weaken checks.
- Existing reservations never regain a send-capable handle; ambiguous recovery performs authoritative readback only.
- Revocation/expiry/base state drift after reservation but before prepared commit refuses with zero provider calls.
- Prepared call capability cannot be stolen, rebound, replayed, copied, serialized, or survive `finally`.
- Missing/pending/conflicting/forked publication heads cannot yield verified Outcomes.
- Status without the exact verified comment Outcome, signed lifecycle receipt, and coordinator head refuses.
- Exact concurrent requests converge; same request ID with changed choices/source/context refuses before dispatch in same and separate processes.
- Journal tamper, rollback, fork, gap, stale lock, symlink/root substitution, temp crash, and receipt substitution refuse or recover without resend.
- The exact five-alias profile admits only compatible signed contracts and rejects tag/extra/missing/duplicate/reordered/cross-scope sets.
- Linear-only produces no GitHub reservation, provider call, field, or receipt.
- Existing single-definition governed Cell, four-alias GitHub release runtime, local multi-definition jobs, legacy equal-digest kernel/transport, prepared/non-prepared dispatch, package exports, build-packs, and packed consumers remain green.

## Verification

Use strict RED/GREEN commits per phase, both TypeScript builds, focused authority/pack/runtime suites, authority/outcome/bootstrap/adapter/package contracts, build-pack and packed-consumer gates, `git diff --check`, and independent review. Run the full suite once at the final boundary and report the exact honest aggregate. No external provider write, push, merge, tag, or publication is authorized.
