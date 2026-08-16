# Continuity Adapter Conformance and Eve Tracer-Bullet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an open Continuity Adapter v1 conformance runner and a hermetic Eve 0.37.1 process-kill tracer bullet proving that task truth survives harness replacement without duplicating a Path C consequence.

**Architecture:** Keep `reelier/continuity` as the model-neutral truth kernel, add only the missing authenticated Outcome-status operation, and exercise it through a public adapter candidate protocol. Run a separate Eve fixture over Eve's durable HTTP session API; the fixture talks to a loopback-only hermetic Path C port, while the conformance runner observes counters and artifacts without importing private Authority Cell state.

**Tech Stack:** TypeScript 5.5/Node 20 for Reelier, Node 24 for the isolated Eve fixture, `eve@0.37.1`, `zod@4.4.3`, Node test runner, JSON Schema 2020-12/Ajv, Eve local Workflow world, loopback HTTP only.

**Spec:** `docs/superpowers/specs/2026-08-14-continuity-adapter-conformance-design.md`

## Global Constraints

- Pin the implementation base to `fb31b587488ad25b932d5cb8aef2f5aadff15c1b`; preserve all later review repairs.
- Pin Eve exactly to `0.37.1`; do not use a caret range.
- Do not add Eve, Zod 4, or Node 24 packages to Reelier's root dependencies or devDependencies.
- Use Eve's HTTP session API; ACP restart/resume is explicitly out of scope.
- Use `mockModel`; do not call a model provider or load model credentials.
- Use loopback networking only; do not deploy Eve or contact a live provider.
- Do not create or onboard a Grok Bot.
- Identity, task, workload, job-card digest, and authority-snapshot digest come from host-owned binding state, never model-facing input.
- `open()`, stream reconnect, compact, clear, and replacement-harness resume perform zero Outcome requests and zero provider dispatches.
- Only verifier-produced Path C evidence may become `verified`; agent memos and public checkpoints remain `unchecked`.
- Ambiguity must project `reconcile-before-retry`; no automatic resend or compensation is allowed.
- Reports must state that topology, traffic completeness, semantic correctness, safety, and production readiness are not proved.
- Every task ends with focused tests, `git diff --check`, and an immutable commit. Do not merge, push, or dispatch workflows during implementation.

---

### Task 1: Add authenticated Outcome status to the runtime adapter

**Files:**
- Modify: `src/continuity/adapter.ts`
- Modify: `test/continuity/adapter.test.ts`
- Modify: `test/continuity/kill-resume.test.ts`
- Modify: `test/continuity/package.test.ts`

**Interfaces:**
- Consumes: `AuthorityIngressOutcome`, `AuthenticatedWorkloadV1`, and the existing `ContinuityRuntimeAdapterV1` factory.
- Produces: `OutcomeStatusRequesterV1`, `ContinuityRuntimeAdapterV1.statusOutcome(input)`, and `ContinuityRuntimeAdapterOptionsV1.statusOutcome`.

- [ ] **Step 1: Write the failing host-identity/status test**

Append this test to `test/continuity/adapter.test.ts`:

```ts
test("adapter binds Outcome status reads to host identity without redispatch", async () => {
  await withRoot(async root => {
    let requested = 0;
    let observed: readonly [typeof actor, Readonly<{ requestId: string }>] | undefined;
    const status: AuthorityIngressOutcome = {
      requestId: "request_1",
      verdict: "accepted",
      reasonCode: "existing",
      lifecycleState: "ambiguous",
    };
    const adapter = createContinuityRuntimeAdapter({
      ledger: new FsContinuityLedger(root),
      identify: async () => actor,
      requestOutcome: async () => {
        requested += 1;
        throw new Error("status must not request another Outcome");
      },
      statusOutcome: async (identity, input) => {
        observed = [identity, input];
        return status;
      },
    });

    assert.deepEqual(await adapter.statusOutcome({ requestId: "request_1" }), status);
    assert.deepEqual(observed, [actor, { requestId: "request_1" }]);
    assert.equal(requested, 0);
  });
});
```

Update both existing adapter factories in this file with an explicit unused status port:

```ts
statusOutcome: async () => { throw new Error("unused Outcome status requester"); },
```

- [ ] **Step 2: Run the focused test and confirm the interface is absent**

Run:

```powershell
npx tsc -p tsconfig.test.json
```

Expected: compilation fails because `statusOutcome` is not accepted by `ContinuityRuntimeAdapterOptionsV1` and does not exist on `ContinuityRuntimeAdapterV1`.

- [ ] **Step 3: Add the minimal authenticated status surface**

Add to `src/continuity/adapter.ts`:

```ts
export type OutcomeStatusRequesterV1 = (
  actor: AuthenticatedWorkloadV1,
  input: Readonly<{ requestId: string }>,
) => Promise<AuthorityIngressOutcome>;
```

Extend the two interfaces exactly:

```ts
export interface ContinuityRuntimeAdapterV1 {
  identify(): Promise<AuthenticatedWorkloadV1>;
  open(taskId: string): Promise<ResumeProjectionV1>;
  checkpoint(input: ContinuityCheckpointV1): Promise<ContinuityAppendResultV1>;
  requestOutcome(input: OutcomeRequest): Promise<AuthorityIngressOutcome>;
  statusOutcome(input: Readonly<{ requestId: string }>): Promise<AuthorityIngressOutcome>;
}

export interface ContinuityRuntimeAdapterOptionsV1 {
  readonly ledger: FsContinuityLedger;
  readonly identify: () => Promise<AuthenticatedWorkloadV1>;
  readonly requestOutcome: OutcomeRequesterV1;
  readonly statusOutcome: OutcomeStatusRequesterV1;
}
```

