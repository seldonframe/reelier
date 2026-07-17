import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSkill, SkillParseError } from "../src/skill.js";

const VALID_SKILL = `---
name: example-skill
description: An example skill for tests
---

# Example

## Steps

### Step 1 — First step
- intent: Do the first thing
- action: http.get {"url": "https://example.com/{{slug}}"}
- assert: status == 200
- assert: body contains "hello"
- bind: token = json.data.token
- effect: read

### Step 2 — Second step
- intent: Do the second thing
- action: http.post {"url": "https://example.com/two", "body": {"t": "{{token}}"}}
- effect: idempotent-write
`;

test("parses a valid skill with frontmatter and steps", () => {
  const skill = parseSkill(VALID_SKILL);
  assert.equal(skill.name, "example-skill");
  assert.equal(skill.description, "An example skill for tests");
  assert.equal(skill.steps.length, 2);

  const s1 = skill.steps[0];
  assert.equal(s1.n, 1);
  assert.equal(s1.title, "First step");
  assert.equal(s1.intent, "Do the first thing");
  assert.equal(s1.actionTool, "http.get");
  assert.deepEqual(s1.actionArgs, { url: "https://example.com/{{slug}}" });
  assert.deepEqual(s1.asserts, ['status == 200', 'body contains "hello"']);
  assert.deepEqual(s1.binds, ["token = json.data.token"]);
  assert.equal(s1.effect, "read");

  const s2 = skill.steps[1];
  assert.equal(s2.n, 2);
  assert.equal(s2.asserts.length, 0);
  assert.equal(s2.effect, "idempotent-write");
});

test("rejects a skill missing the opening frontmatter fence", () => {
  const bad = "# no frontmatter\n\n## Steps\n";
  assert.throws(() => parseSkill(bad), SkillParseError);
});

test("rejects a skill with unclosed frontmatter fence", () => {
  const bad = "---\nname: x\ndescription: y\n\n## Steps\n";
  assert.throws(() => parseSkill(bad), SkillParseError);
});

test("rejects a skill missing required frontmatter field 'name'", () => {
  const bad = "---\ndescription: y\n---\n\n### Step 1 — t\n- intent: i\n- action: http.get {\"url\":\"x\"}\n- effect: read\n";
  assert.throws(() => parseSkill(bad), /name/);
});

test("rejects a skill with no step headers", () => {
  const bad = "---\nname: x\ndescription: y\n---\n\nNo steps here.\n";
  assert.throws(() => parseSkill(bad), /Step/);
});

test("rejects a skill with out-of-order step numbers", () => {
  const bad = `---
name: x
description: y
---

### Step 1 — first
- intent: i
- action: http.get {"url":"x"}
- effect: read

### Step 3 — third
- intent: i
- action: http.get {"url":"x"}
- effect: read
`;
  assert.throws(() => parseSkill(bad), /sequentially/);
});

test("rejects a step missing required 'intent'", () => {
  const bad = `---
name: x
description: y
---

### Step 1 — first
- action: http.get {"url":"x"}
- effect: read
`;
  assert.throws(() => parseSkill(bad), /intent/);
});

test("rejects a step missing required 'action'", () => {
  const bad = `---
name: x
description: y
---

### Step 1 — first
- intent: i
- effect: read
`;
  assert.throws(() => parseSkill(bad), /action/);
});

test("rejects a step missing required 'effect'", () => {
  const bad = `---
name: x
description: y
---

### Step 1 — first
- intent: i
- action: http.get {"url":"x"}
`;
  assert.throws(() => parseSkill(bad), /effect/);
});

test("rejects an invalid effect value", () => {
  const bad = `---
name: x
description: y
---

### Step 1 — first
- intent: i
- action: http.get {"url":"x"}
- effect: dangerous
`;
  assert.throws(() => parseSkill(bad), /Invalid effect/);
});

test("rejects malformed JSON in an action line", () => {
  const bad = `---
name: x
description: y
---

### Step 1 — first
- intent: i
- action: http.get {url: x}
- effect: read
`;
  assert.throws(() => parseSkill(bad), /valid JSON/);
});

test("rejects an unrecognized bulleted field", () => {
  const bad = `---
name: x
description: y
---

### Step 1 — first
- intent: i
- action: http.get {"url":"x"}
- effect: read
- bogus: nope
`;
  assert.throws(() => parseSkill(bad), /Unrecognized step field/);
});

test("tolerates trailing '## Open questions' and '## Changelog' sections after the steps", () => {
  const source = `---
name: example-skill
description: An example skill for tests
---

## Steps

### Step 1 — First step
- intent: Do the first thing
- action: http.get {"url": "https://example.com"}
- assert: status == 200
- effect: read

## Open questions

- Step 1: this is not a step field, just prose.
- (trailing note): another bullet that must not be parsed as a step field.

## Changelog

- 2026-07-17 — compiled from trace.jsonl (1 calls, 1 steps)
`;
  const skill = parseSkill(source);
  assert.equal(skill.steps.length, 1);
  assert.equal(skill.steps[0].asserts.length, 1);
  assert.deepEqual(skill.steps[0].asserts, ["status == 200"]);
});

test("error message names the step and line for a malformed step", () => {
  const bad = `---
name: x
description: y
---

### Step 1 — first
- intent: i
- action: http.get {"url":"x"}
- effect: read

### Step 2 — second
- intent: i
- effect: read
`;
  try {
    parseSkill(bad);
    assert.fail("expected SkillParseError");
  } catch (err) {
    assert.ok(err instanceof SkillParseError);
    assert.match(err.message, /step 2/);
    assert.match(err.message, /line \d+/);
  }
});
