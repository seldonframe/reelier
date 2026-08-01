# Run footprint Implementation Plan (public-repo half of wave Task 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Derive a `RunFootprint` from a `RunRecord` and compare a run against its own recent
history, so a job that usually dispatches 30 writes and suddenly dispatches 3 is visible the same
day instead of on Thursday.

**Architecture:** One new pure, IO-free module `src/footprint.ts`, in the shape of the existing
`src/diff.ts`: types + functions, no fs, no network, no clock. `deriveFootprint` is *total* — it
never throws on any historical record shape. `compareFootprint` is arithmetic only. The CLI reads
records and prints; the module decides nothing about presentation. A new package export subpath
makes both available to reelier-cloud, which already depends on `reelier`.

**Tech Stack:** TypeScript 5.5 (ESM, `module: NodeNext`, `strict`), Node's built-in `node:test` +
`node:assert/strict`. No new dependencies.

## Scope

This plan is the **public-repo half** of the wave plan's Task 1. It delivers the footprint object,
its comparison, and the CLI surface. Persistence (`run_footprints`, migration `0022`, the 656-row
backfill) and the `drift_alerts` `'footprint'` kind are a **separate plan against reelier-cloud**,
and are genuinely blocked on this landing in a published `reelier` release — cloud consumes this
code via its `reelier` dependency rather than reimplementing the arithmetic. Do not attempt cloud
work here.

## Global Constraints

Copied from the wave plan; every task's requirements implicitly include these.

- **Never render `absent`, `pending`, or `unevaluated` as a pass.** A footprint with no baseline
  renders `baseline: none` — **never** `0 anomalies`. `"baseline-absent"` is a first-class verdict
  and MUST NOT be collapsed into `"within"`.
- **Never block from a learned score alone.** A footprint anomaly is a *flag*, never a refusal.
  Nothing in this plan may change an exit code on the basis of a footprint comparison.
- **Never let a receipt imply more than it proves.** A footprint proves *shape changed*, never
  *something is wrong*. Copy names **which counter moved** and its baseline — never "⚠ anomaly
  detected", never a verdict on whether the move is bad.
- **Never lead with cost or speed savings** in any copy, comment, or commit message.
- **Never let the trust layer be the reason a write fails.** Derivation is recorder-side and must
  never break a run: `deriveFootprint` is total over every historical record shape.
- **No model anywhere in this path.** Comparison is arithmetic.
- **`ms` is never an anomaly input.** Duration is *recorded* on the footprint and *never read* by
  `compareFootprint` — the same rule `src/diff.ts:10` already holds ("Timing (ms) is never drift").
- **Do not weaken `diff.ts`'s data-blindness.** The footprint is a new derived object, not a change
  to `diff`. `src/diff.ts` is not modified by this plan.
- Baseline before starting: `npm test` → 1132 tests, 1131 pass, 0 fail, 1 skipped.

## File Structure

- **Create** `src/footprint.ts` — the whole feature: `RunFootprint`, `FootprintVerdict`,
  `deriveFootprint`, `compareFootprint`, and the record-totals helper moved in from `cli.ts`.
  Modelled on `src/diff.ts` (pure, self-contained, types + functions, no barrel).
- **Create** `test/footprint.test.ts` — unit tests, `node:test`, local factory helpers in the style
  of `test/diff.test.ts:6-8`.
- **Modify** `src/cli.ts` — delete the private `deriveRecordTotals` (`:536-561`), import it from the
  new module instead; add the `--footprint` branch to `cmdDiff` (`:1116-1146`).
- **Modify** `package.json` — add the `"./footprint"` export subpath.

`src/diff.ts` is **not** modified.

---

### Task 1: `deriveFootprint` — the object

**Files:**
- Create: `src/footprint.ts`
- Create: `test/footprint.test.ts`
- Modify: `src/cli.ts:536-561` (remove the private `deriveRecordTotals`, import instead)

**Interfaces:**
- Consumes: `RunRecord`, `StepRecord` from `./runner.js` (types only).
- Produces, for Tasks 2 and 3 and for reelier-cloud:
  ```ts
  export interface RunFootprint {
    skill: string; finishedAt: string; ms: number;
    steps: number; passed: number; failed: number; unchecked: number; skipped: number;
    writesDispatched: number; distinctWriteResources: number;
    escalations: number;
    healL0: number; healL1: number; healL2: number;
    mocked: number; manifestIgnored: boolean;
  }
  export function deriveFootprint(record: RunRecord): RunFootprint;
  export function recordTotals(r: RunRecord): { passed: number; unchecked: number; skipped: number; failed: number };
  ```

**Background — presence rules that make a naive count wrong (verified 2026-07-31):**

