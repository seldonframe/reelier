import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSkill, SkillParseError } from "../src/skill.js";
import { serializeSkill } from "../src/writeback.js";
import { computeApprovalHash } from "../src/approval.js";
import { digestSha256 } from "../src/canonical-json.js";

const BASE = (attestLine: string) => `---
name: t
description: d
---
## Steps

### Step 1 — write
- intent: i
- action: http.post {"url":"https://api.example.com/x","body":{"a":1}}
${attestLine}
- effect: idempotent-write
`;

const DECL = `- attest: {"tool":"http.get","args":{"url":"https://api.example.com/x/{{id}}"},"projection":["etag","updated_at"]}`;

test("attest parses into StepAttestDecl", () => {
  const s = parseSkill(BASE(DECL));
  assert.deepEqual(s.steps[0].attest, {
    tool: "http.get",
    args: { url: "https://api.example.com/x/{{id}}" },
    projection: ["etag", "updated_at"],
  });
});

test("attest without projection parses; projection omitted", () => {
  const s = parseSkill(BASE(`- attest: {"tool":"http.get","args":{"url":"u"}}`));
  assert.equal(s.steps[0].attest?.projection, undefined);
});

test("malformed attest fails loudly with step+line", () => {
  for (const bad of [
    `- attest: not json`,
    `- attest: {"args":{}}`,
    `- attest: {"tool":"","args":{}}`,
    `- attest: {"tool":"http.get"}`,
    `- attest: {"tool":"http.get","args":{},"projection":[]}`,
    `- attest: {"tool":"http.get","args":{},"projection":["ok",""]}`,
    `- attest: {"tool":"http.get","args":{},"projjection":["x"]}`,
  ]) {
    assert.throws(() => parseSkill(BASE(bad)), SkillParseError);
  }
});

test("duplicate attest rejected", () => {
  assert.throws(() => parseSkill(BASE(`${DECL}\n${DECL}`)), /Duplicate 'attest'/);
});

test("serializeSkill round-trips attest byte-stably", () => {
  const s = parseSkill(BASE(DECL));
  const rendered = serializeSkill(s);
  const reparsed = parseSkill(rendered);
  assert.deepEqual(reparsed.steps[0].attest, s.steps[0].attest);
  assert.equal(serializeSkill(reparsed), rendered);
});

test("approval hash unchanged for attest-less steps, changes when attest added", () => {
  const plain = parseSkill(BASE("")).steps[0];
  // lock the legacy formula so this can never silently drift:
  assert.equal(computeApprovalHash({ ...plain, attest: plain.attest, expect: plain.expect }), digestSha256({ args: plain.actionArgs, tool: plain.actionTool }));
  const withAttest = parseSkill(BASE(DECL)).steps[0];
  assert.notEqual(computeApprovalHash({ ...withAttest, attest: withAttest.attest, expect: withAttest.expect }), computeApprovalHash({ ...plain, attest: plain.attest, expect: plain.expect }));
});
