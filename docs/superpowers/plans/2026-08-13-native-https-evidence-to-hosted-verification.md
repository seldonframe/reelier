# Native HTTPS Evidence to Hosted Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task, with a fresh implementer and independent review after every task.

**Goal:** Extend the completed native HTTPS Outcome baseline into independently verifiable portable evidence, an immutable hermetic candidate, an approval-protected live runner, and an explicit hosted Gate 4 decision without silently widening authority or claiming live success.

**Architecture:** Task 9 adds a generic portable publication and offline verifier over the existing receipt graph; it binds the canonical request, route, identity, response profile, authoritative pre/post projections, reconciliation, and no-resend facts without changing Adapter Contract v1. Task 10 freezes those verified artifacts into a content-addressed candidate and checks the exact public commit/tarball/lane/pack/checker bindings. Task 11 only authors a disabled-by-default, `workflow_dispatch`-only disposable runner. Task 12 is the separately approved hosted Ubuntu/Windows verification workflow whose final artifact is a refusal/blocked/approved Gate 4 decision, never an automatic promotion.

**Tech Stack:** TypeScript/Node ESM, Node `node:test`, canonical authority wire/JCS digests, existing receipt graph and trust-pin verifiers, npm pack, GitHub Actions workflow YAML, offline packed-consumer tests.

**Spec:** `docs/superpowers/plans/2026-08-12-native-https-github-label-outcome.md`, especially its Task 7 portable-evidence interface and Task 8 baseline/non-claim rules; authority principles in `docs/superpowers/specs/2026-08-10-authority-certification-design.md`.

## Global Constraints

- FOUNDATION and BUILDING-COMPASS govern: broad intelligence may propose; only the sealed authority path may perform a consequential exit.
- Preserve the completed Task 8 interfaces and commit `83015fa`; do not rewrite its baseline or introduce a numeric latency SLO/regression budget.
- Adapter Contract v1 remains byte-identical: `sha256:7f46242b26d9c921f4e1ec9de6418ac5fc8c03d70c4415c25e799ae0e73a1512`.
- Secret values, raw secret references, authorization/cookie headers, provider response bodies, account names, and credential-slot mappings never enter portable evidence, logs, metrics, workflow inputs, or artifacts.
- `2xx` is not durable post-state, delivery, exactly-once behavior, or correctness. Ambiguous sends reconcile without automatic resend.
- Tasks 9–11 are offline/authoring-only: no production credentials, GitHub writes, provider calls, workflow dispatches, or hosted execution.
- Task 12 may run only after an explicit human approval of the candidate and runner; Ubuntu hosts consequential execution, Windows verifies offline artifacts and refuses native hosting before mutation.
- Every task uses RED→GREEN, exact focused commands, `git diff --check`, and an independent scoped review. Full-suite hangs and platform skips are recorded as non-evidence.
- The existing dirty Task 6 experiment remains untouched.

---

### Task 9: Extend portable evidence and offline verification

**Files:**

- Modify: `docs/superpowers/plans/2026-08-13-native-https-evidence-to-hosted-verification.md` (tracked Task 9 scope-ratification and immutable audit-deviation record)
- Create: `src/authority/host/portable-receipts.ts`
- Modify: `src/authority/certification/lifecycle-receipts.ts`
- Modify: `src/authority/certification/task-receipt-graph.ts`
- Modify: `src/authority/certification/github-issue-labels-runner.ts` (narrow scope amendment: this is the durable hermetic execution boundary that must persist and pass the actual authorized route snapshot, signed authenticated identity, materialized request, sealed response profile, executed reconciliation/no-resend counters, and cleanup parent into the Task 9 graph; its provenance state format must be explicitly migrated/versioned rather than reconstructed by the graph)
- Modify: `src/authority/certification/factory-journey.ts` (narrow verifier call-site migration only: supply the now-mandatory external current-trust observation and verification time)
- Modify: `src/authority/host/local.ts`
- Modify: `src/authority/verify.ts`
- Modify: `contract/certification/v1/task-receipt-graph.schema.json`
- Create: `test/authority/portable-receipts.test.ts`
- Modify: `test/authority/certification-github-issue-labels-runner.test.ts`
- Modify: `test/authority/certification-factory-journey.test.ts` (factory verifier call-site behavior only)
- Modify: `test/authority/native-github-labels.test.ts`
- Modify: `test/authority/artifacts.test.ts`
- Modify: `test/authority/contract.test.ts`
- Create: `.superpowers/sdd/2026-08-13-native-https-evidence-to-hosted-verification/task-9-report.md`

