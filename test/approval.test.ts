import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSkill, SkillParseError } from "../src/skill.js";
import { serializeSkill } from "../src/writeback.js";
import { computeApprovalHash, computeIdempotencyKey } from "../src/approval.js";

const APPROVE_LINE = `sha256:${"0".repeat(64)}`;

function skillWithApprove(approveLine?: string): string {
  return `---
name: approval-fixture
description: exercises the approve field
---

### Step 1 — write something
- intent: write it
- action: http.post {"url": "https://example.com", "body": {"a": 1}}
- assert: status == 200
- effect: idempotent-write
${approveLine !== undefined ? `- approve: ${approveLine}\n` : ""}`;
}

test("a step with a valid approve: line parses, value round-trips", () => {
  const skill = parseSkill(skillWithApprove(APPROVE_LINE));
  assert.equal(skill.steps[0].approve, APPROVE_LINE);
});

test("a step with no approve: field parses with approve undefined", () => {
  const skill = parseSkill(skillWithApprove());
  assert.equal(skill.steps[0].approve, undefined);
  assert.ok(!("approve" in skill.steps[0]) || skill.steps[0].approve === undefined);
});

test("rejects a malformed approve value (not sha256:<64hex>)", () => {
  assert.throws(() => parseSkill(skillWithApprove("not-a-hash")), SkillParseError);
  assert.throws(() => parseSkill(skillWithApprove("sha256:abc")), SkillParseError);
});

test("rejects a duplicate approve field in a step", () => {
  const bad = `---
name: x
description: y
---

### Step 1 — first
- intent: i
- action: http.get {"url":"x"}
- effect: read
- approve: ${APPROVE_LINE}
- approve: ${APPROVE_LINE}
`;
  assert.throws(() => parseSkill(bad), SkillParseError);
});

test("serialize(parse(source)) round-trips a step WITH approve byte-identically on a second pass", () => {
  const skill = parseSkill(skillWithApprove(APPROVE_LINE));
  const once = serializeSkill(skill);
  const twice = serializeSkill(parseSkill(once));
  assert.equal(once, twice);
  assert.match(once, new RegExp(`- approve: ${APPROVE_LINE}`));
});

test("a skill WITHOUT approve serializes with no approve: line at all", () => {
  const skill = parseSkill(skillWithApprove());
  const rendered = serializeSkill(skill);
  assert.ok(!/- approve:/.test(rendered));
});

// ---------------------------------------------------------------------------
// computeApprovalHash / computeIdempotencyKey
// ---------------------------------------------------------------------------

test("computeApprovalHash is stable across arg-key order", () => {
  const h1 = computeApprovalHash({ actionTool: "crm.create_contact", actionArgs: { a: 1, b: 2 }, attest: undefined });
  const h2 = computeApprovalHash({ actionTool: "crm.create_contact", actionArgs: { b: 2, a: 1 }, attest: undefined });
  assert.equal(h1, h2);
  assert.match(h1, /^sha256:[0-9a-f]{64}$/);
});

test("computeApprovalHash differs when the tool changes", () => {
  const h1 = computeApprovalHash({ actionTool: "crm.create_contact", actionArgs: { a: 1 }, attest: undefined });
  const h2 = computeApprovalHash({ actionTool: "crm.update_contact", actionArgs: { a: 1 }, attest: undefined });
  assert.notEqual(h1, h2);
});

test("computeApprovalHash differs when a placeholder is swapped into the args template", () => {
  const h1 = computeApprovalHash({ actionTool: "crm.create_contact", actionArgs: { email: "a@example.com" }, attest: undefined });
  const h2 = computeApprovalHash({ actionTool: "crm.create_contact", actionArgs: { email: "{{email}}" }, attest: undefined });
  assert.notEqual(h1, h2);
});

test("computeApprovalHash does NOT bind server (offline reelier approve can't know it)", () => {
  // Same tool+args, no way to pass a server into computeApprovalHash at all —
  // this test just documents/pins the 2-key shape via a stable digest.
  const h = computeApprovalHash({ actionTool: "crm.create_contact", actionArgs: { a: 1 }, attest: undefined });
  assert.match(h, /^sha256:[0-9a-f]{64}$/);
});

test("computeIdempotencyKey binds tool + server + filled args; differs when any one changes", () => {
  const base = computeIdempotencyKey("crm.create_contact", "seldonframe", { email: "a@example.com" });
  const diffServer = computeIdempotencyKey("crm.create_contact", "other-server", { email: "a@example.com" });
  const diffTool = computeIdempotencyKey("crm.update_contact", "seldonframe", { email: "a@example.com" });
  const diffArgs = computeIdempotencyKey("crm.create_contact", "seldonframe", { email: "b@example.com" });
  assert.match(base, /^sha256:[0-9a-f]{64}$/);
  assert.notEqual(base, diffServer);
  assert.notEqual(base, diffTool);
  assert.notEqual(base, diffArgs);
});

test("computeIdempotencyKey accepts a null server (builtin http.* tools have none)", () => {
  const h = computeIdempotencyKey("http.post", null, { url: "https://example.com" });
  assert.match(h, /^sha256:[0-9a-f]{64}$/);
});