Return the method from `createContinuityRuntimeAdapter` without changing `open`, `checkpoint`, or `requestOutcome`:

```ts
async statusOutcome(input) {
  return options.statusOutcome(await identify(), input);
},
```

- [ ] **Step 4: Update every existing adapter construction**

Run:

```powershell
rg -n "createContinuityRuntimeAdapter\(" test src
```

For each existing options object, add an explicit `statusOutcome` function. Tests that do not exercise status must throw `unused Outcome status requester`; the replacement-harness test must increment a separate status counter so it can assert `open()` performs neither request nor status.

- [ ] **Step 5: Prove status is public and read-only**

Add `OutcomeStatusRequesterV1` to the type import assertions in `test/continuity/package.test.ts` only if that test already checks emitted declarations. Keep the runtime export check unchanged because types do not exist at runtime.

Run:

```powershell
npx tsc -p tsconfig.test.json
node --test --test-concurrency=1 dist-test/test/continuity/adapter.test.js dist-test/test/continuity/kill-resume.test.js dist-test/test/continuity/package.test.js
```

Expected: all focused tests pass; the replacement `open()` counter remains `{ requests: 0, statuses: 0 }`.

- [ ] **Step 6: Commit the authenticated status operation**

```powershell
git diff --check
git add -- src/continuity/adapter.ts test/continuity/adapter.test.ts test/continuity/kill-resume.test.ts test/continuity/package.test.ts
git commit -m "feat(continuity): add authenticated outcome status"
```

---

### Task 2: Freeze the open executable Continuity Adapter v1 contract

**Files:**
- Create: `conformance/continuity-adapter/v1/README.md`
- Create: `conformance/continuity-adapter/v1/candidate.schema.json`
- Create: `conformance/continuity-adapter/v1/report.schema.json`
- Create: `conformance/continuity-adapter/v1/protocol.d.ts`
- Create: `conformance/continuity-adapter/v1/check.mjs`
- Create: `conformance/continuity-adapter/v1/fixtures/core-candidate.mjs`
- Create: `test/continuity/conformance-runner.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: the public `reelier/continuity` and `reelier/authority` package subpaths plus `AUTHORITY_ADAPTER_CONTRACT_V1_DIGEST`.
- Produces: `createCandidate(input)`, `checkContinuityAdapterCandidate(modulePath)`, closed candidate/report records, and `npm run check:continuity-adapter`.

- [ ] **Step 1: Write failing runner contract tests**

Create `test/continuity/conformance-runner.test.ts` with these cases:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { checkContinuityAdapterCandidate } from "../../conformance/continuity-adapter/v1/check.mjs";

const candidate = pathToFileURL(resolve("conformance/continuity-adapter/v1/fixtures/core-candidate.mjs")).href;

test("core candidate passes the closed continuity adapter contract", async () => {
  const report = await checkContinuityAdapterCandidate(candidate);
  assert.equal(report.v, "reelier.continuity-adapter-conformance-report/v1");
  assert.equal(report.status, "passed");
  assert.equal(report.maturity, "reproduced");
  assert.equal(report.checks.every((item: { status: string }) => item.status === "passed"), true);
  assert.deepEqual(report.nonClaims, {
    contentCorrectness: "not-proved",
    productionReadiness: "not-proved",
    safety: "not-proved",
    topology: "not-proved",
    trafficCompleteness: "not-proved",
  });
});

test("runner fails a candidate that dispatches during open", async () => {
  const report = await checkContinuityAdapterCandidate(candidate, { mutation: "dispatch-on-open" });
  assert.equal(report.status, "failed");
  assert.equal(report.checks.find((item: { id: string }) => item.id === "resume-is-read-only")?.status, "failed");
});

test("runner fails identity override and evidence upgrade candidates", async () => {
  for (const mutation of ["identity-from-input", "unchecked-as-verified"] as const) {
    const report = await checkContinuityAdapterCandidate(candidate, { mutation });
    assert.equal(report.status, "failed");
  }
});
```

- [ ] **Step 2: Compile the test and confirm the runner is missing**

Run:

```powershell
npx tsc -p tsconfig.test.json
```

Expected: compilation fails because `conformance/continuity-adapter/v1/check.mjs` and its exported function do not exist.

- [ ] **Step 3: Define the candidate protocol and closed schemas**

Write `protocol.d.ts` with this exact driver surface:

```ts
import type { ContinuityEventV1, ContinuityRuntimeAdapterV1 } from "reelier/continuity";

export interface CandidateBindingV1 {
  readonly taskId: string;
  readonly principalId: string;
  readonly workloadId: string;
  readonly runtimeSessionId: string;
  readonly harnessId: string;
}

export interface CandidateCountersV1 {
  readonly outcomeRequests: number;
  readonly statusReads: number;
  readonly providerDispatches: number;
  readonly reservations: number;
}

export interface ContinuityAdapterCandidateV1 {
  readonly descriptor: {
    readonly v: "reelier.continuity-adapter-candidate/v1";
    readonly adapterId: string;
    readonly harnessId: string;
    readonly harnessVersion: string;
    readonly reelierCommit: string;
    readonly authorityAdapterContractDigest: string;
  };
  provision(events: readonly ContinuityEventV1[]): Promise<void>;
  adapter(binding: CandidateBindingV1): Promise<ContinuityRuntimeAdapterV1>;
  counters(): Promise<CandidateCountersV1>;
  close(): Promise<void>;
}

export function createCandidate(input: Readonly<{
  scenarioId: string;
  mutation?: "dispatch-on-open" | "identity-from-input" | "unchecked-as-verified";
}>): Promise<ContinuityAdapterCandidateV1>;
```

Make `candidate.schema.json` exact and closed over the five descriptor fields after `v`. Require non-empty IDs, a semantic harness version, a 40-character lowercase commit, and a nonzero `sha256:` digest. Make `report.schema.json` exact and closed over `v`, `status`, `maturity`, `adapterId`, `harnessId`, `harnessVersion`, `reelierCommit`, `authorityAdapterContractDigest`, `checks`, and `nonClaims`. Restrict every check to `{ id, status, detail }` and every non-claim value to `not-proved`.

- [ ] **Step 4: Implement the generic checker against public methods**

In `check.mjs`, export:

```js
export async function checkContinuityAdapterCandidate(modulePath, options = {}) {
  const module = await import(modulePath);
  if (typeof module.createCandidate !== "function") return invalid("candidate-module", "createCandidate export is absent");
  const checks = [];
  await runScenario("host-identity", module.createCandidate, options, checks);
  await runScenario("identity-isolation-refuses", module.createCandidate, options, checks);
  await runScenario("replacement-projection", module.createCandidate, options, checks);
  await runScenario("resume-is-read-only", module.createCandidate, options, checks);
  await runScenario("cursor-contention", module.createCandidate, options, checks);
  await runScenario("ambiguity-blocks-resend", module.createCandidate, options, checks);
  await runScenario("status-does-not-dispatch", module.createCandidate, options, checks);
  await runScenario("semantic-retry-is-idempotent", module.createCandidate, options, checks);
  await runScenario("request-id-conflict-refuses", module.createCandidate, options, checks);
  await runScenario("uncertainty-is-honest", module.createCandidate, options, checks);
  return closedReport(checks);
}
```

Implement each named scenario with fresh `createCandidate({ scenarioId, mutation })` state and `finally { await candidate.close(); }`. Use only `identify`, `open`, `checkpoint`, `requestOutcome`, `statusOutcome`, and `counters`; do not read ledger files or candidate-private fields. `identity-isolation-refuses` attempts cross-task `open` plus checkpoints whose task, principal, and workload each disagree with the host binding, and requires every call to refuse with an unchanged ledger projection. The semantic-retry scenario calls the same canonical `OutcomeRequest` twice and requires `providerDispatches === 1` and `reservations === 1`; it then uses a different request ID and requires the counters to increase to `2`. The request-ID-conflict scenario reuses one request ID with different `choices`, requires a refused `request-id-conflict` outcome, and requires dispatch/reservation counters to remain unchanged.

Validate the descriptor before scenarios and the final report before returning it. The CLI form accepts exactly one module path, writes one JSON line, exits `0` for passed, `1` for failed, and `2` for usage errors. Never include candidate values, credentials, stack traces, or filesystem roots in failure details.

- [ ] **Step 5: Implement the hermetic core candidate**

Create `fixtures/core-candidate.mjs` using a temporary `FsContinuityLedger`, `createContinuityRuntimeAdapter`, and a Map keyed by `requestId`. Each entry stores canonical request bytes plus its outcome. The requester must reserve and dispatch once per new semantic request; a reused ID with different canonical bytes returns `verdict: "refused"`, `reasonCode: "request-id-conflict"`, and performs no dispatch or reservation:

```js
import { authorityCanonicalBytes } from "reelier/authority";

const outcomes = new Map(); // requestId -> { requestBytes, outcome }
const counters = { outcomeRequests: 0, statusReads: 0, providerDispatches: 0, reservations: 0 };

async function requestOutcome(_actor, input) {
  counters.outcomeRequests += 1;
  const existing = outcomes.get(input.requestId);
  const requestBytes = authorityCanonicalBytes(input);
  if (existing && !existing.requestBytes.equals(requestBytes)) return Object.freeze({
    requestId: input.requestId,
    verdict: "refused",
    reasonCode: "request-id-conflict",
    lifecycleState: "refused",
  });
  if (existing) return existing.outcome;
  counters.reservations += 1;
  counters.providerDispatches += 1;
  const created = Object.freeze({
    requestId: input.requestId,
    verdict: "accepted",
    reasonCode: "accepted",
    lifecycleState: "ambiguous",
  });
  outcomes.set(input.requestId, { requestBytes, outcome: created });
  return created;
}

async function statusOutcome(_actor, input) {
  counters.statusReads += 1;
  return outcomes.get(input.requestId)?.outcome ?? Object.freeze({
    requestId: input.requestId,
    verdict: "refused",
    reasonCode: "status-absent",
    lifecycleState: "absent",
  });
}
```