**Task 9 scope amendment (2026-08-13):** The certification GitHub runner is an unavoidable, narrowly bounded seam for portable provenance. Task 9 may change only its execution-provenance capture, durable provenance-state version/migration, and graph-input threading. It must not change provider behavior, authority policy, budgets, lifecycle semantics, or network behavior. This amendment exists because graph-time reconstruction cannot prove runtime provenance; every runtime fact consumed by the portable publication must instead arrive from the durable executed artifact.

**Task 9 verifier call-site amendment (2026-08-13):** `factory-journey.ts` and its focused test are included only because the integrated graph verifier now requires caller-supplied current-trust and verification-time anchors. No factory packet shape, lifecycle, or publication behavior may change. Gate and ledger implementation files remain out of scope: the runner must use their existing route-authority injection and persisted reservation interfaces without modifying those public seams.

**Task 9 remaining-remediation scope ratification (2026-08-13):** The user already approved Task 9 implementation. The two amendments above were recorded retrospectively after implementation exposed seams that the original file list omitted; this ratification governs the remaining Task 9 remediation and does not rewrite or squash that history. The actual implementation surface is: `github-issue-labels-runner.ts` for the sealed hermetic response profile, gate-accepted route/identity/request capture, durable signed provider provenance, initial response classification, reconciliation/no-resend counters, cleanup parent, and graph export; `factory-journey.ts` only for the externally supplied current-trust and verification-time call; `task-receipt-graph.ts`, `portable-receipts.ts`, `verify.ts`, `lifecycle-receipts.ts`, `local.ts`, and the certification graph schema for publication and verification; and the Task 9 tests named in this Files section, including the factory, native, artifact, and contract gates. The runner consumes, but Task 9 does not modify, `AuthorityGateDependencies.routeAuthority` and `authenticatedProviderIdentity` in `gate.ts`, the gate's accepted reservation handle, and `ReservationIntent.routeAuthority` plus durable reservation/journal lookups in `ledger.ts`. Provider policy, budgets, transport behavior, gate/ledger public contracts, and Adapter Contract v1 remain out of scope.

The hermetic runner's actual sealed response profile remains `github.issue-labels.hermetic-v1` with acknowledged statuses `[200]`; portable evidence binds that exact profile while the generic response-semantics parser retains its existing closed, sorted, unique 2xx behavior. An applied write whose initial 503/disconnect classifies as `ambiguous` may reach `exact` only through later authoritative matched reconciliation with one provider write and zero resends; the initial observation must never be relabeled `acknowledged`.

**Immutable audit deviation:** strict before-edit provenance for the earlier retrospective scope amendments cannot be manufactured without rewriting existing commits. History will not be rewritten. The earlier RED/GREEN commits and ignored Task 9 report remain the audit record, and the independent reviewer/founder must decide whether this disclosed deviation is acceptable. This note is the first tracked ratification before any round-4 production edit.

**Interfaces:**

- Produce internal `createPortableAuthorityReceiptPublication(input)` and keep `createCertificationLifecycleReceiptPublication(input)` as its certification wrapper.
- Add the closed extension:

