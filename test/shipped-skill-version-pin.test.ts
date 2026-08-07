import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * Fifth occurrence of the hardcoded-version bug class. action.yml,
 * clawhub/reelier/SKILL.md and server.json each have a pin test; the skills
 * the PLUGIN ships did not, and they are the copy strangers read first.
 * Pinned to MINOR: these document commands and semantics, which do not change
 * on a patch bump.
 *
 * Deviation from the brief's test: the brief's version skips any skill with no
 * `written against` line at all (`if (!claimed) continue`), which means a
 * future third skill shipped with no line is silently unguarded — exactly the
 * failure mode the sibling tests in this file exist to catch in other files.
 * This version instead REQUIRES the line on every shipped skill and fails
 * loudly if one is missing it, so "add a skill, forget the pin" cannot pass.
 */

const repoRoot = process.cwd();
const skillsDir = path.join(repoRoot, "integrations", "skills");
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")) as { version: string };
const expectedMinor = pkg.version.split(".").slice(0, 2).join(".");

function shippedSkills(): Array<{ id: string; body: string }> {
  return fs
    .readdirSync(skillsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ({
      id: e.name,
      body: fs.readFileSync(path.join(skillsDir, e.name, "SKILL.md"), "utf8"),
    }));
}

test("every shipped skill claims a CLI vintage, and it is the current one", () => {
  const skills = shippedSkills();
  assert.ok(skills.length > 0, "no shipped skills found under integrations/skills");
  for (const { id, body } of skills) {
    const claimed = /written against `reelier` (\d+\.\d+)\.x/.exec(body);
    assert.ok(
      claimed,
      `integrations/skills/${id}/SKILL.md has no 'written against \`reelier\` <major>.<minor>.x' line — ` +
        "every shipped skill must claim a vintage so this test can guard it; an unpinned skill is an " +
        "unguarded one.",
    );
    assert.equal(
      claimed[1],
      expectedMinor,
      `${id} says it was written against ${claimed[1]}.x but package.json is ${pkg.version}`,
    );
  }
});

test("the write-safety skill's coverage quote matches the CLI's actual output", () => {
  // The skill instructs the agent to repeat this line verbatim to the user.
  // Pin it against the string `coverage.ts` actually emits, so a copy-edit to
  // either side becomes a test failure instead of a silently dead quote.
  const skillBody = fs.readFileSync(
    path.join(skillsDir, "reelier-write-safety", "SKILL.md"),
    "utf8",
  );
  const quoted = /^> `(.+)`$/m.exec(skillBody);
  assert.ok(quoted, "reelier-write-safety/SKILL.md no longer quotes the coverage command's last line");

  const coverageSrc = fs.readFileSync(path.join(repoRoot, "src", "coverage.ts"), "utf8");
  const emitted = /lines\.push\("(Observed inventory only[^"]*)"\)/.exec(coverageSrc);
  assert.ok(emitted, "src/coverage.ts no longer emits an 'Observed inventory only' line — update or drop the quote");

  assert.equal(
    quoted[1],
    emitted[1],
    "reelier-write-safety/SKILL.md quotes a coverage line that no longer matches src/coverage.ts's actual output",
  );
});
