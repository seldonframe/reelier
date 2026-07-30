// S1 of the state-conditioned-approval design (Wave 2 spec §2.1, §10 S1):
// the `expect:` step bullet — parse, shape-validate, joint-validate
// (requires attest: + approve: on the same step, invariant I-12), and
// byte-stable serialization with alphabetical key order (at, keyId, pre).
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSkill, SkillParseError } from "../src/skill.js";
import { serializeSkill } from "../src/writeback.js";

const APPROVE = `- approve: sha256:${"a".repeat(64)}`;
const ATTEST = `- attest: {"tool":"gbrain.get_page","args":{"slug":"reelier-demo-page"},"projection":["compiled_truth"]}`;
const EXPECT = `- expect: {"at":"2026-07-30T06:58:12.331Z","keyId":"3c9a01d2e4f5b6a7","pre":"hmac-sha256:${"9f".repeat(32)}"}`;

/** A one-write-step skill whose step block carries exactly `lines`, in order. */
const SKILL = (...lines: string[]) => `---
name: t
description: d
---
## Steps

### Step 1 — write
- intent: i
- action: gbrain.put_page {"markdown":"# hi","slug":"reelier-demo-page","title":"Demo"}
${lines.filter((l) => l !== "").join("\n")}
- effect: idempotent-write
`;

// ---------------------------------------------------------------------------
// Parse: the happy trio
// ---------------------------------------------------------------------------

test("expect parses into StepExpect alongside attest and approve", () => {
  const s = parseSkill(SKILL(ATTEST, APPROVE, EXPECT));
  assert.deepEqual(s.steps[0].expect, {
    at: "2026-07-30T06:58:12.331Z",
    keyId: "3c9a01d2e4f5b6a7",
    pre: `hmac-sha256:${"9f".repeat(32)}`,
  });
});

test("a step without expect parses with expect undefined (legacy-identical)", () => {
  const s = parseSkill(SKILL(ATTEST, APPROVE));
  assert.equal(s.steps[0].expect, undefined);
});

// ---------------------------------------------------------------------------
// Joint validation (I-12): expect requires BOTH attest and approve
// ---------------------------------------------------------------------------

test("expect without attest is a parse error with the spec's verbatim message", () => {
  assert.throws(
    () => parseSkill(SKILL(APPROVE, EXPECT)),
    /'expect' requires both 'attest:' and 'approve:' on the step/
  );
});

test("expect without approve is a parse error with the spec's verbatim message", () => {
  assert.throws(
    () => parseSkill(SKILL(ATTEST, EXPECT)),
    /'expect' requires both 'attest:' and 'approve:' on the step/
  );
});

test("expect alone (no attest, no approve) is a parse error", () => {
  assert.throws(
    () => parseSkill(SKILL(EXPECT)),
    /'expect' requires both 'attest:' and 'approve:' on the step/
  );
});

// ---------------------------------------------------------------------------
// Cardinality
// ---------------------------------------------------------------------------

test("duplicate expect rejected with the spec's verbatim message", () => {
  assert.throws(() => parseSkill(SKILL(ATTEST, APPROVE, EXPECT, EXPECT)), /Duplicate 'expect' field in step/);
});

// ---------------------------------------------------------------------------
// Shape validation (mirrors validateAttestShape: loud, specific, closed set)
// ---------------------------------------------------------------------------

test("expect value must be valid JSON", () => {
  assert.throws(() => parseSkill(SKILL(ATTEST, APPROVE, `- expect: not json`)), /not valid JSON/);
});

test("expect value must be a JSON object (not array/null/scalar)", () => {
  for (const bad of [`- expect: []`, `- expect: null`, `- expect: "x"`, `- expect: 3`]) {
    assert.throws(() => parseSkill(SKILL(ATTEST, APPROVE, bad)), /Malformed 'expect' value \(expected a JSON object\)/);
  }
});