Implement mutations only inside this fixture so the runner itself remains unchanged. `dispatch-on-open` increments `providerDispatches` before delegating to the real `open`; `identity-from-input` returns a mismatched actor; `unchecked-as-verified` attempts a fabricated verified claim and must cause the runner's honesty check to fail.

- [ ] **Step 6: Document and wire the command**

In `README.md`, state the candidate protocol, ten checks, report fields, and non-claims. Add to root `package.json`:

```json
"check:continuity-adapter": "node conformance/continuity-adapter/v1/check.mjs"
```

Run:

```powershell
npx tsc -p tsconfig.test.json
node --test --test-concurrency=1 dist-test/test/continuity/conformance-runner.test.js
npm run check:continuity-adapter -- ./conformance/continuity-adapter/v1/fixtures/core-candidate.mjs
```

Expected: tests pass and the CLI emits one closed `passed` report.

- [ ] **Step 7: Commit the portable conformance kit**

```powershell
git diff --check
git add -- conformance/continuity-adapter/v1 package.json test/continuity/conformance-runner.test.ts
git commit -m "feat(continuity): add adapter conformance v1"
```

---

### Task 3: Expose the existing hermetic Path C journey through a loopback-only port

**Files:**
- Create: `test/authority/fixtures/github-issue-labels.ts`
- Modify: `test/authority/certification-github-issue-labels-runner.test.ts`
- Create: `test/continuity/support/path-c-port.ts`
- Create: `test/continuity/path-c-port.test.ts`

**Interfaces:**
- Consumes: the existing hermetic GitHub label certification composition and its current test fixture.
- Produces: `createGitHubIssueLabelsFixture(mode)`, `startPathCConformancePort(options)`, a loopback URL/token, counters, a fault latch, verified graph export, and deterministic cleanup.

- [ ] **Step 1: Extract the existing authority fixture without changing behavior**

Move the current `fixture(mode)` construction from `test/authority/certification-github-issue-labels-runner.test.ts` into `test/authority/fixtures/github-issue-labels.ts` and export:

```ts
export type GitHubIssueLabelsFixtureMode =
  | "normal"
  | "source-drift"
  | "effect-drift"
  | "provider-503"
  | "accessor-response"
  | "cut-after-budget"
  | "cut-after-dispatched"
  | "cut-after-send-intent"
  | "cut-after-cleanup-publication"
  | "cut-after-conflict-publication"
  | "cut-after-conflict-receipt-before-extension"
  | "pause-after-dispatched";

export type GitHubIssueLabelsAuthorityMode =
  | "valid"
  | "absent"
  | "substituted"
  | "contract-substituted";

export type GitHubIssueLabelsFixture = Awaited<
  ReturnType<typeof createGitHubIssueLabelsFixture>
>;
```

Rename the moved implementation to `createGitHubIssueLabelsFixture(mode: GitHubIssueLabelsFixtureMode = "normal", authorityMode: GitHubIssueLabelsAuthorityMode = "valid")`. Keep its exact operator config, complete inferred return shape, principals, grants, budget, hermetic provider, trust material, and cleanup behavior; add `close(): Promise<void>` to the returned object. Replace every local `fixture(...)` call in the authority test with `createGitHubIssueLabelsFixture(...)`; replace repeated `rm(f.root, ...)` cleanup with `f.close()`.

- [ ] **Step 2: Prove extraction is behavior-neutral**

Run:

```powershell
npx tsc -p tsconfig.test.json
node --test --test-concurrency=1 dist-test/test/authority/certification-github-issue-labels-runner.test.js
```

Expected: the existing runner test count and assertions are unchanged.

- [ ] **Step 3: Write failing loopback-port tests**

Create `test/continuity/path-c-port.test.ts`:

```ts
test("loopback Path C port keeps provider credentials inside the port and deduplicates request IDs", async () => {
  const fixture = await createGitHubIssueLabelsFixture();
  const port = await startPathCConformancePort({ fixture });
  try {
    const headers = { authorization: `Bearer ${port.clientToken}`, "content-type": "application/json" };
    const body = JSON.stringify({ requestId: "request_eve_retry", sourceRefs: { issue: "issue_1" }, choices: { label: "ready" } });
    const first = await fetch(`${port.url}/outcomes`, { method: "POST", headers, body }).then(value => value.json());
    const retry = await fetch(`${port.url}/outcomes`, { method: "POST", headers, body }).then(value => value.json());
    assert.equal(first.providerWrites, 1);
    assert.equal(retry.providerWrites, 1);
    assert.deepEqual(port.counters(), { outcomeRequests: 2, statusReads: 0, providerDispatches: 1, reservations: 1 });
    assert.equal(JSON.stringify(first).includes(fixture.credential.token), false);
  } finally {
    await port.close();
    await fixture.close();
  }
});
```

Add tests for `401` without the client token, `GET /outcomes/:requestId` incrementing only `statusReads`, and the after-provider-apply latch withholding the first response until `release()`.

- [ ] **Step 4: Implement the loopback authority port**

`startPathCConformancePort` must bind to `127.0.0.1` on port `0`, mint a random client token, and expose only:

```text
POST /outcomes
GET  /outcomes/:requestId
GET  /counters
```

