import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseSkill, SkillParseError, EXPOSURES } from "../src/skill.js";
import { serializeSkill } from "../src/writeback.js";
import { runSkill } from "../src/runner.js";
import type { Tool } from "../src/tools.js";
import { cmdRun } from "../src/cli.js";

/**
 * The `exposure` axis (SPEC §3.7): whether an actor OUTSIDE the system may
 * already have acted on a step's result. Orthogonal to `effect`, which is
 * mechanical — a `destructive` delete and a `destructive` send are the same
 * `effect` and nothing alike in consequence.
 *
 * In this version it is a corpus deposit and a display axis only: it changes
 * NO gating behaviour. The parser half is below; the runner half — including
 * the no-gating pin — is in the second section of this file.
 */

function skillWith(bullets: string, effect = "read"): string {
  return `---
name: exposure-fixture
description: A skill for exercising the exposure axis
---

# Exposure fixture

## Steps

### Step 1 — Only step
- intent: do the thing
- action: http.get {"url": "https://example.com/one"}
- effect: ${effect}
${bullets}`;
}

test("EXPOSURES is exactly the two legal values", () => {
  assert.deepEqual([...EXPOSURES], ["internal", "external-visible"]);
});

for (const value of ["internal", "external-visible"] as const) {
  test(`parses 'exposure: ${value}' onto the step`, () => {
    const skill = parseSkill(skillWith(`- exposure: ${value}\n`));
    assert.equal(skill.steps[0].exposure, value);
  });
}

test("a step with no 'exposure' bullet parses with the field ABSENT, not defaulted", () => {
  const skill = parseSkill(skillWith(""));
  const step = skill.steps[0];
  assert.equal(step.exposure, undefined);
  // Absent, not the string "internal": the default lives at the read site so
  // a record can still tell "the author said internal" from "the author said
  // nothing". `in` is the load-bearing check — `=== undefined` passes either way.
  assert.equal("exposure" in step, false);
});

test("rejects an exposure value outside the closed set, naming both legal values", () => {
  assert.throws(
    () => parseSkill(skillWith("- exposure: whatever\n")),
    (err: unknown) => {
      assert.ok(err instanceof SkillParseError);
      assert.match(err.message, /Invalid exposure "whatever" — must be one of internal, external-visible/);
      return true;
    }
  );
});

test("rejects a duplicate 'exposure' bullet, like every other single-cardinality key", () => {
  assert.throws(
    () => parseSkill(skillWith("- exposure: internal\n- exposure: external-visible\n")),
    (err: unknown) => {
      assert.ok(err instanceof SkillParseError);
      assert.match(err.message, /Duplicate 'exposure' field in step/);
      return true;
    }
  );
});

test("an unknown step key still throws, and the message now lists ten", () => {
  assert.throws(
    () => parseSkill(skillWith("- frobnicate: x\n")),
    (err: unknown) => {
      assert.ok(err instanceof SkillParseError);
      assert.match(
        err.message,
        /Unrecognized step field, expected one of intent\/action\/assert\/bind\/effect\/exposure\/emit\/approve\/attest\/expect/
      );
      return true;
    }
  );
});

test("a skill using 'exposure' round-trips through parseSkill → serializeSkill → parseSkill", () => {
  const source = skillWith("- exposure: external-visible\n", "destructive");
  const skill = parseSkill(source);

  const serialized = serializeSkill(skill);
  assert.match(serialized, /^- exposure: external-visible$/m);

  const reparsed = parseSkill(serialized);
  assert.equal(reparsed.steps[0].exposure, "external-visible");
  assert.equal(serializeSkill(reparsed), serialized);
});

test("a skill WITHOUT 'exposure' serializes byte-identically to before the key existed", () => {
  const skill = parseSkill(skillWith(""));
  const serialized = serializeSkill(skill);
  assert.equal(/^- exposure:/m.test(serialized), false);
  // The full canonical step block, pinned: the new key adds no line, no blank,
  // and no reordering to a skill that does not use it.
  assert.equal(
    serialized,
    `---
name: exposure-fixture
description: A skill for exercising the exposure axis
---

# Exposure fixture

## Steps

### Step 1 — Only step
- intent: do the thing
- action: http.get {"url":"https://example.com/one"}
- effect: read
`
  );
});

// ---------------------------------------------------------------------------
// Runner: the axis reaches the record, and gates nothing.
// ---------------------------------------------------------------------------

