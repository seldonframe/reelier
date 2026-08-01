// Determinism harness — proves reelier's core claim: "replay is
// deterministic at 0 tokens" (maxLevel: 0, no LLM ever constructed).
//
// HERMETIC by construction: every step's tool is an INJECTED in-memory mock
// (never src/tools.ts's http.* builtins, which hit the real network). The
// only source of non-determinism runSkill ever introduces on its own is wall
// clock timing (RunRecord.startedAt/finishedAt/totals.ms, StepRecord.ms) —
// those are normalized to a constant before comparing, exactly as documented
// in src/runner.ts's `now` snapshot comment. A tool's OBSERVATION itself
// must never vary between runs; that's the property under test.
//
// Structure:
//   1. Positive proof — N>=5 runs of a fixed hermetic skill produce
//      byte-identical (deep-equal AND digest-equal) normalized records, and
//      the run actually passes (a deterministically-FAILING replay would
//      still satisfy naive equality checks, so this is asserted too).
//   2. Negative control — a mock tool that intentionally returns a
//      DIFFERENT observation on its 2nd call is used to prove the harness
//      can actually detect non-determinism, not just pass vacuously because
//      every varying field happens to get normalized away.

import { test } from "node:test";
import assert from "node:assert/strict";
import { runSkill, type RunOptions } from "../src/runner.js";
import type { Tool, ToolContext } from "../src/tools.js";
import type { Observation } from "../src/assert.js";
import type { Skill } from "../src/skill.js";
import { digestSha256 } from "../src/canonical-json.js";
import type { RunRecord } from "../src/runner.js";

// ---------------------------------------------------------------------------
// Fixture skill: two steps, second step's args reference the first step's
// bind — exercises fillTemplate + evalAssert + evalBind, not just a bare
// tool dispatch. Built directly as a Skill object (not parsed from markdown
// text) so there is no file I/O anywhere in this suite.
// ---------------------------------------------------------------------------

function buildFixtureSkill(): Skill {
  return {
    name: "determinism-fixture",
    description: "Hermetic fixture — two steps, a bind, and a template reference — for the determinism harness.",
    preamble: "",
    trailing: "",
    steps: [
      {
        n: 1,
        title: "Fetch the account",
        intent: "fetch a fixed account record from the injected mock tool",
        actionTool: "mock.get",
        actionArgs: { url: "https://mock.local/account" },
        asserts: ['json.status == "ok"'],
        binds: ["accountId = json.id"],
        effect: "read",
        line: 10,
      },
      {
        n: 2,
        title: "Reference the bound account id",
        intent: "use the step-1 bind in a template hole, then assert against a fixed observation",
        actionTool: "mock.get",
        actionArgs: { url: "https://mock.local/account/{{accountId}}/status" },
        asserts: ['json.id == "acct_001"', "json.status is string"],
        binds: [],
        effect: "read",
        line: 20,
      },
    ],
  };
}

/** A fully fixed, no-randomness, no-clock, no-network mock — always returns the identical Observation. */
function makeFixedMockTool(): Tool {
  return {
    effect: "read",
    async run(_args: unknown, _ctx: ToolContext): Promise<Observation> {
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "acct_001", status: "ok" }),
      };
    },
  };
}

/** A mock whose 2nd (and later) call returns a DIFFERENT observation than its 1st — the negative control. */
function makeVaryingMockTool(): Tool {
  let calls = 0;
  return {
    effect: "read",
    async run(_args: unknown, _ctx: ToolContext): Promise<Observation> {
      calls++;
      const body = calls === 1 ? JSON.stringify({ id: "acct_001", status: "ok" }) : JSON.stringify({ id: "acct_001", status: "degraded" });
      return { status: 200, headers: {}, body };
    },
  };
}

const NORMALIZED_TS = "1970-01-01T00:00:00.000Z";

/** Strip the only fields runSkill legitimately derives from the real wall clock, per src/runner.ts's own `now`-snapshot doc comment. Everything else in a RunRecord must already be identical run-to-run. */
function normalizeRecord(r: RunRecord): RunRecord {
  return {
    ...r,
    startedAt: NORMALIZED_TS,
    finishedAt: NORMALIZED_TS,
    totals: { ...r.totals, ms: 0 },
    steps: r.steps.map((s) => ({ ...s, ms: 0 })),
  };
}

