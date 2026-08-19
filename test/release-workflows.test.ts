import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

// Resolved relative to process.cwd() — same cwd-anchored precedent as
// test/action-version-pin.test.ts: this suite compiles to
// dist-test/test/release-workflows.test.js and runs under `node --test`
// from the repo root, so cwd is the one robust anchor regardless of where
// tsc places the compiled file.
const read = (relative: string) => readFileSync(path.resolve(relative), "utf8");

test("npm-publish.yml pins the governed publish shape", () => {
  const workflow = read(".github/workflows/npm-publish.yml");
  for (const required of [
    'tags: ["v*"]', "workflow_dispatch:", "id-token: write", "contents: read",
    "environment: production-release", "node-version: 24", "fetch-depth: 0",
    "node scripts/check-release-ancestor.mjs", "node scripts/verify-release-authorization.mjs",
    "node scripts/reconcile-npm-destination.mjs", "npm ci", "npm run build", "npm pack",
    "--provenance", "concurrency:", "group: npm-publish-${{ github.ref_name }}", "cancel-in-progress: false",
  ]) assert.ok(workflow.includes(required), `npm-publish.yml is missing: ${required}`);
});
