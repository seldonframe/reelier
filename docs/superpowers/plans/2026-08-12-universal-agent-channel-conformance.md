# Universal Agent Channel Conformance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a hermetic pre-freeze conformance checker and Grok fixtures that define the universal agent/Path C seam without executing a real Outcome.

**Architecture:** A standalone Node checker validates a closed JSON candidate with JSON Schema, then evaluates cross-field channel invariants that schema cannot express. Grok Build and Grok Bot golden candidates exercise the same semantic surface over different transports. The checker has no network, provider, credential, ledger, signer, or Path C host imports.

**Tech Stack:** Node.js 20 ESM, JSON Schema 2020-12, Ajv 8, `node:test`, TypeScript test runner.

## Global Constraints

- Branch from `origin/main`; do not modify `.worktrees/outcomes-delegation-infra` or consume its unlanded runner ABI.
- Keep execution exactly `fixture-only` while the authority contract is `pending-freeze` with `digest: null`.
- Accept broad native agent tools, but describe no direct provider write as governed.
- Model-controlled Outcome input contains only `jobRef`, `requestId`, opaque `sourceRefs`, and bounded `choices`.
- Observed mode never reports verified topology or completeness.
- Enforced mode remains unavailable without verified topology.
- Passing conformance never means live, safe, correct, or complete.
- Write each production behavior only after its focused test has failed for the intended reason.

---

### Task 1: Closed candidate parser and executable checker

**Files:**
- Create: `conformance/agent-adapter/v0/candidate.schema.json`
- Create: `conformance/agent-adapter/v0/check.mjs`
- Create: `test/agent-adapter-conformance.test.ts`

**Interfaces:**
- Consumes: one candidate JSON path as `process.argv[2]`.
- Produces: `checkCandidate(value): { v: "reelier.agent-adapter-conformance-report/v0"; status: "passed" | "failed"; adapterId: string | null; checks: { id: string; status: "passed" | "failed"; detail: string }[] }` and exit code `0` only when every check passes.

- [ ] **Step 1: Write the failing schema and usage tests**

Add a test helper that invokes the real script with `spawnSync(process.execPath, [checker, candidatePath])`, parses stdout as JSON, and returns exit status plus report. Write tests proving a minimal structurally invalid object exits `1` with a failed `closed-schema` check, and a missing argument exits `2` with a JSON usage error.

```ts
test("the checker refuses an open or malformed candidate before semantic checks", () => {
  const result = runCandidate({ v: "reelier.agent-adapter-candidate/v0", extra: true });
  assert.equal(result.status, 1);
  assert.deepEqual(result.report.checks.map((check) => check.id), ["closed-schema"]);
  assert.equal(result.report.checks[0].status, "failed");
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx tsc -p tsconfig.test.json && node --test dist-test/test/agent-adapter-conformance.test.js`

Expected: FAIL because `conformance/agent-adapter/v0/check.mjs` does not exist.

- [ ] **Step 3: Add the closed candidate schema**

Define an exact 2020-12 schema with `additionalProperties: false` at every object. Require:

```json
{
  "v": "reelier.agent-adapter-candidate/v0",
  "descriptor": {
    "adapterId": "nonempty dot/dash/underscore identifier",
    "agentHost": "nonempty host identifier",
    "transport": "mcp-stdio | https",
    "execution": "fixture-only",
    "identityBinding": "host-authenticated",
    "providerCredentialAccess": "none",
    "authorityContract": { "status": "pending-freeze", "digest": null },
    "coverage": { "supportedModes": ["observed", "enforced"], "defaultMode": "observed" },
    "operations": ["jobs.search", "jobs.load", "delegations.request", "delegations.status", "tasks.status", "outcomes.invoke", "outcomes.status"],
    "hardCodedJobRefs": []
  },
  "session": {
    "taskId": "nonempty",
    "principalId": "nonempty",
    "allocationId": "nonempty",
    "remainingEffects": 2
  },
  "transcript": [],
  "coverageProbes": []
}
```

