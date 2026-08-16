Files changed

- `conformance/semantic-matrix/v0/check.mjs`
- `conformance/semantic-matrix/v0/report.schema.json`
- `test/semantic-matrix-conformance.test.ts`
- `.superpowers/sdd/2026-08-16-five-harness-conformance/task-2-report.md`

What changed per file

- `conformance/semantic-matrix/v0/check.mjs`: Added a deterministic local five-slot matrix runner for Codex, Claude Code, Eve, Grok Build, and Grok Bot. It validates closed input, runs the existing agent-adapter checker for supplied candidates, accepts existing continuity/Eve reports, preserves fixture-only semantics, emits unsupported/not-tested rows for missing candidates, and delegates aggregate classification to `aggregateReports(records)`.
- `conformance/semantic-matrix/v0/report.schema.json`: Added the closed v0 matrix output schema, including nested aggregate output, five harness rows, and semantic check records.
- `test/semantic-matrix-conformance.test.ts`: Added focused RED/GREEN coverage for five-harness expansion, Grok fixture evidence, Eve continuity classification, missing live candidates, and unknown-harness refusal.
- This report: Recorded implementation, verification, commits, and concerns.

Deviations from the plan and why

- None. The implementation stayed within the five-harness semantic matrix and reused the existing universal checker and `aggregateReports` interface. No external harnesses, providers, credentials, network, or other worktrees were used.

RED verification

Command:

```text
npx tsc -p tsconfig.test.json; node --test dist-test/test/semantic-matrix-conformance.test.js
```