```ts
export interface PortableOutcomeEvidenceV1 {
  readonly v: "reelier.portable-outcome-evidence/v1";
  readonly routeAuthorityDigest: string;
  readonly materializedRequestDigest: string;
  readonly responseSemanticsProfileDigest: string;
  readonly preStateEvidenceDigest: string;
  readonly postStateEvidenceDigest: string;
  readonly confidence: "exact" | "partial" | "pending" | "absent";
  readonly authoritativeStateSource: "hermetic-github-fixture" | "github-api";
  readonly executionAttestationSignerId: string;
  readonly reconciliationAttestationSignerId: string;
  readonly attestationSignerRelationship: "same-authority-cell";
  readonly cleanupParentReceiptDigest: string | null;
}
```

- `exact` is permitted only when the independent read route/account/schema join, complete comparable pre/post projection, authoritative source, and valid purpose-bound authority attestation all verify. `pending` and `absent` never pass.
- The graph verifier must recompute every route, request, profile, pre-state, post-state, reconciliation, cleanup-parent, receipt-chain, collection-count, terminal, and signer digest; reject missing, substituted, forked, reordered, self-anchored, false-`exact`, accessor-backed, extra-key, secret-bearing, or stale evidence.
- `createLocalAuthorityRuntime` accepts an injected portable publication; it never manufactures a self-anchored trust root.

- [ ] **Step 1: Write the failing tamper and no-secret tests.** Add fixtures with a signed job card, route authority, authenticated identity, materialized request projection, response profile, authoritative pre/post projection, reconciliation result, cleanup parent, and same-cell authority-evidence signer. Mutate each digest, source, confidence, signer role, cleanup link, collection order, terminal count, and raw secret canary; assert refusal.

- [ ] **Step 2: Run RED.**

```bash
npx tsc -p tsconfig.test.json
node --test --test-concurrency=1 dist-test/test/authority/portable-receipts.test.js dist-test/test/authority/certification-github-issue-labels-runner.test.js dist-test/test/authority/native-github-labels.test.js dist-test/test/authority/artifacts.test.js dist-test/test/authority/contract.test.js
```

Expected result: failure because route/request/native post-state extensions and their schema/verifier are absent.

- [ ] **Step 3: Implement the generic publication and verifier.** Store only canonical digests and reviewed projections; use the existing trust pin and purpose-separated `authority-evidence`/receipt signers. Keep Adapter Contract v1 unchanged.

- [ ] **Step 4: Run GREEN and frozen-contract checks.**

```bash
npm run check:authority-contract
npx tsc -p tsconfig.test.json
node --test --test-concurrency=1 dist-test/test/authority/portable-receipts.test.js dist-test/test/authority/certification-github-issue-labels-runner.test.js dist-test/test/authority/native-github-labels.test.js dist-test/test/authority/artifacts.test.js dist-test/test/authority/contract.test.js
git diff --check
```

Expected result: all focused tests pass and the Adapter Contract digest remains unchanged.

- [ ] **Step 5: Commit and review.**

```bash
git add src/authority/host/portable-receipts.ts src/authority/certification/lifecycle-receipts.ts src/authority/certification/task-receipt-graph.ts src/authority/host/local.ts src/authority/verify.ts contract/certification/v1/task-receipt-graph.schema.json test/authority/portable-receipts.test.ts test/authority/certification-github-issue-labels-runner.test.ts test/authority/native-github-labels.test.ts test/authority/artifacts.test.ts test/authority/contract.test.ts
git commit -m "feat(authority): verify portable native HTTPS evidence"
```

Review must independently verify no-resend semantics, exact pre/post comparability, cleanup independence, trust-root binding, and secret-canary refusal.

---

### Task 10: Build the hermetic native candidate

**Files:**

- Create: `src/authority/certification/native-candidate.ts`
- Create: `contract/certification/v1/native-candidate.schema.json`
- Create: `test/authority/native-candidate.test.ts`
- Create: `test/packed/native-candidate.mjs`
- Create: `docs/release/native-github-label-candidate.md`
- Modify: `src/authority/index.ts`
- Modify: `package.json`
- Create: `.superpowers/sdd/2026-08-13-native-https-evidence-to-hosted-verification/task-10-report.md`

**Interfaces:**

