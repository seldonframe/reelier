import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fillTemplate, runSkill } from "../src/runner.js";
import type { Tool } from "../src/tools.js";
import type { Observation } from "../src/assert.js";
import { parseSkill } from "../src/skill.js";
import { computeApprovalHash, computeIdempotencyKey } from "../src/approval.js";
import type { LlmClient, LlmCallInput, LlmCallResult } from "../src/llm.js";
import { cmdRun, type ParsedArgs } from "../src/cli.js";

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

test("runner: stamps options.skillContentSha256 verbatim onto the RunRecord when provided", async () => {
  const skill = parseSkill(SKILL_TWO_STEPS);
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-test-"));
  try {
    const record = await runSkill(skill, {
      cwd: dir,
      tools: { "mock.tool": mockTool([{ status: 200, headers: {}, body: JSON.stringify({ token: "t" }) }]) },
      skillContentSha256: "a".repeat(64),
    });
    assert.equal(record.skillContentSha256, "a".repeat(64));

    const raw = await readFile(path.join(dir, ".reelier", "runs", "test-two-steps.jsonl"), "utf8");
    const written = JSON.parse(raw.trim().split("\n")[0]);
    assert.equal(written.skillContentSha256, "a".repeat(64));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runner: skillContentSha256 is absent (not fabricated) when the caller doesn't pass it", async () => {
  const skill = parseSkill(SKILL_TWO_STEPS);
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-test-"));
  try {
    const record = await runSkill(skill, {
      cwd: dir,
      tools: { "mock.tool": mockTool([{ status: 200, headers: {}, body: JSON.stringify({ token: "t" }) }]) },
    });
    assert.equal(record.skillContentSha256, undefined);
    assert.ok(!("skillContentSha256" in record));
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

// ---------------------------------------------------------------------------
// Task 7: the approval gate replaces the blanket --allow-writes/--yes flags
// as the FINAL boundary on a write step. Spec: flight-recorder-v2.md §2.
// ---------------------------------------------------------------------------

const WRITE_ACTION_ARGS = { url: "https://example.com/write" };
const DESTRUCTIVE_ACTION_ARGS = { url: "https://example.com/delete" };

const WRITE_APPROVE_HASH = computeApprovalHash({ actionTool: "mock.tool", actionArgs: WRITE_ACTION_ARGS, attest: undefined });
const DESTRUCTIVE_APPROVE_HASH = computeApprovalHash({ actionTool: "mock.tool", actionArgs: DESTRUCTIVE_ACTION_ARGS, attest: undefined });
const WRONG_HASH = `sha256:${"0".repeat(64)}`;

function skillWithApprove(effect: "idempotent-write" | "destructive", approveLine?: string): string {
  const args = effect === "destructive" ? DESTRUCTIVE_ACTION_ARGS : WRITE_ACTION_ARGS;
  return `---
name: test-approval-gate
description: exercises the approval gate
---

### Step 1 — write it
- intent: perform the write
- action: mock.tool ${JSON.stringify(args)}
- assert: status == 200
- effect: ${effect}
${approveLine !== undefined ? `- approve: ${approveLine}\n` : ""}`;
}

function callCountingTool(status = 200): { tool: Tool; calls: () => number } {
  let calls = 0;
  const tool: Tool = {
    effect: "read",
    async run() {
      calls++;
      return { status, headers: {}, body: "" };
    },
  };
  return { tool, calls: () => calls };
}

test("approval gate: approved+match executes a WRITE step with NO flags at all", async () => {
  const skill = parseSkill(skillWithApprove("idempotent-write", WRITE_APPROVE_HASH));
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-test-"));
  const { tool, calls } = callCountingTool();
  try {
    const record = await runSkill(skill, { cwd: dir, tools: { "mock.tool": tool } }); // no allowWrites/allowDestructive
    assert.equal(calls(), 1);
    assert.equal(record.passed, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("approval gate: approved+match executes a DESTRUCTIVE step with NO flags at all", async () => {
  const skill = parseSkill(skillWithApprove("destructive", DESTRUCTIVE_APPROVE_HASH));
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-test-"));
  const { tool, calls } = callCountingTool();
  try {
    const record = await runSkill(skill, { cwd: dir, tools: { "mock.tool": tool } });
    assert.equal(calls(), 1);
    assert.equal(record.passed, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("approval gate: approved+MISMATCH fails closed on a write step even WITH --allow-writes AND --yes", async () => {
  const skill = parseSkill(skillWithApprove("idempotent-write", WRONG_HASH));
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-test-"));
  const { tool, calls } = callCountingTool();
  try {
    const record = await runSkill(skill, {
      cwd: dir,
      tools: { "mock.tool": tool },
      allowWrites: true,
      allowDestructive: true,
    });
    assert.equal(calls(), 0, "the fake tool must NEVER be called on an approval mismatch");
    assert.equal(record.passed, false);
    assert.match(record.steps[0].failures[0], /Approval mismatch/);
    assert.match(record.steps[0].failures[0], /reelier approve/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("approval gate: approved+MISMATCH fails closed on a destructive step even WITH --allow-writes AND --yes", async () => {
  const skill = parseSkill(skillWithApprove("destructive", WRONG_HASH));
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-test-"));
  const { tool, calls } = callCountingTool();
  try {
    const record = await runSkill(skill, {
      cwd: dir,
      tools: { "mock.tool": tool },
      allowWrites: true,
      allowDestructive: true,
    });
    assert.equal(calls(), 0, "the fake tool must NEVER be called on an approval mismatch");
    assert.equal(record.passed, false);
    assert.match(record.steps[0].failures[0], /Approval mismatch/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("approval gate: no approve field on a write step keeps today's EXACT refusal message, no flags", async () => {
  const skill = parseSkill(skillWithApprove("idempotent-write"));
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-test-"));
  const { tool, calls } = callCountingTool();
  try {
    const record = await runSkill(skill, { cwd: dir, tools: { "mock.tool": tool } });
    assert.equal(calls(), 0);
    assert.equal(record.passed, false);
    assert.match(
      record.steps[0].failures[0],
      /Refusing to execute a write step \(effect: idempotent-write\) — replay is read-only by default\. Pass --allow-writes to execute it\./
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("approval gate: no approve field on a write step executes normally with --allow-writes (legacy path unchanged)", async () => {
  const skill = parseSkill(skillWithApprove("idempotent-write"));
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-test-"));
  const { tool, calls } = callCountingTool();
  try {
    const record = await runSkill(skill, { cwd: dir, tools: { "mock.tool": tool }, allowWrites: true });
    assert.equal(calls(), 1);
    assert.equal(record.passed, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("approval gate: no approve field on a destructive step keeps today's EXACT refusal message", async () => {
  const skill = parseSkill(skillWithApprove("destructive"));
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-test-"));
  const { tool, calls } = callCountingTool();
  try {
    const record = await runSkill(skill, { cwd: dir, tools: { "mock.tool": tool } });
    assert.equal(calls(), 0);
    assert.equal(record.passed, false);
    assert.match(record.steps[0].failures[0], /Refusing to execute destructive step without --yes\./);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Task 8: the write receipt — StepRecord.write (idempotency key, approved,
// resource, duplicateOf). Spec: flight-recorder-v2.md §2.
// ---------------------------------------------------------------------------

function spyLlm(responses: LlmCallResult[]): { llm: LlmClient; calls: LlmCallInput[] } {
  const calls: LlmCallInput[] = [];
  let i = 0;
  const llm: LlmClient = {
    async completeJson(input) {
      calls.push(input);
      const r = responses[Math.min(i, responses.length - 1)];
      i++;
      return r;
    },
  };
  return { llm, calls };
}

test("write receipt: an executed write step gets a stable idempotencyKey matching computeIdempotencyKey", async () => {
  const skill = parseSkill(skillWithApprove("idempotent-write", WRITE_APPROVE_HASH));
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-test-"));
  try {
    const record = await runSkill(skill, {
      cwd: dir,
      tools: { "mock.tool": { effect: "read", async run() { return { status: 200, headers: {}, body: "" }; } } },
    });
    const expected = computeIdempotencyKey("mock.tool", null, WRITE_ACTION_ARGS);
    assert.equal(record.steps[0].write?.idempotencyKey, expected);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("write receipt: approved is true when executed via the approve hash, false when via the legacy flag", async () => {
  const dirA = await mkdtemp(path.join(tmpdir(), "reelier-test-"));
  const dirB = await mkdtemp(path.join(tmpdir(), "reelier-test-"));
  try {
    const approvedSkill = parseSkill(skillWithApprove("idempotent-write", WRITE_APPROVE_HASH));
    const recA = await runSkill(approvedSkill, {
      cwd: dirA,
      tools: { "mock.tool": { effect: "read", async run() { return { status: 200, headers: {}, body: "" }; } } },
    });
    assert.equal(recA.steps[0].write?.approved, true);

    const legacySkill = parseSkill(skillWithApprove("idempotent-write"));
    const recB = await runSkill(legacySkill, {
      cwd: dirB,
      tools: { "mock.tool": { effect: "read", async run() { return { status: 200, headers: {}, body: "" }; } } },
      allowWrites: true,
    });
    assert.equal(recB.steps[0].write?.approved, false);
  } finally {
    await rm(dirA, { recursive: true, force: true });
    await rm(dirB, { recursive: true, force: true });
  }
});

test("write receipt: resource is extracted from a JSON body's id/version-ish fields", async () => {
  const skill = parseSkill(skillWithApprove("idempotent-write", WRITE_APPROVE_HASH));
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-test-"));
  try {
    const record = await runSkill(skill, {
      cwd: dir,
      tools: {
        "mock.tool": {
          effect: "read",
          async run() {
            return { status: 200, headers: {}, body: JSON.stringify({ id: "c_123", etag: 7 }) };
          },
        },
      },
    });
    assert.deepEqual(record.steps[0].write?.resource, { id: "c_123", version: "7" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("write receipt: resource is omitted (not fabricated) when the body isn't JSON or has neither field", async () => {
  const dirA = await mkdtemp(path.join(tmpdir(), "reelier-test-"));
  const dirB = await mkdtemp(path.join(tmpdir(), "reelier-test-"));
  try {
    const skillA = parseSkill(skillWithApprove("idempotent-write", WRITE_APPROVE_HASH));
    const recA = await runSkill(skillA, {
      cwd: dirA,
      tools: { "mock.tool": { effect: "read", async run() { return { status: 200, headers: {}, body: "not json at all" }; } } },
    });
    assert.equal(recA.steps[0].write?.resource, undefined);
    assert.ok(!("resource" in (recA.steps[0].write ?? {})));

    const skillB = parseSkill(skillWithApprove("idempotent-write", WRITE_APPROVE_HASH));
    const recB = await runSkill(skillB, {
      cwd: dirB,
      tools: { "mock.tool": { effect: "read", async run() { return { status: 200, headers: {}, body: JSON.stringify({ ok: true }) }; } } },
    });
    assert.equal(recB.steps[0].write?.resource, undefined);
  } finally {
    await rm(dirA, { recursive: true, force: true });
    await rm(dirB, { recursive: true, force: true });
  }
});

const SKILL_DUPLICATE_WRITES = `---
name: test-duplicate-writes
description: two steps that dispatch the identical write twice in one run
---

### Step 1 — write it
- intent: write it
- action: mock.tool {"url": "https://example.com/write"}
- assert: status == 200
- effect: idempotent-write

### Step 2 — write the same thing again
- intent: write it again (e.g. a retried skill)
- action: mock.tool {"url": "https://example.com/write"}
- assert: status == 200
- effect: idempotent-write
`;

test("write receipt: a second step with the identical idempotency key is flagged duplicateOf the first, not failed", async () => {
  const skill = parseSkill(SKILL_DUPLICATE_WRITES);
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-test-"));
  try {
    const record = await runSkill(skill, {
      cwd: dir,
      tools: { "mock.tool": { effect: "read", async run() { return { status: 200, headers: {}, body: "" }; } } },
      allowWrites: true,
    });
    assert.equal(record.passed, true);
    assert.equal(record.steps[0].write?.duplicateOf, undefined);
    assert.equal(record.steps[1].write?.duplicateOf, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

const SKILL_WRITE_HEAL_L2 = `---
name: heal-write-with-l2
description: a write step whose endpoint moved, healed at L2
---

### Step 1 — create a contact
- intent: create a contact
- action: mock.tool {"url": "https://example.com/v1/contacts"}
- assert: status == 200
- effect: idempotent-write
`;

test("write receipt: an L2-healed write step carries a fresh write block (from the re-executed call)", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-test-"));
  const skillPath = path.join(dir, "heal-write-with-l2.skill.md");
  try {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(skillPath, SKILL_WRITE_HEAL_L2, "utf8");
    const skill = parseSkill(SKILL_WRITE_HEAL_L2);

    const { llm } = spyLlm([
      { json: { verdict: "real-failure", reason: "L1 has nothing to patch, the endpoint itself moved" }, usage: { inputTokens: 10, outputTokens: 5 } },
      {
        json: {
          verdict: "patch",
          asserts: ["status == 200"],
          binds: [],
          args: { url: "https://example.com/v2/contacts" },
          reason: "endpoint moved from v1 to v2",
        },
        usage: { inputTokens: 200, outputTokens: 50 },
      },
    ]);

    const tool: Tool = {
      effect: "idempotent-write",
      async run(args): Promise<Observation> {
        const url = (args as { url: string }).url;
        if (url === "https://example.com/v2/contacts") {
          return { status: 200, headers: {}, body: JSON.stringify({ id: "c_9" }) };
        }
        return { status: 404, headers: {}, body: "not found" };
      },
    };

    const record = await runSkill(skill, {
      cwd: dir,
      tools: { "mock.tool": tool },
      maxLevel: 2,
      allowWrites: true,
      llm,
      skillPath,
    });

    assert.equal(record.passed, true);
    assert.equal(record.steps[0].level, 2);
    assert.equal(record.steps[0].write?.approved, false);
    assert.deepEqual(record.steps[0].write?.resource, { id: "c_9" });
    assert.equal(
      record.steps[0].write?.idempotencyKey,
      computeIdempotencyKey("mock.tool", null, { url: "https://example.com/v2/contacts" })
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Adversarial-review fix wave (fr2-slice2-review.md, findings #1/#2/#3/#4):
// L2 re-execution must re-check approval before dispatching a write whose
// args the LLM patched away from the approved template. Spec §2: "patched
// args that leave the approved template → the write is NOT re-executed at
// L2." Only a matching template (or an unapproved legacy step) may execute.
// ---------------------------------------------------------------------------

const L2_APPROVE_ARGS = { url: "https://example.com/contacts" };
const L2_APPROVE_HASH = computeApprovalHash({ actionTool: "mock.tool", actionArgs: L2_APPROVE_ARGS, attest: undefined });

function skillApprovedWriteForL2(): string {
  return `---
name: approved-write-l2
description: an approved write step that diverges then reaches L2
---

### Step 1 — create a contact
- intent: create a contact
- action: mock.tool ${JSON.stringify(L2_APPROVE_ARGS)}
- assert: json.flag == true
- effect: idempotent-write
- approve: ${L2_APPROVE_HASH}
`;
}

test("L2 approval gate: an approved step whose L2 patch changes ARGS is refused — tool never re-dispatched, no lying write", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-test-"));
  const skillPath = path.join(dir, "approved-write-l2.skill.md");
  try {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(skillPath, skillApprovedWriteForL2(), "utf8");
    const skill = parseSkill(skillApprovedWriteForL2());

    const { llm } = spyLlm([
      { json: { verdict: "real-failure", reason: "L1 has nothing to patch" }, usage: { inputTokens: 10, outputTokens: 5 } },
      {
        json: {
          verdict: "patch",
          asserts: ["json.flag == true"],
          binds: [],
          args: { url: "https://example.com/contacts-v2" }, // DIFFERENT from the approved template
          reason: "endpoint moved",
        },
        usage: { inputTokens: 50, outputTokens: 20 },
      },
    ]);

    let calls = 0;
    const tool: Tool = {
      effect: "idempotent-write",
      async run(): Promise<Observation> {
        calls++;
        return { status: 200, headers: {}, body: JSON.stringify({ flag: false }) };
      },
    };

    const record = await runSkill(skill, { cwd: dir, tools: { "mock.tool": tool }, maxLevel: 2, llm, skillPath });

    assert.equal(calls, 1, "only the main-path dispatch happened — L2 must never re-execute on an approval mismatch");
    assert.equal(record.passed, false);
    assert.equal(record.steps[0].level, 0);
    assert.match(record.steps[0].failures.join("\n"), /Approval mismatch on L2-patched write step/);
    assert.match(record.steps[0].failures.join("\n"), /was NOT re-executed/);
    // The write block, if present, is the TRUE main-path receipt (real dispatch,
    // real approval match against the ORIGINAL template) — never a fabricated
    // L2 one, and never lying about approval.
    assert.equal(record.steps[0].write?.approved, true);
    assert.equal(
      record.steps[0].write?.idempotencyKey,
      computeIdempotencyKey("mock.tool", null, L2_APPROVE_ARGS)
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("L2 approval gate: an approved step whose L2 patch touches only asserts/binds (args unchanged) executes normally, write.approved stays true", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-test-"));
  const skillPath = path.join(dir, "approved-write-l2.skill.md");
  try {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(skillPath, skillApprovedWriteForL2(), "utf8");
    const skill = parseSkill(skillApprovedWriteForL2());

    const { llm } = spyLlm([
      { json: { verdict: "real-failure", reason: "L1 has nothing to patch" }, usage: { inputTokens: 10, outputTokens: 5 } },
      {
        json: {
          verdict: "patch",
          asserts: ["json.flag == false"],
          binds: [],
          // No `args` field at all — the LLM only patched asserts, so the
          // candidate template is the step's OWN unchanged template, which
          // trivially still matches the approval.
          reason: "flag semantics were inverted",
        },
        usage: { inputTokens: 30, outputTokens: 10 },
      },
    ]);

    let calls = 0;
    const tool: Tool = {
      effect: "idempotent-write",
      async run(): Promise<Observation> {
        calls++;
        return { status: 200, headers: {}, body: JSON.stringify({ flag: false, id: "c_1" }) };
      },
    };

    const record = await runSkill(skill, { cwd: dir, tools: { "mock.tool": tool }, maxLevel: 2, llm, skillPath });

    assert.equal(calls, 2, "main-path dispatch + exactly one L2 re-execution");
    assert.equal(record.passed, true);
    assert.equal(record.steps[0].level, 2);
    assert.equal(record.steps[0].write?.approved, true);
    assert.deepEqual(record.steps[0].write?.resource, { id: "c_1" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("L2 approval gate: an UNAPPROVED step (legacy --allow-writes) still re-executes at L2 with patched args, unchanged", async () => {
  const skillPath0 = path.join(await mkdtemp(path.join(tmpdir(), "reelier-test-")), "unused");
  const dir = path.dirname(skillPath0);
  const skillPath = path.join(dir, "heal-write-with-l2-legacy.skill.md");
  try {
    const { writeFile } = await import("node:fs/promises");
    const source = `---
name: heal-write-with-l2-legacy
description: an unapproved write step healed at L2 (legacy flag path)
---

### Step 1 — create a contact
- intent: create a contact
- action: mock.tool {"url": "https://example.com/v1/contacts"}
- assert: status == 200
- effect: idempotent-write
`;
    await writeFile(skillPath, source, "utf8");
    const skill = parseSkill(source);

    const { llm } = spyLlm([
      { json: { verdict: "real-failure", reason: "L1 has nothing to patch, the endpoint itself moved" }, usage: { inputTokens: 10, outputTokens: 5 } },
      {
        json: {
          verdict: "patch",
          asserts: ["status == 200"],
          binds: [],
          args: { url: "https://example.com/v2/contacts" },
          reason: "endpoint moved from v1 to v2",
        },
        usage: { inputTokens: 200, outputTokens: 50 },
      },
    ]);

    let calls = 0;
    const tool: Tool = {
      effect: "idempotent-write",
      async run(args): Promise<Observation> {
        calls++;
        const url = (args as { url: string }).url;
        if (url === "https://example.com/v2/contacts") {
          return { status: 200, headers: {}, body: "{}" };
        }
        return { status: 404, headers: {}, body: "not found" };
      },
    };

    const record = await runSkill(skill, {
      cwd: dir,
      tools: { "mock.tool": tool },
      maxLevel: 2,
      allowWrites: true,
      llm,
      skillPath,
    });

    assert.equal(calls, 2, "no approve field -> no approval check at L2, legacy flag path executes as before");
    assert.equal(record.passed, true);
    assert.equal(record.steps[0].level, 2);
    assert.equal(record.steps[0].write?.approved, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("write receipt: an intra-step double write (main dispatch + L2 re-dispatch with the SAME idempotency key) is flagged duplicateOf, not silently discarded", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-test-"));
  const skillPath = path.join(dir, "double-write.skill.md");
  try {
    const { writeFile } = await import("node:fs/promises");
    const source = `---
name: double-write
description: main-path write + an L2 re-execution against the SAME args
---

### Step 1 — write it
- intent: write it
- action: mock.tool {"url": "https://example.com/write"}
- assert: json.flag == true
- effect: idempotent-write
`;
    await writeFile(skillPath, source, "utf8");
    const skill = parseSkill(source);

    const { llm } = spyLlm([
      { json: { verdict: "real-failure", reason: "L1 has nothing to patch" }, usage: { inputTokens: 10, outputTokens: 5 } },
      {
        json: {
          verdict: "patch",
          asserts: ["json.flag == false"],
          binds: [],
          // Same args template (no `args` field) — the re-dispatch hits the
          // exact same URL, so its idempotency key matches the main-path
          // attempt's exactly.
          reason: "flag semantics were inverted",
        },
        usage: { inputTokens: 30, outputTokens: 10 },
      },
    ]);

    const tool: Tool = {
      effect: "idempotent-write",
      async run(): Promise<Observation> {
        return { status: 200, headers: {}, body: JSON.stringify({ flag: false }) };
      },
    };

    const record = await runSkill(skill, {
      cwd: dir,
      tools: { "mock.tool": tool },
      maxLevel: 2,
      allowWrites: true,
      llm,
      skillPath,
    });

    assert.equal(record.passed, true);
    assert.equal(record.steps[0].level, 2);
    // The main-path write registered this step's own idempotency key BEFORE
    // escalation ran; the L2 re-dispatch's identical key is honestly flagged
    // as a duplicate of that earlier (same-step) attempt, rather than
    // silently discarding the fact that TWO real writes happened.
    assert.equal(record.steps[0].write?.duplicateOf, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Task 10: --fail N[=status] mocked-failure replay through the real
// escalation ladder. Spec: flight-recorder-v2.md §3.
// ---------------------------------------------------------------------------

const SKILL_MOCK_SINGLE = `---
name: test-mock-single
description: one read step, mockable
---

### Step 1 — get a thing
- intent: fetch a thing
- action: mock.tool {"url": "https://example.com/thing"}
- assert: status == 200
- effect: read
`;

test("mock failure: a mocked step never dispatches the real tool", async () => {
  const skill = parseSkill(SKILL_MOCK_SINGLE);
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-test-"));
  let called = false;
  try {
    const tool: Tool = {
      effect: "read",
      async run() {
        called = true;
        return { status: 200, headers: {}, body: "" };
      },
    };
    const record = await runSkill(skill, {
      cwd: dir,
      tools: { "mock.tool": tool },
      mockFailures: { 1: 500 },
    });
    assert.equal(called, false, "the real tool must never be called for a mocked step");
    assert.equal(record.passed, false);
    assert.equal(record.steps[0].mocked, true);
    assert.match(record.steps[0].failures[0], /status/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("mock failure: defaults to injected status 500 when no override given", async () => {
  const skill = parseSkill(SKILL_MOCK_SINGLE);
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-test-"));
  try {
    const record = await runSkill(skill, {
      cwd: dir,
      tools: { "mock.tool": mockTool([{ status: 200, headers: {}, body: "" }]) },
      mockFailures: { 1: 500 },
    });
    assert.equal(record.steps[0].outcome, "failed");
    assert.equal(record.steps[0].mocked, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("mock failure: an explicit override status is honored (e.g. 429)", async () => {
  const skill = parseSkill(`---
name: test-mock-status
description: asserts a specific injected status
---

### Step 1 — get a thing
- intent: fetch a thing
- action: mock.tool {"url": "https://example.com/thing"}
- assert: status == 429
- effect: read
`);
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-test-"));
  try {
    const record = await runSkill(skill, {
      cwd: dir,
      tools: { "mock.tool": mockTool([{ status: 200, headers: {}, body: "" }]) },
      mockFailures: { 1: 429 },
    });
    // The synthetic observation's status is 429, matching the assert -> passes.
    assert.equal(record.steps[0].outcome, "passed");
    assert.equal(record.steps[0].mocked, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("mock failure: an unmocked step in the same run is completely unaffected", async () => {
  const skill = parseSkill(SKILL_TWO_STEPS);
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-test-"));
  try {
    const record = await runSkill(skill, {
      cwd: dir,
      tools: {
        "mock.tool": {
          effect: "read",
          async run() {
            return { status: 200, headers: {}, body: JSON.stringify({ token: "tok-9" }) };
          },
        },
      },
      mockFailures: { 1: 500 },
    });
    assert.equal(record.steps[0].mocked, true);
    assert.equal(record.steps[0].outcome, "failed");
    assert.equal(record.steps[1].outcome, "skipped");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("mock failure: RunRecord.mockFailures carries the sorted step numbers; absent when none injected", async () => {
  const skill = parseSkill(SKILL_MOCK_SINGLE);
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-test-"));
  try {
    const record = await runSkill(skill, {
      cwd: dir,
      tools: { "mock.tool": mockTool([{ status: 200, headers: {}, body: "" }]) },
      mockFailures: { 1: 500 },
    });
    assert.deepEqual(record.mockFailures, [1]);

    const dir2 = await mkdtemp(path.join(tmpdir(), "reelier-test-"));
    try {
      const record2 = await runSkill(skill, {
        cwd: dir2,
        tools: { "mock.tool": mockTool([{ status: 200, headers: {}, body: "" }]) },
      });
      assert.equal(record2.mockFailures, undefined);
      assert.ok(!("mockFailures" in record2));
    } finally {
      await rm(dir2, { recursive: true, force: true });
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("mock failure: a mocked write step never gets a write receipt (no dispatch happened)", async () => {
  const skill = parseSkill(skillWithApprove("idempotent-write", WRITE_APPROVE_HASH));
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-test-"));
  let called = false;
  try {
    const record = await runSkill(skill, {
      cwd: dir,
      tools: {
        "mock.tool": {
          effect: "read",
          async run() {
            called = true;
            return { status: 200, headers: {}, body: "" };
          },
        },
      },
      mockFailures: { 1: 500 },
    });
    assert.equal(called, false);
    assert.equal(record.steps[0].write, undefined);
    assert.equal(record.steps[0].mocked, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("mock failure: a mocked write step's real gates (approval/allow-writes) are never consulted — no flags needed to recovery-test it", async () => {
  // No `approve:` and no allowWrites — under real execution this step would
  // refuse outright. Under --fail it still runs (mocked), proving the gate
  // is bypassed entirely for a mocked dispatch.
  const skill = parseSkill(skillWithApprove("idempotent-write"));
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-test-"));
  try {
    const record = await runSkill(skill, {
      cwd: dir,
      tools: { "mock.tool": { effect: "read", async run() { return { status: 200, headers: {}, body: "" }; } } },
      mockFailures: { 1: 500 },
    });
    assert.equal(record.steps[0].mocked, true);
    assert.equal(record.steps[0].outcome, "failed");
    // The failure must be the injected-observation assert failure, NOT the
    // "Refusing to execute a write step" gate message.
    assert.doesNotMatch(record.steps[0].failures[0], /Refusing to execute/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("mock failure: a mocked failure flows into the REAL escalation ladder and can be healed at L1", async () => {
  const skill = parseSkill(SKILL_MOCK_SINGLE);
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-test-"));
  try {
    const { llm } = spyLlm([
      {
        json: { verdict: "patch", asserts: ["status == 500"], binds: [], reason: "injected failure is expected here" },
        usage: { inputTokens: 10, outputTokens: 5 },
      },
    ]);
    const record = await runSkill(skill, {
      cwd: dir,
      tools: { "mock.tool": mockTool([{ status: 200, headers: {}, body: "" }]) },
      mockFailures: { 1: 500 },
      maxLevel: 1,
      llm,
    });
    assert.equal(record.passed, true);
    assert.equal(record.steps[0].level, 1);
    assert.equal(record.steps[0].mocked, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Task 10 (CLI): cmdRun's --fail N[=status] flag parsing/validation, plus
// its "MOCK RUN" banner and per-step "INJECTED" onStep line.
// ---------------------------------------------------------------------------

function fakeArgs(positional: string[], fails: string[] = []): ParsedArgs {
  return { positional, flags: new Set(), vars: {}, wraps: [], opts: {}, fails };
}

async function withCapturedConsole<T>(fn: () => Promise<T>): Promise<{ result: T; logs: string[]; errs: string[] }> {
  const logs: string[] = [];
  const errs: string[] = [];
  const origLog = console.log;
  const origError = console.error;
  console.log = (msg: string) => logs.push(msg);
  console.error = (msg: string) => errs.push(msg);
  try {
    const result = await fn();
    return { result, logs, errs };
  } finally {
    console.log = origLog;
    console.error = origError;
  }
}

test("cmdRun: --fail with a non-numeric step is rejected with a usage error, exit 1 (no file needed)", async () => {
  const { result, errs } = await withCapturedConsole(() => cmdRun(fakeArgs(["/nonexistent/does-not-matter.skill.md"], ["x"])));
  assert.equal(result, 1);
  assert.ok(errs.some((l) => /--fail/.test(l)));
});

test("cmdRun: --fail 3=oops (non-numeric status) is rejected with a usage error, exit 1", async () => {
  const { result, errs } = await withCapturedConsole(() => cmdRun(fakeArgs(["/nonexistent/does-not-matter.skill.md"], ["3=oops"])));
  assert.equal(result, 1);
  assert.ok(errs.some((l) => /--fail/.test(l)));
});

const SKILL_MOCK_HTTP = `---
name: test-mock-http-get
description: single read step against the builtin http.get tool
---

### Step 1 — get a thing
- intent: fetch a thing
- action: http.get {"url": "https://example.invalid/thing"}
- assert: status == 200
- effect: read
`;

test("cmdRun: --fail 1 prints the MOCK RUN banner and an INJECTED line, and never dispatches the real tool", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-test-"));
  const skillPath = path.join(dir, "s.skill.md");
  try {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(skillPath, SKILL_MOCK_HTTP, "utf8");
    const { result, logs } = await withCapturedConsole(() => cmdRun(fakeArgs([skillPath], ["1"])));
    assert.equal(result, 1); // default injected status 500 fails the `status == 200` assert
    assert.ok(logs.some((l) => /MOCK RUN — injected failures at step\(s\): 1/.test(l)));
    assert.ok(logs.some((l) => /⚡ INJECTED failure \(--fail 1\)/.test(l)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cmdRun: --fail 1=429 honors the explicit override status", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-test-"));
  const skillPath = path.join(dir, "s.skill.md");
  try {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      skillPath,
      `---
name: test-mock-http-status
description: single read step asserting a specific injected status
---

### Step 1 — get a thing
- intent: fetch a thing
- action: http.get {"url": "https://example.invalid/thing"}
- assert: status == 429
- effect: read
`,
      "utf8"
    );
    const { result } = await withCapturedConsole(() => cmdRun(fakeArgs([skillPath], ["1=429"])));
    assert.equal(result, 0);
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
