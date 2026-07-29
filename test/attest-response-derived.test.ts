import { test } from "node:test";
import assert from "node:assert/strict";
import { buildResponseDerivedAttest, projectObservation, runSkill } from "../src/runner.js";
import type { Observation } from "../src/assert.js";
import { digestSha256 } from "../src/canonical-json.js";
import { parseSkill } from "../src/skill.js";
import type { Tool } from "../src/tools.js";

function obsOf(body: unknown, headers: Record<string, string> = {}): Observation {
  return { status: 200, headers, body: typeof body === "string" ? body : JSON.stringify(body) };
}

test("response body with id + etag yields partial attest with a projection hash", () => {
  const a = buildResponseDerivedAttest(obsOf({ id: 42, etag: "W/\"abc\"", name: "raw-secret-value" }));
  assert.equal(a.method, "response-derived");
  assert.equal(a.confidence, "partial");
  assert.ok(a.post);
  assert.match(a.post!.hash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(a.pre, undefined);
  assert.equal(a.delta, undefined);
  // exact expected hash: projection is {"body.etag":"W/\"abc\"","body.id":"42"}
  assert.equal(a.post!.hash, digestSha256({ "body.etag": 'W/"abc"', "body.id": "42" }));
});

test("attest never contains raw response values (hash + timestamps only)", () => {
  const a = buildResponseDerivedAttest(obsOf({ id: "cus_123", updated_at: "2026-07-28T00:00:00Z" }));
  const flat = JSON.stringify(a);
  assert.ok(!flat.includes("cus_123"));
  assert.ok(!flat.includes("2026-07-28T00:00:00Z"));
});

test("header etag participates in the projection when the body has nothing", () => {
  const a = buildResponseDerivedAttest(obsOf("not json", { etag: '"v7"' }));
  assert.equal(a.confidence, "partial");
  assert.equal(a.post!.hash, digestSha256({ "header.etag": '"v7"' }));
});

test("array body / non-JSON body / empty object degrade to absent with reason", () => {
  for (const body of [[1, 2], "plain text", {}]) {
    const a = buildResponseDerivedAttest(obsOf(body));
    assert.equal(a.confidence, "absent");
    assert.equal(a.reason, "no-derivable-state");
    assert.equal(a.post, undefined);
  }
});

test("projection hash is stable under body key order", () => {
  const a = buildResponseDerivedAttest(obsOf({ id: 1, version: "2" }));
  const b = buildResponseDerivedAttest(obsOf({ version: "2", id: 1 }));
  assert.equal(a.post!.hash, b.post!.hash);
});

const WRITE_SKILL = `---
name: attest-rd
description: response-derived attest e2e
---
## Steps

### Step 1 — create thing
- intent: create
- action: fake.create {"name":"x"}
- assert: status == 200
- effect: idempotent-write
`;

function fakeCreate(body: unknown): Tool {
  return { effect: "idempotent-write", run: async () => obsOf(body) };
}

test("a dispatched write step records attest; refused/read/mocked steps never do", async () => {
  const skill = parseSkill(WRITE_SKILL);
  // dispatched (allowWrites)
  const ran = await runSkill(skill, { tools: { "fake.create": fakeCreate({ id: 7 }) }, allowWrites: true, dryRun: true });
  assert.equal(ran.steps[0].attest?.confidence, "partial");
  // refused (no allowWrites): no attest at all
  const refused = await runSkill(skill, { tools: { "fake.create": fakeCreate({ id: 7 }) }, dryRun: true });
  assert.equal(refused.steps[0].attest, undefined);
  // mocked step: no attest
  const mocked = await runSkill(skill, { tools: { "fake.create": fakeCreate({ id: 7 }) }, allowWrites: true, dryRun: true, mockFailures: { 1: 500 } });
  assert.equal(mocked.steps[0].attest, undefined);
});

const READ_SKILL = `---
name: attest-rd-read
description: read step e2e
---
## Steps

### Step 1 — read thing
- intent: read
- action: fake.read {"name":"x"}
- assert: status == 200
- effect: read
`;

test("read steps never get attest", async () => {
  const readSkill = parseSkill(READ_SKILL);
  const ran = await runSkill(readSkill, { tools: { "fake.read": { effect: "read", run: async () => obsOf({ id: 7 }) } }, dryRun: true });
  assert.equal(ran.steps[0].attest, undefined);
});
