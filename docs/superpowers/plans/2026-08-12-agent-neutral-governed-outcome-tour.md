# Agent-Neutral Governed Outcome Tour Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a new Reelier user one provider-credential-free, external-network-free command that explains and demonstrates Paths A, B, and C through a genuinely governed, receipted, offline-verifiable Outcome without requiring or selecting an AI agent. Full Path C execution is Linux-hosted; native Windows demonstrates client configuration/identity semantics, host refusal, and offline verification.

**Architecture:** `reelier authority tour` is a CLI-internal orchestration over synthetic Path A/B inputs and the completed hermetic GitHub-label Path C lifecycle. It never reads agent histories, rewrites agent configuration, resolves a credential, calls a provider, opens a socket, or weakens production Authority Cell authentication. A closed report distinguishes demonstrations from detected local capability and preserves `verified`/`failed`/`unchecked`/`absent` exactly.

**Tech Stack:** TypeScript, Node.js test runner, existing Reelier coverage/discovery/compiler/runner modules, existing Authority Cell certification lifecycle, Adapter Contract v1, portable receipts and offline task-graph verification.

**Dependency:** Begin implementation only after `docs/superpowers/plans/2026-08-12-windows-client-linux-authority-cell.md` Tasks 4, 4A, 5, and 6 are complete, independently reviewed, and green against the exact packed artifact. This plan may reuse those reviewed internals but may not change their authority or proof semantics to improve onboarding.

## Global Constraints

- FOUNDATION and `BUILDING-COMPASS.md` govern: wide intelligence, narrow consequential exits; credentials and consequential values never come from model fields; receipts prove only covered transitions.
- **Teaching boundary:** Present these as independent layers: (1) production/provider access, identity authentication, and payment or settlement—none exercised here; (2) execution confinement—the fixture and Linux Cell boundary, not an agent sandbox; (3) Path B repeatability through a compiled skill/harness, which grants no authority; (4) the sole human-signed scoped authority handoff, child/session, budget, expiry, and revocation boundary; (5) dispatch under that authority; (6) authoritative provider observation/post-state and reconciliation; and (7) receipt/attestation binding and offline verification. Evidence at one layer never upgrades another.
- Optional reviewer agents are defense-in-depth readers of the signed evidence packet only. They are not trust roots, cannot sign, grant, or expand authority, and cannot turn `failed`, `unchecked`, `absent`, or attestation confidence `pending` into a pass. No reviewer agent runs in the fixture.
- The default tour is hermetic and deterministic: zero provider credential values, zero bearer/reference resolution, zero external network, zero provider SDK calls, zero writes outside its fresh confined fixture. Purpose-separated authority signing keys are generated inside the opaque Cell ceremony, never serialized or exposed, and are not provider credentials.
- The agent is optional. Do not prefer, install, launch, configure, or require any model, coding agent, desktop environment, or harness.
- Do not inspect real agent histories/configs by default. Synthetic inputs demonstrate Paths A/B; optional local detection must be a separately requested read-only mode and must report its evidence honestly.
- Production `/v1/identity` remains authenticated. The tour uses a closed in-process fixture transport and labels it `fixture`, never `live`.
- Do not export an executable tour/factory/provider constructor from public barrels. Public surface may expose only closed report parsing and offline verification where required.
- Preserve frozen Adapter Contract v1 digest `sha256:7f46242b26d9c921f4e1ec9de6418ac5fc8c03d70c4415c25e799ae0e73a1512`.
- Every behavior change follows RED → GREEN TDD in separate commits and receives an independent task review.

---

### Task 1: Freeze the tour report and closed CLI surface

**Files:**
- Create: `src/authority/certification/tour-report.ts`
- Create: `contract/client/v1/authority-tour-report.schema.json`
- Modify: `src/authority/cli.ts`
- Test: `test/authority/authority-tour.test.ts`
- Create: `.superpowers/sdd/2026-08-12-agent-neutral-governed-outcome-tour/task-1-report.md`

