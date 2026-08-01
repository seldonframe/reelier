import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveStateGateForRun, policyPaths } from "../src/policy.js";
import { runSkill } from "../src/runner.js";
import { parseSkill } from "../src/skill.js";
import { serializeSkill } from "../src/writeback.js";
import type { Tool } from "../src/tools.js";

// ---------------------------------------------------------------------------
// docs/specs/policy-attestation-v1.md §2.4/§2.5/§3 — the RUN path.
//
// A RunRecord is evidence about ONE execution and reports the policy in force
// at THAT execution, always. It never inherits the recording-time policy: a
// skill recorded under policy X and replayed under Y must report Y, or the
// receipt fabricates a claim about the present out of the past.
// ---------------------------------------------------------------------------

async function tmpRepo() {
  const cwd = await mkdtemp(path.join(tmpdir(), "reelier-runpol-cwd-"));
  const home = await mkdtemp(path.join(tmpdir(), "reelier-runpol-home-"));
  return { cwd, home, cleanup: async () => {
    await rm(cwd, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  } };
}

async function writeProjectPolicy(cwd: string, home: string, body: string): Promise<string> {
  const { project } = policyPaths(cwd, home);
  await mkdir(path.dirname(project), { recursive: true });
  await writeFile(project, body, "utf8");
  return project;
}

// --- the resolution carries the claim --------------------------------------

test("run policy: a clean policy resolves `verified` with a digest and a source", async () => {
  const { cwd, home, cleanup } = await tmpRepo();
  try {
    await writeProjectPolicy(cwd, home, 'version: 1\ndeny:\n  - tool: "crm.delete_*"\n');
    const res = await resolveStateGateForRun(cwd, home);
    assert.equal(res.policy.status, "verified");
    assert.match(res.policy.digest!, /^sha256:[0-9a-f]{64}$/);
    assert.equal(res.policy.sourcePath, "project");
  } finally {
    await cleanup();
  }
});

test("run policy: NO rule counts on the run path — replay evaluates no deny/dry_run rule at all", async () => {
  const { cwd, home, cleanup } = await tmpRepo();
  try {
    await writeProjectPolicy(cwd, home, 'version: 1\ndeny:\n  - tool: "a.*"\n  - tool: "b.*"\ndry_run:\n  - tool: "c.*"\n');
    const res = await resolveStateGateForRun(cwd, home);
    assert.equal(res.policy.status, "verified");
    // §2.4: the absence IS the statement. There is no live tool inventory to
    // match against because there is no rule-level enforcement on this path
    // to have coverage of. Reporting counts here would imply the deny list
    // was live during replay. It was not.
    // Checked as key-presence, not property access: `PolicyClaim` has no
    // such properties at all, so this rule is enforced by the type and the
    // runtime check only guards against a cast sneaking one in.
    assert.equal("rules" in res.policy, false);
    assert.equal("unmatchedRules" in res.policy, false);
  } finally {
    await cleanup();
  }
});

test("run policy: no file at either candidate is `absent`", async () => {
  const { cwd, home, cleanup } = await tmpRepo();
  try {
    const res = await resolveStateGateForRun(cwd, home);
    assert.equal(res.policy.status, "absent");
    assert.equal(res.policy.digest, undefined);
    assert.equal(res.policy.sourcePath, undefined);
  } finally {
    await cleanup();
  }
});

test("run policy: an unreadable file is `unchecked`, and the run still proceeds (fail open at the recorder)", async () => {
  const { cwd, home, cleanup } = await tmpRepo();
  try {
    const { project } = policyPaths(cwd, home);
    await mkdir(project, { recursive: true }); // EISDIR
    const res = await resolveStateGateForRun(cwd, home);
    assert.equal(res.mode, "off");
    assert.equal(res.policy.status, "unchecked");
    assert.equal(res.policy.sourcePath, "project");
    assert.equal(res.policy.digest, undefined);
  } finally {
    await cleanup();
  }
});

test("run policy: a malformed file with no state_gate key is `failed` and still carries a digest", async () => {
  const { cwd, home, cleanup } = await tmpRepo();
  try {
    await writeProjectPolicy(cwd, home, "  bad: indent\n");
    const res = await resolveStateGateForRun(cwd, home);
    assert.equal(res.mode, "off");
    assert.equal(res.policy.status, "failed");
    assert.match(res.policy.digest!, /^sha256:[0-9a-f]{64}$/);
  } finally {
    await cleanup();
  }
});

test("run policy: a valid state_gate opt-in is `verified` (the gate is ON and the file parsed)", async () => {
  const { cwd, home, cleanup } = await tmpRepo();
  try {
    await writeProjectPolicy(cwd, home, "version: 1\nstate_gate: refuse\n");
    const res = await resolveStateGateForRun(cwd, home);
    assert.equal(res.mode, "refuse");
    assert.equal(res.policy.status, "verified");
    assert.match(res.policy.digest!, /^sha256:[0-9a-f]{64}$/);
  } finally {
    await cleanup();
  }
});

// --- the record ------------------------------------------------------------

const TRIVIAL_SKILL = `---
name: pol-run
description: one read step, so the record is about the policy and nothing else
---

### Step 1 — ping
- intent: ping
- action: mock.tool {"v": "1"}
- assert: status == 200
- effect: read
`;

function echoTool(): Record<string, Tool> {
  const tool: Tool = {
    effect: "read",
    async run(args) {
      return { status: 200, headers: {}, body: JSON.stringify(args) };
    },
  };
  return { "mock.tool": tool };
}

test("RunRecord.policy: reports the RUN-TIME policy, and never rules/unmatchedRules", async () => {
  const { cwd, home, cleanup } = await tmpRepo();
  try {
    await writeProjectPolicy(cwd, home, 'version: 1\ndeny:\n  - tool: "x.*"\n');
    const res = await resolveStateGateForRun(cwd, home);
    const skill = parseSkill(TRIVIAL_SKILL);

    const record = await runSkill(skill, {
      cwd,
      tools: echoTool(),
      dryRun: true,
      maxLevel: 0,
      policy: res.policy,
    });

    assert.equal(record.policy?.status, "verified");
    assert.equal(record.policy?.sourcePath, "project");
    assert.equal("rules" in record.policy!, false);
    assert.equal("unmatchedRules" in record.policy!, false);
  } finally {
    await cleanup();
  }
});

test("RunRecord.policy: omitted entirely when the caller passes none — pre-policy records stay byte-identical", async () => {
  const { cwd, cleanup } = await tmpRepo();
  try {
    const skill = parseSkill(TRIVIAL_SKILL);
    const record = await runSkill(skill, { cwd, tools: echoTool(), dryRun: true, maxLevel: 0 });

    assert.equal("policy" in record, false);
    // Absence means "this caller reported nothing" — never `absent`, which is
    // a positive finding that a lookup happened and found no file.
    assert.equal(record.policy, undefined);
  } finally {
    await cleanup();
  }
});

test("RunRecord.policy: a replay under a DIFFERENT policy reports the replay's, never the recording's", async () => {
  const { cwd, home, cleanup } = await tmpRepo();
  try {
    // The trap (§3). The skill is the one artifact that travels between the
    // recording and the replay, and it carries no policy field at all — so
    // there is nothing for a replay to inherit even by accident. Checked on
    // the parsed object AND on the serialized bytes, because either alone
    // would miss a field that survives only one of the two.
    const parsed = parseSkill(TRIVIAL_SKILL) as unknown as Record<string, unknown>;
    assert.equal("policy" in parsed, false, "a parsed skill must carry no policy field");
    for (const step of parsed.steps as Array<Record<string, unknown>>) {
      assert.equal("policy" in step, false, "a skill step must carry no policy field");
    }
    assert.doesNotMatch(serializeSkill(parseSkill(TRIVIAL_SKILL)), /^\s*-?\s*policy:/m, "serialized bytes must carry no policy key");

    await writeProjectPolicy(cwd, home, "version: 1\nstate_gate: refuse\n");
    const res = await resolveStateGateForRun(cwd, home);
    const record = await runSkill(parseSkill(TRIVIAL_SKILL), {
      cwd,
      tools: echoTool(),
      dryRun: true,
      maxLevel: 0,
      policy: res.policy,
    });

    // This run's own file, hashed at this run's load — not whatever governed
    // whatever session first produced the skill.
    const expectedDigest = res.policy.digest;
    assert.equal(record.policy?.digest, expectedDigest);
    assert.equal(record.policy?.status, "verified");
  } finally {
    await cleanup();
  }
});
