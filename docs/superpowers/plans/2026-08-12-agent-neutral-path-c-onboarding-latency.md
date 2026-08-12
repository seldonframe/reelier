# Agent-Neutral Path C Onboarding and Latency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the packed `reelier authority tour` runtime the single, truthful first experience, while separately publishing the common MCP/HTTP Outcome ingress contract that a production client must implement before promoting any named agent host.

**Architecture:** Extend the reviewed hermetic tour with one closed onboarding report, one packed-tour runtime fixture, and one distinct common protocol artifact derived from the existing Authority Cell MCP and HTTP ingress. `reelier-cli-tour` proves only that the exact packed CLI runs and verifies the hermetic fixture; it does not send production Outcome requests. `reelier authority serve` only hosts the Linux Authority Cell. A separate MCP/HTTP client must request governed work through `reelier_outcome_invoke` or `POST /v1/outcomes/:alias`, then read status through `reelier_outcome_status` or `GET /v1/outcomes/:alias/:requestId`. Grok Build, Claude Code, Hermes, Codex, and eve remain `unchecked` until the native GitHub-label tracer exists and each pinned real host passes its own parser/process/canary suite.

**Tech Stack:** TypeScript, Node.js 20+, Node test runner, JSON Schema 2020-12, existing Authority Cell MCP/HTTP ingress, existing Windows connection client, existing portable evidence/offline verification, exact packed npm artifact.

**Dependencies and delivery order:** Begin only after Tasks 4A-6 of `docs/superpowers/plans/2026-08-12-windows-client-linux-authority-cell.md` and all tasks of `docs/superpowers/plans/2026-08-12-agent-neutral-governed-outcome-tour.md` are independently approved and green against the exact packed artifact. Complete this packed-tour/common-protocol onboarding plan before the native HTTPS GitHub-label tracer. Named-host promotion is not a prerequisite for native HTTPS and starts only after that tracer is reproduced.

## Global Constraints

- FOUNDATION and `BUILDING-COMPASS.md` govern: access, login, payment, sandboxing, repeatability, prompts, reviewer output, and host session possession do not grant Reelier authority. A receipt proves only its named covered transition; `verified` never means safe, correct, complete, or delivered.
- `reelier authority tour` remains the sole first command. `reelier authority certify` remains the private expert/certification surface. Add no top-level `prepare`, `setup`, or `onboard` verb.
- Default tour and preparation make zero model, provider, Reelier Cloud, package-registry, credential-resolution, or external-network calls. They never inspect histories, memories, browser sessions, environment values, auth stores, credential files, MCP headers/env maps, provider configs, or provider account contents.
- Windows is a client and offline verifier. Full Path C execution, gate signing, private keys, ledger mutation, dispatch, and reconciliation remain in the Linux Authority Cell.
- The separate common production protocol surfaces are exactly:
  - MCP request: `reelier_outcome_invoke` with the existing closed `{ jobRef, requestId, sourceRefs, choices }` schema.
  - MCP status: `reelier_outcome_status` with `{ requestId }`.
  - HTTP request: `POST /v1/outcomes/:alias` with the existing normalized Outcome Request body and a host-owned scoped principal credential.
  - HTTP status: `GET /v1/outcomes/:alias/:requestId`.
- `reelier authority serve` starts the Cell transport. It is never described or used as an invocation command.
- Reconcile `src/authority/host/adapters.ts` as the sole common adapter-artifact source. Do not introduce a second registry under `src/authority/onboarding/adapters/`. Retire its current unverified named-host claims and invalid command metadata in the same task that introduces the common artifact.
- Host evidence has two independent fields:
  - `commonProtocolArtifact: verified | failed | unchecked | absent` proves only that exact packaged MCP/HTTP names, schemas, and route bytes match the implemented Cell ingress. It is not a runtime or execution claim.
  - `hostRuntimeConformance: verified | failed | unchecked | absent` proves the exact runtime surface was parsed and invoked correctly by a pinned real host binary/runtime under canary observation.
