// `StepWrite.approvalHash` — the join key FOUNDATION's ten-year asset #1
// already names and the record did not carry.
//
// Asset #1 is "what an agent DECLARED it would change (scope, approval hash)
// joined to what ACTUALLY changed (observed delta) and to WHO was answerable".
// The observed side shipped long ago; `approved: boolean` said only THAT a
// write executed under some approval, never WHICH one. Without the hash the
// pairs cannot be grouped by authorization after the fact, and every receipt
// written without it is a pair that cannot be reconstructed later.
//
// Additive only (I-11), and no new exposure: the hash is already in the
// committed skill file. The claim is exactly as earned as `approved` is —
// both are read off the same verified equality, which is why they are minted
// from ONE argument rather than two that could disagree.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseSkill } from "../src/skill.js";
import { runSkill } from "../src/runner.js";
import { computeApprovalHash } from "../src/approval.js";
import type { Tool } from "../src/tools.js";

const BODY = `### Step 1 — write something
- intent: write it
- action: put_page {"slug": "demo", "content": "# hi"}
- assert: status == 200
- effect: idempotent-write
`;

function skill(approveLine?: string): string {
  return `---
name: write-approval-hash-fixture
description: one idempotent-write step
---

${BODY}${approveLine !== undefined ? `- approve: ${approveLine}\n` : ""}`;
}

/** The hash `reelier approve` would stamp for this exact step. */
function stampedHash(): string {
  const s = parseSkill(skill());
  const step = s.steps[0];
  return computeApprovalHash({
    actionTool: step.actionTool,
    actionArgs: step.actionArgs,
    attest: step.attest,
    expect: step.expect,
  });
}

function tools() {
  const calls: unknown[] = [];
  const reg: Record<string, Tool> = {
    put_page: {
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
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-ahash-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("a write executed under a matching approve: hash records WHICH approval authorized it", async () => {
  await withTempDir(async (dir) => {
    const hash = stampedHash();
    const { reg, calls } = tools();
    const record = await runSkill(parseSkill(skill(hash)), { tools: reg, vars: {}, cwd: dir });
    assert.equal(calls.length, 1, "the write dispatched under the approval, no flag needed");
    const write = record.steps[0].write!;
    assert.equal(write.approved, true);
    assert.equal(write.approvalHash, hash, "the join key is the hash the gate actually verified");
  });
});

test("a write executed on the legacy flag path records NO approvalHash — there was no approval to name", async () => {
  await withTempDir(async (dir) => {
    const { reg, calls } = tools();
    const record = await runSkill(parseSkill(skill()), { tools: reg, vars: {}, cwd: dir, allowWrites: true });
    assert.equal(calls.length, 1);
    const write = record.steps[0].write!;
    assert.equal(write.approved, false);
    assert.ok(
      !("approvalHash" in write),
      "absent, not null or empty — a --allow-writes dispatch has no authorization to point at",
    );
  });
});

test("the unapproved write record is byte-identical to the pre-change shape", async () => {
  await withTempDir(async (dir) => {
    const { reg } = tools();
    const record = await runSkill(parseSkill(skill()), { tools: reg, vars: {}, cwd: dir, allowWrites: true });
    // No `resource` (the stub body carries no id/version), so this is the
    // complete key set a legacy receipt has always had.
    assert.deepEqual(Object.keys(record.steps[0].write!).sort(), ["approved", "idempotencyKey"]);
  });
});

test("`approved` and `approvalHash` can never disagree — they are minted from one value", async () => {
  await withTempDir(async (dir) => {
    for (const approveLine of [stampedHash(), undefined]) {
      const { reg } = tools();
      const record = await runSkill(parseSkill(skill(approveLine)), {
        tools: reg,
        vars: {},
        cwd: dir,
        allowWrites: true,
      });
      const write = record.steps[0].write!;
      assert.equal(
        write.approved,
        write.approvalHash !== undefined,
        `approved=${write.approved} but approvalHash=${String(write.approvalHash)} — a record that claims an approval it cannot name, or names one it does not claim`,
      );
    }
  });
});
