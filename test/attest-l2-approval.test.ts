// Fix-wave F1 (final-review S1/S4): attemptEscalation's L2 approval gate must
// recompute the hash with the step's `attest:` bound in — otherwise an
// approved+attested step can NEVER heal at L2 (the stamped hash embeds attest,
// the recomputation didn't), and the receipt records a fabricated
// "template changed" reason for a byte-identical template.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runSkill } from "../src/runner.js";
import { parseSkill } from "../src/skill.js";
import { computeApprovalHash } from "../src/approval.js";
import { digestSha256 } from "../src/canonical-json.js";
import type { Tool } from "../src/tools.js";
import type { Observation } from "../src/assert.js";
import type { LlmClient, LlmCallInput, LlmCallResult } from "../src/llm.js";

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

const BODY = `---
name: attest-l2-approval
description: approved+attested write step that diverges then reaches L2
---

### Step 1 — update the thing
- intent: update it
- action: mock.tool {"url":"https://example.com/write"}
- assert: json.flag == true
- attest: {"tool":"mock.read","args":{"id":"x1"},"projection":["etag"]}
- effect: idempotent-write
`;

/** Skill text with a CURRENT approve: hash stamped exactly as cmdApprove would (attest bound in). */
function approvedSkillSource(): string {
  const s = parseSkill(BODY).steps[0];
  const hash = computeApprovalHash({ actionTool: s.actionTool, actionArgs: s.actionArgs, attest: s.attest, expect: s.expect });
  return `${BODY}- approve: ${hash}\n`;
}

function tools(onWrite: () => Observation): { tools: Record<string, Tool>; writeCalls: () => number } {
  let writes = 0;
  return {
    tools: {
      "mock.tool": {
        effect: "idempotent-write",
        async run(): Promise<Observation> {
          writes++;
          return onWrite();
        },
      },
      "mock.read": {
        effect: "read",
        async run(): Promise<Observation> {
          return { status: 200, headers: {}, body: JSON.stringify({ etag: "e1" }) };
        },
      },
    },
    writeCalls: () => writes,
  };
}