- Host status is `supported | unchecked | unsupported`. Admission is surface-specific: `reelier-cli-tour` requires the exact pinned packed runtime to execute and offline-verify the hermetic tour, while any future production client requires its exact pinned host runtime to emit the committed request to the common fake Cell and read status through the same protocol. In both cases the applicable conformance evidence must be `verified` and secret/config/history canaries must remain untouched. Documentation or filesystem detection is never host conformance.
- In this plan only `reelier-cli-tour` may become `supported`, and only for executing the hermetic tour. `grok-build`, `claude-code`, `hermes`, `codex`, and `eve` must remain `unchecked`; all may report `commonProtocolArtifact: verified` while `hostRuntimeConformance: unchecked`. No plugin/config files are generated for them.
- The named-host candidates remain research-only because their prospective surfaces are not yet executable evidence: Grok skills/plugins/MCP/AGENTS, Claude skills/plugins/MCP, Hermes skills/MCP config, Codex Agent Plugins/skills/config limitations, and eve filesystem tool/connection wrappers. Do not implement or advertise guessed paths/commands.
- JSON is closed and stable. Unknown keys fail without invoking accessors. `--json` emits exactly one JSON object to stdout; diagnostics go to stderr. Process spawn/exit/signal/timeout/stdout-overflow/invalid-JSON failures map to closed reason codes and never leak raw command lines, environment, or stdout/stderr bytes.
- Packed runtime artifacts are explicit. `package.json#files` must include `dist`, `contract`, and `integrations`; runtime uses generated `integrations/authority/common/mcp-tools.json` and `integrations/authority/common/http-routes.json`, and package tests prove those exact bytes/digests match `src/authority/ingress/mcp.ts`, `src/authority/ingress/http.ts`, and `src/authority/host/adapters.ts`.
- Cache only immutable verified schema/artifact/contract digests. Never cache grant, revocation, expiry, session, principal, account, budget, gate, ambiguity, provider acknowledgement, reconciliation, or post-state decisions.
- This plan measures onboarding only: hermetic-tour setup, authority ceremony, and observed operator actions. Native HTTPS owns gate, provider acknowledgement, reconciliation, receipt, and export latency. Do not put those production phases or graph export into this onboarding baseline.
- The hermetic fixture action count and production action count are separate fields. This plan measures the former; the latter remains `not-run`. Do not claim `<=4` for production until a production journey observes it.
- Record onboarding p50/p95/p99 only after a reproducible baseline artifact exists. No latency SLO or public performance claim precedes a reviewed baseline.
- Every task follows RED -> GREEN TDD, writes the named task report, receives independent review, and commits only its declared files.

## Closed report vocabulary

```ts
export type OnboardingHostId =
  | "reelier-cli-tour"
  | "grok-build"
  | "claude-code"
  | "hermes"
  | "codex"
  | "eve";

export type HostSupport = "supported" | "unchecked" | "unsupported";
export type EvidenceState = "verified" | "failed" | "unchecked" | "absent";

export type OnboardingReasonCode =
  | "ready"
  | "authority-ceremony-required"
  | "linux-authority-cell-required"
  | "authority-cell-connection-absent"
  | "host-runtime-unchecked"
  | "host-runtime-failed"
  | "host-surface-unsupported"
  | "adapter-artifact-failed"
  | "process-spawn-failed"
  | "process-exit-nonzero"
  | "process-signaled"
  | "process-timeout"
  | "process-output-overflow"
  | "process-json-invalid"
  | "authority-refused"
  | "evidence-failed"
  | "offline-verification-failed";

export interface HostConformanceV1 {
  readonly hostId: OnboardingHostId;
  readonly support: HostSupport;
  readonly commonProtocolArtifact: EvidenceState;
  readonly hostRuntimeConformance: EvidenceState;
  readonly packageDigest: `sha256:${string}`;
  readonly adapterDigest: `sha256:${string}`;
  readonly hostRuntime?: Readonly<{
    version: string;
    binaryDigest: `sha256:${string}`;
    fixtureDigest: `sha256:${string}`;
  }>;
  readonly reasonCode: OnboardingReasonCode;
}

export interface OnboardingMeasurementV1 {
  readonly phase: "setup" | "ceremony";
  readonly context: "fixture" | "offline";
  readonly durationMs: number;
  readonly operationCount: number;
  readonly status: "measured" | "not-run";
}

export interface OperatorActionMeasurementV1 {
  readonly journey: "hermetic-fixture" | "production";
  readonly status: "measured" | "not-run";
  readonly count?: number;
}
```

`support: "supported"` requires `hostRuntimeConformance === "verified"` and all `hostRuntime` fields. `commonProtocolArtifact` is deliberately not part of that implication because protocol bytes cannot prove a host executed them. The sole `reelier-cli-tour` fixture pins the exact packed Node executable and proves only `reelier authority tour`; every named host lacks `hostRuntime` and cannot be promoted.

---

### Task 1: Freeze the closed onboarding report and compose it into the tour

**Files:**
- Create: `src/authority/onboarding-report.ts`
- Create: `contract/client/v1/authority-onboarding-report.schema.json`
- Modify: `src/authority/certification/tour-report.ts`
- Modify: `contract/client/v1/authority-tour-report.schema.json`
- Test: `test/authority/authority-onboarding-report.test.ts`
- Create: `.superpowers/sdd/2026-08-12-agent-neutral-path-c-onboarding-latency/task-1-report.md`

