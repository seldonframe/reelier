import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { cmdApprove, type ParsedArgs } from "../src/cli.js";

// Exercises cmdApprove's advisory note for write steps missing an `attest:`
// declaration. Harness copied verbatim from test/approve-cli.test.ts
// (temp dir + writeFile + fakeArgs + captureConsole, --all to avoid
// interactivity).

const SKILL_ONE_WITH_ONE_WITHOUT_ATTEST = `---
name: attest-approve-advisory
description: one write step with attest, one without
---

### Step 1 — create a contact
- intent: create a contact
- action: create_contact {"email": "a@example.com"}
- assert: status == 200
- effect: idempotent-write
- attest: {"tool":"get_contact","args":{"email":"a@example.com"},"projection":["status"]}

### Step 2 — delete the account
- intent: delete it
- action: delete_account {"id": "acc_1"}
- assert: status == 200
- effect: destructive
`;

function fakeArgs(positional: string[], flags: string[] = []): ParsedArgs {
  return { positional, flags: new Set(flags), vars: {}, wraps: [], opts: {}, fails: [] };
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-attest-advisory-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function captureConsole<T>(fn: () => Promise<T>): Promise<{ result: T; logs: string[] }> {
  const logs: string[] = [];
  const origLog = console.log;
  console.log = (msg: string) => logs.push(String(msg));
  try {
    const result = await fn();
    return { result, logs };
  } finally {
    console.log = origLog;
  }
}

test("cmdApprove --all: prints the attest advisory only on the write step lacking an attest: declaration", async () => {
  await withTempDir(async (dir) => {
    const skillPath = path.join(dir, "s.skill.md");
    await writeFile(skillPath, SKILL_ONE_WITH_ONE_WITHOUT_ATTEST, "utf8");
    const { result: code, logs } = await captureConsole(() => cmdApprove(fakeArgs([skillPath], ["all"])));
    assert.equal(code, 0);

    // Split the captured log lines into per-step blocks, keyed by the
    // "Step N — title" header line each step prints.
    const step1Start = logs.findIndex((l) => /^Step 1 —/.test(l));
    const step2Start = logs.findIndex((l) => /^Step 2 —/.test(l));
    assert.ok(step1Start !== -1 && step2Start !== -1, "expected both step headers in output");
    const step1Block = logs.slice(step1Start, step2Start);
    const step2Block = logs.slice(step2Start);

    const advisoryLines = logs.filter((l) => /no 'attest:' declared/.test(l));
    assert.equal(advisoryLines.length, 1, "advisory must appear exactly once across the whole run");

    assert.ok(
      !step1Block.some((l) => /no 'attest:' declared/.test(l)),
      "step 1 (has attest:) must NOT get the advisory"
    );
    assert.ok(
      step2Block.some((l) => /no 'attest:' declared/.test(l)),
      "step 2 (no attest:) must get the advisory"
    );
  });
});