test("unknown expect key rejected with the spec's verbatim message shape", () => {
  assert.throws(
    () =>
      parseSkill(
        SKILL(ATTEST, APPROVE, `- expect: {"at":"2026-07-30T00:00:00Z","keyId":"3c9a01d2e4f5b6a7","pre":"hmac-sha256:${"a".repeat(64)}","extra":1}`)
      ),
    // Anchored through to the where-clause (review finding): an unanchored
    // prefix match let the P1.5 "/fields" suffix land without this pin
    // noticing — the key list must end exactly at the (step …) suffix.
    /Unknown 'expect' key "extra" — expected pre\/keyId\/at\/fields \(step /
  );
});

test("expect.pre must match hmac-sha256:<64 hex> exactly", () => {
  for (const badPre of [
    `sha256:${"a".repeat(64)}`, // salted-attest prefix must never be accepted here
    `hmac-sha256:${"a".repeat(63)}`,
    `hmac-sha256:${"A".repeat(64)}`, // uppercase hex is not canonical
    `hmac-sha256:`,
    ``,
  ]) {
    assert.throws(
      () => parseSkill(SKILL(ATTEST, APPROVE, `- expect: {"at":"2026-07-30T00:00:00Z","keyId":"3c9a01d2e4f5b6a7","pre":${JSON.stringify(badPre)}}`)),
      /'expect\.pre'/
    );
  }
});

test("expect.keyId must be exactly 16 lowercase hex chars", () => {
  for (const badKeyId of ["3c9a01d2e4f5b6a", "3c9a01d2e4f5b6a7f", "3C9A01D2E4F5B6A7", "", "zzzz01d2e4f5b6a7"]) {
    assert.throws(
      () =>
        parseSkill(SKILL(ATTEST, APPROVE, `- expect: {"at":"2026-07-30T00:00:00Z","keyId":${JSON.stringify(badKeyId)},"pre":"hmac-sha256:${"a".repeat(64)}"}`)),
      /'expect\.keyId'/
    );
  }
});

test("expect.at must be a non-empty ISO-8601-parseable string", () => {
  // The last four are Date.parse-able in V8 but NOT ISO-8601 — the shape
  // anchor must reject them (review finding: bare Date.parse under-enforces).
  for (const badAt of ["", "not a date", "2026-99-99T00:00:00Z", "March 5, 2026", "2026/07/30", " 2026-01-01 ", "0"]) {
    assert.throws(
      () =>
        parseSkill(SKILL(ATTEST, APPROVE, `- expect: {"at":${JSON.stringify(badAt)},"keyId":"3c9a01d2e4f5b6a7","pre":"hmac-sha256:${"a".repeat(64)}"}`)),
      /'expect\.at'/
    );
  }
});

test("missing expect keys are each rejected", () => {
  for (const bad of [
    `- expect: {"keyId":"3c9a01d2e4f5b6a7","pre":"hmac-sha256:${"a".repeat(64)}"}`,
    `- expect: {"at":"2026-07-30T00:00:00Z","pre":"hmac-sha256:${"a".repeat(64)}"}`,
    `- expect: {"at":"2026-07-30T00:00:00Z","keyId":"3c9a01d2e4f5b6a7"}`,
  ]) {
    assert.throws(() => parseSkill(SKILL(ATTEST, APPROVE, bad)), SkillParseError);
  }
});

test("parse errors name the step and line", () => {
  try {
    parseSkill(SKILL(ATTEST, APPROVE, `- expect: {"bad":1}`));
    assert.fail("should have thrown");
  } catch (err) {
    assert.ok(err instanceof SkillParseError);
    assert.match((err as Error).message, /step 1/);
    assert.match((err as Error).message, /line \d+/);
  }
});

// ---------------------------------------------------------------------------
// The closed bullet-key set: 8 keys, expect listed in the rejection message
// ---------------------------------------------------------------------------

test("unrecognized step field message lists expect among the closed key set", () => {
  assert.throws(
    () => parseSkill(SKILL(`- exxpect: {}`)),
    /Unrecognized step field, expected one of intent\/action\/assert\/bind\/effect\/approve\/attest\/expect/
  );
});

// ---------------------------------------------------------------------------
// Serialization: byte-stable round-trip, alphabetical key order (at, keyId, pre)
// ---------------------------------------------------------------------------

test("serializeSkill renders expect with alphabetical key order and round-trips byte-stably", () => {
  const s = parseSkill(SKILL(ATTEST, APPROVE, EXPECT));
  const rendered = serializeSkill(s);
  assert.ok(
    rendered.includes(`- expect: {"at":"2026-07-30T06:58:12.331Z","keyId":"3c9a01d2e4f5b6a7","pre":"hmac-sha256:${"9f".repeat(32)}"}`),
    `expected canonical expect line in:\n${rendered}`
  );
  const reparsed = parseSkill(rendered);
  assert.deepEqual(reparsed.steps[0].expect, s.steps[0].expect);
  assert.equal(serializeSkill(reparsed), rendered);
});

test("serializeSkill canonicalizes a hand-shuffled expect key order", () => {
  const shuffled = `- expect: {"pre":"hmac-sha256:${"9f".repeat(32)}","at":"2026-07-30T06:58:12.331Z","keyId":"3c9a01d2e4f5b6a7"}`;
  const s = parseSkill(SKILL(ATTEST, APPROVE, shuffled));
  const rendered = serializeSkill(s);
  assert.ok(rendered.includes(`- expect: {"at":"2026-07-30T06:58:12.331Z","keyId":"3c9a01d2e4f5b6a7","pre":"hmac-sha256:${"9f".repeat(32)}"}`));
});