Verbatim output tail:

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'C:\Users\maxim\CascadeProjects\reelier\.worktrees\five-harness-conformance\conformance\semantic-matrix\v0\check.mjs'
✖ dist-test\test\semantic-matrix-conformance.test.js (46.6752ms)
ℹ tests 1
ℹ pass 0
ℹ fail 1
```

GREEN verification

Command:

```text
npx tsc --noEmit; npx tsc -p tsconfig.test.json; node --test dist-test/test/semantic-matrix-conformance.test.js dist-test/test/aggregate-conformance.test.js dist-test/test/agent-adapter-conformance.test.js
```

Verbatim output tail:

```text
✔ semantic matrix runs universal checks and preserves fixture-only Grok evidence (9.3458ms)
✔ semantic matrix refuses unknown harnesses and does not synthesize missing candidates (0.4263ms)
ℹ tests 20
ℹ suites 0
ℹ pass 20
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ duration_ms 2135.3471
```

Commits

- RED: `adf4e4a` — `test: define five-harness semantic matrix contract`
- GREEN: `e2fff15` — `feat: add five-harness semantic matrix runner`
- Report: pending this commit.

Concerns

- No live harness candidates were supplied, so Codex, Claude Code, and live Grok execution remain unsupported/not-tested by design.
- Eve input is classified from existing continuity evidence and is not upgraded to universal agent-adapter execution.
- The command-line error fallback is intentionally a failed diagnostic object rather than a passing matrix; valid matrix output is schema-validated before emission.

Fix round 1 evidence

Findings addressed:

- Closed the matrix schema around the canonical Task 1 aggregate schema, exact five harness identities, unique identity cardinality, aggregate-bound top-level status, and aggregate-defined evidence/status vocabulary.
- Suppressed semantic checks until source validation and identity binding succeed; invalid agent reports become unsupported and publish no checks.
- Changed both CLI error paths to emit a schema-valid failed five-row matrix.
- Required explicit `missing: true` for listed input entries without a candidate or report.
- Added focused tests for all requested fix-round cases.

Fix RED verification

Command:

```text
npx tsc -p tsconfig.test.json; node --test dist-test/test/semantic-matrix-conformance.test.js
```

Verbatim output tail:

```text
✖ matrix report has exactly the five unique harness identities and binds status to aggregate
✖ invalid source reports cannot publish semantic checks
✖ listed missing evidence must be explicit and CLI failures remain schema-valid
ℹ tests 5
ℹ pass 2
ℹ fail 3
```

Fix GREEN verification (fail-fast compile before tests)

Command:

```text
npx tsc --noEmit; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; npx tsc -p tsconfig.test.json; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; node --test dist-test/test/semantic-matrix-conformance.test.js dist-test/test/aggregate-conformance.test.js dist-test/test/agent-adapter-conformance.test.js
```

Verbatim output tail:

```text
✔ semantic matrix runs universal checks and preserves fixture-only Grok evidence (8.1786ms)
✔ semantic matrix refuses unknown harnesses and does not synthesize missing candidates (0.3607ms)
✔ matrix report has exactly the five unique harness identities and binds status to aggregate (0.8535ms)
✔ invalid source reports cannot publish semantic checks (0.2569ms)
✔ listed missing evidence must be explicit and CLI failures remain schema-valid (381.6446ms)
ℹ tests 23
ℹ pass 23
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ duration_ms 2141.7254
```

Fix commit

- `140b56c` — `fix: close five-harness matrix report contract`

Fix round 2 evidence

Findings addressed:

- A matrix with `status: "passed"` now requires every top-level row to satisfy Task 1’s canonical `passingHarness` definition. The schema reuses the aggregate schema reference and preserves the normal generated report’s failed status when candidates are missing.
- Input alternatives now reject `missing: true` combined with `candidate` or `report`.
- Added regressions for dishonest passed rows and mutually exclusive missing evidence.

Fix RED verification

Command:

```text
npx tsc -p tsconfig.test.json; node --test dist-test/test/semantic-matrix-conformance.test.js
```

Verbatim output tail:

```text
✖ explicit missing evidence cannot coexist with a candidate or report (0.8641ms)
ℹ tests 7
ℹ pass 6
ℹ fail 1
```

Fix GREEN verification (fail-fast compile before tests)

Command:

```text
npx tsc --noEmit; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; npx tsc -p tsconfig.test.json; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; node --test dist-test/test/semantic-matrix-conformance.test.js dist-test/test/aggregate-conformance.test.js dist-test/test/agent-adapter-conformance.test.js
```

Verbatim output tail:

```text
✔ listed missing evidence must be explicit and CLI failures remain schema-valid (398.5342ms)
✔ a passed matrix cannot contain unsupported top-level harness rows (0.5037ms)
✔ explicit missing evidence cannot coexist with a candidate or report (0.2721ms)
ℹ tests 25
ℹ pass 25
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ duration_ms 2204.071
```

Fix round 2 commit

- `7ba7873` — `fix: require honest passing matrix rows`

Fix round 3 evidence

Changes were test-only. The passing-row regression now constructs and validates a fully valid matrix with five passing aggregate rows, then mutates only the matrix’s top-level rows to unsupported/not-tested while retaining nested `aggregate.status: "passed"`; the validator must reject that dishonest matrix. The mutual-exclusion regression remains and covers both candidate and report conflicts with `missing: true`.

RED verification

Command:

```text
npx tsc -p tsconfig.test.json; node --test dist-test/test/semantic-matrix-conformance.test.js
```

Verbatim output tail:

```text
✖ a passed matrix cannot contain unsupported top-level harness rows (0.9678ms)
ℹ tests 7
ℹ pass 6
ℹ fail 1
```

GREEN verification (fail-fast compile before tests)

Command:

```text
npx tsc --noEmit; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; npx tsc -p tsconfig.test.json; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; node --test dist-test/test/semantic-matrix-conformance.test.js dist-test/test/aggregate-conformance.test.js dist-test/test/agent-adapter-conformance.test.js
```

Verbatim output tail:

```text
✔ listed missing evidence must be explicit and CLI failures remain schema-valid (388.202ms)
✔ a passed matrix cannot contain unsupported top-level harness rows (0.5223ms)
✔ explicit missing evidence cannot coexist with a candidate or report (0.2459ms)
ℹ tests 25
ℹ pass 25
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ duration_ms 2151.0089
```

Final cross-task hardening

What changed per file

- `conformance/semantic-matrix/v0/check.mjs`: `validateSemanticMatrixReport` now requires matrix status to equal nested aggregate status and compares each top-level harness row's overall, evidence, coverage, execution, and outcome statuses with its canonical nested aggregate row. This applies to failed as well as passed matrices.
- `test/semantic-matrix-conformance.test.ts`: Added a mutation regression that changes a failed matrix's top-level Codex row to a different, internally coherent failed row. Direct standalone schema validation accepts that structurally valid mutation, while the semantic checker must refuse the contradiction.
- This report: Added final hardening scope and evidence.

`conformance/semantic-matrix/v0/report.schema.json` was reviewed but unchanged. JSON Schema validates each row's closed shape; equality between duplicated rows in separate arrays is enforced by the exported semantic checker and proven by the standalone-schema/checker mutation test. Task 3 was not updated because no coverage-envelope file or result changed.

RED evidence

The combined focused RED command exited 1. The semantic mutation failed for the intended missing cross-array check:

```text
✖ failed matrix validation refuses schema-valid top-level rows that contradict the nested aggregate
AssertionError: Expected values to be strictly equal:
true !== false
```

RED commit: `e1f6c24` (`test: expose cross-task report contradictions`). GREEN implementation commit: `25a8df4` (`fix: harden conformance failure reports`).

Final scoped evidence

- `npm run build`: exit 0; emitted all ten listed packs.
- `npx tsc --noEmit --pretty false`: exit 0, no output.
- `npx tsc -p tsconfig.test.json --pretty false`: exit 0, no output.
- Focused Tasks 1–7 plus continuity: 121 tests, 121 passed, 0 failed, exit 0.
- `git diff --check 3ca93e7..HEAD`: exit 0, no output before report updates.

Verbatim focused-suite tail:

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

Deviations and open risks

- No deviation from the final hardening allowlist. No external call or real harness execution occurred.
- The existing schema remains the structural gate; cross-array equality is intentionally a semantic-checker invariant.
- These results do not claim whole-repository green. The orchestrator-updated plan remains a pre-existing unstaged path and was preserved.

Fix round 3 commit

- `6a12299` — `test: strengthen passing matrix regression`