**Interfaces:**
- Produces the exact types above plus `AuthorityOnboardingReportV1`, `parseAuthorityOnboardingReportV1(value)`, and `composeAuthorityTourOnboarding(tour, onboarding)`.
- `AuthorityOnboardingReportV1.v` is exactly `reelier.authority-onboarding-report/v1` and contains `host`, `commonProtocol`, `measurements`, `operatorActions`, and `nonClaims`.
- The tour report adds exactly one required `onboarding` property. Composition parses and freezes both reports; it cannot mutate or upgrade any Path A/B/C claim.

- [ ] **Step 1: Write the failing closed-parser and composition tests**

Test a valid `reelier-cli-tour` report, every named host as unchecked, unknown keys at each nesting level, getter-backed input without getter invocation, invalid digests, `supported` without verified host runtime evidence, `supported` without pinned runtime, `commonProtocolArtifact: verified` with host runtime unchecked, negative/non-finite timings, and accidental production action claims.

```ts
test("named support requires adapter and pinned host runtime evidence", () => {
  const value = validOnboarding({
    host: { ...uncheckedClaude, support: "supported", commonProtocolArtifact: "verified" },
  });
  assert.throws(() => parseAuthorityOnboardingReportV1(value), /host runtime/i);
});
```

Prove `composeAuthorityTourOnboarding` preserves `unchecked`, `absent`, and pending attestation confidence from the original tour.

- [ ] **Step 2: Run RED**

```powershell
npx tsc -p tsconfig.test.json
node --test dist-test/test/authority/authority-onboarding-report.test.js
```

Expected: compilation fails because the report module/schema do not exist.

- [ ] **Step 3: Implement minimal parsers and schema composition**

Use own-property descriptors before reading, exact-key sets, plain-object prototypes only, lowercase SHA-256 validation, finite non-negative timings, safe integer action/operation counts, and frozen defensive copies. Do not import process, filesystem, network, agent-host, or credential modules.

- [ ] **Step 4: Run GREEN and contract checks**

```powershell
npx tsc -p tsconfig.test.json
node --test dist-test/test/authority/authority-onboarding-report.test.js dist-test/test/authority/authority-tour.test.js
npm run check:authority-contract
git diff --check -- src/authority/onboarding-report.ts contract/client/v1/authority-onboarding-report.schema.json src/authority/certification/tour-report.ts contract/client/v1/authority-tour-report.schema.json test/authority/authority-onboarding-report.test.ts
```

- [ ] **Step 5: Commit and independent protocol review**

```powershell
git add -- test/authority/authority-onboarding-report.test.ts
git commit -m "test(authority): specify onboarding report"
git add -- src/authority/onboarding-report.ts contract/client/v1/authority-onboarding-report.schema.json src/authority/certification/tour-report.ts contract/client/v1/authority-tour-report.schema.json .superpowers/sdd/2026-08-12-agent-neutral-path-c-onboarding-latency/task-1-report.md
git commit -m "feat(authority): compose onboarding evidence into tour"
```

The reviewer must reject any parser path that can invoke an accessor or any support promotion without pinned runtime evidence.

### Task 2: Replace unverified named-host metadata with one common MCP/HTTP artifact

**Files:**
- Modify: `src/authority/host/adapters.ts`
- Modify: `src/authority/host/index.ts`
- Create: `integrations/authority/common/mcp-tools.json`
- Create: `integrations/authority/common/http-routes.json`
- Create: `scripts/build-authority-adapter-artifact.mjs`
- Modify: `package.json`
- Test: `test/authority/authority-adapter-artifact.test.ts`
- Create: `.superpowers/sdd/2026-08-12-agent-neutral-path-c-onboarding-latency/task-2-report.md`

**Interfaces:**
- Retires `SupportedAuthorityHost`, `AuthorityHostAdapter`, and `createAuthorityHostAdapters(command)` from `src/authority/host/adapters.ts` because they claim unverified hosts and currently encode `reelier authority serve` as though it were a request adapter.
- Removes those three legacy exports from `src/authority/host/index.ts` and exports `AuthorityCommonAdapterArtifactV1` plus `createAuthorityCommonAdapterArtifact` instead. No compatibility alias retains the unverified named-host vocabulary.
- Replaces them with:

```ts
export interface AuthorityCommonAdapterArtifactV1 {
  readonly v: "reelier.authority-common-adapter/v1";
  readonly mcp: Readonly<{
    invokeTool: "reelier_outcome_invoke";
    statusTool: "reelier_outcome_status";
  }>;
  readonly http: Readonly<{
    invoke: "POST /v1/outcomes/:alias";
    status: "GET /v1/outcomes/:alias/:requestId";
  }>;
  readonly server: Readonly<{
    command: "reelier authority serve";
    role: "linux-authority-cell-host";
  }>;
  readonly digest: `sha256:${string}`;
}

export function createAuthorityCommonAdapterArtifact(): AuthorityCommonAdapterArtifactV1;
```