**Interfaces:**
- Produces `AuthorityTourReportV1`, `parseAuthorityTourReportV1(value)`, and CLI-internal `runAuthorityTour(options)`.
- Report sections are exact: `environment`, `teachingLayers`, `pathA`, `pathB`, `pathC`, `verification`, `metrics`, `nonClaims`.

- [ ] Write a failing test that `reelier authority tour --json` is recognized, accepts only `--json` and a confined `--output`, rejects credentials/endpoints/agents/callbacks, and returns a closed report whose unknown keys and accessors are rejected without invocation. Require exact non-claims: GUI participation `absent`; agent-sandbox evidence `absent`; universal agent compatibility `unchecked`; live plugin coverage `unchecked`; universal write completeness `unchecked`; production reachability/authentication `unchecked`; payment or settlement `absent`; external delivery `absent`; and live human review `absent`.
- [ ] Run the focused test and confirm failure because the command/report do not exist.
- [ ] Implement the closed parser/schema and a non-executable report skeleton in `src/authority/certification/tour-report.ts`; wire `tour` inside `runAuthorityCommand` without adding a top-level command.
- [ ] Run the focused test and contract/schema checks; confirm the skeleton reports all demonstrations `absent` and is not successful.
- [ ] Commit RED and GREEN separately and write the task report.

### Task 2: Demonstrate Path A with synthetic agent coverage

**Files:**
- Create: `src/authority/certification/tour-path-a.ts`
- Modify: `src/authority/certification/tour-report.ts`
- Test: `test/authority/authority-tour-path-a.test.ts`
- Create: `.superpowers/sdd/2026-08-12-agent-neutral-governed-outcome-tour/task-2-report.md`

**Interfaces:**
- Reuses only pure analyzers from `src/coverage.ts` and static config-shape fixtures informed by `src/init.ts`; it never calls collectors, `planInstall`, or `applyInstall`.
- Produces a `PathATourEvidenceV1` with `inputKind: "synthetic"`, observed MCP entries, wrap-visible entries, plugin-delivered gaps, and four-state claims.

- [ ] Write failing tests with synthetic Codex and Claude configurations plus a plugin manifest proving which MCP calls are visible and which remain outside the wrapper; inject home/config/history/network functions that throw if touched.
- [ ] Run tests and confirm failure because the vignette is missing.
- [ ] Implement the minimal synthetic analyzer and render a concise explanation of Path A’s live-proxy boundary without claiming completeness or installing anything.
- [ ] Run focused tests and assert all injected real-environment access counters remain zero.
- [ ] Commit RED and GREEN separately and write the task report.

### Task 3: Demonstrate Path B with a synthetic recorded workflow

**Files:**
- Create: `src/authority/certification/tour-path-b.ts`
- Modify: `src/authority/certification/tour-report.ts`
- Test: `test/authority/authority-tour-path-b.test.ts`
- Create: `.superpowers/sdd/2026-08-12-agent-neutral-governed-outcome-tour/task-3-report.md`

**Interfaces:**
- Reuses `compile` from `src/compile.ts`, `preflightManifest` from `src/manifest.ts`, and `dryRunSkill`/`runSkill` from `src/runner.ts` with an injected in-memory MCP transport. It does not call `renderSkillMd`, whose package-version read is outside this hermetic vignette.
- Produces `PathBTourEvidenceV1` binding the synthetic trace digest, compiled skill digest, manifest preflight, assertions, and replay record.

- [ ] Write a failing test for one synthetic read plus one idempotent in-memory write, including manifest drift refusal and no external process/network/filesystem access.
- [ ] Run tests and verify failure because the Path B vignette is missing.
- [ ] Implement the minimal compiler/dry-run/replay fixture; call the actual manifest preflight seam and `runSkill(..., { tools, allowWrites: true, dryRun: true })` so tools execute only against in-memory state while no run record is written. Keep content correctness out of scope.
- [ ] Run focused tests, including drift/tamper falsifiers, zero external access assertions, and proof that a verified repeatable replay still has Path C authorization `absent` and cannot authorize dispatch.
- [ ] Commit RED and GREEN separately and write the task report.