```ts
export interface NativeCandidateV1 {
  readonly v: "reelier.native-github-candidate/v1";
  readonly candidateId: string;
  readonly publicCommitSha: string;
  readonly tarballDigest: string;
  readonly laneCommits: readonly Readonly<{ laneId: string; commitSha: string }>[];
  readonly packDigest: string;
  readonly task8BaselineDigest: string;
  readonly portableEvidenceContractDigest: string;
  readonly checkerIdentities: readonly Readonly<{ role: "task8" | "task9" | "pack" | "contract"; signerId: string; verdictDigest: string }>[];
}

export function verifyNativeCandidate(value: unknown, inputs: Readonly<{
  tarballBytes: Uint8Array;
  publicCommitSha: string;
  task8BaselineDigest: string;
  portableEvidenceContractDigest: string;
}>): Readonly<{ status: "verified"; candidateDigest: string }>;
```

- Candidate creation is permitted only after Task 8’s baseline verifier and Task 9’s portable graph verifier return `status: "verified"`.
- Parse exact JCS bytes; recompute tarball SHA-256, pack digest, baseline/evidence digests, lane commit uniqueness, and checker verdict bindings. Candidate IDs are content-addressed and immutable; no mutable “latest” pointer exists.
- The public package exposes only `verifyNativeCandidate`; it does not expose candidate creation, private keys, credentials, provider adapters, workflow dispatch, or delivery operations.

- [ ] **Step 1: Write RED mutation tests.** Assert refusal before Task 8/9 verification, wrong public commit, tarball byte substitution, pack mismatch, lane reorder/duplicate/unknown, checker identity substitution, stale baseline, extra keys, non-JCS bytes, and secret canaries.

- [ ] **Step 2: Run RED.**

```bash
npx tsc -p tsconfig.test.json
node --test --test-concurrency=1 dist-test/test/authority/native-candidate.test.js
```

Expected result: failure because no candidate parser/verifier or certification-local schema exists.

- [ ] **Step 3: Implement the closed candidate verifier and packed consumer test.** Use an exact temporary npm consumer and the already-built public verifier; never resolve from checkout source.

- [ ] **Step 4: Run GREEN and package gates.**

```bash
npm run check:authority-contract
npx tsc -p tsconfig.test.json
npm pack --json
node test/packed/native-candidate.mjs <absolute-tarball-path>
git diff --check
```

The packed consumer must report only `verified`, the candidate digest, and non-claims; it must not print route URLs, account names, slot IDs, credentials, response content, or provider status beyond the already-bound hermetic `absent` claim.

- [ ] **Step 5: Commit and review.**

```bash
git add src/authority/certification/native-candidate.ts contract/certification/v1/native-candidate.schema.json test/authority/native-candidate.test.ts test/packed/native-candidate.mjs docs/release/native-github-label-candidate.md src/authority/index.ts package.json
git commit -m "feat(authority): freeze hermetic native candidate"
```

Candidate creation is the first point at which the exact public commit, tarball digest, lane commits, pack digest, and checker identities may be called immutable.

---

### Task 11: Author the guarded live runner without executing it

**Files:**

- Create: `scripts/native-github-live-runner.mjs`
- Create: `.github/workflows/native-github-live.yml`
- Create: `test/authority/native-github-live-runner.test.ts`
- Create: `docs/authority/native-github-live-runner.md`
- Modify: `package.json`
- Create: `.superpowers/sdd/2026-08-13-native-https-evidence-to-hosted-verification/task-11-report.md`

**Interfaces and guards:**