- `scripts/build-authority-adapter-artifact.mjs` imports `dist/authority/host/adapters.js`, invokes `createAuthorityCommonAdapterArtifact()`, generates both JSON projections, and supports `--check`. It has no duplicate literal registry.
- `package.json#files` explicitly retains `dist`, `contract`, and `integrations`; `build` runs the existing authority-contract check, compiles TypeScript, runs `build-authority-adapter-artifact.mjs --check` against that just-compiled single source, copies schemas, and builds packs. No fixtures under `test/` become runtime dependencies.

- [ ] **Step 1: Write RED artifact, drift, and invocation-semantics tests**

Require the exact MCP names and HTTP routes already implemented in `src/authority/ingress/mcp.ts` and `src/authority/ingress/http.ts`. Assert the server command has `role: linux-authority-cell-host` and is never present in invoke/status fields. Reject all legacy named hosts/config paths and `args: ["--stdio"]`. Check that generated JSON has no credential, header, environment, arbitrary command, host path, or provider field.

- [ ] **Step 2: Run RED**

```powershell
npx tsc -p tsconfig.test.json
node --test dist-test/test/authority/authority-adapter-artifact.test.js
node scripts/build-authority-adapter-artifact.mjs --check
```

Expected: tests fail against legacy named-host metadata and missing generated files.

- [ ] **Step 3: Implement the common artifact and deterministic generator**

Compute `digest` with existing canonical authority bytes over the artifact without its digest. Generate JSON with stable indentation and LF. The generator imports only the just-compiled `createAuthorityCommonAdapterArtifact` export; do not duplicate literals or parse TypeScript with regex.

- [ ] **Step 4: Run GREEN and existing ingress regression tests**

```powershell
node scripts/build-authority-adapter-artifact.mjs
npx tsc -p tsconfig.test.json
node --test dist-test/test/authority/authority-adapter-artifact.test.js dist-test/test/authority/host-server.test.js dist-test/test/authority/authority-serve.test.js
node scripts/build-authority-adapter-artifact.mjs --check
npm run build
git diff --check -- src/authority/host/adapters.ts src/authority/host/index.ts integrations/authority/common scripts/build-authority-adapter-artifact.mjs package.json test/authority/authority-adapter-artifact.test.ts
```

- [ ] **Step 5: Commit and independent source-of-truth review**

```powershell
git add -- test/authority/authority-adapter-artifact.test.ts
git commit -m "test(authority): specify common adapter artifact"
git add -- src/authority/host/adapters.ts src/authority/host/index.ts integrations/authority/common scripts/build-authority-adapter-artifact.mjs package.json .superpowers/sdd/2026-08-12-agent-neutral-path-c-onboarding-latency/task-2-report.md
git commit -m "feat(authority): replace host guesses with common adapter"
```

The reviewer must mechanically show there is one adapter registry/source, and that `authority serve` cannot be mistaken for an Outcome request.

### Task 3: Conform the packed tour runtime and separately verify common protocol bytes

**Files:**
- Create: `src/authority/onboarding-conformance.ts`
- Create: `test/fixtures/authority/onboarding/reelier-cli-tour.json`
- Create: `test/fixtures/authority/onboarding/common-protocol.json`
- Test: `test/authority/authority-onboarding-conformance.test.ts`
- Create: `.superpowers/sdd/2026-08-12-agent-neutral-path-c-onboarding-latency/task-3-report.md`

**Interfaces:**
- Produces `ReelierCliTourFixtureV1`, `CommonProtocolFixtureV1`, `parseReelierCliTourFixtureV1`, `parseCommonProtocolFixtureV1`, `runReelierCliTourConformance(fixture, runtime)`, `verifyCommonProtocolArtifact(fixture)`, and `mapConformanceProcessFailure(error)`.
- The tour fixture pins exact package digest, packed `reelier` executable digest, frozen Adapter Contract digest, secret canaries, the exact argv `authority tour --json`, and expected report digest. It contains no MCP/HTTP request vector and cannot claim production invocation.
- The common-protocol fixture separately pins the common artifact digest, MCP tool names/input schemas, HTTP routes/body schemas, and in-process fake-Cell request/response vectors. It has no host binary and cannot produce `hostRuntimeConformance`.
- Tour conformance invokes the exact packed CLI only for the hermetic CLI/parser assertion. Protocol verification exercises an in-process fake Cell only. Neither contacts a provider, Cloud, package registry, or model.
- Closed process outcomes map exactly:
  - spawn error -> `process-spawn-failed`
  - nonzero exit -> `process-exit-nonzero`
  - signal -> `process-signaled`
  - monotonic deadline -> `process-timeout`
  - stdout/stderr limit -> `process-output-overflow`
  - non-single/invalid/unknown-key JSON -> `process-json-invalid`