### Task 4: Promote the hermetic Path C fixture into a tour composition

**Files:**
- Create: `src/authority/certification/tour-path-c.ts`
- Modify: `src/authority/certification/github-issue-labels-runner.ts`
- Modify: `src/authority/certification/tour-report.ts`
- Test: `test/authority/authority-tour-path-c.test.ts`
- Create: `.superpowers/sdd/2026-08-12-agent-neutral-governed-outcome-tour/task-4-report.md`

**Interfaces:**
- Consumes the reviewed Task 4 lifecycle: initializer, preflight, signed readiness, opaque lifecycle authority ceremony, `createCertificationCellHost`, `createGitHubIssueLabelsHermeticComposition`, portable receipts, and graph exporter.
- Produces one internal `runHermeticPathCTour()` returning only sanitized evidence, graph, public trust material, terminal reason codes, and counters.

- [ ] Write a failing integration test that initializes a fresh confined fixture, proves authorization is `absent` and dispatchable is false, then exercises the sole fixture human authority-handoff ceremony over the exact opaque signed authority root. After the ceremony only the committed task, grant, budget, principal/session, adapter/resource/operation, and Outcome become dispatchable. Record `liveHumanReview: absent` as a separate claim; use the reviewed Tasks 4/4A root→child execution lineage, apply one label Outcome, reconcile an apply-then-cut without resend, restore exact state, and export a graph.
- [ ] Assert zero provider-credential or bearer-reference resolution, zero provider SDK calls, zero external network calls, no enumerable private keys, and no legacy raw-key host.
- [ ] Implement by promoting reusable fixture composition from the existing lifecycle test into production-internal code; do not import test utilities or expose an executable constructor.
- [ ] Run focused lifecycle/tour tests and verify every duplicate, conflict, ambiguity, refusal, revocation, and unsupported-case reason actually emitted by the reviewed lifecycle remains honest and non-passing where applicable; unsupported categories remain `absent`. A mutated human or agent reviewer verdict cannot confer authority or change these states.
- [ ] Commit RED and GREEN separately and write the task report.

### Task 5: Add a fixture Windows-client-to-Linux-Cell connection demonstration

**Files:**
- Create: `src/authority/certification/tour-connection.ts`
- Modify: `src/authority/certification/tour-report.ts`
- Test: `test/authority/authority-tour-connection.test.ts`
- Create: `.superpowers/sdd/2026-08-12-agent-neutral-governed-outcome-tour/task-5-report.md`

**Interfaces:**
- Reuses `AuthorityCellConnectionV1` parsing and Adapter Contract identity checks. Full Path C execution is Linux-hosted; the Windows vignette proves host refusal, client configuration semantics, fixture identity comparison, and offline verification only.
- Provides a closed in-process transport; it must not call `checkAuthorityCellLive` because that resolves a bearer token.

- [ ] Write failing tests simulating a Windows client, Linux fixture Cell identity, stale Cell ID, stale contract digest, redirect attempt, bearer-token reference access, and socket access.
- [ ] Run tests and verify the fixture transport is absent.
- [ ] Implement the in-process identity exchange and report `transport: "fixture"`, `productionReachability: "unchecked"`, and pathname/topology/lease claims as `unchecked` or `absent`.
- [ ] Run focused tests and prove production HTTP authentication is unchanged.
- [ ] Commit RED and GREEN separately and write the task report.

### Task 6: Verify receipts and graph offline with every external capability disabled

**Files:**
- Modify: `src/authority/certification/tour-report.ts`
- Test: `test/authority/authority-tour-offline.test.ts`
- Create: `.superpowers/sdd/2026-08-12-agent-neutral-governed-outcome-tour/task-6-report.md`