The POST handler validates the closed request shape `{ requestId, sourceRefs, choices }`, injects the protocol discriminator `v: "reelier.outcome-request/v1"`, and computes canonical request bytes before calling `fixture.runner.run` with `fixture.credential.token` only inside the server process. Bind each request ID to those bytes: an exact retry reaches the runner, while the same ID with different bytes returns `request-id-conflict` without reaching it. Map runner status to `AuthorityIngressOutcome` without returning provider credentials or private graph data. The runner remains the source of provider-write and budget truth.

The GET handler calls `fixture.runner.status({ bearerToken: fixture.credential.token, requestId })`. The counter snapshot derives `providerDispatches` from `status.providerWrites` and `reservations` from the fixture allocation's consumed budget, not from HTTP call count.

For `fault: "after-provider-apply-before-response"`, complete `runner.run`, signal `faultReached`, then await a private promise until `release()` or server closure. Closing must release all latches, close the HTTP server, and leave fixture cleanup to the caller.

- [ ] **Step 5: Run port and authority regression tests**

```powershell
npx tsc -p tsconfig.test.json
node --test --test-concurrency=1 dist-test/test/continuity/path-c-port.test.js dist-test/test/authority/certification-github-issue-labels-runner.test.js
```

Expected: all tests pass; retries show one provider write and one conserved reservation.

- [ ] **Step 6: Commit the hermetic public-boundary fixture**

```powershell
git diff --check
git add -- test/authority/fixtures/github-issue-labels.ts test/authority/certification-github-issue-labels-runner.test.ts test/continuity/support/path-c-port.ts test/continuity/path-c-port.test.ts
git commit -m "test(continuity): expose hermetic path c port"
```

---

### Task 4: Build the isolated Eve binding and deterministic no-crash conformance

**Files:**
- Create: `conformance/continuity-adapter/v1/eve-fixture/package.json`
- Create: `conformance/continuity-adapter/v1/eve-fixture/package-lock.json`
- Create: `conformance/continuity-adapter/v1/eve-fixture/tsconfig.json`
- Create: `conformance/continuity-adapter/v1/eve-fixture/agent/agent.ts`
- Create: `conformance/continuity-adapter/v1/eve-fixture/agent/channels/eve.ts`
- Create: `conformance/continuity-adapter/v1/eve-fixture/agent/lib/binding.ts`
- Create: `conformance/continuity-adapter/v1/eve-fixture/agent/lib/runtime.ts`
- Create: `conformance/continuity-adapter/v1/eve-fixture/agent/lib/faults.ts`
- Create: `conformance/continuity-adapter/v1/eve-fixture/agent/instructions/continuity.ts`
- Create: `conformance/continuity-adapter/v1/eve-fixture/agent/tools/continuity_checkpoint.ts`
- Create: `conformance/continuity-adapter/v1/eve-fixture/agent/tools/reelier_outcome_request.ts`
- Create: `conformance/continuity-adapter/v1/eve-fixture/agent/tools/reelier_outcome_status.ts`
- Create: `conformance/continuity-adapter/v1/eve-fixture/evals/evals.config.ts`
- Create: `conformance/continuity-adapter/v1/eve-fixture/evals/continuity.eval.ts`
- Create: `test/continuity/eve-binding-static.test.ts`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `eve@0.37.1`, `reelier/continuity`, host auth attributes, the Reelier ledger root, authority digests, and the loopback Path C port URL/token.
- Produces: an Eve HTTP agent whose system context and three tools implement the approved binding without exposing identity or authority fields to the model.

- [ ] **Step 1: Add failing static boundary tests before installing Eve**

Create `test/continuity/eve-binding-static.test.ts` that reads the fixture files and asserts:

```ts
const fixtureRoot = resolve("conformance/continuity-adapter/v1/eve-fixture");
const rootPackageJson = JSON.parse(
  await readFile(resolve(fixtureRoot, "../../../..", "package.json"), "utf8"),
);

function exportedSchemaKeys(source: string): string[] {
  const match = /export const MODEL_INPUT_KEYS = \[([^\]]*)\] as const;/s.exec(source);
  assert.ok(match, "MODEL_INPUT_KEYS must be an exported literal array");
  return [...match[1].matchAll(/"([^"]+)"/g)].map(item => item[1]);
}

test("Eve fixture is isolated and its model-facing schemas exclude authority", async () => {
  const packageJson = JSON.parse(await readFile(join(fixtureRoot, "package.json"), "utf8"));
  assert.equal(packageJson.dependencies.eve, "0.37.1");
  assert.equal(packageJson.dependencies.reelier, "file:../../../..");
  assert.equal(rootPackageJson.dependencies?.eve, undefined);
  assert.equal(rootPackageJson.devDependencies?.eve, undefined);

  const checkpoint = await readFile(join(fixtureRoot, "agent/tools/continuity_checkpoint.ts"), "utf8");
  assert.deepEqual(exportedSchemaKeys(checkpoint), ["events", "evidenceRefs", "expectedCursor", "agentMemo"]);
  for (const forbidden of ["taskId", "actorPrincipalId", "workloadId", "jobCardDigest", "authoritySnapshotDigest"]) {
    assert.equal(exportedSchemaKeys(checkpoint).includes(forbidden), false);
  }
  const outcome = await readFile(join(fixtureRoot, "agent/tools/reelier_outcome_request.ts"), "utf8");
  assert.deepEqual(exportedSchemaKeys(outcome), ["choices", "requestId", "sourceRefs"]);
  const status = await readFile(join(fixtureRoot, "agent/tools/reelier_outcome_status.ts"), "utf8");
  assert.deepEqual(exportedSchemaKeys(status), ["requestId"]);
});
```

