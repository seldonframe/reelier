import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Resolved relative to process.cwd() rather than import.meta.url — this
// suite compiles to dist-test/test/*.test.js and runs under `node --test`
// from the repo root (that's how `npm test` always invokes it), so cwd is
// the one robust anchor regardless of where tsc places the compiled file.
const repoRoot = process.cwd();
const actionYmlPath = path.join(repoRoot, "action.yml");
const packageJsonPath = path.join(repoRoot, "package.json");

const actionYml = fs.readFileSync(actionYmlPath, "utf8");
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));

// Deliberately simple string/regex parsing — action.yml is YAML, but we
// only need one scalar out of one well-known input block, and pulling in a
// YAML dependency for that would be a worse trade than a targeted regex.
function extractCliVersionDefault(yml: string): string {
  // Tolerate CRLF (the repo's action.yml is checked in with \r\n line
  // endings on this checkout) by matching \r? before every \n.
  const inputBlockMatch = yml.match(
    /cli-version:\r?\n(?:[ \t]+.*\r?\n)*?[ \t]+default:\s*"([^"]+)"/
  );
  assert.ok(
    inputBlockMatch,
    "could not find `cli-version:` input with a `default: \"...\"` in action.yml " +
      "— did the input get renamed or restructured?"
  );
  return inputBlockMatch![1];
}

test("action.yml's cli-version default matches package.json's version (no drift)", () => {
  const pinnedVersion = extractCliVersionDefault(actionYml);
  const packageVersion = packageJson.version;

  assert.equal(
    typeof packageVersion,
    "string",
    "package.json is missing a string `version` field"
  );

  assert.equal(
    pinnedVersion,
    packageVersion,
    `action.yml pins cli-version default to "${pinnedVersion}" but package.json is ` +
      `at "${packageVersion}". This is exactly the drift that shipped a stale CLI to ` +
      `every GitHub Marketplace adopter: a release bumped package.json's version ` +
      `without bumping the version the action installs, and because the old install ` +
      `command used a caret range on a 0.x package (\`reelier@^0.12\`), npm silently ` +
      `capped it at 0.12.1 — 12 versions behind, missing the trust ladder, signing, ` +
      `and the audit log. Bump the \`cli-version\` default in action.yml alongside ` +
      `every package.json version bump.`
  );
});

test("the 'Install reelier' step's run: command never uses a caret range (caret-on-0.x trap)", () => {
  // reelier is still 0.x. For a 0.x package, npm's caret (`^0.12`) only
  // floats the PATCH digit, not the minor — `^0.12` silently caps at
  // 0.12.1 forever, no matter how many releases ship after it. That's the
  // exact bug `cli-version` (exact-pinned) replaced. Guard against it
  // coming back in the actual install command.
  //
  // Scoped to just the "Install reelier" step's `run:` line — not the
  // whole file — because the surrounding docs legitimately quote the old
  // `reelier@^0.12` command as a worked example of the bug this fixes.
  const installStepMatch = actionYml.match(
    /- name: Install reelier[\s\S]*?run:\s*(.+)\r?\n/
  );
  assert.ok(
    installStepMatch,
    "could not find the 'Install reelier' step's run: command in action.yml"
  );
  const installCommand = installStepMatch![1];

  assert.doesNotMatch(
    installCommand,
    /reelier@\^/,
    `the install command "${installCommand}" uses a caret range (reelier@^...), which ` +
      "on a 0.x package silently pins the minor version — this is the caret-on-0.x " +
      "trap that shipped a 12-versions-stale CLI to every adopter. Install an exact " +
      "version (the cli-version input) instead."
  );
});
