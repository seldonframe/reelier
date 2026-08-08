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

test("every shipped skill carries the execution ladder itself, not just its vocabulary", () => {
  // The previous version of this file guarded only the substring `npx -y
  // reelier`, which every skill body mentions a dozen times in ordinary
  // command examples. Deleting the entire "How to run Reelier — in this
  // order" section left the suite green. So assert the ladder's own
  // structure: the heading, three numbered rungs under it, and the honesty
  // sentence the spec calls the point of the whole section. Proven to bite by
  // deleting the section from reelier-write-safety and watching this fail.
  for (const { id, body } of shippedSkills()) {
    const section = /^## How to run Reelier — in this order$([\s\S]*?)(?=^## )/m.exec(body)?.[1];
    assert.ok(section, `${id} has no "How to run Reelier — in this order" section`);

    for (const rung of [1, 2, 3]) {
      assert.match(
        section,
        new RegExp(`^${rung}\\. `, "m"),
        `${id}'s execution ladder is missing rung ${rung}`,
      );
    }

    // \s+ rather than literal spaces: the sentence is hard-wrapped in both
    // sources, so a single-space pattern would not match either one.
    assert.match(
      section,
      /Never\s+describe\s+a\s+step\s+as\s+done\s+when\s+it\s+did\s+not\s+run/,
      `${id}'s execution ladder drops the honesty sentence, which is the point of it`,
    );
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
