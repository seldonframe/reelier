import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

// Same convention as compile-cli.test.ts: exercise the CLI as a real
// subprocess against dist-test's compiled output.
const CLI_PATH = fileURLToPath(new URL("../src/cli.js", import.meta.url));

const SKILL_SOURCE = `---
name: bench-fixture
description: a two-step skill used to exercise bench against mixed-shape run records
---

### Step 1 — one
- intent: first step
- action: http.get {"url": "https://example.com/1"}
- assert: status == 200
- effect: read

### Step 2 — two
- intent: second step
- action: http.get {"url": "https://example.com/2"}
- assert: status == 200
- effect: read
`;

// A genuine 0.1.x-shaped record: totals has no unchecked/skipped fields, and
// its `passed` count (2) is the old "passed OR unchecked" rollup — one of
// the two steps below is actually "unchecked", so the honest derivation
// must land on passed=1/unchecked=1, not trust the legacy totals.passed=2.
const LEGACY_RECORD = {
  skill: "bench-fixture",
  startedAt: "2026-01-01T00:00:00.000Z",
  finishedAt: "2026-01-01T00:00:01.000Z",
  passed: true,
  steps: [
    { n: 1, title: "one", level: 0, outcome: "passed", ms: 10, failures: [] },
    { n: 2, title: "two", level: 0, outcome: "unchecked", ms: 5, failures: [] },
  ],
  totals: { steps: 2, passed: 2, failed: 0, ms: 15, llmInputTokens: 0, llmOutputTokens: 0 },
};

// A 0.2.0-shaped record with an honest split, plus an escalation that burned
// L1 tokens and still failed (escalationAttempted=1, level stays 0).
const NEW_RECORD = {
  skill: "bench-fixture",
  startedAt: "2026-07-18T00:00:00.000Z",
  finishedAt: "2026-07-18T00:00:02.000Z",
  passed: false,
  steps: [
    { n: 1, title: "one", level: 0, outcome: "passed", ms: 12, failures: [] },
    {
      n: 2,
      title: "two",
      level: 0,
      outcome: "failed",
      ms: 8,
      failures: ["L1: real-failure"],
      llm: { inputTokens: 30, outputTokens: 10 },
      escalationAttempted: 1,
    },
  ],
  totals: { steps: 2, passed: 1, unchecked: 0, skipped: 0, failed: 1, ms: 20, llmInputTokens: 30, llmOutputTokens: 10 },
};

test("bench: handles a mix of pre-0.2.0 (legacy) and 0.2.0 run records without crashing, and reports honest split totals", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-bench-cli-"));
  try {
    const skillPath = path.join(dir, "bench-fixture.skill.md");
    await writeFile(skillPath, SKILL_SOURCE, "utf8");

    const runsDir = path.join(dir, ".reelier", "runs");
    await mkdir(runsDir, { recursive: true });
    const runFile = path.join(runsDir, "bench-fixture.jsonl");
    await writeFile(runFile, [JSON.stringify(LEGACY_RECORD), JSON.stringify(NEW_RECORD)].join("\n") + "\n", "utf8");

    const result = await execFileAsync("node", [CLI_PATH, "bench", skillPath], { cwd: dir });

    assert.match(result.stdout, /Bench: bench-fixture/);
    assert.match(result.stdout, /runs:\s+2/);
    // Honest split across BOTH records, derived per-record (legacy record's
    // per-step outcomes, not its old totals.passed=2 rollup):
    // legacy: passed=1, unchecked=1 ; new: passed=1, failed=1
    // => passed=2, unchecked=1, skipped=0, failed=1
    assert.match(result.stdout, /passed=2 unchecked=1 skipped=0 failed=1/);
    // Escalation attempted-vs-healed: the new record's step 2 tried L1 and
    // failed — that must show as an attempt even though it never healed.
    assert.match(result.stdout, /L1 attempted=1 healed=0/);
    assert.match(result.stdout, /L2 attempted=0 healed=0/);
    assert.match(result.stdout, /LLM tokens:\s+30 in \/ 10 out/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
