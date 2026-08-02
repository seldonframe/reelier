// `reelier resolve` (docs/specs/artifact-attestation-v1.md §8) — walk the
// ledger for deferred attestations whose provider record may now exist, probe
// for it, and append the resolution as a SECOND record.
//
// The load-bearing behaviour under test is what it does NOT write: a probe
// that has not resolved and whose deadline has not passed must append nothing,
// or the ledger grows a record per invocation and the next scan starts reading
// this command's own output.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { cmdResolve, type ParsedArgs } from "../src/cli.js";
import { computeApprovalHash } from "../src/approval.js";
import { parseSkill } from "../src/skill.js";
import type { DownstreamConnection } from "../src/mcp-client.js";
import { canonicalJson, digestSha256 } from "../src/canonical-json.js";

const SKILL_UNAPPROVED = `---
name: resolve-fixture
description: a send whose post-state arrives late
---

### Step 1 — send a message
- intent: send it
- action: send_email {"to": "ops@example.com", "body": "b"}
- assert: status == 200
- effect: idempotent-write
- emit: {"projection":["args.to","args.body"]}
- attest: {"tool":"get_message","args":{"id":"m1"},"projection":["delivered"],"defer":"24h"}
`;

const APPROVAL = (() => {
  const step = parseSkill(SKILL_UNAPPROVED).steps[0];
  return computeApprovalHash({
    actionTool: step.actionTool,
    actionArgs: step.actionArgs,
    attest: step.attest,
    expect: step.expect,
    emit: step.emit,
  });
})();
const ARTIFACT = "sha256:" + "b".repeat(64);
const SKILL = `${SKILL_UNAPPROVED}- approve: ${APPROVAL}\n`;

const FUTURE = "2099-01-01T00:00:00.000Z";
const PAST = "2000-01-01T00:00:00.000Z";

function pendingRecord(deferredUntil: string, approvalHash = APPROVAL): string {
  return JSON.stringify({
    skill: "resolve-fixture",
    startedAt: "2026-08-01T00:00:00.000Z",
    finishedAt: "2026-08-01T00:00:01.000Z",
    passed: true,
    steps: [
      {
        n: 1, title: "send a message", level: 0, outcome: "passed", ms: 1, failures: [],
        write: { idempotencyKey: "sha256:k", dispatchId: "dispatch-1", approved: true, approvalHash },
        emit: { artifactDigest: ARTIFACT },
        attest: { method: "declared-probe", selector: "get_message", confidence: "pending", deferredUntil },
      },
    ],
    totals: { steps: 1, passed: 1, unchecked: 0, skipped: 0, failed: 0, ms: 1, llmInputTokens: 0, llmOutputTokens: 0 },
  });
}

function fakeArgs(positional: string[], wraps: string[] = []): ParsedArgs {
  return { positional, flags: new Set(), vars: {}, wraps, opts: {}, fails: [] };
}

function fakeConnection(body: string | null, calls: unknown[]): DownstreamConnection {
  return {
    name: "fake",
    tools: [{ name: "get_message", description: "read a message", inputSchema: { type: "object" } }],
    async call(name: string, args: unknown) {
      calls.push({ name, args });
      if (body === null) throw new Error("provider record not found");
      return { content: [{ type: "text", text: body }], isError: false };
    },
    async close() {},
  } as unknown as DownstreamConnection;
}

async function seed(
  dir: string,
  deferredUntil: string,
  skillSource = SKILL,
  approvalHash = APPROVAL,
): Promise<{ skillPath: string; ledger: string }> {
  const skillPath = path.join(dir, "s.skill.md");
  await writeFile(skillPath, skillSource, "utf8");
  const runsDir = path.join(dir, ".reelier", "runs");
  await mkdir(runsDir, { recursive: true });
  const ledger = path.join(runsDir, "resolve-fixture.jsonl");
  await writeFile(ledger, pendingRecord(deferredUntil, approvalHash) + "\n", "utf8");
  return { skillPath, ledger };
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-resolve-"));
  try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

function lines(text: string): unknown[] {
  return text.split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l));
}

const quiet = async <T>(fn: () => Promise<T>): Promise<T> => {
  const log = console.log, err = console.error;
  console.log = () => {}; console.error = () => {};
  try { return await fn(); } finally { console.log = log; console.error = err; }
};

// ---------------------------------------------------------------------------