The source helper must parse exported literal `MODEL_INPUT_KEYS` arrays rather than grep arbitrary implementation text, because host-only fields legitimately appear in tool construction.

- [ ] **Step 2: Create the isolated package and lock exact versions**

Use this package manifest:

```json
{
  "name": "reelier-eve-continuity-conformance",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "imports": { "#*": "./agent/*", "#evals/*": "./evals/*" },
  "scripts": { "build": "eve build", "dev": "eve dev", "typecheck": "tsc --noEmit", "eval": "eve eval" },
  "dependencies": { "eve": "0.37.1", "reelier": "file:../../../..", "zod": "4.4.3" },
  "devDependencies": { "@types/node": "24.13.3", "typescript": "7.0.2" },
  "engines": { "node": "24.x" }
}
```

Run `npm install --ignore-scripts` inside the fixture to generate its lockfile, then `npm run typecheck` and `npm run build`. Add `.eve/`, `dist/`, and `node_modules/` below this fixture to `.gitignore`; commit the lockfile, not installed output.

- [ ] **Step 3: Implement fixture route authentication and pinned binding**

`agent/channels/eve.ts` must use a custom `AuthFn<Request>` that reads a bearer token, hashes it, and looks it up in `REELIER_EVE_AUTH_REGISTRY_JSON`. Registry entries contain `{ principalId, taskId, workloadId }`; request bodies and prompt text contain none of those values. Return:

```ts
return {
  authenticator: "reelier-eve-conformance",
  principalId: entry.principalId,
  principalType: "user",
  attributes: { taskId: entry.taskId, workloadId: entry.workloadId },
};
```

In `binding.ts`, define session state `reelier.continuity.binding/v1`. On first managed callback, pin `{ taskId, principalId, workloadId }` from `ctx.session.auth.initiator`; on later turns require `ctx.session.auth.current` to match all three. Derive the actor exactly:

```ts
return {
  v: "reelier.authenticated-workload/v1",
  taskId: binding.taskId,
  principalId: binding.principalId,
  workloadId: binding.workloadId,
  runtimeSessionId: ctx.session.id,
  harnessId: "eve@0.37.1",
};
```

Throw before model execution on missing auth, missing attributes, cross-principal follow-up, cross-task follow-up, or changed workload.

- [ ] **Step 4: Build the runtime adapter and turn-scoped resume instruction**

`runtime.ts` constructs `FsContinuityLedger(process.env.REELIER_CONTINUITY_ROOT!)` and `createContinuityRuntimeAdapter`. `requestOutcome` POSTs the closed request to the loopback port; `statusOutcome` GETs by encoded request ID. Both add only the internal port bearer token. `identify` calls the binding helper inside Eve-managed context.

`instructions/continuity.ts` uses `defineDynamic` on `turn.started`, calls `adapter.open(actor.taskId)`, and returns `defineInstructions({ content: renderResumeMarkdown(projection) })` with system role. It never returns `role: "user"` and never calls request/status.

- [ ] **Step 5: Implement the three narrow tools**

Export these literal arrays for static inspection:

```ts
export const MODEL_INPUT_KEYS = ["events", "evidenceRefs", "expectedCursor", "agentMemo"] as const;
export const MODEL_INPUT_KEYS = ["choices", "requestId", "sourceRefs"] as const;
export const MODEL_INPUT_KEYS = ["requestId"] as const;
```

The checkpoint tool reads the host-owned job and authority digests from environment variables, then constructs the full `ContinuityCheckpointV1` with actor fields from `identify()`. Its Zod schema restricts events to the public `ContinuityEventV1` variants and excludes `consequence.observed` plus `status: "verified"`.

The request tool calls only `adapter.requestOutcome`. The status tool calls only `adapter.statusOutcome`. All tool outputs are closed JSON-serializable objects; none includes bearer tokens, route registry data, private receipt graphs, or filesystem paths.

- [ ] **Step 6: Add deterministic Eve behavior and evals**

Configure `mockModel` so the exact fixture prompts produce deterministic tool calls:

```ts
model: mockModel(({ lastUserMessage, toolResults }) => {
  if (toolResults.length > 0) return { text: JSON.stringify(toolResults.at(-1)?.output) };
  if (lastUserMessage === "checkpoint") return { toolCalls: [{ name: "continuity_checkpoint", input: checkpointInput }] };
  if (lastUserMessage === "request outcome") return { toolCalls: [{ name: "reelier_outcome_request", input: outcomeInput }] };
  if (lastUserMessage === "read status") return { toolCalls: [{ name: "reelier_outcome_status", input: { requestId: "request_eve_1" } }] };
  return { text: "continuity ready" };
}),
```

The eval asserts stable session ID across turns, the expected tool names, no failed actions, and system resume content after checkpoint. Use only deterministic assertions; configure no judge and no reporter.

- [ ] **Step 7: Prove the static and no-crash Eve fixture**

Run:

```powershell
npx tsc -p tsconfig.test.json
node --test --test-concurrency=1 dist-test/test/continuity/eve-binding-static.test.js
npm --prefix conformance/continuity-adapter/v1/eve-fixture run typecheck
npm --prefix conformance/continuity-adapter/v1/eve-fixture run build
```

