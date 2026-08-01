// The `emit:` step field (docs/specs/artifact-attestation-v1.md §4): grammar,
// round-trip, and its binding into the approval hash.

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSkill, SkillParseError } from "../src/skill.js";
import { serializeSkill } from "../src/writeback.js";
import { computeApprovalHash } from "../src/approval.js";

function skill(stepFields: string, effect = "destructive"): string {
  return `---
name: emit-fixture
description: exercises the emit field
---

### Step 1 — send a message
- intent: send it
- action: send_email {"to": "{{recipient}}", "subject": "hi", "body": "{{draft}}"}
- assert: status == 200
- effect: ${effect}
${stepFields}`;
}

const VALID = `- emit: {"projection":["args.to","args.subject","args.body"]}\n`;

// ---------------------------------------------------------------------------
// Grammar
// ---------------------------------------------------------------------------

test("a well-formed emit: parses into the step", () => {
  const s = parseSkill(skill(VALID));
  assert.deepEqual(s.steps[0].emit, { projection: ["args.to", "args.subject", "args.body"] });
});

test("a step without emit: leaves the field absent, never defaulted", () => {
  assert.equal(parseSkill(skill("")).steps[0].emit, undefined);
});

test("duplicate emit: is rejected", () => {
  assert.throws(() => parseSkill(skill(VALID + VALID)), /Duplicate 'emit' field in step/);
});

test("an unknown emit key is rejected, never silently degraded to 'no emit'", () => {
  assert.throws(
    () => parseSkill(skill(`- emit: {"projection":["args.to"],"constraints":[]}\n`)),
    /Unknown 'emit' key .*constraints.* expected projection/
  );
});

test("emit.projection must be a non-empty array of non-empty strings", () => {
  for (const bad of ['{"projection":[]}', '{"projection":"args.to"}', '{"projection":["  "]}', "{}"]) {
    assert.throws(() => parseSkill(skill(`- emit: ${bad}\n`)), SkillParseError, `expected rejection for ${bad}`);
  }
});

test("malformed emit JSON is rejected loudly", () => {
  assert.throws(() => parseSkill(skill(`- emit: {not json}\n`)), /not valid JSON/);
});

test("a projection entry without the args. prefix is rejected at parse time — there is no bare form", () => {
  assert.throws(() => parseSkill(skill(`- emit: {"projection":["to"]}\n`)), /args\./);
  assert.throws(() => parseSkill(skill(`- emit: {"projection":["body.to"]}\n`)), /args\./);
});

test("a duplicate projection entry is rejected — a covered-components list names each field once", () => {
  // RFC 9421 §2.3, credited in spec §11.1: "each component identifier MUST
  // occur only once". A list that names a field twice is not a coverage
  // declaration anyone can reason about.
  assert.throws(() => parseSkill(skill(`- emit: {"projection":["args.to","args.to"]}\n`)), /once|duplicate/i);
});

test("emit: on a read step is rejected — a read never dispatches a write to attest", () => {
  // Same argument that rejects `expect` on a read step: the record block is
  // written only on a dispatched write, so an emit here would be a declaration
  // nothing records, rendering as a clean pass (never-list #1).
  assert.throws(() => parseSkill(skill(VALID, "read")), /write-effect step/);
});

test("emit: does NOT require approve: — a flag-path write still records what left", () => {
  // §6: emit.approvalHash is absent exactly when write.approved is false.
  // An unapproved write has no authorization to name, and still has an artifact.
  const s = parseSkill(skill(VALID));
  assert.equal(s.steps[0].approve, undefined);
  assert.ok(s.steps[0].emit);
});

test("the unrecognized-step-field error names emit among the accepted keys", () => {
  assert.throws(() => parseSkill(skill(`- emitt: {"projection":["args.to"]}\n`)), /intent\/action\/assert\/bind\/effect\/exposure\/emit\/approve\/attest\/expect/);
});

// ---------------------------------------------------------------------------
// Round-trip
// ---------------------------------------------------------------------------

test("emit: round-trips parse -> serialize -> parse unchanged", () => {
  const once = serializeSkill(parseSkill(skill(VALID)));
  const twice = serializeSkill(parseSkill(once));
  assert.equal(once, twice);
  assert.deepEqual(parseSkill(once).steps[0].emit, {
    projection: ["args.to", "args.subject", "args.body"],
  });
});

test("declared projection ORDER survives the round-trip — the list is ordered, not a set", () => {
  const reversed = `- emit: {"projection":["args.body","args.to"]}\n`;
  assert.deepEqual(parseSkill(serializeSkill(parseSkill(skill(reversed)))).steps[0].emit?.projection, [
    "args.body",
    "args.to",
  ]);
});

test("a skill with no emit: serializes byte-identically to before the field existed", () => {
  const src = skill("");
  assert.equal(serializeSkill(parseSkill(src)).includes("emit:"), false);
});

// ---------------------------------------------------------------------------
// Approval-hash binding (§4, the compat law)
// ---------------------------------------------------------------------------

const EMITLESS = {
  actionTool: "send_email",
  actionArgs: { to: "{{recipient}}", body: "{{draft}}" },
  attest: undefined,
  expect: undefined,
} as const;

test("an emit-less step hashes byte-identically to 0.29.0 (pinned against a literal captured digest)", () => {
  // Captured from origin/main @ 5d6d521 BEFORE this field existed. A restated
  // formula would move with the code; a literal cannot.
  assert.equal(
    computeApprovalHash({ ...EMITLESS, emit: undefined }),
    "sha256:33ad62a2c921c9afa940d7603ad23ab4191f00849d33d7865dc470fd9b01604a"
  );
});

test("adding emit: changes the approval hash", () => {
  assert.notEqual(
    computeApprovalHash({ ...EMITLESS, emit: undefined }),
    computeApprovalHash({ ...EMITLESS, emit: { projection: ["args.to"] } })
  );
});

test("editing the declared coverage changes the approval hash — narrowing it is an approval mismatch", () => {
  // This is the countermeasure to RFC 9421 §7.2.1 "Insufficient Coverage"
  // (spec §11.1): binding the list is what stops it being quietly narrowed
  // after a human approved it.
  const wide = computeApprovalHash({ ...EMITLESS, emit: { projection: ["args.to", "args.body"] } });
  const narrow = computeApprovalHash({ ...EMITLESS, emit: { projection: ["args.to"] } });
  assert.notEqual(wide, narrow);
});

test("reordering the declared coverage changes the approval hash — the list is ordered", () => {
  assert.notEqual(
    computeApprovalHash({ ...EMITLESS, emit: { projection: ["args.to", "args.body"] } }),
    computeApprovalHash({ ...EMITLESS, emit: { projection: ["args.body", "args.to"] } })
  );
});
