# Breaker Fixes and Tasks 6–8 Completion — Design

**Date:** 2026-08-19. **Branch:** `codex/eve-governed-production-release` (clean HEAD `d075f75d` at design time).
**Supersedes nothing:** this design completes `docs/superpowers/plans/2026-08-18-eve-governed-production-release.md`
after its Task-5 terminal breaker verdict (SDD ledger, `progress.md` line "BLOCKED by terminal breaker review at d075f75d").
**Binding order:** code and measured evidence > FOUNDATION > BUILDING-COMPASS > this design.

## 1. Goal

Fix the three Task-5 terminal falsifiers, complete Tasks 6–8, and ship `reelier@0.32.1` to npm, MCP
Registry, and GHCR through the governed four-definition path: one human-signed mission authorization,
one pre-publish human review (mission #1 only), one post-release review. Governing metric: reconciled
Outcomes per human review. All evidence is engineering / tenant-#1 evidence, never market evidence.

## 2. Settled decisions (operator-confirmed 2026-08-19)

1. **Publish gate:** pre-publish human review on mission #1 only, enforced by the GitHub
   `production-release` environment required-reviewer on all three publish workflows (post-tag,
   pre-publication). Removed after two clean missions — evidence-led widening per FOUNDATION v1.4.
2. **Hotfix timing:** coupled to the mission, with an armed **Sep 1 auto-decouple**: if `0.32.1` has
   not shipped by 2026-09-01, the Task-1 CLI-help fix is cherry-picked onto `origin/main` and shipped
   plainly that day; the mission re-points at `0.32.2` (version-collision refusal handles the re-point).
3. **Cell topology:** customer-held Authority Cell on **Fly.io** ("like a real customer would") —
   operator's Fly account, Cell-only credential custody, no Cloud control plane. Managed productization
   stays postponed.
4. **Approach:** three parallel lanes with one sync barrier (operator-selected option B).
5. **Eve fallback (accepted earlier):** 2 working days to bind real Eve; then the mission runs on
   Codex/Claude Code through the same harness-neutral contract and the Eve gap ships as a finding.

## 3. Architecture — three lanes, one barrier

Lanes are file-disjoint and run concurrently on `codex/eve-governed-production-release`:

- **Lane 1 — kernel:** the three breaker fixes + scoped Task-5 re-review. Only lane touching
  `src/authority/host`.
- **Lane 2 — release surface:** `.github/workflows/npm-publish.yml`, shared offline verifier script,
  edits to the two existing tag workflows, live GitHub HTTPS provider. Consumes Task-4 frozen contracts.
- **Lane 3 — substrate + admin:** Fly Cell serving authority over HTTP, substrate-certification tests,
  human-owned admin setup.

**Barrier criteria (all required):** Lane-1 scoped re-review passed; Lane-2 live-provider smoke against
the rehearsal repo passed; Lane-3 Cell deployed with certification gaps explicitly recorded and admin
checklist complete; integrated branch passes the full Ubuntu suite.

**Post-barrier order:** infra PR → `main` (normal human-reviewed PR; prerequisite construction per the
recorded ruling, never the governed candidate; worktree CLAUDE.md re-pin rides along) → follow-up PR
re-pinning `RELEASE_BASE` + workflow digests in `src/authority/release-contracts.ts` to the post-merge
head → Eve→ingress smoke → two consecutive clean rehearsals → mission.

## 4. Lane 1 — kernel fixes (fix order: 4.1 → 4.2 → 4.3; every fix lands RED-first)

### 4.1 Receipt integrity (`src/authority/host/receipts.ts`)

Defect: node validation (line 204) checks `head.evidenceDigest` by format regex only (line 161) and
never recomputes it from the digest-bound preimage (line 127); chain-walk-driving head fields are
trusted unbound; no parent-directory fsync exists anywhere (only file-handle syncs at lines 92, 188);
a lost terminal dirent silently rolls the head back to `reservation` (walk stops at line 212, returns
at 219) even for a `dispatched` query.

Fix:
- In `loadDurableChain` validation: recompute the evidence digest from
  `{v, receiptRef, identity: node.head.identity, phase, terminalKind, providerResultDigest}` and
  require strict equality; cross-check `head.phase`, `head.terminalKind`, `head.priorReceiptRef`,
  `head.reservationReceiptRef`, `head.v` against the digest-bound `node.preimage`. Mismatch throws the
  existing invalid/conflicting `TypeError`. (Identity choice: recompute uses `node.head.identity`,
  already digest-proven equal to the query identity at line 204.)
- Thread the query's `ledgerState` into `loadDurableHead`/`loadDurableChain`: a `dispatched`/`ambiguous`
  query whose reconstructed head is `reservation`-phase **refuses** (closes the silent-rollback readback).
  The check lives loader-side (host boundary), not in the dispatch caller.
- New `syncDirectory(dir)` helper (`open(dir,'r')` → `handle.sync()` → close): called after the node
  create in `writeImmutable`, after the durable-dir `mkdir` (line 134), and after the legacy rename
  (line 93). Hard-required on `process.platform === 'linux'`; tolerated failure codes elsewhere (tests
  run on win32 under the platform override).
- Harden `writeImmutable` to temp-file + fsync + rename + dir-fsync so mid-write crash cannot leave
  partial JSON under the final node name (currently bricks readback at line 202 and poisons the
  EEXIST byte-compare at 191). `legacyPublish` keeps its existing shape plus the rename dir-fsync.

RED tests (in `test/authority/receipts.test.ts`, following its lines 26–43 template):
(a) forge `node.head.evidenceDigest` (well-formed, wrong value) → restart → `loadDurableHead` rejects;
sibling case tampers `head.terminalKind`. (b) unlink the terminal node (the post-crash state the
missing dir-fsync produces) → `dispatched` query rejects instead of returning `reservation`.
(c) seam-based ordering test asserting a directory-fd sync follows node create, durable-dir mkdir,
and legacy rename — via a module-level test hook following the `__testSetAuthorityCellHostPlatform`
precedent (no new options key; preserves closed-options style).

### 4.2 ID seam (`receipts.ts`, `github-release-runner.ts`, `dispatch.ts`)

Defect: the shipped fs-ledger mints reservation IDs as raw `sha256:<64hex>` (durable on-disk state);
the new durable/journal stack requires a colon-free identifier; exactly one bridge exists
(`durableIdentity`, `dispatch.ts:332`, `sha256:<hex>` → `reservation_<hex>`) and consumers mix raw and
normalized forms. Primary strand: `receipts.ts:113` compares normalized identity vs raw state ID and
throws after send-started commit, before provider send; recovery then aborts at `dispatch.ts:274`.

Fix direction (lower blast radius, no digest churn): **`reservation_<hex>` is the single canonical
durable/journal identity form.** Extract the inline mapping into one shared helper
(`normalizeReservationPublicationId`) and use it at every seam: the `receipts.ts:113` guard, the
`receipts.ts:143/:153` identity-map set/get keys, the runner's journal `requestId` (`:195`), and the
runner's identity-map keys and confirmation id (`:229–255`). Raw `sha256:` remains wherever the shipped
ledger requires it: the ledger API, `PreparedDispatchDescriptionV1.reservationId`
(`fs-ledger.ts:591` binding), and the coordinator capability stamps (both sides raw today).
**`src/authority/host/fs-ledger.ts` is not modified.** The portable-wire `sha256.` convention
(`source.ts:106`) is not introduced here.

RED tests (real-artifact fixture rule, §9): drive dispatch through a reservation minted by the real
`FsAuthorityLedger` — publish-reservation no longer throws; crash after send-started; restart; recovery
walks to a terminal state without stranding; runner journal keys and `confirmAuthoritativeHead` load
the same identity; restart-recovery through the runner finds its requests.

### 4.3 Serve injection (`src/authority/cli.ts`, new provider-config parser)

Defect: `authority serve` never imports `createGitHubReleaseAuthorityRuntime`; `localRuntimeOptions`
(cli.ts:295–301) carries no runner; all four release endpoints permanently refuse
(`dedicated-release-runner-absent`) on the only documented production path.

Fix:
- New closed operator flag `--release-runner-config <file>` (pattern: `--certification-config`,
  cli.ts:286–288) parsed by a new closed parser; constructs the branded runner in-process via
  `createGitHubReleaseRunner` (journal signer, evidence signer, absolute rootDir, authorization
  resolver, provider, `now`). Credential material arrives only as `SecretResolver` references —
  never in `authority.yml` (local.ts:64 rule).
- `AuthorityServeHostCompositionDependencies` gains `createGitHubReleaseRuntime`;
  `composeAuthorityServeHost` accepts the runner as an **explicit parameter** (never inside the
  options record — `local.ts:104` rejects an options key) and routes: runner present →
  `createGitHubReleaseAuthorityRuntime(config, runner, options)`.
- Fail-closed startup: config definitions equal to the four release aliases **without** a constructible
  runner → refuse to start with an actionable message (hermetic four-alias setups pass a loopback
  fixture provider config instead). stdio transport + runner → refuse (Fly serves HTTP).

Test through **public command dispatch** (Task-3 lesson: the existing pass-through test at
`authority-serve.test.ts:29–44` proves nothing): spawn `dist-test/src/cli.js authority serve …` like
the bootstrap test, or `runAuthorityCommand` with only `startHost` stubbed via
`__testSetAuthorityServeRuntime`, keeping real composition dependencies so the factory's guards run.
Positive case with loopback fixture provider; fail-closed cases (four aliases w/o runner config;
definitions ≠ exact four; missing deployment/trust-pin) through the same dispatch; runner public
surface still refuses `run`/`recover`. win32 skips; platform seam for in-process runs.

### 4.4 Scoped Task-5 re-review

Per the Task-1→Task-2 carry precedent: one fresh dispatch fixes 4.1–4.3; one scoped independent
re-review covers the three falsifiers plus adjacent surface only. No sixth in-task fix round. No
release evidence consumes Task 5 until this passes.

## 5. Lane 2 — release surface

- **`.github/workflows/npm-publish.yml`** (missing fourth committed workflow; path already bound in
  `RELEASE_WORKFLOWS`): `on: push tags v*` + `workflow_dispatch`; `permissions: id-token: write,
  contents: read`; `environment: production-release`; GitHub-hosted Node 24; `fetch-depth: 0`;
  steps: ancestor guard (`scripts/check-release-ancestor.mjs`) → shared verifier → clean `npm ci` +
  build → `npm pack`, tarball digest must equal signed `StagedCandidateManifestV1.packedTarballDigest`
  (exact bytes; mismatch refuses) → `npm publish --provenance`; per-version concurrency key.
  Destination reconciliation before any retry: matching published integrity → reconciled success;
  conflicting → terminal failure; uncertain → pending, never resent.
- **Shared verifier** `scripts/verify-release-authorization.mjs` (house rule: shared script over
  inline run, per `check-release-ancestor.mjs`'s own rationale): loads canonical signed artifacts,
  runs `parseCanonicalSigned*` + `parseSignedReleaseOperationPlanV1` +
  `verifyReleaseAuthorizationBundleV1` from the `src/authority` barrel. Called by all three tag
  workflows: inserted in `mcp-publish.yml` between guard (line 29) and install (line 31); in
  `docker-publish.yml` after the guard under the same tags-only condition. Both workflow edits also
  add `environment: production-release` to their tag-triggered publish jobs so the mission-#1
  required-reviewer gate covers all three surfaces, not only npm (§2.1); the environment reference
  stays after the reviewer is removed (it then gates nothing). Receipt-graph verification
  (`verifyReleaseReceiptGraphV1`, 15 lanes, provider readback) is **post-publish only**: mission final
  verification and the Task-8 gate — never claimed pre-publish.
- **Authorization transport (DECIDED 2026-08-19 by the operator, after the B1 contract check
  escalated):** the B1 investigation
  (`.superpowers/sdd/2026-08-19-breaker-fixes-and-tasks-6-8/task-B1-report.md`) found neither
  original carrier fits the frozen Task-4 contracts: tag creation is a lightweight `createRef` with
  no message surface, and candidate publish writes exactly one governed ref. Decided transport: an
  **out-of-band authorization ref** `refs/reelier/release-authorizations/v0.32.1`, written by the
  Cell's mission tooling outside the four governed definitions. This is sound because the artifacts
  are **self-authenticating** — Ed25519-signed and digest-bound, verified against the committed
  trust pin (R4) — so the transport is untrusted by construction: tampering fails signature
  verification, absence fails closed. The ref write is evidence transport, never a provider effect
  on the release path, and is recorded in the mission evidence. Workflows add one explicit
  `git fetch origin +refs/reelier/*:refs/reelier/*` step before the verifier. No frozen contract is
  amended.
- **Live GitHub HTTPS provider** `src/authority/host/github-release-https-provider.ts`: the 14 closed
  `GitHubReleaseProviderV1` methods (incl. `npmVersionExists`) over the existing json-https driver;
  credentials via `SecretResolver` refs. Hermetic tests against the existing fake-provider suites plus
  one live smoke against the rehearsal repo before any rehearsal counts.

## 6. Lane 3 — Fly substrate + admin

- **Cell:** deploy the branch-built artifact to the operator's Fly account using
  `infra/fly/authority-cell` (HTTP transport); entrypoint runs `authority serve
  --release-runner-config …`; ledger + durable receipts on a Fly volume (Lane 1's fsync work is
  load-bearing here). Credential: fine-grained PAT scoped to `seldonframe/reelier` (contents +
  pull-requests write, ~14-day expiry) imported via `fly secrets` into the Cell only.
- **Substrate certification (honest scope):** credential-isolation — secret-canary scan over logs,
  evidence, receipts; durable-ledger — machine-restart-mid-dispatch rehearsal case; account-binding +
  freshness — existing contract checks; topology evidence — port the certification-branch Fly probe
  runner (pins `flyctl`, reads Machine image + network policy, signs evidence), timebox 3 days;
  **egress-denial is the honest gap** — attempt the port; on stall the mission proceeds with egress
  recorded `unchecked` in the receipt plus a named follow-up. Stated, never silently claimed.
- **Admin checklist (operator, ~hours, start immediately):** npm Trusted Publisher registration
  (`reelier` ↔ `seldonframe/reelier` + `npm-publish.yml` + `production-release` environment); GitHub
  App installed; branch protection with required CI contexts; `v*` tag protection permitting the
  Cell's PAT identity; `production-release` required reviewer = operator (mission #1); disposable
  rehearsal repo; dummy registries — Verdaccio container (npm) and scratch GHCR package rehearse
  live-shaped; the MCP Registry lane rehearses dry-run and is **recorded as dry-run**, not covered.

## 7. Rehearsals and mission

- **Eve smoke** (post-barrier, pre-rehearsal): real Eve 0.39 agent against the Fly Cell ingress —
  `jobs.search` → `load` on the four-definition Job Card. 2-day timebox → harness fallback (§2.5).
- **Rehearsals:** two consecutive clean full-path runs on Fly + disposable repo + dummy registries,
  with fault injection: injected timeouts, duplicate invocations, machine restart mid-dispatch, plus
  the three breaker classes as permanent cases — tampered evidence digest → refusal; lost terminal
  dirent → refusal; absent/lookalike runner → startup refusal. Any failure resets the counter.
  Rehearsal is prerequisite evidence only, never production-pass evidence.
- **Mission #1 timeline:** quality evidence (full suite, coverage, mutation ≥9000bp bound to the
  candidate head) is generated **before signing**, so the 12-hour authorization window covers only
  branch → PR → merge → review → tag → publish. Sequence: human signs mission authorization + bundle →
  Eve organization executes (root + eight roles; root decomposes, collects evidence, invokes signed
  jobs, never edits the candidate) → candidate branch → draft PR → ready → CI evidence → exact-SHA
  squash merge, reconciled → tag `v0.32.1` → all three publish workflows queue on the
  `production-release` environment → **the operator's single pre-publish review approves them** →
  publication → destination reconciliation → fresh Windows + Ubuntu installs of the published package
  run the complete help matrix → offline receipt-graph verification (15 lanes `verified`,
  completeness `unchecked`) → post-release review. A rejected review leaves a tag on merged `main`,
  zero publications, and an immutable failed-mission record — publication, not the tag, is the
  guarded irreversible exit. Missions #2–3: same shape; the environment reviewer is removed after two
  clean missions.

## 8. Task-8 production success criteria

Unchanged from the plan, plus this design's additions: exactly one upfront authorization, one
pre-publish review (mission #1), one post-release review, zero routine approvals; no agent holds a
provider write credential; no write outside the four authorized transitions and declared downstream
workflow effects; no duplicate branch/PR/merge/tag/npm/MCP/GHCR effect; `origin/main`, `v0.32.1`,
npm, MCP Registry, GHCR reconcile to the authorized release; fresh installs receive the fixed CLI;
receipt graph verifies offline with every required lane `verified`; no bypass, hidden manual
correction, or semantic widening. Any missing item falsifies the mission even if artifacts shipped.

## 9. Testing discipline

- **Real-artifact fixture rule (new, binding):** integration-seam tests consume artifacts produced by
  the real producer code path (the ID-seam defect survived a 168-green gate on fabricated fixtures).
- Every breaker fix lands RED-first with the falsifier reproduced before the fix.
- Every rehearsal fault maps to exactly one expected classification: refusal, ambiguity,
  reconciliation, or explicit non-pass. No-resend proofs carry over untouched.
- Suites: focused per-lane gates + full Ubuntu suite at the barrier + Task-8's full gate set.

## 10. Kill thresholds and contingencies (pre-committed)

- Eve binding: 2 working days → harness swap, Eve gap recorded.
- Fly probe-runner port: 3 days → egress `unchecked` + named follow-up.
- Rehearsal failure → ×2 counter resets.
- **2026-09-01:** `0.32.1` not shipped → plain hotfix ships that day; mission re-points `0.32.2`.
- Authorization-transport contract check fails both options → operator exception decision, never a
  silent contract widening.

## 11. Non-claims

Passing proves declared-path transitions and reconciled provider state. It does not prove semantic
correctness, safety, traffic completeness (`unchecked` forever in v1), rollback capability, formal
segregation of duties, egress denial (unless the port lands), MCP-lane rehearsal coverage (dry-run),
or 1,000-person-company equivalence. The 1,000-person horizon is earned only if reconciled Outcomes
grow while human reviews stay approximately constant. Tenant-#1 evidence is a demo, not market
evidence (FOUNDATION).