Then start the loopback port from the test harness and run the Eve eval against a local dev server. Expected: no external provider/model calls, stable session ID, and only the three narrow tools.

- [ ] **Step 8: Commit the Eve binding**

```powershell
git diff --check
git add -- .gitignore conformance/continuity-adapter/v1/eve-fixture test/continuity/eve-binding-static.test.ts
git commit -m "feat(continuity): add isolated eve adapter fixture"
```

---

### Task 5: Prove real Eve process kill/resume and emit the final report

**Files:**
- Create: `conformance/continuity-adapter/v1/eve-fixture/scripts/run-conformance.mjs`
- Create: `conformance/continuity-adapter/v1/eve-fixture/scripts/eve-process.mjs`
- Create: `conformance/continuity-adapter/v1/eve-fixture/scripts/stream.mjs`
- Create: `conformance/continuity-adapter/v1/eve-fixture/conformance-report.schema.json`
- Create: `test/continuity/eve-kill-resume.test.ts`
- Modify: `conformance/continuity-adapter/v1/eve-fixture/package.json`
- Modify: `conformance/continuity-adapter/v1/README.md`
- Modify: `package.json`

**Interfaces:**
- Consumes: the Eve fixture, loopback Path C port, durable ledger root, Eve `.eve/.workflow-data`, and public HTTP session/stream routes.
- Produces: `npm run check:continuity-eve`, a closed report, kill/resume evidence, and the final clean-checkout command.

- [ ] **Step 1: Write the failing external-process matrix**

Create `test/continuity/eve-kill-resume.test.ts` with one serialized top-level test that creates a temporary copy of the Eve fixture runtime state and executes these subtests:

```ts
await t.test("checkpoint commit survives process death before tool return", checkpointCut);
await t.test("Path C apply survives process death without resend", outcomeCut);
await t.test("overlapping stream cursor deduplicates by event id", streamOverlap);
await t.test("compact and clear preserve Reelier continuity", compactAndClear);
await t.test("reset session can be replaced for the same task", resetAndReplace);
await t.test("cross-principal follow-up refuses before model work", crossPrincipal);
await t.test("changed mock model leaves projection bytes unchanged", modelNeutrality);
```

Each subtest must inspect ledger cursor, loopback counters, HTTP status, and resume projection; assistant prose alone is never an assertion source.

- [ ] **Step 2: Implement cross-platform Eve process control**

`eve-process.mjs` uses `spawn(process.execPath, [eveCliPath, "dev", "--port", String(port)], { cwd, env, stdio: ["ignore", "pipe", "pipe"] })`. Resolve `eveCliPath` from the fixture's installed package, bind an unused loopback port, wait for `/eve/v1/health`, and capture bounded stderr lines for diagnostics.

Stop with `SIGTERM`, wait five seconds, then use `taskkill /PID <pid> /T /F` only on Windows or `SIGKILL` elsewhere if the process remains. The helper must target the exact spawned PID and must never enumerate or kill unrelated Node processes.

- [ ] **Step 3: Implement durable stream ingestion**

`stream.mjs` reads NDJSON from `/eve/v1/session/:sessionId/stream?startIndex=<cursor>&includeTailIndex=1`, tracks the absolute consumed count, and deduplicates only instrumentation rows by `meta.id`. Missing IDs remain distinct and add an explicit `legacy-event-id-absent` finding; they never become verified deduplication.

The overlap test reads from `0`, reconnects from `Math.max(0, cursor - 3)`, and requires duplicate event IDs to collapse in the instrumentation set while the Reelier ledger cursor and segment digest remain byte-identical.

- [ ] **Step 4: Implement the checkpoint cut**

Set the Eve fixture fault to `after-checkpoint-commit-before-return`. Start a session with `checkpoint`, wait for the fault marker written after `adapter.checkpoint` returns `ok: true`, and kill the exact Eve process. Restart with the same fixture directory, Workflow data, ledger root, and auth registry but with the fault disabled.

Require:

```ts
assert.equal((await ledger.read(taskId)).cursor, 2);
assert.equal(segmentCount(taskDirectory), 2);
assert.equal(resume.sections.evidenceAndUncertainty.uncertainClaims.length, 0);
assert.deepEqual(counters, { outcomeRequests: 0, statusReads: 0, providerDispatches: 0, reservations: 0 });
```

The first segment is task provisioning; the second is the committed checkpoint. A rerun may return `stale-cursor`, but no third segment may exist.

- [ ] **Step 5: Implement the post-apply Outcome cut**

Start the loopback port with `fault: "after-provider-apply-before-response"`. Send `request outcome`, wait for `port.faultReached`, and kill Eve while the HTTP response is withheld. Release the port latch, restart Eve against the same Workflow and Reelier roots, and let Eve rerun the interrupted step.

Require:

```ts
assert.equal(port.counters().outcomeRequests >= 2, true);
assert.equal(port.counters().providerDispatches, 1);
assert.equal(port.counters().reservations, 1);
assert.equal((await fixture.runner.status({ bearerToken: fixture.credential.token, requestId })).providerWrites, 1);
```

Then call the status tool, export and verify the native receipt graph through the existing verifier path, append it through `appendVerifiedAuthority`, and require the next resume projection to contain verifier-produced consequence evidence. If status remains ambiguous, require `reconcile-before-retry`; never synthesize success.