test("F1: an approved+attested write step heals at L2 when the patched template is byte-identical to the approved one", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-attest-l2-"));
  const skillPath = path.join(dir, "s.skill.md");
  try {
    const source = approvedSkillSource();
    await writeFile(skillPath, source, "utf8");
    const skill = parseSkill(source);

    const { llm, calls } = spyLlm([
      { json: { verdict: "real-failure", reason: "L1 has nothing to patch" }, usage: { inputTokens: 10, outputTokens: 5 } },
      {
        json: {
          verdict: "patch",
          asserts: ["json.flag == false"],
          binds: [],
          // No `args` — the candidate template is the step's OWN unchanged
          // template, which the human approved. This must match at L2.
          reason: "flag semantics were inverted",
        },
        usage: { inputTokens: 30, outputTokens: 10 },
      },
    ]);

    const w = tools(() => ({ status: 200, headers: {}, body: JSON.stringify({ flag: false }) }));
    const record = await runSkill(skill, { cwd: dir, tools: w.tools, maxLevel: 2, llm, skillPath });

    assert.equal(record.steps[0].outcome, "passed", `expected L2 heal, failures: ${record.steps[0].failures.join(" | ")}`);
    assert.equal(record.steps[0].level, 2);
    assert.equal(w.writeCalls(), 2, "main dispatch + exactly one L2 re-execution");
    assert.equal(calls.length, 2, "L1 then L2");
    assert.ok(
      !record.steps[0].failures.some((f) => /Approval mismatch/.test(f)),
      "no fabricated approval-mismatch reason may be recorded"
    );
    assert.equal(record.steps[0].write?.approved, true);
    // The L2 gate proved l2ExpectedHash === step.approve before dispatch, so
    // the healed re-execution ran under the SAME human approval and the
    // receipt must name it. Without this, a mutation recording a different
    // string at the L2 buildStepWrite call site survives the whole suite.
    assert.equal(record.steps[0].write?.approvalHash, parseSkill(source).steps[0].approve);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("pinning: stale legacy approve: (no attest bound) on an attested write step fails closed at BOTH the main gate and the L2 gate, with zero write/probe dispatches (S4-Direction-B)", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-attest-l2-"));
  const skillPath = path.join(dir, "s.skill.md");
  try {
    const parsed = parseSkill(BODY).steps[0];
    // STALE legacy hash: computed the OLD way (no attest bound in), even
    // though this step HAS an attest: block. A human approved this step
    // BEFORE the attest field existed (or before F1's fix), and the skill
    // was never re-approved since — cmdApprove today would stamp a
    // DIFFERENT hash (computeApprovalHash binds attest in). This is exactly
    // the stale-approval shape final-review flagged as S4-Direction-B: the
    // main-path mock-failure branch returns before ever reaching the
    // approve gate, so if the L2 gate didn't ALSO re-check the hash, a
    // stale approval could slip a write through via the escalation ladder.
    const staleLegacyHash = digestSha256({ args: parsed.actionArgs, tool: parsed.actionTool });
    const source = `${BODY}- approve: ${staleLegacyHash}\n`;
    await writeFile(skillPath, source, "utf8");
    const skill = parseSkill(source);

    const { llm, calls } = spyLlm([
      { json: { verdict: "real-failure", reason: "L1 has nothing to patch" }, usage: { inputTokens: 10, outputTokens: 5 } },
      {
        json: {
          verdict: "patch",
          asserts: ["json.flag == true"],
          binds: [],
          // No `args` — L2's candidate template is the step's OWN unchanged
          // template. Even so, the hash must be recomputed WITH attest
          // bound in (current rules), so it can never match the stale
          // legacy hash above.
          reason: "looked fine, retry as-is",
        },
        usage: { inputTokens: 30, outputTokens: 10 },
      },
    ]);

    let writeCalls = 0;
    let probeCalls = 0;
    const tools: Record<string, Tool> = {
      "mock.tool": {
        effect: "idempotent-write",
        async run(): Promise<Observation> {
          writeCalls++;
          return { status: 200, headers: {}, body: JSON.stringify({ flag: true }) };
        },
      },
      "mock.read": {
        effect: "read",
        async run(): Promise<Observation> {
          probeCalls++;
          return { status: 200, headers: {}, body: JSON.stringify({ etag: "e1" }) };
        },
      },
    };

    const record = await runSkill(skill, {
      cwd: dir,
      tools,
      mockFailures: { 1: 500 },
      maxLevel: 2,
      llm,
      skillPath,
    });

    assert.equal(record.passed, false);
    assert.equal(record.steps[0].outcome, "failed");
    assert.equal(record.steps[0].level, 0);
    assert.equal(calls.length, 2, "L1 then L2 were both consulted");
    assert.equal(writeCalls, 0, "the write tool must never dispatch — main path was mocked, L2 gate refused before re-executing");
    assert.equal(probeCalls, 0, "the declared probe must never dispatch — it only fires around a real write dispatch, which never happened");
    assert.match(record.steps[0].failures.join("\n"), /Approval mismatch on L2-patched write step/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("F1: an approved+attested write step whose L2 patch CHANGES the args template still refuses with the mismatch message", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-attest-l2-"));
  const skillPath = path.join(dir, "s.skill.md");
  try {
    const source = approvedSkillSource();
    await writeFile(skillPath, source, "utf8");
    const skill = parseSkill(source);

    const { llm } = spyLlm([
      { json: { verdict: "real-failure", reason: "L1 has nothing to patch" }, usage: { inputTokens: 10, outputTokens: 5 } },
      {
        json: {
          verdict: "patch",
          asserts: ["json.flag == false"],
          binds: [],
          args: { url: "https://example.com/write-v2" }, // DIFFERENT from the approved template
          reason: "endpoint moved",
        },
        usage: { inputTokens: 30, outputTokens: 10 },
      },
    ]);

    const w = tools(() => ({ status: 200, headers: {}, body: JSON.stringify({ flag: false }) }));
    const record = await runSkill(skill, { cwd: dir, tools: w.tools, maxLevel: 2, llm, skillPath });

    assert.equal(record.passed, false);
    assert.equal(record.steps[0].level, 0);
    assert.equal(w.writeCalls(), 1, "L2 must never re-execute on a genuine template change");
    assert.match(record.steps[0].failures.join("\n"), /Approval mismatch on L2-patched write step/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
