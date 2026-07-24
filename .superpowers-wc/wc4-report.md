# wc4 — Determinism harness (replay is deterministic at 0 tokens)

## Files changed
- `test/determinism.test.ts` (new) — hermetic N-run replay determinism suite
- `test/fixtures/e2e/hermetic.skill.md` (new) — network-free fixture skill for the local e2e smoke
- `scripts/e2e-local.mjs` (new) — local end-to-end smoke over the real compiled CLI binary
- `package.json` (modified) — added `"test:e2e": "node scripts/e2e-local.mjs"` script

No files under `src/` or `test/signing.test.ts` were touched.

## `test/determinism.test.ts`

### Hermeticity
- Every step's tool is an **injected in-memory mock** (`makeFixedMockTool` / `makeVaryingMockTool`), never `src/tools.ts`'s `builtinTools` (`http.get`/`http.post`, which hit the real network). `runSkill` is called with `tools` explicitly supplied, so `builtinTools` is never reached.
- `maxLevel: 0` — the LLM is never constructed or called (matches `src/runner.ts`'s own stated contract: "the LLM is never constructed or called, full stop").
- `dryRun: true` — no `.reelier/runs/*.jsonl` file I/O; the whole test is in-memory.
- The fixture `Skill` is built directly as a TS object (not parsed from a markdown file), so there's zero filesystem I/O anywhere in the suite.
- The only two skill fixtures use hand-fixed observations (`{"id":"acct_001","status":"ok"}` etc.) — no `Date.now()`, no `Math.random()`, no environment reads inside the mock tools.

### N and what's normalized
- `N = 7` (>= 5 required by the brief).
- Normalized fields (the only ones `runSkill` legitimately derives from the real wall clock, per its own `now`-snapshot doc comment): `RunRecord.startedAt`, `RunRecord.finishedAt`, `RunRecord.totals.ms`, and every `StepRecord.ms`. Everything else — `skill`, `passed`, `steps[].outcome/failures/level/refs/write/etc.`, `totals.steps/passed/unchecked/skipped/failed/llmInputTokens/llmOutputTokens` — is asserted untouched.
- Assertion set per run, before normalization: `passed === true`, `totals.failed === 0`, `totals.steps === 2` (guards against a "deterministically fails" replay silently satisfying the equality checks).
- After normalization: `assert.deepEqual(normalized[i], normalized[0])` for every run `i`, plus `digestSha256(normalized[i]) === digestSha256(normalized[0])`, plus a final check that the *set* of all N digests has exactly 1 unique member.
- A fresh mock-tool instance is constructed on every iteration (not reused/shared) — proves the equality holds because the tool's *observation* is fixed, not because of accidental shared-state coincidence across iterations.

### Negative control
- `makeVaryingMockTool()` returns `{status:"ok"}` on its 1st call and `{status:"degraded"}` on every call after — a single tool instance is shared across two `runSkill` calls so the call-counter genuinely advances between them (simulating a real-world tool whose observation isn't fixed).
- `run1.passed === true`, `run2.passed === false` — the assertion diverges because of the differing observation.
- Asserts `assert.notDeepEqual(normalizeRecord(run2), normalizeRecord(run1))` and `digestSha256` differs — proving the harness detects non-determinism instead of passing vacuously because every varying field happened to get normalized away (per the brief's explicit guardrail).

## `scripts/e2e-local.mjs`

Dependency-free (`node:child_process`, `node:fs`, `node:os`, `node:path`, `node:url` only). Steps:
1. `npm run build` (fails fast/loud if the build breaks).
2. Confirms `dist/cli.js` and `test/fixtures/e2e/hermetic.skill.md` exist.
3. Spawns `node dist/cli.js run <fixture>` **twice**, each in its own fresh `mkdtempSync` cwd (so `.reelier/runs/*.jsonl` never touches the repo tree, and neither run can see the other's on-disk state).
4. Reads each run's `.reelier/runs/hermetic-e2e-fixture.jsonl` last line as the `RunRecord`.
5. Asserts: both runs' exit codes match; the two records are byte-identical after normalizing `startedAt`/`finishedAt`/`ms` (same normalization as the unit test); `digestSha256` of the two normalized records is identical (imported directly from `dist/canonical-json.js` via `pathToFileURL`, since this script is plain JS, not compiled).
6. Prints a `✓`/`✗` line per check, exits non-zero on any failure.

### Fixture hermeticity
`test/fixtures/e2e/hermetic.skill.md` has two steps whose `action` tool is `local.noop` — a name that doesn't exist in the CLI's default (no `--wrap`) tool registry, which only contains `http.get`/`http.post`. Because `runSkill`'s `executeStep` checks `tools[step.actionTool]` before doing anything else, Step 1 fails immediately with `Unknown tool 'local.noop'` and Step 2 is marked `skipped` — deterministically, with zero network reachability ever attempted. The point isn't that the run *passes*; it's that the exact same binary invocation twice produces byte-identical records.

### Actual run output (captured this session)
```
> reelier@0.23.0 test:e2e
> node scripts/e2e-local.mjs

Building CLI (npm run build)...

> reelier@0.23.0 build
> tsc -p tsconfig.json

✓ npm run build succeeded
✓ dist/cli.js exists — C:\Users\maxim\CascadeProjects\reelier-tq\dist\cli.js
✓ fixture skill exists — C:\Users\maxim\CascadeProjects\reelier-tq\test\fixtures\e2e\hermetic.skill.md
✓ run 1 produced a run record — exit 1, passed=false, 2 steps
✓ run 2 produced a run record — exit 1, passed=false, 2 steps
✓ both runs exited with the same exit code — 1
✓ normalized run records are byte-identical (deep equality) run-to-run
✓ digestSha256 of the normalized record is identical run-to-run — sha256:b30ffbe2587689dd0e19459d82bad2ea3f5af5a627ccce53a3eb67440f0befd5

PASSED: local e2e determinism smoke — the real binary produced byte-identical run records across 2 runs.
```
`npm run test:e2e` exits 0. It is NOT wired into `npm test` or CI, per the brief — it's an on-demand local smoke only (`test:e2e` script added to `package.json`).

## `npm test` (full suite) — verbatim tail
```
ℹ tests 725
ℹ suites 0
ℹ pass 725
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 17654.9303
```
725 = 723 pre-existing + 2 new (`test/determinism.test.ts` contributes 2 `test()` blocks: the positive N-run proof and the negative control).

## Deviations from the plan
- None of substance. The plan allowed constructing the Skill either by parsing a hand-written `.skill.md` string or building the object directly — I built it directly (simpler, zero I/O, and still exercises the real `fillTemplate`/`evalAssert`/`evalBind` path since `runSkill` doesn't care how its `Skill` argument was produced).
- Used `dryRun: true` in the unit test (not mentioned explicitly in the plan) to keep the determinism suite fully in-memory with no `.reelier/runs` file writes; the plan's hermeticity requirement was "zero network, zero real clock/random in the observed values" — `dryRun` is an orthogonal simplification, not a hermeticity loophole (the CLI-level e2e script exercises the real on-disk write path instead).
- The e2e fixture uses an unknown-tool-name failure rather than a genuinely passing offline skill, per the brief's own fallback guidance ("if every builtin needs network, keep the skill to binds+asserts with no external tool call, whatever runs offline deterministically") — no builtin tool in this CLI can succeed without touching the network, so a deterministic *failure* is the correct hermetic choice. The test still proves the load-bearing claim: the same binary invocation is byte-identical run-to-run, deep-equal AND digest-equal.

## Self-review checklist
- [x] N=7 (>=5) identical normalized records, deep-equal AND digest-equal, across 7 fresh mock-tool instances.
- [x] Negative control (shared varying-tool instance, 2nd call differs) detects the difference: `passed` flips, `notDeepEqual`, digests differ.
- [x] `scripts/e2e-local.mjs` drives the real compiled `dist/cli.js` binary via `node dist/cli.js run <fixture>`, not the runner functions directly.
- [x] No `src/` files touched; `test/signing.test.ts` untouched.
- [x] No network calls anywhere in either suite (all mock tools are pure in-memory; the e2e fixture's tool name doesn't exist so nothing ever dispatches).

## Open risks
- The e2e script always runs `npm run build` unconditionally (adds a few seconds); this was a deliberate simplicity choice per the brief ("Builds the CLI... then...") rather than trying to detect staleness, and keeps the smoke honest against whatever source is currently checked out.
- `scripts/e2e-local.mjs`'s temp-dir cleanup (`rmSync(cwd, {recursive:true, force:true})`) happens after each `runOnce()` returns; if the process is killed mid-run, a stray `reelier-e2e-*` temp dir could be left under the OS temp directory — harmless (outside the repo) but not self-healing.