- The script accepts only `--candidate <absolute-path> --mode <preflight|run>`; it refuses `run` outside GitHub Actions, without the exact candidate digest, or without the protected environment approval marker.
- The workflow has `on: workflow_dispatch` only, a protected GitHub Environment, explicit disposable-target inputs, `permissions: contents: read`, and no `push`, `pull_request`, `schedule`, `repository_dispatch`, or automatic retry.
- Provider credentials are GitHub Actions secrets scoped to the protected environment and are read only inside the runner process; they never appear in arguments, logs, receipts, artifacts, or model fields. Local tests use canary strings and assert they do not escape.
- The live target is a disposable fixture selected by operator input; write and cleanup are separate authorized reservations. Any ambiguous send reconciles and never resends automatically. The runner exits refused if cleanup authorization or cleanup evidence is unavailable.
- This task authors and statically verifies the runner only. It does not call `gh`, GitHub APIs, `workflow_dispatch`, or the provider.

- [ ] **Step 1: Write RED policy tests.** Parse the workflow and runner; reject a workflow containing non-manual triggers, missing protected environment, write-capable default permissions, retry loops, unbound candidate digest, production-target input, or credential interpolation. Assert `--mode run` refuses in local test execution.

- [ ] **Step 2: Run RED.**

```bash
npx tsc -p tsconfig.test.json
node --test --test-concurrency=1 dist-test/test/authority/native-github-live-runner.test.js
```

Expected result: failure because the guarded runner/workflow does not exist.

- [ ] **Step 3: Implement the preflight-only runner and workflow.** Keep the workflow’s consequential job behind the protected environment and an explicit approval gate; do not add a default branch trigger.

- [ ] **Step 4: Run GREEN without dispatching the workflow.**

```bash
npx tsc -p tsconfig.test.json
node --test --test-concurrency=1 dist-test/test/authority/native-github-live-runner.test.js
node scripts/native-github-live-runner.mjs --candidate <absolute-candidate-path> --mode preflight
git diff --check
```

The preflight output must be sanitized and deterministic. Do not run `--mode run` locally or via CI in this task.

- [ ] **Step 5: Commit and review.**

```bash
git add scripts/native-github-live-runner.mjs .github/workflows/native-github-live.yml test/authority/native-github-live-runner.test.ts docs/authority/native-github-live-runner.md package.json
git commit -m "feat(authority): author approval-protected native runner"
```

Review must verify no automatic trigger, no credential exposure, no production-target default, no retry/resend path, and no execution occurred.

---

### Task 12: Hosted authoritative verification and explicit Gate 4 decision

**Files:**

- Create: `.github/workflows/native-github-authoritative.yml`
- Create: `scripts/verify-native-github-hosted.mjs`
- Create: `src/authority/certification/gate4-decision.ts`
- Create: `contract/certification/v1/gate4-decision.schema.json`
- Create: `test/authority/gate4-decision.test.ts`
- Create: `test/packed/gate4-decision.mjs`
- Create: `docs/release/native-github-gate4-runbook.md`
- Modify: `package.json`
- Create: `.superpowers/sdd/2026-08-13-native-https-evidence-to-hosted-verification/task-12-report.md`

**Interfaces:**

```ts
export interface Gate4DecisionV1 {
  readonly v: "reelier.native-github-gate4-decision/v1";
  readonly candidateDigest: string;
  readonly ubuntuArtifactDigest: string;
  readonly windowsArtifactDigest: string;
  readonly workflowRunId: string;
  readonly ubuntuJobId: string;
  readonly windowsJobId: string;
  readonly decision: "approved" | "refused" | "blocked";
  readonly reasons: readonly string[];
  readonly liveProviderClaim: "absent" | "verified";
  readonly signedAt: string;
  readonly signerId: string;
  readonly signature: AuthoritySignature;
}
```

- The offline decision verifier requires the exact candidate digest, both hosted artifact digests, distinct Ubuntu/Windows job IDs, successful conclusions, the Windows offline/native-host refusal proof, and the Ubuntu lifecycle/reconciliation/no-resend evidence. It refuses retries that obscure a failed attempt, missing artifacts, mismatched SHAs, or any secret-bearing field.
- `approved` is impossible while `liveProviderClaim` is `absent`; hermetic runs therefore produce `blocked` or `refused`, never an implicit Gate 4 approval. A live `verified` claim requires the separately approved Task 11 run, authoritative pre/post read-back, cleanup receipt, and no-resend evidence.
- The workflow records artifacts and digests privately with retention controls; it does not commit release evidence, publish a receipt, or promote a candidate automatically. The explicit decision is made by a human after the hosted jobs finish.
- Ubuntu is the only consequential host. Windows runs offline verification and asserts native Authority Cell hosting is refused before mutation.