- Reports include counts/digests only. They never include executable paths, argv, environment, stdout, stderr, tokens, or canary values.

- [ ] **Step 1: Write RED protocol and failure-corpus tests**

Run the packed CLI with exactly `authority tour --json` and prove its report is the hermetic fixture. Separately exercise `reelier_outcome_invoke`, `reelier_outcome_status`, `POST /v1/outcomes/example`, and `GET /v1/outcomes/example/:requestId` against the in-process fake Cell to verify protocol bytes only. Prove unauthenticated HTTP refusal, scoped-principal binding, status separation, and that HTTP 202 remains dispatch acknowledgement rather than post-state proof. Inject each CLI process failure above and assert exact sanitized JSON.

```ts
test("packed CLI support is tour-only while protocol verification stays separate", async () => {
  const cli = await runReelierCliTourConformance(tourFixture, fakeRuntime);
  const protocol = await verifyCommonProtocolArtifact(protocolFixture);
  assert.equal(cli.host.hostId, "reelier-cli-tour");
  assert.equal(cli.host.support, "supported");
  assert.equal(cli.executedCommand, "authority tour --json");
  assert.equal(protocol.requests.mcp.invoke.name, "reelier_outcome_invoke");
  assert.equal(protocol.requests.http.invoke.route, "POST /v1/outcomes/example");
  assert.equal(protocol.commonProtocolArtifact, "verified");
  assert.equal("hostRuntimeConformance" in protocol, false);
});
```

- [ ] **Step 2: Run RED**

```powershell
npx tsc -p tsconfig.test.json
node --test dist-test/test/authority/authority-onboarding-conformance.test.js
```

- [ ] **Step 3: Implement minimal generic conformance**

Use `execFile`/`spawn` with the fixed tour arguments, `windowsHide: true`, empty stdin, bounded output, monotonic total deadline, and a minimal allowlisted environment containing no inherited credential variables. Validate single-object JSON through Task 1. A successful tour fixture promotes only `reelier-cli-tour`. Protocol verification returns `commonProtocolArtifact` only. Construct the five named host entries as `support: unchecked`, `commonProtocolArtifact: verified`, `hostRuntimeConformance: unchecked`, `reasonCode: host-runtime-unchecked`, with no `hostRuntime` object.

- [ ] **Step 4: Run GREEN and canary corpus**

```powershell
npx tsc -p tsconfig.test.json
node --test dist-test/test/authority/authority-onboarding-conformance.test.js dist-test/test/authority/host-server.test.js
git diff --check -- src/authority/onboarding-conformance.ts test/fixtures/authority/onboarding/reelier-cli-tour.json test/fixtures/authority/onboarding/common-protocol.json test/authority/authority-onboarding-conformance.test.ts
```

- [ ] **Step 5: Commit and independent process-boundary review**

```powershell
git add -- test/authority/authority-onboarding-conformance.test.ts test/fixtures/authority/onboarding/reelier-cli-tour.json test/fixtures/authority/onboarding/common-protocol.json
git commit -m "test(authority): separate tour and protocol conformance"
git add -- src/authority/onboarding-conformance.ts .superpowers/sdd/2026-08-12-agent-neutral-path-c-onboarding-latency/task-3-report.md
git commit -m "feat(authority): conform packed tour runtime"
```

The reviewer must reproduce every process failure and verify no error artifact contains a canary, raw output, environment value, or executable path.

### Task 4: Integrate the packed-tour journey and explicit ceremony into `authority tour`

**Files:**
- Create: `src/authority/onboarding.ts`
- Modify: `src/authority/certification/tour-report.ts`
- Modify: `src/authority/cli.ts`
- Modify: `src/cli.ts`
- Test: `test/authority/authority-onboarding-tour.test.ts`
- Modify: `test/authority/authority-tour.test.ts`
- Create: `.superpowers/sdd/2026-08-12-agent-neutral-path-c-onboarding-latency/task-4-report.md`

**Interfaces:**
- `runAuthorityOnboardingTour(options, runtime)` composes the reviewed hermetic Path A/B/C tour, packed-tour runtime conformance, separate common-protocol evidence, host matrix, onboarding measurements, and operator-action measurements.
- `reelier authority tour` remains the command. Add only `--json`, existing confined `--output`, and explicit `--host <reelier-cli-tour|grok-build|claude-code|hermes|codex|eve>` reporting. Host selection does not inspect or modify that host.
- Default and `--host reelier-cli-tour` run the same tour fixture. Selecting a named host changes only which unchecked row is foregrounded; it performs no host process launch and writes no host/plugin/config file. No tour path emits a production MCP/HTTP Outcome request.
- The authority/session ceremony reuses the existing reviewed Task 4A-6 opaque signed root -> child grant -> principal/session allocation. Before it, authorization is absent and dispatchable is false. Common adapter conformance, login, installation, and host selection cannot cross it.
- Human output contains `Learn`, `Authorize fixture`, `Verify`; it prints one state/reason per stage. JSON contains exact `fixtureOperatorActions` measured by test instrumentation and `productionOperatorActions: { status: "not-run" }`.