- `StepRecord.write` is present **iff** the step actually dispatched a write-effect call. A `read`
  step can never carry it; a **refused** or **mocked** write-effect step does not carry it either
  (`src/runner.ts:65`, `:1734`). So `writesDispatched` counts steps carrying `write` — it must
  **not** be inferred from step effect or from `outcome`.
- `StepWrite.resource` and `.resource.id` are best-effort and frequently absent, never fabricated
  (`src/runner.ts:487-493`). `distinctWriteResources` counts **distinct present** `resource.id`
  strings; steps whose id is absent contribute nothing (they are not an "unknown" bucket).
- `StepRecord.llm` is absent — **not zero** — when escalation never ran (`src/runner.ts:177-186`).
  `escalations` counts steps carrying `llm`.
- `StepRecord.level` is always present, `0 | 1 | 2` (`src/runner.ts:172`).
- `StepRecord.mocked` is `true` or absent (`src/runner.ts:219`).
- `RunRecord.manifestIgnored` is `true` or absent, and its absence is **ambiguous** between "no
  manifest" and "preflight ran normally" (`src/runner.ts:237-243`). The footprint records the
  boolean; no consumer may read `false` as "preflight passed".
- **Legacy records:** `totals.unchecked`/`totals.skipped` are absent on pre-0.2.0 records and that
  era's `totals.passed` used the dishonest passed-OR-unchecked rollup. SPEC §4.4 (`SPEC.md:726-742`)
  is normative: check for `totals.unchecked`; if absent, derive from `steps[].outcome` and do
  **not** trust `totals.passed`. `cli.ts:543-561` already implements exactly this as a private
  `deriveRecordTotals`. **Move it, do not copy it** — two copies of a normative rule is how they
  drift apart.

- [ ] **Step 1: Write the failing tests**

Create `test/footprint.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveFootprint } from "../src/footprint.js";
import type { RunRecord, StepRecord, StepOutcome } from "../src/runner.js";

function step(n: number, outcome: StepOutcome, extra: Partial<StepRecord> = {}): StepRecord {
  return { n, title: `step ${n}`, level: 0, outcome, ms: 1, failures: [], ...extra };
}

function run(steps: StepRecord[], extra: Partial<RunRecord> = {}): RunRecord {
  const passed = steps.filter((s) => s.outcome === "passed").length;
  const unchecked = steps.filter((s) => s.outcome === "unchecked").length;
  const skipped = steps.filter((s) => s.outcome === "skipped").length;
  const failed = steps.filter((s) => s.outcome === "failed").length;
  return {
    skill: "demo",
    startedAt: "2026-07-01T00:00:00.000Z",
    finishedAt: "2026-07-01T00:00:05.000Z",
    passed: failed === 0,
    steps,
    totals: { steps: steps.length, passed, unchecked, skipped, failed, ms: 5, llmInputTokens: 0, llmOutputTokens: 0 },
    ...extra,
  };
}

test("deriveFootprint counts outcomes, writes, resources, escalations and heal levels", () => {
  const r = run([
    step(1, "passed", { write: { idempotencyKey: "k1", approved: true, resource: { id: "A" } } }),
    step(2, "passed", { write: { idempotencyKey: "k2", approved: true, resource: { id: "A" } } }),
    step(3, "passed", { write: { idempotencyKey: "k3", approved: true, resource: { id: "B" } } }),
    // dispatched, but no resource could be extracted -- contributes a write, not a resource
    step(4, "passed", { write: { idempotencyKey: "k4", approved: true } }),
    step(5, "unchecked", { level: 1, llm: { inputTokens: 10, outputTokens: 2 } }),
    step(6, "failed", { level: 2, llm: { inputTokens: 5, outputTokens: 1 } }),
    step(7, "skipped"),
    step(8, "passed", { mocked: true }),
  ]);
  const f = deriveFootprint(r);
  assert.equal(f.skill, "demo");
  assert.equal(f.steps, 8);
  assert.equal(f.passed, 5);
  assert.equal(f.failed, 1);
  assert.equal(f.unchecked, 1);
  assert.equal(f.skipped, 1);
  assert.equal(f.writesDispatched, 4);
  assert.equal(f.distinctWriteResources, 2, "A and B -- the id-less write contributes nothing");
  assert.equal(f.escalations, 2);
  assert.equal(f.healL0, 6);
  assert.equal(f.healL1, 1);
  assert.equal(f.healL2, 1);
  assert.equal(f.mocked, 1);
  assert.equal(f.manifestIgnored, false);
});

test("deriveFootprint reads manifestIgnored as a boolean, and absent is false", () => {
  assert.equal(deriveFootprint(run([step(1, "passed")])).manifestIgnored, false);
  assert.equal(deriveFootprint(run([step(1, "passed")], { manifestIgnored: true })).manifestIgnored, true);
});

test("deriveFootprint records ms but it is not an outcome counter", () => {
  const f = deriveFootprint(run([step(1, "passed")], { totals: { steps: 1, passed: 1, unchecked: 0, skipped: 0, failed: 0, ms: 4242, llmInputTokens: 0, llmOutputTokens: 0 } }));
  assert.equal(f.ms, 4242);
});

test("deriveFootprint honours SPEC 4.4: a pre-0.2.0 record's dishonest totals are ignored", () => {
  // No totals.unchecked -> legacy shape. Its totals.passed rolled up passed OR unchecked.
  const legacy = {
    skill: "demo",
    startedAt: "2025-01-01T00:00:00.000Z",
    finishedAt: "2025-01-01T00:00:01.000Z",
    passed: true,
    steps: [step(1, "passed"), step(2, "unchecked"), step(3, "skipped")],
    totals: { steps: 3, passed: 2, ms: 1, llmInputTokens: 0, llmOutputTokens: 0 },
  } as unknown as RunRecord;
  const f = deriveFootprint(legacy);
  assert.equal(f.passed, 1, "derived from steps[].outcome, not the legacy rollup");
  assert.equal(f.unchecked, 1);
  assert.equal(f.skipped, 1);
  assert.equal(f.failed, 0);
});

test("deriveFootprint is total -- it never throws on a degenerate or partial record", () => {
  const shapes: unknown[] = [
    { skill: "x", startedAt: "", finishedAt: "", passed: true, steps: [], totals: { steps: 0, passed: 0, unchecked: 0, skipped: 0, failed: 0, ms: 0, llmInputTokens: 0, llmOutputTokens: 0 } },
    { skill: "x", finishedAt: "t", passed: true, steps: [{ n: 1, title: "t", level: 0, outcome: "passed", ms: 0, failures: [] }] },
    { skill: "x", passed: true, steps: [] },
    { skill: "x", passed: true },
    { steps: [{ n: 1 }] },
    {},
  ];
  for (const s of shapes) {
    assert.doesNotThrow(() => deriveFootprint(s as RunRecord), `threw on ${JSON.stringify(s)}`);
  }
  const empty = deriveFootprint({} as RunRecord);
  assert.equal(empty.steps, 0);
  assert.equal(empty.writesDispatched, 0);
});
```