test("cmdResolve requires a skill path", async () => {
  assert.equal(await quiet(() => cmdResolve(fakeArgs([]))), 1);
});

test("cmdResolve requires --wrap — a probe needs a live server to reach", async () => {
  await withTempDir(async (dir) => {
    const { skillPath } = await seed(dir, FUTURE);
    assert.equal(await quiet(() => cmdResolve(fakeArgs([skillPath]), undefined, { cwd: dir })), 1);
  });
});

test("a resolved provider record appends ONE resolution record graded partial", async () => {
  await withTempDir(async (dir) => {
    const { skillPath, ledger } = await seed(dir, FUTURE);
    const calls: unknown[] = [];
    const code = await quiet(() =>
      cmdResolve(fakeArgs([skillPath], ["fake"]), async () => fakeConnection('{"delivered":true}', calls), { cwd: dir })
    );
    assert.equal(code, 0);
    assert.equal(calls.length, 1, "the probe was dispatched exactly once");

    const recs = lines(await readFile(ledger, "utf8")) as any[];
    assert.equal(recs.length, 2, "the original is untouched; the resolution is appended");
    const resolution = recs[1];
    assert.equal(resolution.steps[0].attest.confidence, "partial", "never exact — no delta across the write");
    assert.equal(resolution.steps[0].attest.deferredUntil, FUTURE, "names WHICH deadline it answered");
    assert.equal(resolution.steps[0].outcome, "unchecked", "a resolution asserts nothing");
    assert.deepEqual(resolution.steps[0].resolutionOf, {
      approvalHash: APPROVAL,
      artifactDigest: ARTIFACT,
      deferredUntil: FUTURE,
      dispatchId: "dispatch-1",
    });
    assert.equal(resolution.deferredResolution, true);
    assert.equal(resolution.passed, false, "the second record is evidence, never a passing run");
    assert.equal(resolution.mockFailures, undefined, "must never wedge a push batch");
    // The original record is immutable — byte-identical to what was seeded.
    assert.equal(JSON.stringify(recs[0]), pendingRecord(FUTURE));
  });
});

test("mutating the approved skill after dispatch makes resolution unclaimable and dispatches no probe", async () => {
  await withTempDir(async (dir) => {
    const { skillPath, ledger } = await seed(dir, FUTURE);
    await writeFile(skillPath, SKILL.replace('"body": "b"', '"body": "mutated"'), "utf8");
    const before = await readFile(ledger, "utf8");
    const calls: unknown[] = [];
    const code = await quiet(() =>
      cmdResolve(fakeArgs([skillPath], ["fake"]), async () => fakeConnection('{"delivered":true}', calls), { cwd: dir })
    );
    assert.equal(code, 1);
    assert.equal(calls.length, 0, "a probe under a different approval must never run");
    assert.equal(await readFile(ledger, "utf8"), before, "no resolution claim was appended");
  });
});

test("a parameterized deferred probe without probeArgs commitment is refused before probing", async () => {
  await withTempDir(async (dir) => {
    const unapproved = SKILL_UNAPPROVED.replace('"id":"m1"', '"id":"{{messageId}}"');
    const step = parseSkill(unapproved).steps[0];
    const approval = computeApprovalHash({
      actionTool: step.actionTool,
      actionArgs: step.actionArgs,
      attest: step.attest,
      expect: step.expect,
      emit: step.emit,
    });
    const source = `${unapproved}- approve: ${approval}\n`;
    const { skillPath, ledger } = await seed(dir, FUTURE, source, approval);
    const before = await readFile(ledger, "utf8");
    const calls: unknown[] = [];
    const args = fakeArgs([skillPath], ["fake"]);
    args.vars.messageId = "different-message";
    const code = await quiet(() =>
      cmdResolve(args, async () => fakeConnection('{"delivered":true}', calls), { cwd: dir })
    );
    assert.equal(code, 1);
    assert.equal(calls.length, 0);
    assert.equal(await readFile(ledger, "utf8"), before);
  });
});