const RUN_OPTIONS_BASE: Omit<RunOptions, "tools"> = {
  maxLevel: 0, // pure deterministic replay — the LLM is never constructed or called (src/runner.ts's own contract)
  allowWrites: false,
  dryRun: true, // in-memory only — no .reelier/runs/*.jsonl file I/O, keeps the suite fully hermetic
};

const N = 7; // >= 5 required by the brief; a couple extra costs nothing and strengthens the proof

test("determinism: N hermetic replays of the same skill produce byte-identical normalized records", async () => {
  const records: RunRecord[] = [];
  for (let i = 0; i < N; i++) {
    // A fresh tool instance every run — proves the equality holds because
    // the OBSERVATION is fixed, not because some shared mutable tool state
    // happens to coincidentally line up across iterations.
    const tools: Record<string, Tool> = { "mock.get": makeFixedMockTool() };
    const record = await runSkill(buildFixtureSkill(), { ...RUN_OPTIONS_BASE, tools });
    records.push(record);
  }

  // Sanity: a broken replay that "deterministically fails" every time must
  // NOT slip through disguised as a determinism proof.
  for (const r of records) {
    assert.equal(r.passed, true, "fixture skill must actually pass — determinism of a broken replay proves nothing");
    assert.equal(r.totals.failed, 0);
    assert.equal(r.totals.steps, 2);
  }

  const normalized = records.map(normalizeRecord);
  const digests = normalized.map((r) => digestSha256(r));

  for (let i = 1; i < N; i++) {
    assert.deepEqual(normalized[i], normalized[0], `run ${i + 1}/${N}'s normalized record diverged from run 1's`);
    assert.equal(digests[i], digests[0], `run ${i + 1}/${N}'s record digest diverged from run 1's`);
  }

  // All N digests identical, not just each equal to run 1's (transitively
  // true given the loop above, but asserted directly as the headline claim).
  const uniqueDigests = new Set(digests);
  assert.equal(uniqueDigests.size, 1, `expected exactly 1 unique digest across ${N} runs, got ${uniqueDigests.size}`);
});

test("determinism negative control: a mock tool returning a DIFFERENT observation on its 2nd call produces a DIFFERENT record — proves the harness can detect non-determinism", async () => {
  // One shared varying tool across both runSkill calls, so its internal
  // call-counter actually advances from run 1 into run 2 (that's the whole
  // point — simulating a tool whose real-world observation isn't fixed).
  const varyingTool = makeVaryingMockTool();

  const skill: Skill = {
    name: "determinism-negative-control",
    description: "Single-step skill whose tool's 2nd call diverges from its 1st — negative control for the determinism harness.",
    preamble: "",
    trailing: "",
    steps: [
      {
        n: 1,
        title: "Check status",
        intent: "assert status is ok — passes on call 1, fails on call 2+ once the mock starts varying",
        actionTool: "mock.varying",
        actionArgs: { url: "https://mock.local/account" },
        asserts: ['json.status == "ok"'],
        binds: [],
        effect: "read",
        line: 10,
      },
    ],
  };

  const run1 = await runSkill(skill, { ...RUN_OPTIONS_BASE, tools: { "mock.varying": varyingTool } });
  const run2 = await runSkill(skill, { ...RUN_OPTIONS_BASE, tools: { "mock.varying": varyingTool } });

  // The tool call actually happened twice with different results.
  assert.equal(run1.passed, true, "run 1 should pass — the tool's 1st call returns status: ok");
  assert.equal(run2.passed, false, "run 2 should fail — the tool's 2nd call returns status: degraded");

  const n1 = normalizeRecord(run1);
  const n2 = normalizeRecord(run2);

  assert.notDeepEqual(n2, n1, "normalized records should differ once the underlying observation differs — a determinism check that can't detect this would pass vacuously");
  assert.notEqual(digestSha256(n2), digestSha256(n1), "digests should differ once the underlying observation differs");
});