- [ ] **Step 1: Write RED CLI/journey tests**

Cover the default packed tour, every named host selection remaining unchecked, separate verified common-protocol evidence, ceremony refusal/acceptance, revocation before fixture gate, Windows client/Linux Cell wording, absent production connection, exact offline verification, no production Outcome request, no provider/Cloud/model/network/credential/history access, stable JSON, and action-count separation. Assert no `<=4` production claim exists.

```ts
test("selecting a named host cannot turn common artifact evidence into host support", async () => {
  const report = await runTour(["--host", "eve", "--json"], hermeticRuntime);
  assert.equal(report.onboarding.host.hostId, "eve");
  assert.equal(report.onboarding.host.commonProtocolArtifact, "verified");
  assert.equal(report.onboarding.host.hostRuntimeConformance, "unchecked");
  assert.equal(report.onboarding.host.support, "unchecked");
  assert.deepEqual(report.onboarding.operatorActions.production, { journey: "production", status: "not-run" });
});
```

- [ ] **Step 2: Run RED**

```powershell
npx tsc -p tsconfig.test.json
node --test dist-test/test/authority/authority-onboarding-tour.test.js dist-test/test/authority/authority-tour.test.js
```

- [ ] **Step 3: Implement the smallest composition and UX**

Use injected clocks/process/filesystem/network seams. Do not add a host detector, installer, plugin generator, credential reader, or live connection check. Preserve production `/v1/identity` authentication. Do not expose executable fixture constructors from public Authority barrels.

- [ ] **Step 4: Run GREEN and expert-surface regressions**

```powershell
npx tsc -p tsconfig.test.json
node --test dist-test/test/authority/authority-onboarding-tour.test.js dist-test/test/authority/authority-tour.test.js dist-test/test/authority/certify-cli.test.js dist-test/test/authority/authority-cell-connection.test.js
npm run check:authority-contract
git diff --check -- src/authority/onboarding.ts src/authority/certification/tour-report.ts src/authority/cli.ts src/cli.ts test/authority/authority-onboarding-tour.test.ts test/authority/authority-tour.test.ts
```

- [ ] **Step 5: Commit and two-reviewer gate**

```powershell
git add -- test/authority/authority-onboarding-tour.test.ts test/authority/authority-tour.test.ts
git commit -m "test(authority): specify packed tour journey"
git add -- src/authority/onboarding.ts src/authority/certification/tour-report.ts src/authority/cli.ts src/cli.ts .superpowers/sdd/2026-08-12-agent-neutral-path-c-onboarding-latency/task-4-report.md
git commit -m "feat(authority): add packed tour journey"
```

One reviewer checks clean-user comprehension; a separate reviewer checks that the ceremony is the sole authorization transition and that host selection cannot create runtime support.

### Task 5: Measure onboarding setup, ceremony, and operator actions without an SLO

**Files:**
- Create: `src/authority/onboarding-latency.ts`
- Create: `scripts/write-onboarding-baseline.mjs`
- Modify: `src/authority/onboarding.ts`
- Test: `test/authority/authority-onboarding-latency.test.ts`
- Create: `.superpowers/sdd/2026-08-12-agent-neutral-path-c-onboarding-latency/task-5-report.md`

**Interfaces:**
- Produces `createOnboardingRecorder({ now, onOperation })`, `measureOnboardingPhase(recorder, phase, fn)`, `summarizeOnboardingSamples(samples)`, and `writeOnboardingBaselineArtifact(input, outputFile)`.
- `summarizeOnboardingSamples` returns count plus nearest-rank p50/p95/p99 for `setup.durationMs`, `ceremony.durationMs`, setup operation count, ceremony operation count, and hermetic fixture operator actions.
- Baseline artifact is `reelier.onboarding-baseline/v1` with package/adapter/fixture/Node/OS digests or identifiers, raw samples, p50/p95/p99 summary, `productionOperatorActions: not-run`, and `numericalSlo: absent`.
- Only immutable verified package/adapter/schema/contract digests may be cached. Ceremony authority state is always recomputed.

- [ ] **Step 1: Write RED deterministic timing and writer tests**

Use injected monotonic sequences to isolate setup and ceremony. Prove graph/export, provider, Cloud, model, reviewer, npm, gate, dispatch, acknowledgement, reconciliation, receipt, and production action functions are never called. Test nearest-rank percentile behavior at 1, 2, 20, and 100 samples. Test atomic writer replacement, stable JSON bytes, corrupt existing artifact refusal, and no secrets/raw process output.

