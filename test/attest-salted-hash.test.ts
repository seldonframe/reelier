// Fix-wave F3 (final-review S3): attest hashes are SALTED commitments. An
// unsalted sha256 over a low-entropy projection (a boolean, an enum, a small
// id) is trivially preimage-reversible from a shared/pushed record. Each
// attest now mixes in a per-attest random salt held in memory only and NEVER
// recorded: pre and post for the SAME attest share the salt (so within-record
// change detection survives), while cross-run hash joins are deliberately
// sacrificed — without the salt the hash cannot be brute-forced.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runSkill, buildResponseDerivedAttest } from "../src/runner.js";
import { parseSkill } from "../src/skill.js";
import { computeApprovalHash } from "../src/approval.js";
import type { Tool } from "../src/tools.js";
import type { Observation } from "../src/assert.js";

function obsOf(body: unknown): Observation {
  return { status: 200, headers: {}, body: JSON.stringify(body) };
}

const SKILL = `---
name: salted-t
description: d
---
## Steps

### Step 1 — update thing
- intent: update
- action: fake.update {"id":"x1"}
- assert: status == 200
- attest: {"tool":"fake.read","args":{"id":"x1"},"projection":["active"]}
- effect: idempotent-write
`;

function withApprove(src: string): string {
  const s = parseSkill(src).steps[0];
  const hash = computeApprovalHash({ actionTool: s.actionTool, actionArgs: s.actionArgs, attest: s.attest });
  return `${src}- approve: ${hash}\n`;
}

function tools(readBody: () => unknown): Record<string, Tool> {
  return {
    "fake.read": { effect: "read", run: async () => obsOf(readBody()) },
    "fake.update": { effect: "idempotent-write", run: async () => obsOf({ id: "x1" }) },
  };
}

test("F3: the same projection hashed in two separate runs yields DIFFERENT hashes (no cross-run brute-force)", async () => {
  const src = withApprove(SKILL);
  const t = tools(() => ({ active: true })); // state never changes
  const rec1 = await runSkill(parseSkill(src), { tools: t, dryRun: true });
  const rec2 = await runSkill(parseSkill(src), { tools: t, dryRun: true });
  const a1 = rec1.steps[0].attest!;
  const a2 = rec2.steps[0].attest!;
  assert.equal(a1.confidence, "exact");
  assert.notEqual(a1.pre!.hash, a2.pre!.hash, "identical projection must hash differently across runs (per-attest salt)");
  assert.notEqual(a1.post!.hash, a2.post!.hash);
});

test("F3: within one attest, unchanged projection => pre.hash === post.hash; changed => different", async () => {
  // unchanged
  const same = await runSkill(parseSkill(withApprove(SKILL)), { tools: tools(() => ({ active: true })), dryRun: true });
  const aSame = same.steps[0].attest!;
  assert.equal(aSame.pre!.hash, aSame.post!.hash, "same salt + same projection must produce equal pre/post hashes");
  assert.deepEqual(aSame.delta, { changed: 0 });

  // changed
  let active = true;
  const t = {
    "fake.read": { effect: "read", run: async () => obsOf({ active }) } as Tool,
    "fake.update": { effect: "idempotent-write", run: async () => { active = false; return obsOf({ id: "x1" }); } } as Tool,
  };
  const diff = await runSkill(parseSkill(withApprove(SKILL)), { tools: t, dryRun: true });
  const aDiff = diff.steps[0].attest!;
  assert.notEqual(aDiff.pre!.hash, aDiff.post!.hash);
  assert.deepEqual(aDiff.delta, { changed: 1, fields: ["body.active"] });
});

test("F3: response-derived hashes are salted too — same observation, two attests, different hashes", () => {
  const a = buildResponseDerivedAttest(obsOf({ id: 42, etag: "abc" }));
  const b = buildResponseDerivedAttest(obsOf({ id: 42, etag: "abc" }));
  assert.match(a.post!.hash, /^sha256:[0-9a-f]{64}$/);
  assert.notEqual(a.post!.hash, b.post!.hash);
});