- [ ] **Step 2: Run the tests and confirm they fail for the right reason**

```bash
npm test 2>&1 | grep -A 3 "footprint"
```

Expected: a module-resolution/compile failure — `src/footprint.ts` does not exist yet. That is the
correct RED. Capture the output.

- [ ] **Step 3: Implement `src/footprint.ts`**

Write the module. Open with a header comment in the voice of `src/diff.ts:1-12`: say what the object
is, that it is pure and IO-free, that `ms` is recorded but is never a comparison input, and that a
footprint proves *shape changed* and never *something is wrong*.

Requirements:

- `recordTotals(r)` — exported, and is the code **moved** from `cli.ts:543-561`. Keep its doc
  comment (it states the SPEC §4.4 rule); extend it to note it is now shared.
- `deriveFootprint(record)` — total. Guard every field access: a missing `steps` array yields `0`
  counters, not a throw. Do not use non-null assertions. Prefer `Array.isArray(record?.steps) ? … : []`
  over optional chaining alone, because a historical record may carry a non-array `steps`.
- `distinctWriteResources` uses a `Set` of `write.resource.id` values that are non-empty strings.
- `manifestIgnored` is `record.manifestIgnored === true`.
- `finishedAt`/`skill` fall back to `""` when absent, so the type stays non-optional and callers
  never branch on undefined.

- [ ] **Step 4: Run the tests to green**

```bash
npm test 2>&1 | grep -E "^(ok|not ok|✔|✖).*footprint|deriveFootprint"
```

Expected: all five tests pass.

- [ ] **Step 5: Rewire `cli.ts` to the shared helper**

Delete the private `deriveRecordTotals` at `src/cli.ts:536-561` and import `recordTotals` from
`./footprint.js`, updating its call sites. Do not change behaviour — this is a move, not a rewrite.

- [ ] **Step 6: Full suite — the `bench` path must be unchanged**

```bash
npm test 2>&1 | tail -8
```

Expected: `fail 0`. `reelier bench` is the main consumer of the moved helper; its existing tests
(`test/bench-cli.test.ts`) must pass **unmodified**. If any needs editing, stop and report — that
means the move changed behaviour.

- [ ] **Step 7: Commit**