- [ ] **Step 2: Run RED with correct Node test syntax**

```powershell
npx tsc -p tsconfig.test.json
node --test --test-name-pattern="onboarding latency" dist-test/test/authority/authority-onboarding-latency.test.js
```

- [ ] **Step 3: Implement the recorder, summary, and explicit artifact writer**

Use `performance.now()` by default, injected time in tests, and operation increments at named onboarding boundaries. The writer accepts a caller-provided confined output path, writes a sibling temporary file, fsyncs where available, and renames atomically. It does not upload, publish, sign, or interpret the baseline.

- [ ] **Step 4: Run 100 hermetic samples and record baseline, not budget**

```powershell
npx tsc -p tsconfig.test.json
node --test dist-test/test/authority/authority-onboarding-latency.test.js
node scripts/write-onboarding-baseline.mjs --iterations 100 --output .superpowers/sdd/2026-08-12-agent-neutral-path-c-onboarding-latency/onboarding-baseline.json
git diff --check -- src/authority/onboarding-latency.ts scripts/write-onboarding-baseline.mjs src/authority/onboarding.ts test/authority/authority-onboarding-latency.test.ts .superpowers/sdd/2026-08-12-agent-neutral-path-c-onboarding-latency
```

Task report records p50/p95/p99 and environmental identifiers, labels them `hermetic-onboarding-baseline`, and states `numericalSlo: absent`. It makes no production latency or operator-action claim.

- [ ] **Step 5: Commit and independent measurement review**

```powershell
git add -- test/authority/authority-onboarding-latency.test.ts
git commit -m "test(authority): specify onboarding measurements"
git add -- src/authority/onboarding-latency.ts scripts/write-onboarding-baseline.mjs src/authority/onboarding.ts .superpowers/sdd/2026-08-12-agent-neutral-path-c-onboarding-latency/task-5-report.md .superpowers/sdd/2026-08-12-agent-neutral-path-c-onboarding-latency/onboarding-baseline.json
git commit -m "feat(authority): measure tour onboarding"
```

The reviewer must recalculate percentiles independently and verify that removing/corrupting any immutable cache changes setup performance only, never authority or evidence results.

### Task 6: Certify the packed tour and common protocol, then publish future host-promotion gates