- [ ] **Step 1: Write RED decision and workflow tests.** Assert exact workflow matrix/OS labels, no retry masking, artifact digest binding, candidate binding, Windows refusal, Ubuntu evidence requirements, signature purpose, and `approved` refusal when live evidence is absent.

- [ ] **Step 2: Run RED.**

```bash
npx tsc -p tsconfig.test.json
node --test --test-concurrency=1 dist-test/test/authority/gate4-decision.test.js dist-test/test/packed-gate4-decision.js
```

Expected result: failure because no Gate 4 decision schema/verifier or hosted workflow exists.

- [ ] **Step 3: Implement offline verifier and workflow.** Keep hosted execution behind an explicit `workflow_dispatch` input referencing the immutable candidate and protected environment. The verifier must be usable from a clean packed consumer and must not create authority, credentials, provider clients, or network listeners.

- [ ] **Step 4: Run GREEN locally only.**

```bash
npx tsc -p tsconfig.test.json
node --test --test-concurrency=1 dist-test/test/authority/gate4-decision.test.js
node test/packed/gate4-decision.mjs <absolute-fixture-path>
npm run check:authority-contract
git diff --check
```

Do not dispatch the hosted workflow in Task 12’s implementation cycle. The first hosted run is a separate explicit approval action after independent review.

- [ ] **Step 5: Hosted execution ceremony (separate approval required).**

```text
1. Verify Task 9, 10, and 11 reports and independent reviews are clean.
2. Confirm the candidate digest and protected disposable target in writing.
3. Approve exactly one workflow_dispatch run; record workflowRunId and both job IDs.
4. Retain Ubuntu/Windows artifact bytes and SHA-256 digests privately.
5. Verify the packed offline decision input from retained bytes; do not fetch replacements.
6. Review the explicit decision: approved, refused, or blocked.
```

No production credential, GitHub write, retry, promotion, merge, or publication is part of the implementation plan before that approval.

- [ ] **Step 6: Commit and review the authoring changes.**

```bash
git add .github/workflows/native-github-authoritative.yml scripts/verify-native-github-hosted.mjs src/authority/certification/gate4-decision.ts contract/certification/v1/gate4-decision.schema.json test/authority/gate4-decision.test.ts test/packed/gate4-decision.mjs docs/release/native-github-gate4-runbook.md package.json
git commit -m "feat(authority): add explicit hosted Gate 4 verification"
```

The task is complete only when the authoring verifier is green; the hosted decision remains `blocked` until the separately approved run produces retained evidence.

---

## Cross-task completion gates

1. Task 9 must verify portable evidence offline before Task 10 can create a candidate.
2. Task 10 must bind the exact public commit, tarball, pack, lane, baseline, and checker digests before Task 11 can reference a candidate.
3. Task 11 must pass static workflow/runner policy tests; its runner remains unexecuted.
4. Task 12 authoring must pass offline tests before any hosted dispatch is considered.
5. Hosted Gate 4 is a separate human decision. Missing, stale, ambiguous, or secret-bearing evidence yields `blocked` or `refused`, never approval.

## Explicit non-claims

- Portable evidence proves only the declared route/request/pre/post/reconciliation/cleanup facts; it does not prove semantic correctness, completeness, safety, or absence of bypass writes.
- A hermetic candidate proves reproducibility of the exact artifact, not provider behavior.
- Authoring a live runner proves guardrails, not that a live run occurred.
- A hosted `2xx` does not prove durable state, delivery, exactly-once external effects, or application correctness.
- No task grants broad agent autonomy, credential possession, reviewer identity, or platform-wide compatibility.