```bash
git add src/footprint.ts test/footprint.test.ts src/cli.ts
git commit -m "feat(footprint): derive a run's shape from its record, total over every record age

A run that usually dispatches 30 writes and suddenly dispatches 3 is the
signal worth surfacing, and nothing in the record layer surfaced it. This
is the object: counts of what a run did, derived purely from its own
RunRecord, so it is available for every record already on disk.

Total by construction -- a partial or pre-0.20.0 record yields zeroes, never
a throw, because derivation is recorder-side and must never break a run. The
SPEC 4.4 legacy-totals rule moves out of cli.ts and is now shared rather than
duplicated. ms is recorded and is deliberately never a comparison input."
```

---

### Task 2: ~~`compareFootprint` — the arithmetic~~ — **SUPERSEDED 2026-07-31**

> **Do not implement this section.** It invented a second anomaly engine next to one that already
> ships. See **Plan amendment** at the end of this file for the replacement Task 2. The text below
> is kept only so the superseded reasoning stays auditable.

**Files:**
- Modify: `src/footprint.ts` (add comparison types + function)
- Modify: `test/footprint.test.ts` (add comparison tests)

**Interfaces:**
- Consumes: `RunFootprint` from Task 1.
- Produces:
  ```ts
  export type FootprintVerdictKind = "baseline-absent" | "within" | "outside";
  export interface CounterMove { counter: string; current: number; baseline: number; }
  export interface FootprintVerdict {
    kind: FootprintVerdictKind;
    baselineRuns: number;
    moved: CounterMove[]; // always [] unless kind === "outside"
  }
  export const MIN_BASELINE_RUNS = 3;
  export function compareFootprint(current: RunFootprint, baseline: RunFootprint[]): FootprintVerdict;
  ```

**Design decisions, fixed here so the implementer does not re-litigate them:**

- **Windowing is the caller's job.** `compareFootprint` receives an already-filtered baseline array.
  The 7-day trailing window lives in the CLI (Task 3) and later in cloud. This keeps the function
  pure and clock-free — it must not call `Date.now()`.
- **Minimum baseline of 3 prior runs.** Fewer → `"baseline-absent"`, `moved: []`. Same discipline as
  `isStale`'s ≥3-reporting-days guard, for the same reason: a threshold computed from one or two
  samples is not a threshold.
- **Comparison basis is the arithmetic mean** of each counter across the baseline runs.
- **The 2× rule with a slack of 1.** A counter has moved when
  `current > 2 * mean + 1` **or** `current < mean / 2 - 1`.
  The `± 1` slack exists to kill 0→1 chatter on rare counters (an `escalations` mean of 0.2 would
  otherwise flag on the first escalation) while leaving the signal that motivated this untouched:
  a 30→3 drop is `3 < 14` and still flags. Name this constant `SLACK` and comment the reasoning.
- **Compared counters — an explicit list, not "every numeric field":**
  `steps`, `passed`, `failed`, `unchecked`, `skipped`, `writesDispatched`,
  `distinctWriteResources`, `escalations`, `mocked`.
  **`ms` is excluded** and there must be a test that proves it. `healL0/L1/L2`, `skill`,
  `finishedAt` and `manifestIgnored` are excluded too — heal level is `diff.ts`'s job and the rest
  are not counters.
- **`moved` is ordered** by the counter list above, so output is deterministic.

- [ ] **Step 1: Write the failing tests**

Append to `test/footprint.test.ts` (add `compareFootprint`, `MIN_BASELINE_RUNS` to the import):

