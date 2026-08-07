import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * `server.json` must not publish a stale version to the official MCP registry.
 *
 * Fourth occurrence of the hardcoded-version-reference bug class, and the most
 * consequential so far because nothing about it is visible locally: the
 * tag-triggered `.github/workflows/mcp-publish.yml` publishes `server.json`
 * verbatim, so a pinned version there is faithfully republished on every
 * release. Found 2026-08-07 with `server.json` at 0.24.0 while npm served
 * 0.31.1 — seven minors, republished green every time, with the registry
 * listing the wrong version and pointing npm consumers at an npm package
 * version that is real but seven minors old.
 *
 * Both occurrences are checked. The top-level `version` names the server
 * release; `packages[].version` names the npm package to install. They drifted
 * together and a test covering one would have let the other rot.
 *
 * Pinned to the EXACT version, not the minor: unlike the skill file (which
 * documents commands and semantics), this is an install coordinate. Publishing
 * `0.31.0` when npm has `0.31.1` sends users to a package version that may not
 * be the one released.
 *
 * Siblings: test/action-version-pin.test.ts, test/skill-version-pin.test.ts.
 * Resolved from process.cwd() for the same reason they are — the suite
 * compiles to dist-test/test/ and always runs from the repo root.
 */

const repoRoot = process.cwd();
const serverJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "server.json"), "utf8")) as {
  version: string;
  packages: Array<{ identifier: string; version: string }>;
};
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")) as { version: string };

test("server.json's top-level version matches package.json (no drift into the MCP registry)", () => {
  assert.equal(
    serverJson.version,
    packageJson.version,
    `server.json declares version "${serverJson.version}" but package.json is "${packageJson.version}". ` +
      `mcp-publish.yml publishes server.json verbatim on a v* tag, so this drift is republished to the ` +
      `official MCP registry on every release. Bump server.json alongside package.json.`
  );
});

test("server.json's npm package version matches package.json (the install coordinate)", () => {
  const npmPackage = serverJson.packages.find((p) => p.identifier === "reelier");
  assert.ok(npmPackage, "server.json has no npm package entry with identifier 'reelier'");
  assert.equal(
    npmPackage.version,
    packageJson.version,
    `server.json's npm package pins "${npmPackage.version}" but package.json is "${packageJson.version}". ` +
      `This is the version a registry consumer installs — a stale pin sends them to the wrong release.`
  );
});
