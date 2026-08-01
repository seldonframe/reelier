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
// Additive only (I-11). Disclosure: this is an UNSALTED hash and a
// deliberate cross-run/cross-tenant correlator; it adds no new exposure CLASS
// only because `idempotencyKey` beside it already hashes the FILLED args.
// The claim is exactly as earned as `approved` is —
// both are read off the same verified equality, which is why they are minted
// from ONE argument rather than two that could disagree.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
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

/** Two identical write steps — the second is a duplicateOf the first. */
function TWO_STEP_SAME_WRITE(approveLine: string): string {
  const step = (n: number) => `### Step ${n} — write something
- intent: write it
- action: put_page {"slug": "demo", "content": "# hi"}
- assert: status == 200
- effect: idempotent-write
${approveLine !== "" ? `- approve: ${approveLine}
` : ""}`;
  return `---
name: write-approval-hash-dup
description: two identical write steps
---

${step(1)}
${step(2)}`;
}

/** The hash `reelier approve` would stamp for this exact step. */
function stampedHash(): string {
  const s = parseSkill(skill());
  const step = s.steps[0];
  return computeApprovalHash({ emit: undefined,
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
    await runSkill(parseSkill(skill()), { tools: reg, vars: {}, cwd: dir, allowWrites: true });
    // Review finding: the first version of this test called Object.keys().sort(),
    // which discards the one property the title claims. Insertion ORDER is what
    // determines the appended JSONL bytes, so read the ledger line the runner
    // actually wrote and compare the serialized substring literally.
    const ledger = await readFile(path.join(dir, ".reelier", "runs", "write-approval-hash-fixture.jsonl"), "utf8");
    const line = ledger.trim().split("\n").at(-1)!;
    const write = JSON.parse(line).steps[0].write;
    assert.deepEqual(Object.keys(write), ["idempotencyKey", "approved"], "key ORDER, not just the key set");
    assert.ok(
      line.includes(`"write":{"idempotencyKey":"${write.idempotencyKey}","approved":false}`),
      `legacy write block is not byte-identical in the serialized ledger: ${line}`,
    );
    assert.ok(!line.includes("approvalHash"), "the field must not appear at all on the flag path");
  });
});

test("approvalHash coexists with resource and duplicateOf without disturbing them", async () => {
  await withTempDir(async (dir) => {
    // The only shapes where the spread ordering in buildStepWrite is
    // observable, and the duplicateOf re-spread at the run loop.
    const hash = (): string => {
      const s = parseSkill(TWO_STEP_SAME_WRITE(""));
      const step = s.steps[0];
      return computeApprovalHash({ emit: undefined,
        actionTool: step.actionTool,
        actionArgs: step.actionArgs,
        attest: step.attest,
        expect: step.expect,
      });
    };
    const h = hash();
    const reg: Record<string, Tool> = {
      put_page: {
        effect: "idempotent-write",
        run: async () => ({ status: 200, headers: {}, body: JSON.stringify({ id: "abc", version: "v2" }) }),
      },
    };
    const record = await runSkill(parseSkill(TWO_STEP_SAME_WRITE(h)), { tools: reg, vars: {}, cwd: dir });
    const first = record.steps[0].write!;
    assert.equal(first.approvalHash, h);
    assert.deepEqual(first.resource, { id: "abc", version: "v2" }, "resource survives alongside the new field");
    const second = record.steps[1].write!;
    assert.equal(second.approvalHash, h, "the duplicateOf re-spread preserves the join key");
    assert.equal(second.duplicateOf, 1);
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
