import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSkill, SkillParseError, EXPOSURES } from "../src/skill.js";
import { serializeSkill } from "../src/writeback.js";

/**
 * The `exposure` axis (SPEC §3.7): whether an actor OUTSIDE the system may
 * already have acted on a step's result. Orthogonal to `effect`, which is
 * mechanical — a `destructive` delete and a `destructive` send are the same
 * `effect` and nothing alike in consequence.
 *
 * In this version it is a corpus deposit and a display axis only: it changes
 * NO gating behaviour. The runner-side half of that promise is pinned in
 * test/exposure-record.test.ts.
 */

function skillWith(bullets: string, effect = "read"): string {
  return `---
name: exposure-fixture
description: A skill for exercising the exposure axis
---

# Exposure fixture

## Steps

### Step 1 — Only step
- intent: do the thing
- action: http.get {"url": "https://example.com/one"}
- effect: ${effect}
${bullets}`;
}

test("EXPOSURES is exactly the two legal values", () => {
  assert.deepEqual([...EXPOSURES], ["internal", "external-visible"]);
});

for (const value of ["internal", "external-visible"] as const) {
  test(`parses 'exposure: ${value}' onto the step`, () => {
    const skill = parseSkill(skillWith(`- exposure: ${value}\n`));
    assert.equal(skill.steps[0].exposure, value);
  });
}

test("a step with no 'exposure' bullet parses with the field ABSENT, not defaulted", () => {
  const skill = parseSkill(skillWith(""));
  const step = skill.steps[0];
  assert.equal(step.exposure, undefined);
  // Absent, not the string "internal": the default lives at the read site so
  // a record can still tell "the author said internal" from "the author said
  // nothing". `in` is the load-bearing check — `=== undefined` passes either way.
  assert.equal("exposure" in step, false);
});

test("rejects an exposure value outside the closed set, naming both legal values", () => {
  assert.throws(
    () => parseSkill(skillWith("- exposure: whatever\n")),
    (err: unknown) => {
      assert.ok(err instanceof SkillParseError);
      assert.match(err.message, /Invalid exposure "whatever" — must be one of internal, external-visible/);
      return true;
    }
  );
});

test("rejects a duplicate 'exposure' bullet, like every other single-cardinality key", () => {
  assert.throws(
    () => parseSkill(skillWith("- exposure: internal\n- exposure: external-visible\n")),
    (err: unknown) => {
      assert.ok(err instanceof SkillParseError);
      assert.match(err.message, /Duplicate 'exposure' field in step/);
      return true;
    }
  );
});

test("an unknown step key still throws, and the message now lists nine", () => {
  assert.throws(
    () => parseSkill(skillWith("- frobnicate: x\n")),
    (err: unknown) => {
      assert.ok(err instanceof SkillParseError);
      assert.match(
        err.message,
        /Unrecognized step field, expected one of intent\/action\/assert\/bind\/effect\/exposure\/approve\/attest\/expect/
      );
      return true;
    }
  );
});

test("a skill using 'exposure' round-trips through parseSkill → serializeSkill → parseSkill", () => {
  const source = skillWith("- exposure: external-visible\n", "destructive");
  const skill = parseSkill(source);

  const serialized = serializeSkill(skill);
  assert.match(serialized, /^- exposure: external-visible$/m);

  const reparsed = parseSkill(serialized);
  assert.equal(reparsed.steps[0].exposure, "external-visible");
  assert.equal(serializeSkill(reparsed), serialized);
});

test("a skill WITHOUT 'exposure' serializes byte-identically to before the key existed", () => {
  const skill = parseSkill(skillWith(""));
  const serialized = serializeSkill(skill);
  assert.equal(/^- exposure:/m.test(serialized), false);
  // The full canonical step block, pinned: the new key adds no line, no blank,
  // and no reordering to a skill that does not use it.
  assert.equal(
    serialized,
    `---
name: exposure-fixture
description: A skill for exercising the exposure axis
---

# Exposure fixture

## Steps

### Step 1 — Only step
- intent: do the thing
- action: http.get {"url":"https://example.com/one"}
- effect: read
`
  );
});