/** A read tool that always answers 200 {} — enough to satisfy `status == 200`. */
const okTool: Tool = {
  effect: "read",
  async run() {
    return { status: 200, headers: {}, body: "{}" };
  },
};

/** A write tool, so a `destructive` step has something real to be gated on. */
const writeTool: Tool = {
  effect: "destructive",
  async run() {
    return { status: 200, headers: {}, body: JSON.stringify({ id: "res-1" }) };
  },
};

const TOOLS = { "mock.read": okTool, "mock.send": writeTool };

async function inTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-exposure-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * A two-step skill — one read, one `destructive` send — parameterized ONLY by
 * whether every step carries `- exposure: external-visible`. Everything the
 * runner could gate on (tools, args, asserts, effects) is identical between
 * the two spellings, so any behavioural difference between them is `exposure`
 * and nothing else.
 */
function gatingFixture(exposed: boolean): string {
  const tag = exposed ? "- exposure: external-visible\n" : "";
  return `---
name: notice-flow
description: one read and one destructive send, with and without the exposure axis
---

## Steps

### Step 1 — look something up
- intent: read the record
- action: mock.read {"url": "https://example.com/lookup"}
- assert: status == 200
- effect: read
${tag}
### Step 2 — send the notice
- intent: send a message a human will read
- action: mock.send {"to": "someone@example.com"}
- assert: status == 200
- effect: destructive
${tag}`;
}

test("runner: a step declaring 'exposure' carries it onto the StepRecord", async () => {
  const skill = parseSkill(gatingFixture(true));
  const record = await inTempDir((cwd) =>
    runSkill(skill, { cwd, tools: TOOLS, allowDestructive: true, allowWrites: true })
  );
  assert.deepEqual(
    record.steps.map((s) => s.exposure),
    ["external-visible", "external-visible"]
  );
});

test("runner: a step with no 'exposure' produces a record with the field absent — serialized comparison", async () => {
  const skill = parseSkill(gatingFixture(false));
  const record = await inTempDir((cwd) =>
    runSkill(skill, { cwd, tools: TOOLS, allowDestructive: true, allowWrites: true })
  );

  // The additive guarantee, pinned as a whole-record STRING rather than
  // field-by-field: field-by-field can only catch the key you thought to
  // check, and the claim here is that nothing was added at all. The literal
  // below was captured from a build that predates `exposure` entirely — if it
  // still matches, the record for a skill that does not use the key did not
  // move. Only genuinely per-run values are normalized: durations, the two
  // run timestamps, observation timestamps, and the salted attest commitment
  // (a fresh salt per attest, by design).
  const normalized = JSON.stringify(record, (key, value) => {
    if (key === "ms" || key === "startedAt" || key === "finishedAt" || key === "dispatchedAt" || key === "at") {
      return "<t>";
    }
    if (key === "idempotencyKey" || key === "skillContentSha256" || key === "hash") return "<hash>";
    return value;
  });
  assert.equal(
    normalized,
    '{"skill":"notice-flow","startedAt":"<t>","finishedAt":"<t>",' +
      '"passed":true,' +
      '"steps":[' +
      '{"n":1,"title":"look something up","level":0,"outcome":"passed","ms":"<t>","failures":[]},' +
      '{"n":2,"title":"send the notice","level":0,"outcome":"passed","ms":"<t>","failures":[],' +
      '"write":{"idempotencyKey":"<hash>","approved":false,"resource":{"id":"res-1"}},' +
      '"attest":{"method":"response-derived","post":{"hash":"<hash>","at":"<t>"},"confidence":"partial"}}' +
      "]," +
      '"totals":{"steps":2,"passed":2,"unchecked":0,"skipped":0,"failed":0,"ms":"<t>",' +
      '"llmInputTokens":0,"llmOutputTokens":0}}'
  );
  assert.equal(normalized.includes("exposure"), false);
});