```ts
function fp(over: Partial<RunFootprint> = {}): RunFootprint {
  return {
    skill: "demo", finishedAt: "2026-07-01T00:00:00.000Z", ms: 100,
    steps: 10, passed: 10, failed: 0, unchecked: 0, skipped: 0,
    writesDispatched: 30, distinctWriteResources: 30, escalations: 0,
    healL0: 10, healL1: 0, healL2: 0, mocked: 0, manifestIgnored: false,
    ...over,
  };
}

test("compareFootprint: fewer than 3 baseline runs is baseline-absent, never within", () => {
  for (const n of [0, 1, 2]) {
    const v = compareFootprint(fp(), Array.from({ length: n }, () => fp()));
    assert.equal(v.kind, "baseline-absent", `${n} baseline run(s)`);
    assert.equal(v.baselineRuns, n);
    assert.deepEqual(v.moved, []);
  }
  assert.equal(MIN_BASELINE_RUNS, 3);
});

test("compareFootprint: the 30 -> 3 write-count drop flags, naming the counter that moved", () => {
  const baseline = [fp(), fp(), fp()];
  const v = compareFootprint(fp({ writesDispatched: 3, distinctWriteResources: 3 }), baseline);
  assert.equal(v.kind, "outside");
  assert.equal(v.baselineRuns, 3);
  const names = v.moved.map((m) => m.counter);
  assert.deepEqual(names, ["writesDispatched", "distinctWriteResources"]);
  assert.deepEqual(v.moved[0], { counter: "writesDispatched", current: 3, baseline: 30 });
});

test("compareFootprint: a same-shape run with fresh data does not flag", () => {
  const baseline = [fp(), fp(), fp()];
  assert.equal(compareFootprint(fp(), baseline).kind, "within");
  // different resource IDENTITIES, same COUNTS -- the footprint counts, it never compares values
  assert.equal(compareFootprint(fp({ finishedAt: "2026-07-09T00:00:00.000Z" }), baseline).kind, "within");
});

test("compareFootprint: ms is never an anomaly input", () => {
  const baseline = [fp({ ms: 100 }), fp({ ms: 100 }), fp({ ms: 100 })];
  const v = compareFootprint(fp({ ms: 100000 }), baseline);
  assert.equal(v.kind, "within");
  assert.deepEqual(v.moved, []);
});

test("compareFootprint: slack suppresses 0 -> 1 chatter but not a real spike", () => {
  const baseline = [fp({ escalations: 0 }), fp({ escalations: 0 }), fp({ escalations: 1 })];
  // mean 0.33 -- one escalation is noise, not signal
  assert.equal(compareFootprint(fp({ escalations: 1 }), baseline).kind, "within");
  assert.equal(compareFootprint(fp({ escalations: 5 }), baseline).kind, "outside");
});

test("compareFootprint is pure -- same inputs, same verdict, and inputs are not mutated", () => {
  const current = fp({ writesDispatched: 3 });
  const baseline = [fp(), fp(), fp()];
  const snapshot = JSON.stringify({ current, baseline });
  const a = compareFootprint(current, baseline);
  const b = compareFootprint(current, baseline);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify({ current, baseline }), snapshot);
});
```

- [ ] **Step 2: Run and confirm RED**

```bash
npm test 2>&1 | grep -A 3 "compareFootprint"
```

Expected: compile failure — `compareFootprint` is not exported yet.

- [ ] **Step 3: Implement `compareFootprint`**

Add the types, `MIN_BASELINE_RUNS = 3`, `SLACK = 1`, the ordered `COMPARED_COUNTERS` list, and the
function, per the design decisions above. `baseline` is read-only — do not sort or mutate the array.

- [ ] **Step 4: Green, then full suite**

```bash
npm test 2>&1 | tail -8
```

Expected: `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/footprint.ts test/footprint.test.ts
git commit -m "feat(footprint): compare a run against its own recent history, arithmetically

Flags a counter that moved outside ~2x its trailing-window mean, with a
slack of 1 so a rare counter going 0 -> 1 is not treated as signal. Needs
three prior runs before it will say anything at all; below that the verdict
is baseline-absent, which is its own state and must never render as within.

The verdict names which counter moved and what the baseline was. It does not
say whether the move is bad -- it cannot know that, and copy must not imply
it. ms is excluded from the comparison and a test pins that."
```

---

### Task 3: ~~`reelier diff --footprint` and the package export~~ — **SUPERSEDED 2026-07-31**

> **Do not implement this section as written.** `computeRunShape` already has two CLI surfaces
> (`src/cli.ts:268`, `:721`), so a third is duplication. The package-export step survives. See
> **Plan amendment** at the end of this file. Text kept for auditability.

**Files:**
- Modify: `src/footprint.ts` (add the trailing-window helper + counter labels)
- Modify: `src/cli.ts:1116-1146` (`cmdDiff`)
- Modify: `test/footprint.test.ts` (window helper tests)
- Create: `test/footprint-cli.test.ts` (CLI output + exit-code tests)
- Modify: `package.json` (add the `"./footprint"` export subpath)

**Interfaces:**
- Consumes: `deriveFootprint`, `compareFootprint`, `RunFootprint`, `FootprintVerdict` from Tasks 1-2.
- Produces:
  ```ts
  export const BASELINE_WINDOW_DAYS = 7;
  /** Footprints finishing within `windowDays` BEFORE the anchor. Clock-free: the caller passes the anchor. */
  export function withinTrailingWindow(footprints: RunFootprint[], anchorFinishedAt: string, windowDays?: number): RunFootprint[];
  /** Human labels for the compared counters, e.g. writesDispatched -> "writes dispatched". */
  export const COUNTER_LABELS: Readonly<Record<string, string>>;
  ```

