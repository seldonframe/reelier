import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fillTemplate, runSkill } from "../src/runner.js";
import type { Tool } from "../src/tools.js";
import type { Observation } from "../src/assert.js";
import { parseSkill } from "../src/skill.js";

test("fillTemplate replaces {{var}} holes in string values, recursively", () => {
  const filled = fillTemplate(
    { url: "https://example.com/{{slug}}", nested: { q: "{{token}}-suffix" }, list: ["{{slug}}"] },
    { slug: "acme", token: "abc" }
  );
  assert.deepEqual(filled, {
    url: "https://example.com/acme",
    nested: { q: "abc-suffix" },
    list: ["acme"],
  });
});

test("fillTemplate throws on an unbound variable", () => {
  assert.throws(() => fillTemplate({ url: "{{missing}}" }, {}), /Unbound template variable/);
});

// ---------------------------------------------------------------------------
// Computed date template vars: {{today}}, {{today-Nd}}, {{today+Nd}}.
// A fixed `now` is injected in every case below so these tests are never
// wall-clock-flaky.
// ---------------------------------------------------------------------------

const FIXED_NOW = Date.UTC(2026, 6, 18, 12, 0, 0); // 2026-07-18T12:00:00.000Z

test("fillTemplate resolves {{today}} to the current UTC date (YYYY-MM-DD) from the injected clock", () => {
  const filled = fillTemplate({ date: "{{today}}" }, {}, FIXED_NOW);
  assert.deepEqual(filled, { date: "2026-07-18" });
});

test("fillTemplate resolves {{today-Nd}} to N days before the injected clock", () => {
  const filled = fillTemplate({ date: "{{today-7d}}" }, {}, FIXED_NOW);
  assert.deepEqual(filled, { date: "2026-07-11" });
});

test("fillTemplate resolves {{today+Nd}} to N days after the injected clock", () => {
  const filled = fillTemplate({ date: "{{today+10d}}" }, {}, FIXED_NOW);
  assert.deepEqual(filled, { date: "2026-07-28" });
});

test("fillTemplate computed dates cross month/year boundaries correctly", () => {
  const filled = fillTemplate({ date: "{{today-30d}}" }, {}, FIXED_NOW);
  assert.deepEqual(filled, { date: "2026-06-18" });

  const newYear = Date.UTC(2026, 0, 3, 0, 0, 0); // 2026-01-03
  const filled2 = fillTemplate({ date: "{{today-10d}}" }, {}, newYear);
  assert.deepEqual(filled2, { date: "2025-12-24" });
});

test("fillTemplate rejects {{today-0d}} (offset must be >= 1 — use {{today}} for zero)", () => {
  assert.throws(() => fillTemplate({ date: "{{today-0d}}" }, {}, FIXED_NOW), /offset of 0 days/);
});

test("fillTemplate rejects {{today-366d}} (offset too large) with a clear error, not a silent pass", () => {
  assert.throws(() => fillTemplate({ date: "{{today-366d}}" }, {}, FIXED_NOW), /offset of 366 days/);
});

test("fillTemplate rejects {{today+400d}} the same way", () => {
  assert.throws(() => fillTemplate({ date: "{{today+400d}}" }, {}, FIXED_NOW), /offset of 400 days/);
});

test("fillTemplate computed vars work alongside ordinary bindings in the same template", () => {
  const filled = fillTemplate(
    { url: "https://example.com/{{slug}}?since={{today-3d}}" },
    { slug: "acme" },
    FIXED_NOW
  );
  assert.deepEqual(filled, { url: "https://example.com/acme?since=2026-07-15" });
});

test("fillTemplate without an explicit `now` still resolves {{today}} (defaults to the real clock)", () => {
  const filled = fillTemplate({ date: "{{today}}" }, {}) as { date: string };
  assert.match(filled.date, /^\d{4}-\d{2}-\d{2}$/);
});

function mockTool(observations: Observation[]): Tool {
  let i = 0;
  return {
    effect: "read",
    async run() {
      const obs = observations[Math.min(i, observations.length - 1)];
      i++;
      return obs;
    },
  };
}

const SKILL_TWO_STEPS = `---
name: test-two-steps
description: two steps, second depends on a bind from the first
---

### Step 1 — get token
- intent: get a token
- action: mock.tool {"url": "https://example.com/1"}
- assert: status == 200
- bind: token = json.token
- effect: read

### Step 2 — use token
- intent: use the token
- action: mock.tool {"url": "https://example.com/2/{{token}}"}
- assert: status == 200
- effect: read
`;

