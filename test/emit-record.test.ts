// `StepRecord.emit` (docs/specs/artifact-attestation-v1.md §6) and the
// coverage gate (§7): the artifact commitment is computed AFTER the args are
// filled and BEFORE dispatch, and a declared coverage list that did not
// resolve is a first-class outcome rather than a silently narrower claim.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseSkill } from "../src/skill.js";
import { runSkill } from "../src/runner.js";
import { computeApprovalHash } from "../src/approval.js";
import { artifactDigest, projectArtifact } from "../src/artifact.js";
import type { Tool } from "../src/tools.js";

function skill(opts: { emit?: string; approve?: string } = {}): string {
  return `---
name: emit-record-fixture
description: a templated send
---

### Step 1 — send a message
- intent: send it
- action: send_email {"to": "{{recipient}}", "subject": "Q3 update", "body": "{{draft}}"}
- assert: status == 200
- effect: idempotent-write
${opts.emit !== undefined ? `- emit: ${opts.emit}\n` : ""}${opts.approve !== undefined ? `- approve: ${opts.approve}\n` : ""}`;
}

const COVERS_ALL = `{"projection":["args.to","args.subject","args.body"]}`;
/** Declares a field the filled args never carry — §3.1's server-side-render shape. */
const COVERS_MISSING = `{"projection":["args.to","args.attachment_id"]}`;

const VARS = { recipient: "ops@example.com", draft: "the rendered body" };

function stampedHash(src: string): string {
  const step = parseSkill(src).steps[0];
  return computeApprovalHash({
    actionTool: step.actionTool,
    actionArgs: step.actionArgs,
    attest: step.attest,
    expect: step.expect,
    emit: step.emit,
  });
}