**Interfaces:**
- Reuses `verifyAuthorityReceiptBundle`, `verifyCertificationTaskReceiptGraph`, and frozen Adapter Contract verification.
- Produces a verification summary derived from signed artifacts only.

- [ ] Write failing tests that verify the clean tour offline and reject altered contract digest, receipt omission/fork, grant/principal substitution, budget imbalance, unknown terminal reason, false pass for ambiguous/manual/absent evidence, attestation confidence `pending`, and a secret canary. Add falsifiers where dispatch verifies but observation/post-state is `absent`, acknowledgement exists without authoritative reconciliation, or receipts verify while external delivery remains `absent`; none may yield overall success.
- [ ] Run tests and confirm the missing tour-level verification binding.
- [ ] Implement minimal aggregation and verification; inject network/provider/credential functions that throw and assert zero calls.
- [ ] Run focused tamper corpus and existing receipt/graph tests.
- [ ] Commit RED and GREEN separately and write the task report.

### Task 7: Ship the guided CLI experience and packed acceptance

**Files:**
- Modify: `src/authority/cli.ts`
- Modify: `package.json`
- Create: `test/packed/authority-tour.mjs`
- Modify: `.github/workflows/ci.yml`
- Create: `docs/authority/tour.md`
- Test: `test/authority/authority-tour.test.ts`
- Test: `test/authority/package.test.ts`
- Modify: `docs/superpowers/plans/2026-08-12-agent-neutral-governed-outcome-tour.md`
- Create: `.superpowers/sdd/2026-08-12-agent-neutral-governed-outcome-tour/task-7-report.md`

**Interfaces:**
- `reelier authority tour` prints short numbered stages; `--json` emits only `AuthorityTourReportV1`; `--output` atomically writes the report and graph under a confined new directory.
- Packed tests install the exact tarball into clean Ubuntu/Windows fixtures.

- [ ] Write failing CLI and packed-artifact tests proving at most four operator actions after install: run tour, cross the one explicit authority ceremony, inspect summary, verify offline. No model or agent process is required.
- [ ] Add failure copy that distinguishes `failed`, `blocked`, `manual`, `unchecked`, and `absent`; explain that `pending` is a non-passing attestation-confidence value, not a fifth four-state claim value. Never call any of them safe or successful.
- [ ] Implement concise interactive output with links to the existing Path A, Path B, and Path C sections created inside `docs/authority/tour.md`, plus an optional, separate read-only local-detection command suggestion; do not inspect local state automatically and state that native Windows does not host the Path C Cell. Snapshot the seven teaching layers and disclose: synthetic agent/plugin inventory is not compatibility or completeness evidence; the fixture performs no payment, settlement, live provider access, GUI interception, or external delivery; and a verified receipt authenticates only its covered evidence/linkage.
- [ ] Add Ubuntu packed execution and Windows client/offline execution using the identical tarball and Ubuntu-produced public evidence.
- [ ] Run build, test compile, focused tour/authority suites, contract checks, package-content tests, full tests, and `git diff --check`; independently review the entire plan range.
- [ ] Commit RED/GREEN/docs/CI evidence and complete the plan ledger.

## Completion criteria

- A user gets a genuine first governed hermetic Outcome without providing provider credentials, selecting an agent, resolving a bearer reference, or granting external network access; Cell signing keys remain opaque and confined.
- Paths A and B are demonstrated from synthetic inputs; Path C exercises genuine signed authority, budget, reconciliation, receipts, cleanup, and offline graph verification.
- The report distinguishes fixture evidence from live deployment evidence and never upgrades `unchecked`/`absent`/manual/ambiguous states to pass.
- The tour remains model-, agent-, desktop-, and harness-neutral because none participates in verification or enforcement; named ecosystem examples are not compatibility claims without their own executable tests.
- The exact packed artifact passes its Ubuntu-hosted and Windows-client/offline journeys.
