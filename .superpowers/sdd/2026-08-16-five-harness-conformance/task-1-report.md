Files changed

- `conformance/aggregate/v0/check.mjs`
- `conformance/aggregate/v0/report.schema.json`
- `test/aggregate-conformance.test.ts`
- `.superpowers/sdd/2026-08-16-five-harness-conformance/task-1-report.md`

## What changed

- Added a closed `reelier.aggregate-conformance-report/v0` schema with per-harness identity, adapter path, evidence maturity, coverage status, execution status, outcome status, overall status, non-claims, and reasons.
- Added an aggregate runner that consumes existing v0 agent-adapter and continuity/Eve reports without changing their meanings. Fixture-only v0 evidence remains fixture-only; Eve continuity remains continuity-proven and does not become universal agent-adapter execution proof.
- Added explicit non-passing classifications for coverage-unknown, not-tested, unsupported, and failed evidence. Passing requires strong evidence in every aggregate lane; unknown-like states cannot pass.
- Added focused tests covering the real Grok Build fixture, the existing Eve continuity candidate/report, and the non-passing status vocabulary.

## RED verification

Command:

```text
node --test dist-test/test/aggregate-conformance.test.js
```

Observed failure before implementation:

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '...\\conformance\\aggregate\\v0\\check.mjs'
✖ dist-test\\test\\aggregate-conformance.test.js
```

RED test commit: `b2b341de502e3dba113558cdb4da331c5a98d43b`

The test expectation was then corrected to consume the existing real Grok Build fixture, in commit `fd440ad2aa7cb74069be24286fb7b0b2a7a1bdd6`.

## GREEN verification

Command:

```text
npx tsc -p tsconfig.test.json; node --test dist-test/test/aggregate-conformance.test.js dist-test/test/agent-adapter-conformance.test.js dist-test/test/continuity/conformance-runner.test.js
```

Result: 25 tests passed, 0 failed.

Verbatim tail:

```text
✔ uncertainty checks reject swapped and conflated consequence lifecycles (111.9987ms)
✔ candidate schema accepts SemVer build metadata and rejects malformed identifiers (25.9038ms)
ℹ tests 25
ℹ suites 0
ℹ pass 25
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ duration_ms 2688.6544
```

GREEN implementation commit: `03ffbbe3a475556a12c6ab2b17a510846ce984b1`

## Deviations from the plan

None. The pre-existing untracked plan file was not modified.

## Remaining concerns

- No current harness has execution-proven, enforced-coverage, or verified-outcome evidence; therefore the aggregate report correctly remains non-passing.
- The aggregate runner supports the existing report versions only. Future harnesses must add an explicit classifier rather than being inferred as live-tested.
- The implementation is local-only and makes no provider or external calls.

## Review fix round 1

Addressed all review findings within Task 1:

- The report schema now rejects empty aggregates, requires fixed non-claims, uses lane-specific enums, binds `passed` to execution-proven/enforced/verified lanes, and enforces per-lane combinations for fixture-only, continuity-proven, unsupported, failed, and execution-proven rows.
- Recognized agent-adapter, continuity-adapter, and Eve reports are validated against their closed source contracts before classification. Caller harness identity and adapter path are bound to the source report where the source contract provides identity.
- The Eve aggregate test now supplies the genuine `reelier.continuity-eve-conformance-report/v1` shape, including Eve version, process-matrix checks, artifacts, and Eve non-claims; it no longer relabels the generic core continuity report.
- The closed vocabulary now explicitly covers `unknown`, `uncovered`, `unchecked`, `absent`, `pending`, `not-tested`, `unsupported`, `failed`, and `continuity-only`, with tests proving none can pass.

### Fix RED

Command:

```text
npx tsc -p tsconfig.test.json; node --test dist-test/test/aggregate-conformance.test.js
```

Observed failure before the fix implementation:

```text
✖ aggregate rejects empty, contradictory, and dishonest passing reports
TypeError: aggregate.validateAggregateReport is not a function
✖ aggregate validates source contracts and binds source identity
AssertionError: actual 'fixture-only' expected 'unsupported'
```

### Fix GREEN

Fail-fast command (TypeScript compilation stops the test command on failure):

```text
npx tsc -p tsconfig.test.json; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; node --test dist-test/test/aggregate-conformance.test.js dist-test/test/agent-adapter-conformance.test.js dist-test/test/continuity/conformance-runner.test.js
```

Exact result: 27 tests passed, 0 failed.

Verbatim tail:

```text
ℹ tests 27
ℹ suites 0
ℹ pass 27
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ duration_ms 2126.3976
```

Fix commit: `a8efd3c37acaa022b40a232da86626c9b2c64973`.

## Review fix round 2

Closed the remaining source-validation gap in `validAgentReport()`: agent-adapter v0 reports now require exactly the four top-level keys `v`, `status`, `adapterId`, and `checks`. Existing nested closed checks remain enforced for every check record, including exact nested keys and allowed status values. Added a regression that injects `unexpected: true` and verifies the aggregate classifies the source as unsupported and the aggregate as failed.

### Fix RED

Command:

```text
npx tsc -p tsconfig.test.json; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; node --test dist-test/test/aggregate-conformance.test.js
```

Observed failure before implementation:

```text
✖ aggregate rejects an agent report with an unexpected top-level property
AssertionError: actual 'fixture-only' expected 'unsupported'
```

### Fix GREEN

Fail-fast command:

```text
npx tsc -p tsconfig.test.json; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; node --test dist-test/test/aggregate-conformance.test.js dist-test/test/agent-adapter-conformance.test.js dist-test/test/continuity/conformance-runner.test.js
```

Exact result: 28 tests passed, 0 failed.

Verbatim tail:

```text
ℹ tests 28
ℹ suites 0
ℹ pass 28
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ duration_ms 2167.3582
```

Round-2 fix commit: `a3daccc570ab4d78e11d2af79e8e9c3ab2337ce7`.

## Final cross-task hardening

### What changed per file

- `conformance/aggregate/v0/check.mjs`: Usage and parse failures now pass five explicit missing-source records through the normal aggregate classifier. The emitted failed report validates against the existing standalone schema and carries unsupported/coverage-unknown/not-tested evidence without a fake pass.
- `test/aggregate-conformance.test.ts`: Added a process-level regression for both CLI failure paths. It compiles `report.schema.json` directly with Ajv, validates emitted JSON independently of the checker export, and requires five non-passing rows.
- This report: Added the final hardening RED/GREEN evidence and exact scoped verification results.

`conformance/aggregate/v0/report.schema.json` was reviewed but did not require a change: five explicit harness rows satisfy its existing `minItems` and closed row combinations. Task 3 files and evidence were not changed because this hardening did not alter coverage-envelope behavior.

### RED verification

Command:

```text
npx tsc -p tsconfig.test.json --pretty false; node --test --test-concurrency=1 dist-test/test/aggregate-conformance.test.js dist-test/test/semantic-matrix-conformance.test.js
```

The aggregate regression failed for the intended standalone-schema reason:

```text
✖ aggregate CLI usage and parse failures emit standalone-schema-valid non-passing evidence
AssertionError: [{"instancePath":"/harnesses","schemaPath":"#/properties/harnesses/minItems","keyword":"minItems","params":{"limit":1},"message":"must NOT have fewer than 1 items"}]
false !== true
```

RED commit: `e1f6c24` (`test: expose cross-task report contradictions`).

### GREEN and final scoped verification

Implementation commit: `25a8df4` (`fix: harden conformance failure reports`).

Fresh emitting build, exit 0:

```text
> reelier@0.32.1 build
> node scripts/build-authority-contract.mjs --check && node scripts/build-bootstrap-contract.mjs --check && tsc -p tsconfig.json && node scripts/build-authority-contract.mjs --copy-schemas && node scripts/build-packs.mjs

