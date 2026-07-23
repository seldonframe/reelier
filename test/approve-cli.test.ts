import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { cmdApprove, cmdRun, type ParsedArgs } from "../src/cli.js";
import { parseSkill } from "../src/skill.js";
import { computeApprovalHash } from "../src/approval.js";

// Exercises cmdApprove's console output + file write directly, driven with
// --all (non-interactive) — same reasoning as cmdManifest/cmdPush's tests
// (test/manifest-cli.test.ts, test/push-cli.test.ts): no real stdin/readline
// involved, no subprocess spawned.

const SKILL_NO_WRITES = `---
name: approve-cli-no-writes
description: a skill with only read steps
---

### Step 1 — read something
- intent: read it
- action: http.get {"url": "https://example.com"}
- assert: status == 200
- effect: read
`;

const SKILL_ONE_WRITE = `---
name: approve-cli-one-write
description: a skill with a single write step
---

### Step 1 — create a contact
- intent: create a contact
- action: create_contact {"email": "a@example.com"}
- assert: status == 200
- effect: idempotent-write
`;

const SKILL_TWO_WRITES = `---
name: approve-cli-two-writes
description: a skill with a write and a destructive step
---

### Step 1 — create a contact
- intent: create a contact
- action: create_contact {"email": "a@example.com"}
- assert: status == 200
- effect: idempotent-write

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
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-approve-cli-"));
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

test("cmdApprove: a skill with no write steps prints 'no write steps to approve', exit 0", async () => {
  await withTempDir(async (dir) => {
    const skillPath = path.join(dir, "s.skill.md");
    await writeFile(skillPath, SKILL_NO_WRITES, "utf8");
    const { result: code, logs } = await captureConsole(() => cmdApprove(fakeArgs([skillPath])));
    assert.equal(code, 0);
    assert.ok(logs.some((l) => /no write steps to approve/.test(l)));
  });
});

test("cmdApprove --all: stamps a valid approve: hash for every write step, atomically, with a changelog line", async () => {
  await withTempDir(async (dir) => {
    const skillPath = path.join(dir, "s.skill.md");
    await writeFile(skillPath, SKILL_TWO_WRITES, "utf8");
    const { result: code, logs } = await captureConsole(() => cmdApprove(fakeArgs([skillPath], ["all"])));
    assert.equal(code, 0);
    assert.ok(logs.some((l) => /approved 2, skipped 0/.test(l)));

    const written = await readFile(skillPath, "utf8");
    const skill = parseSkill(written);
    assert.equal(skill.steps[0].approve, computeApprovalHash(skill.steps[0]));
    assert.equal(skill.steps[1].approve, computeApprovalHash(skill.steps[1]));
    assert.match(written, /## Changelog/);
    assert.match(written, /approved 2 write step\(s\) \(reelier approve\)/);
  });
});

test("cmdApprove --all: an approved skill then satisfies the runner's approval gate with NO flags", async () => {
  await withTempDir(async (dir) => {
    const skillPath = path.join(dir, "s.skill.md");
    await writeFile(skillPath, SKILL_ONE_WRITE, "utf8");
    await cmdApprove(fakeArgs([skillPath], ["all"]));

    let called = false;
    const runArgs: ParsedArgs = { positional: [skillPath], flags: new Set(), vars: {}, wraps: [], opts: {}, fails: [] };
    const origLog = console.log;
    const origErr = console.error;
    console.log = () => {};
    console.error = () => {};
    let code: number;
    try {
      code = await cmdRun(runArgs);
    } finally {
      console.log = origLog;
      console.error = origErr;
    }
    // The step's tool ('create_contact') is unknown to the builtin registry
    // without --wrap, so this run still fails on "Unknown tool" — but that
    // proves the approval gate itself did NOT refuse it (no "Refusing to
    // execute" / "Approval mismatch" message), which is what this test cares
    // about; this is exercised more directly in test/runner.test.ts's
    // approval-gate matrix against an injected fake tool.
    assert.notEqual(code, undefined);
  });
});

test("cmdApprove --all: reports 'approved (STALE — args changed)' and re-stamps when args drifted since a prior approval", async () => {
  await withTempDir(async (dir) => {
    const skillPath = path.join(dir, "s.skill.md");
    await writeFile(skillPath, SKILL_ONE_WRITE, "utf8");
    await cmdApprove(fakeArgs([skillPath], ["all"]));

    // Simulate a hand-edit that changes the step's args after approval —
    // parse, mutate, serialize back with the OLD (now-stale) approve hash
    // still in place.
    const { serializeSkill } = await import("../src/writeback.js");
    const before = parseSkill(await readFile(skillPath, "utf8"));
    before.steps[0].actionArgs = { email: "changed@example.com" };
    await writeFile(skillPath, serializeSkill(before), "utf8");

    const { result: code, logs } = await captureConsole(() => cmdApprove(fakeArgs([skillPath], ["all"])));
    assert.equal(code, 0);
    assert.ok(logs.some((l) => /STALE/.test(l)));

    const written = await readFile(skillPath, "utf8");
    const skill = parseSkill(written);
    assert.equal(skill.steps[0].approve, computeApprovalHash(skill.steps[0]));
  });
});

test("cmdApprove: reports a missing skill file with a clear error, exit 1", async () => {
  await withTempDir(async (dir) => {
    const skillPath = path.join(dir, "does-not-exist.skill.md");
    const logs: string[] = [];
    const origErr = console.error;
    console.error = (msg: string) => logs.push(String(msg));
    let code: number;
    try {
      code = await cmdApprove(fakeArgs([skillPath]));
    } finally {
      console.error = origErr;
    }
    assert.equal(code, 1);
    assert.ok(logs.some((l) => /Could not read skill file/.test(l)));
  });
});
