# Five-harness Reelier conformance

## Objective

Implement a machine-readable conformance matrix that distinguishes semantic contract conformance, observed route coverage, continuity, governed execution, and substrate outcome evidence across Codex, Claude Code, Eve, Grok Build, and Grok Bot. Unknown, uncovered, unchecked, absent, and pending evidence must never become a pass.

## Global constraints

- Do not call external providers, send email, push GitHub, merge, publish, or use credentials from tests.
- Preserve existing agent-adapter v0 and continuity-adapter v1 meanings; fixture-only evidence remains fixture-only.
- Do not claim route discovery is write enforcement.
- Do not claim Eve continuity proves universal agent-adapter execution.
- Do not claim Grok Build or Grok Bot are live-tested unless a black-box candidate was supplied by that harness.
- Use the existing Reelier authority, delegation, coverage, route, and receipt types; do not create a second delegation protocol.
- All aggregate reports use explicit evidence statuses and non-claims.
- New tests must follow RED-GREEN verification.

## Files touched allowlist

Each task may create or modify only the files listed for that task. A task whose allowlist is not
defined must amend this plan and receive review before implementation begins.

### Task 1

- `conformance/aggregate/v0/check.mjs`
- `conformance/aggregate/v0/report.schema.json`
- `test/aggregate-conformance.test.ts`
- `.superpowers/sdd/2026-08-16-five-harness-conformance/task-1-report.md`

### Task 2

- `conformance/semantic-matrix/v0/check.mjs`
- `conformance/semantic-matrix/v0/report.schema.json`
- `test/semantic-matrix-conformance.test.ts`
- `.superpowers/sdd/2026-08-16-five-harness-conformance/task-2-report.md`

### Task 3

- `conformance/coverage-envelope/v0/check.mjs`
- `conformance/coverage-envelope/v0/input.schema.json`
- `conformance/coverage-envelope/v0/report.schema.json`
- `test/coverage-envelope-conformance.test.ts`
- `.superpowers/sdd/task-3-coverage-envelope-brief.md`
- `.superpowers/sdd/task-3-coverage-envelope-report.md`

### Task 4

- `conformance/agent-adapter/v0/fixtures/eve-observed.json`
- `conformance/semantic-matrix/v0/check.mjs`
- `conformance/semantic-matrix/v0/report.schema.json`
- `test/agent-adapter-conformance.test.ts`
- `test/semantic-matrix-conformance.test.ts`
- `docs/superpowers/plans/2026-08-16-five-harness-conformance.md`
- `.superpowers/sdd/task-4-eve-agent-adapter-report.md`

### Tasks 5–7

- Task 5 (live-capture boundary):
  - `conformance/candidate-capture/v0/check.mjs`
  - `conformance/candidate-capture/v0/capture.schema.json`
  - `conformance/candidate-capture/v0/report.schema.json`
  - `conformance/candidate-capture/v0/README.md`
  - `test/candidate-capture-conformance.test.ts`
  - `docs/superpowers/plans/2026-08-16-five-harness-conformance.md`
  - `.superpowers/sdd/task-5-candidate-capture-report.md`
- Task 6 (failure injection):
  - `conformance/failure-injection/v0/check.mjs`
  - `conformance/failure-injection/v0/report.schema.json`
  - `test/failure-injection-conformance.test.ts`
  - `.superpowers/sdd/task-6-failure-injection-report.md`
- Task 7 (hermetic outcome bundle):
- `conformance/hermetic-outcome/v0/check.mjs`
- `conformance/hermetic-outcome/v0/bundle.schema.json`
- `test/hermetic-outcome-conformance.test.ts`
  - `.superpowers/sdd/task-7-hermetic-outcome-report.md`

### Final cross-task hardening

- `conformance/aggregate/v0/check.mjs`
- `conformance/aggregate/v0/report.schema.json`
- `test/aggregate-conformance.test.ts`
- `conformance/semantic-matrix/v0/check.mjs`
- `conformance/semantic-matrix/v0/report.schema.json`
- `test/semantic-matrix-conformance.test.ts`
- `.superpowers/sdd/2026-08-16-five-harness-conformance/task-1-report.md`
- `.superpowers/sdd/2026-08-16-five-harness-conformance/task-2-report.md`
- `.superpowers/sdd/task-3-coverage-envelope-report.md`
- `docs/superpowers/plans/2026-08-16-five-harness-conformance.md`

## Tasks

### Task 1 — Baseline report and status vocabulary

Add a closed aggregate report format and runner that consumes existing conformance outputs and records, per harness: harness identity, adapter path, evidence maturity, coverage status, execution status, outcome status, non-claims, and reasons. Include fixture-only, observed-only, continuity-proven, execution-proven, coverage-unknown, not-tested, unsupported, and failed states. Add tests proving unknown-like states cannot pass and existing v0/Eve reports remain accurately classified.

### Task 2 — Five-harness semantic matrix

Add a matrix runner over Codex, Claude Code, Eve, Grok Build, and Grok Bot using the existing universal semantic operations. The runner must validate dynamic job discovery, attenuated child delegation, host-bound outcome input, pre-freeze refusal, and honest observed/enforced coverage. Existing Grok fixtures may pass only as fixture evidence. Missing live candidates must be reported as not-tested, never synthesized.

### Task 3 — Coverage envelope

Add a closed coverage envelope for each adapter containing source instance identity, source/config/plugin digest, route inventory, wrapped/unwrapped routes, direct/private routes, observed/enforced mode, freshness, topology, completeness, and reason codes. Connect existing Codex and Claude route discovery rows to this envelope. Add negative tests for catalog-only evidence, stale evidence, unwrapped routes, and completeness upgrades.

### Task 4 — Eve agent-adapter candidate

Add an Eve candidate producer or fixture adapter that exercises the same universal semantic operations as the agent-adapter matrix while preserving the existing Eve continuity process conformance. Its report must distinguish continuity-proven from governed execution-proven and carry the existing explicit non-claims.

### Task 5 — Live-capture boundary for Grok and harnesses

Add a black-box candidate input boundary and documentation for Codex, Claude Code, Eve, Grok Build, and Grok Bot. Candidate data must be closed, detached, transport-neutral, and sufficient to classify observed versus enforced evidence. No implementation may pretend to have run a harness when no candidate exists. Add fixture tests for supplied and missing candidates.

### Task 6 — Failure-injection matrix

Add table-driven mutation cases covering wrong/reused principals, identity injection, undiscovered jobs, unauthorized targets, budget overflow, duplicate retry, crash/ambiguity states, stale outcomes, mismatched provider post-state, hidden routes, incomplete inventory, and malformed coverage. Each mutation must refuse, remain non-passing, or reconcile explicitly.

### Task 7 — Hermetic reversible outcome and evidence bundle

Add a local-only reversible state transition that emits the planned evidence bundle: descriptor, delegation, coverage, dispatch, provider-state, receipt, failure-injection, and final report. Prove exact post-state, idempotent retry, and receipt linkage without external credentials or GitHub/Gmail calls. Document the later GitHub escalation as an operator-run integration, not an automated test in this branch.

## Review and verification

- Use one fresh implementer per task, with a task review after each task.
- Run focused tests after each task, then the relevant conformance suites and package checks.
- Run a final whole-branch review against this plan.
- Do not push or merge this branch.
