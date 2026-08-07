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

test("every shipped skill's frontmatter name matches its directory", () => {
  // Both skills land in the same plugin under skills/<dir>/. When the
  // frontmatter name disagrees with the directory, a host keying on one and a
  // reader keying on the other disagree about which skill is which — and with
  // two skills shipping together, one of them declaring the bare product name
  // reads like the only skill. Caught when the second skill was added: the
  // first still said `name: reelier`.
  for (const { id, body } of shippedSkills()) {
    const declared = /^name:\s*(\S+)\s*$/m.exec(body)?.[1];
    assert.equal(declared, id, `skills/${id}/SKILL.md declares name: ${declared}`);
  }
});

test("no shipped skill forbids the CLI fallback", () => {
  for (const { id, body } of shippedSkills()) {
    assert.doesNotMatch(
      body,
      // \s+ rather than literal spaces: the phrasing this guards against was
      // hard-wrapped in the source as "don't try\nto shell out", so a regex
      // assuming single spaces did not match the real historical defect at
      // all. Verified by running this pattern against the pre-fix file.
      /(?:don't|do\s+not)\s+try\s+to\s+shell\s+out|do\s+not\s+shell\s+out/i,
      `${id} forbids the CLI fallback, which strands a bare plugin install`,
    );
  }
});