Bound string lengths to 128 except titles/queries at 256, arrays to 64, `sourceRefs` to opaque strings, and `choices` to JSON scalar values. Define transcript event variants for `jobs.search`, `jobs.load`, `delegations.request`, `outcomes.invoke`, and `outcomes.status`. Define observed/enforced coverage probe variants and close receipt claims to authorization, dispatch, provider acknowledgement, reconciliation, topology, and completeness.

- [ ] **Step 4: Implement schema validation and deterministic reports**

Load the sibling schema through `import.meta.url`, compile it with Ajv 2020 in strict/all-errors mode, read only the supplied candidate path, and emit exactly one JSON report to stdout. Convert file, JSON, and schema failures into a failed `closed-schema` check without stack traces or candidate values.

```js
export function checkCandidate(value) {
  if (!validate(value)) return report(null, [failed("closed-schema", ajv.errorsText(validate.errors))]);
  const checks = semanticChecks(structuredClone(value));
  return report(value.descriptor.adapterId, checks);
}
```

- [ ] **Step 5: Run the focused test and verify GREEN**

Run: `npx tsc -p tsconfig.test.json && node --test dist-test/test/agent-adapter-conformance.test.js`

Expected: PASS for schema and usage behavior.

- [ ] **Step 6: Commit Task 1**

```bash
git add conformance/agent-adapter/v0/candidate.schema.json conformance/agent-adapter/v0/check.mjs test/agent-adapter-conformance.test.ts
git commit -m "feat: add agent adapter conformance checker"
```

### Task 2: Cross-field invariants and Grok golden candidates

**Files:**
- Modify: `conformance/agent-adapter/v0/check.mjs`
- Modify: `test/agent-adapter-conformance.test.ts`
- Create: `conformance/agent-adapter/v0/fixtures/grok-build-observed.json`
- Create: `conformance/agent-adapter/v0/fixtures/grok-bot-observed.json`

**Interfaces:**
- Consumes: schema-valid candidates from Task 1.
- Produces checks named `universal-operations`, `dynamic-job-discovery`, `host-bound-outcome-input`, `attenuated-child-principal`, `pre-freeze-no-dispatch`, `observed-coverage-honesty`, and `enforced-mode-unavailable`.

- [ ] **Step 1: Add a complete Grok Build fixture and watch it fail semantic conformance**

The fixture uses adapter `xai.grok-build`, host `grok-build`, transport `mcp-stdio`, a root principal with four remaining effects, and one discovered reversible record-state job. Its transcript searches, loads the returned job reference, requests one effect for a distinct child principal, refuses invocation with `adapter-contract-pending`, and reports no dispatch. Its observed probe is available with unchecked topology/completeness; its enforced probe is unavailable.

Add a test expecting all seven semantic checks to pass. Run the focused test and verify RED because semantic checks are not implemented.

- [ ] **Step 2: Implement universal operation and dynamic discovery checks**

Require the descriptor's operation set to equal the seven universal operations regardless of order. Require one nonempty unique search result, then require load and invoke to reuse a discovered job reference. Reject any descriptor job reference.

- [ ] **Step 3: Implement identity, delegation, and input checks**

For the Outcome invocation, recursively reject exact case-insensitive keys `tenant`, `requester`, `principalId`, `grantId`, `allocationId`, `jobId`, `authorityCellId`, `credential`, `credentials`, `providerAccount`, `endpoint`, `recipient`, `amount`, `body`, `url`, `providerArgs`, and `providerArguments`. Require its keys to be exactly `jobRef`, `requestId`, `sourceRefs`, and `choices`.

Require the child principal to differ from the session principal, its allocation to differ from the parent allocation, and requested effects to be a positive integer smaller than the session's remaining effects.

- [ ] **Step 4: Implement lifecycle and coverage honesty checks**

Require pre-freeze invocation to return only `refused`, `adapter-contract-pending`, and `refused`, with no receipt reference. Require status to reuse the request ID, set `pass: false`, keep dispatch/provider acknowledgement/reconciliation absent, and keep topology/completeness unchecked.

