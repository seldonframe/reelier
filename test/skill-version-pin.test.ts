import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * The shipped skill file must not claim a stale CLI vintage.
 *
 * Third occurrence of one bug class, which is why it now has a test: `action.yml` pinned the
 * installed CLI at `^0.12` while latest was 0.24 (a caret on a 0.x package floats only the patch
 * digit), the cloud's package.json pinned the parser at `^0.12.0` and parsed with a seven-minor-old
 * grammar, and this file said "written against reelier 0.12.x" at 0.27. Every one was a hardcoded
 * version reference that drifted silently because nothing compared it to package.json.
 *
 * Pinned to MINOR, not patch: the skill documents commands and semantics, which do not change on a
 * patch bump, and requiring a doc edit for every patch would train people to ignore this test.
 *
 * Sibling of test/action-version-pin.test.ts, and resolved the same way (process.cwd(), since the
 * suite compiles to dist-test/test/ and always runs from the repo root under `npm test`).
 */

const repoRoot = process.cwd();
const skillPath = path.join(repoRoot, "clawhub", "reelier", "SKILL.md");
const packageJsonPath = path.join(repoRoot, "package.json");

const skillMd = fs.readFileSync(skillPath, "utf8");
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as { version: string };

/** `written against \`reelier\` 0.27.x` -> "0.27" */
function declaredMinor(md: string): string {
  const m = md.match(/written against `reelier` (\d+\.\d+)\.x/);
  assert.ok(
    m,
    "could not find a 'written against `reelier` <major>.<minor>.x' line in clawhub/reelier/SKILL.md — " +
      "if the phrasing changed, update this test rather than dropping the version claim: an unpinned " +
      "version claim is exactly how this drifted fifteen minor versions the first time.",
  );
  return m[1];
}

function packageMinor(version: string): string {
  const m = version.match(/^(\d+\.\d+)\./);
  assert.ok(m, `package.json version ${JSON.stringify(version)} is not <major>.<minor>.<patch>`);
  return m[1];
}

test("the shipped skill's declared CLI version matches package.json (minor)", () => {
  const declared = declaredMinor(skillMd);
  const actual = packageMinor(packageJson.version);
  assert.equal(
    declared,
    actual,
    `clawhub/reelier/SKILL.md says it was written against reelier ${declared}.x, but this repo publishes ` +
      `${packageJson.version}. Update the skill (and check whether anything it documents actually changed) ` +
      `— a skill that misstates its vintage teaches the wrong commands to every agent that reads it.`,
  );
});

test("the shipped skill states its safety constraints and runtime boundary", () => {
  // These sections are the difference between a how-to and a skill an agent can be trusted to act
  // on unattended. Losing them in a future edit should fail loudly, not silently.
  for (const heading of ["## Safety constraints", "## Runtime boundary", "## The honesty boundary"]) {
    assert.ok(skillMd.includes(heading), `clawhub/reelier/SKILL.md is missing the "${heading}" section`);
  }
  assert.match(
    skillMd,
    /untrusted data/i,
    "the skill must tell the agent to treat tool results and web content as untrusted data",
  );
});