**Files:**
- Create: `test/packed/authority-onboarding.mjs`
- Modify: `test/authority/package.test.ts`
- Modify: `.github/workflows/ci.yml`
- Create: `docs/authority/onboarding.md`
- Create: `docs/authority/host-promotion.md`
- Modify: `docs/authority/tour.md`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/plans/2026-08-12-agent-neutral-path-c-onboarding-latency.md`
- Create: `.superpowers/sdd/2026-08-12-agent-neutral-path-c-onboarding-latency/task-6-report.md`

**Interfaces:**
- Packed test installs one exact tarball in clean Ubuntu and Windows fixtures, runs `reelier-cli-tour` conformance, separately verifies the common MCP/HTTP protocol artifact, executes the Linux hermetic ceremony, and verifies Ubuntu-produced evidence offline on Windows.
- Package test asserts tarball inclusion and digest agreement for `dist/authority/host/adapters.js`, both contract schemas, `integrations/authority/common/mcp-tools.json`, and `integrations/authority/common/http-routes.json`.
- `docs/authority/host-promotion.md` defines five independent future tasks, ordered after the native GitHub-label tracer. Each future task must pin the real host binary/runtime and parser, run its actual install/load/invoke route against the generic fake Cell and then the GitHub tracer, set secret/config/history canaries, test malformed/unknown versions, and publish a fixture digest before changing `unchecked` to `supported`.
- The future tasks are distinct and non-blocking: Grok Build, Claude Code, Hermes, Codex, and eve. No task may inherit another host's verdict or promote “all compatible hosts.”

- [ ] **Step 1: Write RED packed/runtime-content and claims gates**

Pack, install without network into temp projects, run `authority tour --json`, separately exercise common MCP/HTTP fixture surfaces against the fake Cell, prove the CLI process emitted no production Outcome request, inspect tarball contents, deny external network, scan stdout/stderr/reports/receipts for canaries, and verify offline cross-platform evidence. Add a docs test requiring all five named hosts to render `unchecked` and rejecting “supported” next to them.

- [ ] **Step 2: Run RED against the exact tarball**

```powershell
npm run build
npm pack --json
node test/packed/authority-onboarding.mjs
```

Expected: fail until package embedding, CI, and docs are complete.

- [ ] **Step 3: Add CI, honest onboarding docs, and post-tracer promotion gates**

Document the hermetic tour action count as measured, production action count as not run, the Windows/Linux split, the CLI-tour/common-protocol separation, exact MCP/HTTP request surfaces required of a production client, the explicit authority ceremony, process reason codes, p50/p95/p99 baseline with no SLO, and these nonclaims:

- No credential values, histories, memories, or host configs were read or copied.
- No model, provider, package registry, or Reelier Cloud call participated in tour, preparation, conformance, or offline verification.
- `reelier-cli-tour` support proves only the packed hermetic tour runtime; it does not prove the CLI can emit a production governed request.
- Common protocol artifact verification is not a host runtime or client conformance claim.
- Production Outcome invocation requires an independently conformed MCP or HTTP client.
- Grok Build, Claude Code, Hermes, Codex, and eve remain unchecked until separate post-GitHub-tracer host tasks pass.
- Windows is a client/offline verifier; Path C executes in the Linux Authority Cell.
- Passing common conformance is not universal MCP, plugin, GUI, direct-HTTP, or write completeness.
- Verified evidence does not mean safe, semantically correct, complete, or delivered.
- No numerical onboarding SLO or production operator-action claim exists.

- [ ] **Step 4: Run the full verification ladder**

```powershell
npm run check:authority-contract
npm run build
npx tsc -p tsconfig.test.json
node --test dist-test/test/authority/authority-onboarding-report.test.js dist-test/test/authority/authority-adapter-artifact.test.js dist-test/test/authority/authority-onboarding-conformance.test.js dist-test/test/authority/authority-onboarding-tour.test.js dist-test/test/authority/authority-onboarding-latency.test.js dist-test/test/authority/authority-tour.test.js dist-test/test/authority/authority-cell-connection.test.js dist-test/test/authority/certify-cli.test.js dist-test/test/authority/package.test.js
node test/packed/authority-onboarding.mjs
npm test
git diff --check
git status --short
```

CI runs the exact same tarball on `ubuntu-latest` for Cell/fixture execution and `windows-latest` for client/offline verification. Local platform simulation cannot replace hosted evidence.

- [ ] **Step 5: Commit, claim audit, and two independent final reviews**

```powershell
git add -- test/packed/authority-onboarding.mjs test/authority/package.test.ts .github/workflows/ci.yml
git commit -m "test(authority): certify packed tour onboarding"
git add -- docs/authority/onboarding.md docs/authority/host-promotion.md docs/authority/tour.md README.md CHANGELOG.md AGENTS.md CLAUDE.md docs/superpowers/plans/2026-08-12-agent-neutral-path-c-onboarding-latency.md .superpowers/sdd/2026-08-12-agent-neutral-path-c-onboarding-latency/task-6-report.md
git commit -m "docs(authority): publish tour onboarding boundary"
```

One reviewer audits protocol/security/package evidence. A separate clean-machine reviewer reproduces usability/baseline results. Both must approve the exact packed candidate and hosted Ubuntu/Windows jobs.

## Completion criteria

- `reelier authority tour` is the sole first command and demonstrates a genuine hermetic governed Outcome with zero model, provider, Cloud, registry, credential, history, or external-network access.
- `src/authority/host/adapters.ts` is the single common adapter source and accurately separates Cell hosting from Outcome invocation.
- The exact common MCP/HTTP request and status surfaces are packaged and digest-bound as `commonProtocolArtifact`; fake-Cell verification does not imply the CLI or any named host emitted them.
- `reelier-cli-tour` is the only supported runtime and support is limited to the hermetic tour. Production Outcome invocation requires an independently conformed MCP or HTTP client. Grok Build, Claude Code, Hermes, Codex, and eve remain unchecked until separate post-native-tracer conformance tasks.
- Common protocol artifact evidence and host runtime conformance cannot be conflated structurally or in copy.
- The existing signed ceremony remains the only authority/session transition; tour, login, adapter bytes, and runtime possession grant nothing.
- Windows remains a client/offline verifier and Linux remains the Authority Cell execution host.
- Hermetic setup, ceremony, and fixture operator actions have reproducible p50/p95/p99 baseline evidence. Production actions are not run, native dispatch phases belong to the native HTTPS plan, and no SLO is claimed.
- Stable closed JSON and process failure reason codes reveal no raw command, path, environment, output, credential, or canary material.

## Plan self-review checklist

- [ ] Map every global constraint to a task/test in the Task 6 report.
- [ ] Scan plan and implementation diffs for placeholder language, new top-level verbs, named-host support, guessed host paths/commands, credential/config/history reads, and a second adapter registry; require zero implementation hits.
- [ ] Verify type consistency for `commonProtocolArtifact`, `hostRuntimeConformance`, `support`, `reasonCode`, `measurements`, and `operatorActions` from Task 1 through Task 6.
- [ ] Verify only the active task's declared files change before each commit; preserve unrelated worktree changes.
- [ ] Run `git diff --check` after each task and the full verification ladder before any completion claim.
