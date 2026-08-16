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