**How `cmdDiff` reads the records.** `runDiffTool` (`src/serve.ts:386-409`) already reads
`.reelier/runs/<skill>.jsonl` via `readRunRecords` and returns only a `RunDiff`. Do **not** widen
`DiffToolResult` — that type is also the `reelier_diff` MCP tool's contract (`src/serve.ts:412`+)
and changing it is out of scope. In `cmdDiff`, when `--footprint` is set, read the records directly
with `readRunRecords` against the same path `src/serve.ts:388` builds, and derive from those.

**Exit code is unchanged by the footprint.** `--footprint` adds a section to the output; the exit
code stays governed by the diff verdict. A footprint anomaly is a flag, never a refusal — this is
the wave's "never block from a learned score alone" constraint, and Step 1's test pins it.

**Copy rules — requirements, not suggestions:**
- `baseline-absent` renders as `baseline: none (N run(s) in the last 7 days; needs 3)`.
  It must **never** render as `0 anomalies`, `no anomalies`, `within`, or a checkmark.
- A moved counter renders as `writes dispatched: 3 (baseline ~30)`.
  It must **never** render as `⚠ anomaly detected`, `FAIL`, or anything asserting the move is wrong.
- Do not lead any line with cost or speed.

- [ ] **Step 1: Write the failing tests**

Add to `test/footprint.test.ts` (extend the import with `withinTrailingWindow`, `BASELINE_WINDOW_DAYS`):

```ts
test("withinTrailingWindow keeps only footprints finishing inside the window before the anchor", () => {
  const at = (d: string) => fp({ finishedAt: d });
  const all = [
    at("2026-06-01T00:00:00.000Z"), // far outside
    at("2026-07-01T00:00:00.000Z"), // 8 days before anchor -- outside
    at("2026-07-05T00:00:00.000Z"), // 4 days before -- inside
    at("2026-07-08T00:00:00.000Z"), // 1 day before -- inside
  ];
  const kept = withinTrailingWindow(all, "2026-07-09T00:00:00.000Z", 7);
  assert.deepEqual(kept.map((f) => f.finishedAt), ["2026-07-05T00:00:00.000Z", "2026-07-08T00:00:00.000Z"]);
  assert.equal(BASELINE_WINDOW_DAYS, 7);
});

test("withinTrailingWindow drops unparseable timestamps rather than throwing", () => {
  const kept = withinTrailingWindow([fp({ finishedAt: "" }), fp({ finishedAt: "not-a-date" })], "2026-07-09T00:00:00.000Z", 7);
  assert.deepEqual(kept, []);
  assert.doesNotThrow(() => withinTrailingWindow([fp()], "nonsense", 7));
});
```

Create `test/footprint-cli.test.ts`. **Find an existing test in this repo that already drives a CLI
command against a temp `.reelier/runs/<skill>.jsonl` fixture and match its setup/teardown idiom
exactly** — do not invent a new harness. It must cover:

1. **`baseline-absent` renders distinctly.** With 2 prior runs, output contains `baseline: none` and
   contains none of `0 anomalies`, `no anomalies`, `within`.
2. **A moved counter names itself.** With 3 identical prior runs at 30 writes and a current run at
   3, output contains `writes dispatched: 3 (baseline ~30)` and does **not** contain
   `anomaly detected`.
3. **Exit code is unchanged by the footprint.** A run whose steps are identical to the baseline
   (diff verdict `same`) but whose write count moved 30→3 exits **0**.
4. **Without `--footprint` the output is byte-identical to today's.** The flag must be purely additive.

- [ ] **Step 2: Run and confirm RED**

```bash
npm test 2>&1 | grep -A 3 "withinTrailingWindow\|footprint-cli"
```

Capture the failure. Expected: unresolved export, then assertion failures on the CLI output.

- [ ] **Step 3: Implement**

Add `BASELINE_WINDOW_DAYS`, `withinTrailingWindow` (guard with `Number.isNaN(Date.parse(...))` on
both the anchor and each footprint — return `[]` rather than throwing), and `COUNTER_LABELS`
covering every counter in `COMPARED_COUNTERS`. Then extend `cmdDiff`: after the existing step lines,
when `args.flags.has("footprint")`, print the footprint section per the copy rules. Update
`cmdDiff`'s usage string to mention `[--footprint]`.

- [ ] **Step 4: Green, then full suite**

```bash
npm test 2>&1 | tail -8
```

Expected: `fail 0`, and no pre-existing test modified.

- [ ] **Step 5: Add the package export subpath**

In `package.json`, add `"./footprint": "./dist/footprint.js"` to `exports`, after `"./trace"` to
match the existing ordering. This is what lets reelier-cloud consume the derivation instead of
reimplementing the arithmetic. Verify the built file lands:

```bash
npm run build && node -e "import('./dist/footprint.js').then(m=>console.log(Object.keys(m).sort().join(',')))"
```

Expected: the printed list includes `compareFootprint`, `deriveFootprint`, `withinTrailingWindow`.

- [ ] **Step 6: Commit**

```bash
git add src/footprint.ts src/cli.ts test/footprint.test.ts test/footprint-cli.test.ts package.json
git commit -m "feat(cli): reelier diff --footprint, and export the module for the cloud

Prints which counter moved and what the baseline was -- 'writes dispatched:
3 (baseline ~30)' -- and never a verdict on whether the move is bad, because
a footprint proves shape changed and nothing more. A run with no baseline
renders 'baseline: none', never a clean bill of health.

The flag is additive: without it the output is byte-identical, and the exit
code is governed by the diff verdict either way. A footprint anomaly is a
flag, never a refusal."
```

---

## Task exit gate (public half)

- [ ] `deriveFootprint` is total across every record shape in `test/footprint.test.ts`, including
      pre-0.2.0 and degenerate ones — **evidence: the totality test's output.**
- [ ] An injected 30→3 write-count change flags; a same-shape run with fresh data does not.
- [ ] `baseline-absent` renders distinctly in the CLI and is never collapsed into `within`.
- [ ] `ms` is proven not to be a comparison input.
- [ ] Exit code is unchanged by a footprint anomaly.
- [ ] Full suite green with no pre-existing test modified.

## Not in this plan (the cloud half of wave Task 1)

Blocked on a published `reelier` release carrying `./footprint`, because reelier-cloud consumes the
package (`reelier: ^0.25.0`, already importing `RunRecord` from it) rather than reimplementing the
arithmetic:

- `run_footprints` table, drizzle migration **`0022_`** (live max on cloud `main` is `0021`)
- backfill of existing run records — the wave plan cites 656 rows; **that count is unverified from
  this side and must be measured, not assumed**
- `drift_alerts` kind `'footprint'`. The live kind union is already **four** values
  (`went_red | recovered | stale | went_unevaluated`, `src/lib/drift-watch.ts:7`), not the three the
  wave plan names, and `kind` is a plain `text` column with no DB constraint
- email copy via `subjectFor` / `causeHintFor` / `buildAlertEmail` (`drift-watch.ts:94-165`);
  `alert-email.ts` is kind-agnostic and needs no change

---

# Plan amendment — 2026-07-31

**Why this exists.** Task 1's review surfaced that `src/priors.ts` ("Local run-shape priors", F5,
spec at `docs/specs/run-shape-priors.md`) **already ships cross-run deviation detection**, wired
into the CLI at `src/cli.ts:268` and `:721`. The wave plan's premise — "detection of a
wrong-but-passing run: none — no cross-run comparison exists" — is false. F5 covers 7 of the
footprint's counters, uses `MIN_PRIOR_RUNS = 3` (the same value, with better-documented reasoning),
and enforces its copy honesty with a banned-word test (`test/priors-render.test.ts`).

**Founder decisions, 2026-07-31:**

1. **The footprint is the persistable projection; the judging reuses F5.** `deriveFootprint` stays
   as the flat, serializable counter record the cloud table needs. The mean-and-2×-with-slack rule
   is **deleted, not built**. Deviation is decided by F5's `deviatesFromBaseline`.
2. **F5's statistic governs:** a value deviates iff it lands more than `DEVIATION_MADS` (3)
   median-absolute-deviations outside the closed range the prior window actually spanned
   (`src/priors.ts:167-204`). The ledger's ~2× default is **not** implemented.

**Consequence for the wave plan that must be recorded there, not here:** its Task 1 kill condition
is calibrated against the 2× rule's false-positive profile ("fires on maybe 1 in 10 runs and is
real about a third of the time"). That calibration no longer describes what ships. The kill
condition must be restated in terms of the MAD/range rule's own measured rate before the 30-day
window starts, or it will be unfalsifiable.

---

### Task 2 (revised): one derivation, five new metrics

**Goal:** make `deriveFootprint` the single place a run's shape is computed, and teach F5 the
counters it is missing — so the repo has one derivation and one statistic rather than two of each.

**Files:**
- Modify: `src/footprint.ts` — outcome counting changes basis (see below)
- Modify: `src/priors.ts` — `RunShapeMetric`, `RunShape`, `RUN_METRICS`; delete `shapeOf`
- Modify: `src/priors-render.ts` — labels/units for the new metrics
- Modify: `docs/specs/run-shape-priors.md` — document the new metrics
- Modify: `test/priors.test.ts`, `test/priors-render.test.ts`, `test/footprint.test.ts`

