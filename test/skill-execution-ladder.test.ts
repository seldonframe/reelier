import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// A skill that names a `reelier_*` MCP tool without also stating the CLI
// fallback is a skill that dead-ends on a bare plugin install. That is the
// exact defect this rewrite fixes, and this test is what stops it returning.
const skillsDir = path.join(process.cwd(), "integrations", "skills");

function shippedSkills(): Array<{ id: string; body: string }> {
  return fs
    .readdirSync(skillsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ({
      id: e.name,
      body: fs.readFileSync(path.join(skillsDir, e.name, "SKILL.md"), "utf8"),
    }));
}

test("every shipped skill that names an MCP tool also states the CLI fallback", () => {
  const skills = shippedSkills();
  assert.ok(skills.length > 0, "no shipped skills found");
  for (const { id, body } of skills) {
    if (!/reelier_[a-z_]+/.test(body)) continue;
    assert.match(body, /npx -y reelier/, `${id} names a reelier_* tool but never states the npx fallback`);
  }
});

test("no shipped skill forbids the CLI fallback", () => {
  for (const { id, body } of shippedSkills()) {
    assert.doesNotMatch(
      body,
      /don't try to shell out|do not shell out/i,
      `${id} forbids the CLI fallback, which strands a bare plugin install`,
    );
  }
});