test("runner: divergence on step 1 marks step 2 as skipped and exits failed", async () => {
  const skill = parseSkill(SKILL_TWO_STEPS);
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-test-"));
  try {
    const record = await runSkill(skill, {
      cwd: dir,
      tools: { "mock.tool": mockTool([{ status: 500, headers: {}, body: "" }]) },
    });
    assert.equal(record.passed, false);
    assert.equal(record.steps[0].outcome, "failed");
    assert.equal(record.steps[1].outcome, "skipped");

    assert.equal(record.totals.passed, 0);
    assert.equal(record.totals.unchecked, 0);
    assert.equal(record.totals.skipped, 1);
    assert.equal(record.totals.failed, 1);

    const raw = await readFile(path.join(dir, ".reelier", "runs", "test-two-steps.jsonl"), "utf8");
    const lines = raw.trim().split("\n");
    assert.equal(lines.length, 1);
    const written = JSON.parse(lines[0]);
    assert.equal(written.passed, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runner: successful run binds step 1's value into step 2's template", async () => {
  const skill = parseSkill(SKILL_TWO_STEPS);
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-test-"));
  const seenUrls: string[] = [];
  try {
    const tool: Tool = {
      effect: "read",
      async run(args) {
        seenUrls.push((args as { url: string }).url);
        if (seenUrls.length === 1) {
          return { status: 200, headers: {}, body: JSON.stringify({ token: "tok-9" }) };
        }
        return { status: 200, headers: {}, body: "{}" };
      },
    };
    const record = await runSkill(skill, { cwd: dir, tools: { "mock.tool": tool } });
    assert.equal(record.passed, true);
    assert.equal(record.totals.passed, 2);
    assert.equal(record.totals.unchecked, 0);
    assert.equal(record.totals.skipped, 0);
    assert.equal(record.totals.failed, 0);
    assert.deepEqual(seenUrls, ["https://example.com/1", "https://example.com/2/tok-9"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

const SKILL_NO_ASSERTS = `---
name: test-unchecked
description: a step with zero assertions
---

### Step 1 — no assertions
- intent: just call it
- action: mock.tool {"url": "https://example.com"}
- effect: read
`;

test("runner: a step with zero assertions is 'unchecked', never 'passed' (honest-success rule)", async () => {
  const skill = parseSkill(SKILL_NO_ASSERTS);
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-test-"));
  try {
    const record = await runSkill(skill, {
      cwd: dir,
      tools: { "mock.tool": mockTool([{ status: 200, headers: {}, body: "" }]) },
    });
    assert.equal(record.steps[0].outcome, "unchecked");
    assert.notEqual(record.steps[0].outcome, "passed");
    // record.passed (the boolean) is still true — zero failed steps — but
    // totals.passed is honest: an unchecked step is never counted as
    // "passed", it gets its own totals.unchecked bucket instead.
    assert.equal(record.passed, true);
    assert.equal(record.totals.passed, 0);
    assert.equal(record.totals.unchecked, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

const SKILL_DESTRUCTIVE = `---
name: test-destructive
description: a destructive step
---

### Step 1 — delete something
- intent: delete a resource
- action: mock.tool {"url": "https://example.com/delete"}
- assert: status == 200
- effect: destructive
`;

test("runner: refuses to execute a destructive step without --yes", async () => {
  const skill = parseSkill(SKILL_DESTRUCTIVE);
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-test-"));
  let called = false;
  try {
    const tool: Tool = {
      effect: "destructive",
      async run() {
        called = true;
        return { status: 200, headers: {}, body: "" };
      },
    };
    const record = await runSkill(skill, { cwd: dir, tools: { "mock.tool": tool }, allowDestructive: false });
    assert.equal(called, false);
    assert.equal(record.passed, false);
    assert.match(record.steps[0].failures[0], /Refusing to execute destructive step/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runner: executes a destructive step when allowDestructive is true", async () => {
  const skill = parseSkill(SKILL_DESTRUCTIVE);
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-test-"));
  let called = false;
  try {
    const tool: Tool = {
      effect: "destructive",
      async run() {
        called = true;
        return { status: 200, headers: {}, body: "" };
      },
    };
    const record = await runSkill(skill, { cwd: dir, tools: { "mock.tool": tool }, allowDestructive: true });
    assert.equal(called, true);
    assert.equal(record.passed, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("date vars: malformed offset forms throw loudly instead of shipping inert literals", () => {
  for (const bad of ["{{today+3}}", "{{today-d}}", "{{today+3x}}", "{{today-}}"]) {
    assert.throws(
      () => fillTemplate({ q: `since ${bad}` }, {}, Date.UTC(2026, 6, 18)),
      /Malformed computed date var/,
      `${bad} should throw`
    );
  }
  // valid forms and today-prefixed ordinary binds still work
  assert.deepEqual(
    fillTemplate({ q: "{{today-7d}}" }, {}, Date.UTC(2026, 6, 18)),
    { q: "2026-07-11" }
  );
  assert.deepEqual(fillTemplate({ q: "{{todays_date}}" }, { todays_date: "x" }, Date.UTC(2026, 6, 18)), { q: "x" });
});
