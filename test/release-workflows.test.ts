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
    // B3 review, Important #1 and #3: pin the security corrections so a
    // future edit can't silently regress this workflow back to the shape
    // it was reviewed away from (a raw --from-tag verifier call, and
    // unpinned floating action tags).
    '--ref "refs/reelier/release-authorizations/', // fixed-prefix ref read, never a bare --from-tag
    'git fetch origin "+refs/reelier/*', // the release-authorization ref namespace must be fetched before the verifier reads it
    "uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4",
    "uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4",
  ]) assert.ok(workflow.includes(required), `npm-publish.yml is missing: ${required}`);
});

test("npm-publish.yml never reintroduces the corrected-away insecure forms", () => {
  const workflow = read(".github/workflows/npm-publish.yml");
  for (const forbidden of [
    // R6's fix replaced --from-tag with --ref/--check-head everywhere; the
    // verifier script itself refuses --from-tag outright, but pinning its
    // absence here catches a regression before it ever runs in CI.
    "--from-tag",
    // The trust-pin signer identity/key must come only from the committed
    // release/trust/release-authorization-signer.json file. The verifier
    // script treats REELIER_RELEASE_SIGNER_ID or REELIER_RELEASE_SIGNER_SPKI
    // being set as a hard failure — this workflow must never set them, and
    // must never even name them where a future edit could copy them into a
    // real env: block.
    "REELIER_RELEASE_SIGNER_",
  ]) assert.ok(!workflow.includes(forbidden), `npm-publish.yml must never contain: ${forbidden}`);
});
