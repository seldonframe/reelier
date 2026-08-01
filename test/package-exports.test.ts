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

/**
 * Map an exports target to the source that must produce it. `npm test` compiles only
 * `dist-test/`, never `dist/`, so asserting on `dist/` alone makes this test pass or fail
 * depending on whether someone ran `npm run build` earlier in that directory — the same
 * order-dependence that let a stale `dist-test/` inflate the pass count. The source check
 * is build-independent and catches the real defect: a subpath naming a module that does
 * not exist. The emitted file is checked too, but only when a build is actually present.
 */
function sourceFor(target: string): string | undefined {
  const m = /^\.\/dist\/(.+)\.js$/.exec(target);
  return m ? `src/${m[1]}.ts` : undefined;
}

test("every exports subpath points at a module that exists in source", () => {
  const missing: string[] = [];
  for (const [subpath, target] of Object.entries(pkg.exports)) {
    // Wildcards (e.g. "./contract/*") name a directory, not a file — check the directory.
    // Strip the star and keep the trailing slash; `existsSync("./contract/")` is true and
    // `existsSync("./contract-nope/")` is false on both POSIX and Windows. Do NOT wrap this
    // in path.dirname — dirname("./contract/") is ".", the repo root, which always exists,
    // and the check silently degrades to "does this repo exist".
    const rel = target.includes("*") ? target.replace("*", "") : (sourceFor(target) ?? target);
    if (!existsSync(path.join(REPO_ROOT, rel))) missing.push(`${subpath} -> ${target} (looked for ${rel})`);
  }
  assert.deepEqual(missing, [], `exports map names modules that do not exist: ${missing.join(", ")}`);
});

test("when a build is present, every exports subpath resolves to an emitted file", () => {
  if (!existsSync(path.join(REPO_ROOT, "dist"))) return; // no build here; the source test above still ran
  const missing: string[] = [];
  for (const [subpath, target] of Object.entries(pkg.exports)) {
    const rel = target.includes("*") ? target.replace("*", "") : target;
    if (!existsSync(path.join(REPO_ROOT, rel))) missing.push(`${subpath} -> ${target}`);
  }
  assert.deepEqual(missing, [], `exports map points at files the build did not emit: ${missing.join(", ")}`);
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