**The five metrics F5 is missing:** `distinctWriteResources`, `escalations`, `mocked`, and the heal
distribution. Add them as `RunShapeMetric` values with `unit: "count"`. **Do not add
`manifestIgnored`** — it is a boolean, not a counter, and `deviatesFromBaseline` is defined over
numbers. It stays on `RunFootprint` for persistence and is never a deviation metric.

**Heal levels: add `healL1` and `healL2` only, not `healL0`.** `healL0` is `steps` minus the other
two and carries no independent information; including it would triple-count the same movement.

**Outcome counting — resolve the divergence the reviewer found.** `shapeOf` counted outcomes from
`steps[]` *always*; `deriveFootprint` trusts `totals` on modern records via `recordTotals`. Under
one derivation they cannot both be right. **`deriveFootprint` must count from `steps[]` always.**
Per-step outcomes were always recorded correctly at every package version (SPEC §4.4), so the
step-derived count is never wrong, while the `totals` shortcut is only *sometimes* trustworthy.
`recordTotals` stays exported in `src/footprint.ts` for `reelier bench`, which has a different job
(reporting a record's own claimed totals honestly) — add a comment on each saying why two functions
that look similar are not duplicates.

**`duration`/`ms`:** `shapeOf` recomputed duration by summing per-step `ms` defensively;
`deriveFootprint` currently records `totals.ms`. These agree on well-formed records and diverge on
malformed ones. Take `shapeOf`'s approach — sum per-step `ms`, guarding with
`typeof s.ms === "number" && Number.isFinite(s.ms)` — so the footprint never carries a `NaN` into a
median. Keep the field name `ms` on `RunFootprint`.

- [ ] **Step 1: Write the failing tests first.** Extend `test/priors.test.ts` with a case per new
      metric proving it deviates when it should and stays quiet when the value is one the skill has
      already produced. Extend `test/footprint.test.ts` to pin that outcome counts now come from
      `steps[]` even when `totals` disagrees, and that a non-finite step `ms` cannot reach the
      footprint. Run and capture RED.
- [ ] **Step 2: Implement.** Replace `shapeOf`'s body with a call to `deriveFootprint` and map
      `RUN_METRICS` onto footprint fields. Delete the now-duplicated logic rather than leaving it.
- [ ] **Step 3: The banned-word test must still pass unmodified.** `test/priors-render.test.ts`
      pins that no rendered line may say "anomaly", "unsafe", "verified", or "something went wrong".
      New metric labels are subject to it. If it needs editing, stop and report.
- [ ] **Step 4: Update `docs/specs/run-shape-priors.md`** for the new metrics, in its existing voice,
      including why `manifestIgnored` and `healL0` are deliberately excluded. **Also reword the
      pointer at `docs/specs/run-shape-priors.md:28-33`**, which currently says per-run counts derive
      "from `steps[]` rather than from `totals`, for the reason already documented at `recordTotals`
      in `src/footprint.ts`" — `recordTotals` is precisely the function that *does* read `totals`
      when SPEC §4.4 says it is trustworthy, so the citation argues against itself. After this task
      `deriveFootprint` is the always-from-`steps[]` function and is the correct referent.

> **Baseline-shift warning for this task.** Swapping `shapeOf` for `deriveFootprint` changes F5's
> counts on any modern record whose `totals` rollup disagrees with its `steps[]`, which can move an
> existing user's baseline. It is the correct direction (steps are always authoritative) but it is a
> silent behaviour change to a shipped feature — say so in the commit message and in the spec.
- [ ] **Step 5: Full suite green, no pre-existing test modified except the two named above.** Commit.

### Task 3 (revised): the package export only

The `reelier diff --footprint` CLI surface is **dropped** — `computeRunShape` is already surfaced
twice and a third rendering of the same idea is duplication, not a feature.

- [ ] Add `"./footprint": "./dist/footprint.js"` to `exports` in `package.json`, after `"./trace"`.
      This is what lets reelier-cloud consume the derivation rather than reimplementing it.
- [ ] Verify: `npm run build && node -e "import('./dist/footprint.js').then(m=>console.log(Object.keys(m).sort().join(',')))"`
      prints a list including `deriveFootprint` and `recordTotals`.
- [ ] Commit.

### Revised exit gate (public half)

- [ ] `deriveFootprint` is total across every shape in the totality test, including `[null]`.
- [ ] Exactly one derivation of a run's shape exists in `src/` — `shapeOf` is gone.
- [ ] The five new metrics deviate correctly, and the banned-word test passes unmodified.
- [ ] `manifestIgnored` and `healL0` are on the footprint but are not deviation metrics.
- [ ] `./footprint` resolves from the built package.
- [ ] Full suite green.