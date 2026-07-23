import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSkill, SkillParseError } from "../src/skill.js";
import { serializeSkill } from "../src/writeback.js";

const VALID_MANIFEST_LINE =
  'manifest: {"tools":[{"digest":"sha256:' +
  "0".repeat(64) +
  '","name":"crm.create_contact","server":"seldonframe"}],"v":1}';

function skillWithManifest(manifestLine: string): string {
  return `---
name: example-skill
description: An example skill for tests
${manifestLine}
---

### Step 1 — First step
- intent: Do the first thing
- action: http.get {"url": "https://example.com"}
- assert: status == 200
- effect: read
`;
}

const NO_MANIFEST = `---
name: example-skill
description: An example skill for tests
---

### Step 1 — First step
- intent: Do the first thing
- action: http.get {"url": "https://example.com"}
- assert: status == 200
- effect: read
`;

test("a skill with a valid manifest: line parses, digest matches", () => {
  const skill = parseSkill(skillWithManifest(VALID_MANIFEST_LINE));
  assert.ok(skill.manifest);
  assert.equal(skill.manifest?.v, 1);
  assert.equal(skill.manifest?.tools.length, 1);
  assert.equal(skill.manifest?.tools[0].digest, "sha256:" + "0".repeat(64));
  assert.equal(skill.manifest?.tools[0].name, "crm.create_contact");
  assert.equal(skill.manifest?.tools[0].server, "seldonframe");
});

test("malformed manifest JSON is rejected loudly, naming the key", () => {
  assert.throws(
    () => parseSkill(skillWithManifest("manifest: {not valid json")),
    (err: unknown) => err instanceof SkillParseError && /manifest/i.test(err.message)
  );
});

test("manifest with wrong version is rejected", () => {
  const bad = 'manifest: {"tools":[],"v":2}';
  assert.throws(() => parseSkill(skillWithManifest(bad)), SkillParseError);
});

test("manifest whose tools is not an array is rejected", () => {
  const bad = 'manifest: {"tools":"nope","v":1}';
  assert.throws(() => parseSkill(skillWithManifest(bad)), SkillParseError);
});

test("manifest tool missing name/digest is rejected", () => {
  const bad = 'manifest: {"tools":[{"server":"x"}],"v":1}';
  assert.throws(() => parseSkill(skillWithManifest(bad)), SkillParseError);
});

test("manifest tool with a malformed digest is rejected", () => {
  const bad = 'manifest: {"tools":[{"name":"x","digest":"not-a-digest"}],"v":1}';
  assert.throws(() => parseSkill(skillWithManifest(bad)), SkillParseError);
});

test("serialize -> parse -> serialize is byte-identical for a skill WITH a manifest", () => {
  const skill = parseSkill(skillWithManifest(VALID_MANIFEST_LINE));
  const once = serializeSkill(skill);
  const reparsed = parseSkill(once);
  const twice = serializeSkill(reparsed);
  assert.equal(once, twice);
  assert.match(once, /^manifest: /m);
});

test("a skill WITHOUT a manifest serializes byte-identically to today (no manifest: line)", () => {
  const skill = parseSkill(NO_MANIFEST);
  assert.equal(skill.manifest, undefined);
  const rendered = serializeSkill(skill);
  assert.doesNotMatch(rendered, /manifest:/);
});