function tools() {
  const calls: unknown[] = [];
  const reg: Record<string, Tool> = {
    send_email: {
      effect: "idempotent-write",
      run: async (args) => {
        calls.push(args);
        return { status: 200, headers: {}, body: "{}" };
      },
    },
  };
  return { reg, calls };
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-emit-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * The repo-level opt-in as `runSkill` actually receives it: the CLI resolves
 * `.reelier/policy.yml` and passes the result down (src/runner.ts). The
 * file-resolution half is covered by test/state-gate.test.ts; these tests
 * exercise the gate itself.
 */
const GATE = { stateGate: "refuse" } as const;

// ---------------------------------------------------------------------------
// The record block
// ---------------------------------------------------------------------------

test("an emit-bearing write records a digest a third party can recompute from the filled args", async () => {
  await withTempDir(async (dir) => {
    const src = skill({ emit: COVERS_ALL });
    const { reg, calls } = tools();
    const record = await runSkill(parseSkill(src), { tools: reg, vars: VARS, cwd: dir, allowWrites: true });

    const emit = record.steps[0].emit!;
    assert.ok(emit, "an emit-bearing dispatched write carries the block");
    // §5.1: unsalted and recomputable — the whole point of the join key.
    const recomputed = artifactDigest(
      "send_email",
      projectArtifact(calls[0], ["args.to", "args.subject", "args.body"])
    );
    assert.equal(emit.artifactDigest, recomputed);
  });
});

test("the record carries the declared projection verbatim and in order", async () => {
  await withTempDir(async (dir) => {
    const { reg } = tools();
    const record = await runSkill(parseSkill(skill({ emit: COVERS_ALL })), {
      tools: reg, vars: VARS, cwd: dir, allowWrites: true,
    });
    assert.deepEqual(record.steps[0].emit!.projection, ["args.to", "args.subject", "args.body"]);
  });
});

test("resolved and unresolved partition the declared projection", async () => {
  await withTempDir(async (dir) => {
    const { reg } = tools();
    const record = await runSkill(parseSkill(skill({ emit: COVERS_MISSING })), {
      tools: reg, vars: VARS, cwd: dir, allowWrites: true,
    });
    const emit = record.steps[0].emit!;
    assert.deepEqual(emit.resolved, ["args.to"]);
    assert.deepEqual(emit.unresolved, ["args.attachment_id"]);
  });
});

test("unresolved is OMITTED when everything resolved — never an empty array", async () => {
  await withTempDir(async (dir) => {
    const { reg } = tools();
    const record = await runSkill(parseSkill(skill({ emit: COVERS_ALL })), {
      tools: reg, vars: VARS, cwd: dir, allowWrites: true,
    });
    assert.ok(!("unresolved" in record.steps[0].emit!), "omitted, never []");
  });
});

test("a declared field the args never carried stays visible instead of quietly shrinking the claim", async () => {
  // §5.3 / §3.1: this is the mechanism that keeps server-side rendering,
  // reference fields and two-call composition from reading as full coverage.
  await withTempDir(async (dir) => {
    const { reg } = tools();
    const record = await runSkill(parseSkill(skill({ emit: COVERS_MISSING })), {
      tools: reg, vars: VARS, cwd: dir, allowWrites: true,
    });
    assert.deepEqual(record.steps[0].emit!.unresolved, ["args.attachment_id"]);
  });
});

test("emit.approvalHash names the approval on the approved path and is absent on the flag path", async () => {
  await withTempDir(async (dir) => {
    const src = skill({ emit: COVERS_ALL });
    const hash = stampedHash(src);
    const { reg } = tools();
    const approved = await runSkill(parseSkill(skill({ emit: COVERS_ALL, approve: hash })), {
      tools: reg, vars: VARS, cwd: dir,
    });
    assert.equal(approved.steps[0].emit!.approvalHash, hash);

    const flagged = await runSkill(parseSkill(src), { tools: tools().reg, vars: VARS, cwd: dir, allowWrites: true });
    assert.ok(
      !("approvalHash" in flagged.steps[0].emit!),
      "absent exactly when write.approved is false — a flag dispatch has no authorization to name",
    );
  });
});

test("a step that declares no emit: produces no emit block at all", async () => {
  await withTempDir(async (dir) => {
    const { reg } = tools();
    const record = await runSkill(parseSkill(skill()), { tools: reg, vars: VARS, cwd: dir, allowWrites: true });
    assert.equal(record.steps[0].emit, undefined);
  });
});

test("a hand-authored emit step whose effective tool effect is read is refused, never silently unrecorded", async () => {
  await withTempDir(async (dir) => {
    const parsed = parseSkill(skill({ emit: COVERS_ALL }));
    delete (parsed.steps[0] as unknown as { effect?: unknown }).effect;
    let calls = 0;
    const readTool: Tool = {
      effect: "read",
      run: async () => {
        calls += 1;
        return { status: 200, headers: {}, body: "{}" };
      },
    };
    const record = await runSkill(parsed, { tools: { send_email: readTool }, vars: VARS, cwd: dir });
    assert.equal(calls, 0);
    assert.equal(record.steps[0].outcome, "failed");
    assert.match(record.steps[0].failures.join(" "), /emit.*non-write|non-write.*emit/i);
    assert.equal(record.steps[0].emit, undefined);
  });
});

test("a tool throw after dispatch preserves the emission commitment — the side effect may have landed", async () => {
  await withTempDir(async (dir) => {
    const calls: unknown[] = [];
    const throwing: Tool = {
      effect: "idempotent-write",
      run: async (args) => {
        calls.push(args);
        throw new Error("response lost after provider accepted the call");
      },
    };
    const record = await runSkill(parseSkill(skill({ emit: COVERS_ALL })), {
      tools: { send_email: throwing },
      vars: VARS,
      cwd: dir,
      allowWrites: true,
    });
    assert.equal(calls.length, 1, "tool.run was invoked: dispatch happened even though the result threw");
    assert.equal(record.steps[0].outcome, "failed");
    assert.ok(record.steps[0].emit, "the record must not erase an artifact that may have left");
    assert.equal(
      record.steps[0].emit?.artifactDigest,
      artifactDigest("send_email", projectArtifact(calls[0], ["args.to", "args.subject", "args.body"])),
    );
  });
});

// ---------------------------------------------------------------------------
// The gate (§7) — refuse, never downgrade
// ---------------------------------------------------------------------------

test("recorder mode stamps unresolved coverage and STILL dispatches — the recorder never blocks", async () => {
  await withTempDir(async (dir) => {
    const { reg, calls } = tools();
    const record = await runSkill(parseSkill(skill({ emit: COVERS_MISSING })), {
      tools: reg, vars: VARS, cwd: dir, allowWrites: true,
    });
    assert.equal(calls.length, 1, "no policy opt-in — recorder mode dispatches");
    assert.deepEqual(record.steps[0].emit!.unresolved, ["args.attachment_id"]);
    assert.equal(record.steps[0].outcome, "passed", "a finding never flips the outcome in recorder mode");
  });
});

test("under state_gate: refuse, unresolved coverage refuses BEFORE dispatch", async () => {
  await withTempDir(async (dir) => {
    const { reg, calls } = tools();
    const record = await runSkill(parseSkill(skill({ emit: COVERS_MISSING })), {
      tools: reg, vars: VARS, cwd: dir, allowWrites: true, ...GATE,
    });
    assert.equal(calls.length, 0, "the call never went out");
    const step = record.steps[0];
    assert.equal(step.outcome, "failed");
    assert.match(step.failures.join(" "), /args\.attachment_id/, "the refusal names what did not resolve");
    // The proof dispatch never issued — same discipline the state gate uses.
    assert.equal(step.write, undefined, "no write block");
    assert.equal(step.attest, undefined, "no attest");
    assert.equal(step.emit, undefined, "no emission commitment for a call that never left");
  });
});

test("fully-resolved coverage proceeds untouched under the gate", async () => {
  await withTempDir(async (dir) => {
    const { reg, calls } = tools();
    const record = await runSkill(parseSkill(skill({ emit: COVERS_ALL })), {
      tools: reg, vars: VARS, cwd: dir, allowWrites: true, ...GATE,
    });
    assert.equal(calls.length, 1);
    assert.equal(record.steps[0].outcome, "passed");
    assert.ok(record.steps[0].emit!.artifactDigest);
  });
});

test("no flag overrides the coverage refusal", async () => {
  await withTempDir(async (dir) => {
    const { reg, calls } = tools();
    const record = await runSkill(parseSkill(skill({ emit: COVERS_MISSING })), {
      tools: reg, vars: VARS, cwd: dir, allowWrites: true, allowDestructive: true, ...GATE,
    });
    assert.equal(calls.length, 0, "--allow-writes/--yes are not consulted at a gate refusal");
    assert.equal(record.steps[0].outcome, "failed");
  });
});

test("a repo with no emit: anywhere is byte-identical under the gate to without it", async () => {
  await withTempDir(async (dir) => {
    const { reg, calls } = tools();
    const record = await runSkill(parseSkill(skill()), { tools: reg, vars: VARS, cwd: dir, allowWrites: true, ...GATE });
    assert.equal(calls.length, 1, "the gate gates declarations, not writes in general");
    assert.equal(record.steps[0].outcome, "passed");
  });
});