test("a computed-date deferred probe is parameterized and requires probeArgs", async () => {
  await withTempDir(async (dir) => {
    const unapproved = SKILL_UNAPPROVED.replace('"id":"m1"', '"id":"{{today}}"');
    const step = parseSkill(unapproved).steps[0];
    const approval = computeApprovalHash({ actionTool: step.actionTool, actionArgs: step.actionArgs, attest: step.attest, expect: step.expect, emit: step.emit });
    const { skillPath, ledger } = await seed(dir, FUTURE, `${unapproved}- approve: ${approval}\n`, approval);
    const before = await readFile(ledger, "utf8");
    const calls: unknown[] = [];
    const code = await quiet(() => cmdResolve(fakeArgs([skillPath], ["fake"]), async () => fakeConnection('{"delivered":true}', calls), { cwd: dir }));
    assert.equal(code, 1);
    assert.equal(calls.length, 0);
    assert.equal(await readFile(ledger, "utf8"), before);
  });
});

test("resolver manifest preflight refuses a drifted probe tool before dispatch", async () => {
  await withTempDir(async (dir) => {
    const wrongDigest = digestSha256({ type: "object", required: ["different"] });
    const source = SKILL.replace(
      "description: a send whose post-state arrives late",
      `description: a send whose post-state arrives late\nmanifest: ${canonicalJson({ v: 1, tools: [{ name: "get_message", digest: wrongDigest }] })}`,
    );
    const { skillPath, ledger } = await seed(dir, FUTURE, source);
    const before = await readFile(ledger, "utf8");
    const calls: unknown[] = [];
    const code = await quiet(() => cmdResolve(fakeArgs([skillPath], ["fake"]), async () => fakeConnection('{"delivered":true}', calls), { cwd: dir }));
    assert.equal(code, 1);
    assert.equal(calls.length, 0);
    assert.equal(await readFile(ledger, "utf8"), before);
  });
});

test("running twice is idempotent — the second run appends nothing", async () => {
  await withTempDir(async (dir) => {
    const { skillPath, ledger } = await seed(dir, FUTURE);
    const run = () => quiet(() =>
      cmdResolve(fakeArgs([skillPath], ["fake"]), async () => fakeConnection('{"delivered":true}', []), { cwd: dir })
    );
    await run();
    const afterFirst = await readFile(ledger, "utf8");
    assert.equal(await run(), 0);
    assert.equal(await readFile(ledger, "utf8"), afterFirst, "no duplicate resolution");
  });
});

test("an unresolved probe BEFORE its deadline appends nothing at all", async () => {
  // The whole reason this rule exists: writing a `pending` resolution would
  // make the next scan read this command's own output.
  await withTempDir(async (dir) => {
    const { skillPath, ledger } = await seed(dir, FUTURE);
    const before = await readFile(ledger, "utf8");
    const code = await quiet(() =>
      cmdResolve(fakeArgs([skillPath], ["fake"]), async () => fakeConnection(null, []), { cwd: dir })
    );
    assert.equal(code, 0, "still waiting is not an error");
    assert.equal(await readFile(ledger, "utf8"), before, "nothing written while the provider may still catch up");
  });
});

test("an unresolved probe AFTER its deadline appends an absent resolution and stops waiting", async () => {
  await withTempDir(async (dir) => {
    const { skillPath, ledger } = await seed(dir, PAST);
    const code = await quiet(() =>
      cmdResolve(fakeArgs([skillPath], ["fake"]), async () => fakeConnection(null, []), { cwd: dir })
    );
    assert.equal(code, 0);
    const recs = lines(await readFile(ledger, "utf8")) as any[];
    assert.equal(recs.length, 2);
    const attest = recs[1].steps[0].attest;
    assert.equal(attest.confidence, "absent");
    assert.match(attest.reason, /deferred-deadline-elapsed/);
    assert.doesNotMatch(attest.reason, /send failed|not delivered/i, "claims only that Reelier stopped waiting");
    assert.equal(recs[1].totals.failed, 0, "an elapsed deadline is not a step failure");
  });
});

test("nothing pending is a clean no-op, not an error", async () => {
  await withTempDir(async (dir) => {
    const skillPath = path.join(dir, "s.skill.md");
    await writeFile(skillPath, SKILL, "utf8");
    await mkdir(path.join(dir, ".reelier", "runs"), { recursive: true });
    const ledger = path.join(dir, ".reelier", "runs", "resolve-fixture.jsonl");
    await writeFile(ledger, "", "utf8");
    assert.equal(
      await quiet(() => cmdResolve(fakeArgs([skillPath], ["fake"]), async () => fakeConnection("{}", []), { cwd: dir })),
      0
    );
    assert.equal(await readFile(ledger, "utf8"), "");
  });
});
