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
    // W3-S4 added `probeArgs` to the closed key set; the error string moves
    // with it in the SAME PR — otherwise every binding this slice stamps
    // becomes a parse error under the old message's promise. W5-T3 added
    // `expiresAt` under the same rule.
    /Unknown 'expect' key "extra" — expected pre\/keyId\/at\/expiresAt\/fields\/probeArgs \(step /
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

// A test that expects a THROW only pins a validator shut if the input is one
// a LOOSENED validator would let through. The cases below are exactly that:
// each is accepted by a regex missing one anchor, so they prove both ends are
// still there — which the existing too-short/uppercase cases cannot do.

test("expect.pre is anchored at BOTH ends — a valid commitment with anything before or after it is still malformed", () => {
  const body = "9f".repeat(32);
  for (const badPre of [
    `Xhmac-sha256:${body}`, // valid commitment with a PREFIX — survives a missing '^'
    ` hmac-sha256:${body}`, // leading space, same class
    `hmac-sha256:${body}X`, // valid commitment with a SUFFIX — survives a missing '$'
    `hmac-sha256:${body}00`, // 66 hex chars: the leading 64 still match without '$'
  ]) {
    assert.throws(
      () => parseSkill(SKILL(ATTEST, APPROVE, `- expect: {"at":"2026-07-30T00:00:00Z","keyId":"3c9a01d2e4f5b6a7","pre":${JSON.stringify(badPre)}}`)),
      /'expect\.pre'/,
      `pre ${JSON.stringify(badPre)} must be rejected`
    );
  }
});

test("expect.at rejects a valid ISO timestamp with anything around it", () => {
  // Unlike expect.pre above, no case here can pin the LEADING anchor: V8's
  // Date.parse returns NaN for every prefixed form of an ISO string (space,
  // tab, newline, stray char), so `Number.isNaN(Date.parse(...))`
  // independently rejects exactly what a missing '^' would let through.
  // Dropping that anchor is an equivalent mutation, and a mutation report
  // listing it as surviving is correct rather than a coverage gap. What this
  // test pins is the contract itself: a decorated timestamp is refused, by
  // whichever gate reaches it first.
  for (const badAt of [
    " 2026-07-30T06:58:12.331Z",
    "2026-07-30T06:58:12.331Z ",
    "\t2026-07-30T06:58:12.331Z",
    "2026-07-30T06:58:12.331Z (UTC)",
  ]) {
    assert.throws(
      () =>
        parseSkill(SKILL(ATTEST, APPROVE, `- expect: {"at":${JSON.stringify(badAt)},"keyId":"3c9a01d2e4f5b6a7","pre":"hmac-sha256:${"a".repeat(64)}"}`)),
      /'expect\.at'/,
      `at ${JSON.stringify(badAt)} must be rejected`
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

/** 1-based line number of the first (or last) source line containing `needle`. */
function lineOf(source: string, needle: string, which: "first" | "last" = "first"): number {
  const lines = source.split("\n");
  const idx = which === "first" ? lines.findIndex((l) => l.includes(needle)) : lines.map((l) => l.includes(needle)).lastIndexOf(true);
  return idx + 1;
}

test("every expect rejection carries the step and the EXPECT BULLET's line — not the step header's, and never a bare message", () => {
  // Two things are pinned here. First, that the context survives at all: a
  // "malformed expect" with no step/line sends the operator hunting through
  // the file by hand. Second, that the line points at the `expect:` bullet
  // rather than falling back to the step header — the fallback is only for
  // shapes where no expect line exists, and silently preferring it would
  // point every state-binding error at the wrong line.
  const cases: { src: string; label: string; which?: "first" | "last" }[] = [
    // The duplicate is reported against the OFFENDING (second) bullet.
    { src: SKILL(ATTEST, APPROVE, EXPECT, EXPECT), label: "duplicate expect", which: "last" },
    { src: SKILL(ATTEST, APPROVE, `- expect: not json`), label: "invalid JSON" },
    { src: SKILL(ATTEST, APPROVE, `- expect: {"bad":1}`), label: "unknown key" },
    { src: SKILL(APPROVE, EXPECT), label: "expect without attest (I-12)" },
    { src: SKILL(ATTEST, EXPECT), label: "expect without approve (I-12)" },
  ];
  for (const { src, label, which } of cases) {
    const expectLine = lineOf(src, "- expect:", which);
    const headerLine = lineOf(src, "### Step 1");
    assert.notEqual(expectLine, headerLine, "fixture sanity: the two lines must differ");
    try {
      parseSkill(src);
      assert.fail(`${label}: should have thrown`);
    } catch (err) {
      assert.ok(err instanceof SkillParseError, `${label}: wrong error type`);
      const msg = (err as Error).message;
      assert.match(msg, new RegExp(`\\(step 1, line ${expectLine}\\)`), `${label}: expected step 1 + line ${expectLine} in: ${msg}`);
    }
  }
});

test("expect on a read-effect step is refused, and the error points at the expect bullet (I-12 write-effect clause)", () => {
  const src = `---
name: t
description: d
---
## Steps

### Step 1 — read it
- intent: i
- action: gbrain.get_page {"slug":"p"}
${ATTEST}
${APPROVE}
${EXPECT}
- effect: read
`;
  const expectLine = lineOf(src, "- expect:");
  try {
    parseSkill(src);
    assert.fail("should have thrown");
  } catch (err) {
    assert.ok(err instanceof SkillParseError);
    const msg = (err as Error).message;
    assert.match(msg, /'expect' requires a write-effect step/);
    assert.match(msg, new RegExp(`\\(step 1, line ${expectLine}\\)`), `expected line ${expectLine} in: ${msg}`);
  }
});

test("a step without approve/attest/expect omits those keys entirely — absent, not present-and-undefined", () => {
  // `step.expect === undefined` reads the same either way, so only own-key
  // presence can tell "this step was never state-bound" from "this step
  // carries an empty binding". Optional-by-absence is the contract the
  // Step type states and the serializer relies on.
  const plain = parseSkill(SKILL()).steps[0];
  for (const key of ["approve", "attest", "expect"]) {
    assert.ok(!(key in plain), `a bare step must not carry an own '${key}' key`);
  }
  assert.deepEqual(Object.keys(plain).sort(), ["actionArgs", "actionTool", "asserts", "binds", "effect", "intent", "line", "n", "title"]);

  // And the positive direction: a bound step carries exactly the three.
  const bound = parseSkill(SKILL(ATTEST, APPROVE, EXPECT)).steps[0];
  for (const key of ["approve", "attest", "expect"]) {
    assert.ok(key in bound, `a bound step must carry '${key}'`);
  }
});

// ---------------------------------------------------------------------------
// The closed bullet-key set: 9 keys, expect listed in the rejection message
// ---------------------------------------------------------------------------

test("unrecognized step field message lists expect among the closed key set", () => {
  assert.throws(
    () => parseSkill(SKILL(`- exxpect: {}`)),
    /Unrecognized step field, expected one of intent\/action\/assert\/bind\/effect\/exposure\/approve\/attest\/expect/
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