built cloudflare_api_token, cloudflare_dns, github_issue_labels, gmail, gmail_labels, hubspot_slack_information_flow, neon_database, slack_channel_topic, stripe, vercel_deployment
```

`npx tsc --noEmit --pretty false` and `npx tsc -p tsconfig.test.json --pretty false` both exited 0 with no output.

Focused Tasks 1–7 plus continuity command:

```text
node --test --test-concurrency=1 dist-test/test/aggregate-conformance.test.js dist-test/test/semantic-matrix-conformance.test.js dist-test/test/coverage-envelope-conformance.test.js dist-test/test/agent-adapter-conformance.test.js dist-test/test/candidate-capture-conformance.test.js dist-test/test/failure-injection-conformance.test.js dist-test/test/hermetic-outcome-conformance.test.js dist-test/test/continuity/conformance-runner.test.js
```

Verbatim tail, exit 0:

```text
✔ failed matrix validation refuses schema-valid top-level rows that contradict the nested aggregate (2.706ms)
ℹ tests 121
ℹ suites 0
ℹ pass 121
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 6244.0985
```

`git diff --check 3ca93e7..HEAD` exited 0 with no output before the report update. The committed implementation/test path audit contained only the two aggregate and two semantic files authorized for final hardening. The orchestrator-updated plan remained the sole pre-existing unstaged path and was not staged or modified during implementation.

### Deviations and open risks

- No deviation from the hardening allowlist. The schema files were inspected but unchanged because the fixes use already-supported closed shapes plus checker-level cross-array validation.
- No external calls, credentials, provider writes, push, merge, or publish occurred.
- This evidence is limited to the emitting build, typechecks, and focused conformance suites above. It does not claim the whole repository is green.
