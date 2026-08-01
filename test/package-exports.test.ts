import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * The `exports` map is the package's public API surface, and nothing checked it.
 *
 * A subpath that points at a file the build does not emit is invisible until a consumer
 * hits ERR_MODULE_NOT_FOUND at import time — which is to say, in someone else's project
 * after publish. reelier-cloud consumes `./footprint` and `./priors` this way, so a typo
 * or a renamed source file breaks a downstream service rather than this suite.
 *
 * This is a pure lint over package.json and the build output. It does not import the
 * modules (that would pull the whole runtime into the test); it checks the map is honest
 * about what it points at.
 */

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")) as {
  exports: Record<string, string>;
};

test("every exports subpath points at a file the build actually emits", () => {
  const missing: string[] = [];
  for (const [subpath, target] of Object.entries(pkg.exports)) {
    // Wildcards (e.g. "./contract/*") name a directory, not a file — check the directory.
    const rel = target.includes("*") ? path.dirname(target.replace("*", "")) : target;
    if (!existsSync(path.join(REPO_ROOT, rel))) missing.push(`${subpath} -> ${target}`);
  }
  assert.deepEqual(
    missing,
    [],
    `exports map points at files that do not exist (run \`npm run build\` first): ${missing.join(", ")}`
  );
});

test("the subpaths reelier-cloud imports are present — removing one is a breaking change", () => {
  // Named explicitly rather than derived, so deleting an entry from package.json fails
  // here instead of silently shrinking the public surface a downstream service depends on.
  for (const required of [".", "./skill", "./footprint", "./priors"]) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(pkg.exports, required),
      `exports is missing "${required}", which reelier-cloud imports`
    );
  }
});