- [ ] **Step 6: Implement compact, clear, reset, and identity tests**

For compact and clear, capture `ResumeProjectionV1` before each Eve control request and compare its canonical bytes after `session.waiting`; Reelier cursor and segment digest must not change.

For reset, require the retired session ID to return `session_not_active`; create a new Eve session with the same authenticated task binding and require the same Reelier projection with a different `runtimeSessionId` only inside `identify()`.

For cross-principal follow-up, reuse the session ID with a second valid token mapped to another principal. Require a failed turn before any `step.started`, unchanged Reelier ledger head, and unchanged Outcome/status/provider counters.

For model neutrality, restart once with fixture model ID `continuity-script-a` and once with `continuity-script-b`; compare canonical resume projection bytes and counters, not assistant message text.

- [ ] **Step 7: Emit and validate one closed evidence report**

`run-conformance.mjs` runs the generic candidate checker, the Eve matrix, and the focused Path C/Continuity tests. Write one JSON object with:

```json
{
  "v": "reelier.continuity-eve-conformance-report/v1",
  "status": "passed",
  "maturity": "reproduced",
  "reelierCommit": "<40 lowercase hex>",
  "authorityAdapterContractDigest": "sha256:<64 lowercase hex>",
  "eveVersion": "0.37.1",
  "nodeVersion": "24.x",
  "checks": [],
  "artifacts": {
    "ledgerHeadDigest": "sha256:<64 lowercase hex>",
    "receiptGraphDigest": "sha256:<64 lowercase hex>",
    "reportDigest": "sha256:<64 lowercase hex>"
  },
  "nonClaims": {
    "contentCorrectness": "not-proved",
    "grokBot": "not-tested",
    "productionReadiness": "not-proved",
    "safety": "not-proved",
    "topology": "not-proved",
    "trafficCompleteness": "not-proved"
  }
}
```

Compute `reportDigest` over canonical report bytes with that field omitted. Validate the final object against `conformance-report.schema.json` before writing exactly one line to stdout. Store verbose logs only in the test temporary directory and delete them on success; on failure print bounded diagnostics with no tokens, provider credentials, or filesystem secrets.

- [ ] **Step 8: Wire the one-command clean-checkout proof**

Add fixture script:

```json
"conformance": "node scripts/run-conformance.mjs"
```

Add root script:

```json
"check:continuity-eve": "npm --prefix conformance/continuity-adapter/v1/eve-fixture ci --ignore-scripts && npm --prefix conformance/continuity-adapter/v1/eve-fixture run conformance"
```

Update the conformance README with Windows prerequisites (Node 24 and local loopback availability), exact commands, expected duration, artifact meanings, and every non-claim.

- [ ] **Step 9: Run the complete verification matrix**

Run fresh:

```powershell
npm run build
npx tsc -p tsconfig.test.json
node --test --test-concurrency=1 "dist-test/test/continuity/*.test.js"
npm run check:continuity-adapter -- ./conformance/continuity-adapter/v1/fixtures/core-candidate.mjs
npm run check:continuity-eve
git diff --check
git status --short
```

Then run the bounded Linux Path C + Continuity matrix in Node 24 Docker exactly as used for commit `fb31b58`, adding the new continuity tests. Expected: zero failures; the only permitted skip remains the existing Windows symlink-privilege case when running the Windows authority suite.

- [ ] **Step 10: Commit the Eve kill/resume tracer bullet**

```powershell
git add -- conformance/continuity-adapter/v1/eve-fixture conformance/continuity-adapter/v1/README.md test/continuity/eve-kill-resume.test.ts package.json
git diff --cached --check
git commit -m "test(continuity): prove eve process resume"
git status --short
```

- [ ] **Step 11: Request independent immutable-range review**

Send the reviewer the base and candidate commit IDs, exact test commands, report digest, and these mandatory falsifiers:

```text
dispatch during open/reconnect
prompt or body identity substitution
checkpoint commit followed by process death and step replay
provider apply followed by process death and step replay
same request ID with different choices
different request ID incorrectly treated as a retry
ambiguous state rendered complete
fabricated verified claim/consequence
overlapping stream cursor duplicates
cross-principal follow-up on an existing session
compact/clear erasing Reelier continuity
reset reusing a retired Eve session ID
non-enumerable/accessor/symbol mutations on closed reports
```

The reviewer performs no edits, merge, push, workflow dispatch, provider call, credential access, deployment, or Grok Bot action. Any concrete falsifier returns the implementation to `FIX FIRST`; only a fresh `PASS` permits merge planning.

---

## Plan self-review mapping

- Spec architecture section 1 is implemented by Task 1.
- The open conformance kit, schemas, report boundaries, and generic scenarios are implemented by Task 2.
- Real Path C idempotency and provider-write evidence are exposed without credentials crossing into Eve by Task 3.
- Eve auth, task pinning, system resume injection, narrow schemas, isolated dependency tree, and deterministic model are implemented by Task 4.
- Every crash point observable at the Eve/Path C boundary, stream reconnect, compact/clear/reset, replacement session, model neutrality, final report, Linux regression matrix, and maker/checker review are implemented by Task 5.
- General memory, live providers, deployments, ACP resume, topology certification, and Grok Bot remain excluded throughout.