Require exactly one observed and one enforced probe. Observed is available only with unchecked topology/completeness. Enforced is unavailable and cannot contain a verified topology/completeness claim.

- [ ] **Step 5: Add mutation tests that name the protected failures**

From the hand-checked Grok Build fixture, write separate tests that mutate one behavior at a time and expect the named check to fail:

- inject `tenant` into Outcome input;
- replace the loaded job reference with an undiscovered value;
- reuse the parent principal for the child;
- return an accepted pre-freeze invocation;
- mark observed completeness verified;
- make enforced mode available with unchecked topology;
- add a provider-specific operation while removing a universal operation.

Run each after writing it and confirm RED before implementing the corresponding rule, then confirm GREEN.

- [ ] **Step 6: Add the Grok Bot transport fixture**

Copy only the semantic candidate data, changing adapter ID to `xai.grok-bot`, host to `grok-bot`, and transport to `https`. Keep the catalog and transcript semantics identical. Assert both fixtures return the same ordered passing check IDs, proving transport-neutral semantics.

- [ ] **Step 7: Commit Task 2**

```bash
git add conformance/agent-adapter/v0/check.mjs conformance/agent-adapter/v0/fixtures test/agent-adapter-conformance.test.ts
git commit -m "test: certify Grok adapter candidates hermetically"
```

### Task 3: Operator contract, Grok handoff, and verification

**Files:**
- Create: `conformance/agent-adapter/v0/README.md`
- Create: `integrations/grok/README.md`
- Modify: `package.json`
- Modify: `test/agent-adapter-conformance.test.ts`

**Interfaces:**
- Consumes: Task 2 checker and fixtures.
- Produces: `npm run check:agent-adapter -- <candidate.json>` and an explicit post-freeze integration handoff.

- [ ] **Step 1: Add a failing package-script integration test**

Execute `npm run check:agent-adapter -- conformance/agent-adapter/v0/fixtures/grok-build-observed.json` and assert exit `0`, report version, adapter ID, and passed status. Verify RED because the package script does not exist.

- [ ] **Step 2: Add the package script**

Add exactly:

```json
"check:agent-adapter": "node conformance/agent-adapter/v0/check.mjs"
```

Run the focused test and verify GREEN.

- [ ] **Step 3: Document harness semantics and limitations**

The conformance README must state the input/output contract, command examples for both fixtures, check meanings, exit codes, no-network guarantee, and the precise non-claim: passing proves only pre-freeze fixture conformance.

The Grok README must state that Grok Build will use MCP, Grok Bot will use authenticated HTTPS/Outcome Console until a native API is evidenced, direct provider sessions make coverage observed, enforced mode requires measured removal of equivalent raw writes, and no live integration begins before Adapter Contract v1.

- [ ] **Step 4: Run focused verification**

Run:

```bash
npm run build
npx tsc -p tsconfig.test.json
node --test dist-test/test/agent-adapter-conformance.test.js
npm run check:agent-adapter -- conformance/agent-adapter/v0/fixtures/grok-build-observed.json
npm run check:agent-adapter -- conformance/agent-adapter/v0/fixtures/grok-bot-observed.json
```

Expected: every command exits `0`; both reports have `status: "passed"`.

- [ ] **Step 5: Run repository verification**

Run `npm test` and expect the established baseline plus the new conformance tests to pass with zero failures. Run `git diff --check` and require no whitespace errors. Confirm `git status --short` contains only planned files.

- [ ] **Step 6: Self-review against the design**

Confirm no file imports Path C host internals, performs network access, reads environment credentials, exposes a provider runner, claims verified completeness, or describes refund as the architecture. Mutate each semantic rule mentally and identify its failing test.

- [ ] **Step 7: Commit Task 3**

```bash
git add package.json conformance/agent-adapter/v0/README.md integrations/grok/README.md test/agent-adapter-conformance.test.ts
git commit -m "docs: hand off universal Grok channel contract"
```