test("runner: exposure changes NO gating behaviour — same exit code, same outcomes, same passed", async () => {
  // The wave's central constraint, made checkable. Both gate settings are
  // exercised: with the destructive step refused, and with it allowed
  // through — so the write gate is in play in both directions.
  for (const allow of [false, true]) {
    const runs = await Promise.all(
      [true, false].map((exposed) =>
        inTempDir((cwd) =>
          runSkill(parseSkill(gatingFixture(exposed)), {
            cwd,
            tools: TOOLS,
            allowDestructive: allow,
            allowWrites: allow,
          })
        )
      )
    );
    const [withExposure, without] = runs;
    const label = `allowDestructive=${allow}`;

    // Exit code, exactly as cmdRun derives it (`record.passed ? 0 : 1`, src/cli.ts).
    assert.equal(withExposure.passed ? 0 : 1, without.passed ? 0 : 1, `${label}: exit code differs`);
    assert.equal(withExposure.passed, without.passed, `${label}: passed differs`);
    assert.deepEqual(
      withExposure.steps.map((s) => s.outcome),
      without.steps.map((s) => s.outcome),
      `${label}: per-step outcome differs`
    );
    assert.deepEqual(
      withExposure.steps.map((s) => s.failures),
      without.steps.map((s) => s.failures),
      `${label}: per-step failures differ`
    );
    // Fixture sanity: the gate really is doing something across the two
    // settings, or "same outcomes" would be a vacuous comparison.
    assert.equal(withExposure.steps[1].outcome, allow ? "passed" : "failed", `${label}: fixture did not exercise the write gate`);
  }
});

test("runner: a SKIPPED step still carries its declared exposure", async () => {
  // The synthetic record built when an earlier step diverged (src/runner.ts) —
  // no dispatch happened, but what the author declared about the step is still
  // true and belongs on the record.
  const skill = parseSkill(`---
name: exposure-skipped
description: step 1 diverges so step 2 is never attempted
---

## Steps

### Step 1 — this one fails
- intent: read something
- action: mock.fail {"url": "https://example.com/boom"}
- assert: status == 200
- effect: read

### Step 2 — never attempted
- intent: send a message a human would read
- action: mock.send {"to": "someone@example.com"}
- assert: status == 200
- effect: destructive
- exposure: external-visible
`);
  const failTool: Tool = {
    effect: "read",
    async run() {
      return { status: 500, headers: {}, body: "" };
    },
  };
  const record = await inTempDir((cwd) =>
    runSkill(skill, { cwd, tools: { ...TOOLS, "mock.fail": failTool }, maxLevel: 0 })
  );
  assert.equal(record.steps[1].outcome, "skipped");
  assert.equal(record.steps[1].exposure, "external-visible");
  // And a skipped step that declared nothing still declares nothing.
  assert.equal("exposure" in record.steps[0], false);
});

test("cli: the step line tags external-visible, and stays silent on internal and absent", async () => {
  // Rendered on a run whose every step fails fast on an unknown tool — no I/O,
  // and the tag is a property of the line, not of the outcome.
  const source = `---
name: exposure-render
description: three steps whose only difference is the exposure axis
---

## Steps

### Step 1 — external step
- intent: send something a human reads
- action: nonexistent_tool {}
- effect: read
- exposure: external-visible

### Step 2 — internal step
- intent: stay inside
- action: nonexistent_tool {}
- effect: read
- exposure: internal

### Step 3 — undeclared step
- intent: say nothing about exposure
- action: nonexistent_tool {}
- effect: read
`;
  const logs = await inTempDir(async (dir) => {
    const skillPath = path.join(dir, "s.skill.md");
    await writeFile(skillPath, source, "utf8");
    const captured: string[] = [];
    const origLog = console.log;
    const origError = console.error;
    console.log = (msg: string) => captured.push(String(msg));
    console.error = () => {};
    try {
      await cmdRun({ positional: [skillPath], flags: new Set<string>(), vars: {}, wraps: [], opts: {}, fails: [] }, undefined, {
        cwd: dir,
      });
    } finally {
      console.log = origLog;
      console.error = origError;
    }
    return captured;
  });

  const stepLines = logs.filter((l) => /^[✓○✗] Step \d/.test(l));
  assert.equal(stepLines.length, 3, `expected three step lines, got:\n${logs.join("\n")}`);
  assert.match(stepLines[0], /\[external-visible\]/);
  // Only external-visible is surfaced: an internal step and an undeclared one
  // render exactly as they did before the axis existed.
  assert.equal(/\[external-visible\]|\[internal\]/.test(stepLines[1]), false, stepLines[1]);
  assert.equal(/\[external-visible\]|\[internal\]/.test(stepLines[2]), false, stepLines[2]);
  // And it is a plain classification — no warning glyph, no severity marker.
  assert.equal(/[!⚠]/.test(stepLines[0]), false, stepLines[0]);
});
