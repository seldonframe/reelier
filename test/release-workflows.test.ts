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

// B4: the same verifier gate lands on the two remaining tag-triggered publish
// workflows, using the exact B3-landed contract above (--ref fixed-prefix +
// $GITHUB_REF_NAME, git fetch of the out-of-band ref namespace first, npm ci
// && npm run build first, SHA-pinned newly-referenced actions) plus R5's
// tags-only condition so mcp-publish.yml's workflow_dispatch path and
// docker-publish.yml's pull_request validation path keep working unchanged.

test("mcp-publish.yml gates tag publishes behind the environment and verifier", () => {
  const workflow = read(".github/workflows/mcp-publish.yml");
  for (const required of [
    "environment: production-release",
    "node scripts/verify-release-authorization.mjs",
    '--ref "refs/reelier/release-authorizations/', // fixed-prefix ref read, never a bare --from-tag
    'git fetch origin "+refs/reelier/*', // the release-authorization ref namespace must be fetched before the verifier reads it
    "node-version: 24",
    "npm ci",
    "npm run build",
    "if: startsWith(github.ref, 'refs/tags/')", // R5: tags-only, so workflow_dispatch keeps working unchanged
    "uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4",
    // D1 prep pass: pin the remaining mutable tag on this gated workflow so a
    // future edit can't silently regress it back to a floating major tag.
    "uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4",
  ]) assert.ok(workflow.includes(required), `mcp-publish.yml is missing: ${required}`);
  assert.ok(workflow.indexOf("check-release-ancestor.mjs") < workflow.indexOf("verify-release-authorization.mjs"), "verifier must run after the ancestor guard");
  assert.ok(workflow.indexOf("verify-release-authorization.mjs") < workflow.indexOf("Install mcp-publisher"), "verifier must run before mcp-publisher install");
});

test("mcp-publish.yml never reintroduces the corrected-away insecure forms", () => {
  const workflow = read(".github/workflows/mcp-publish.yml");
  for (const forbidden of ["--from-tag", "REELIER_RELEASE_SIGNER_"]) {
    assert.ok(!workflow.includes(forbidden), `mcp-publish.yml must never contain: ${forbidden}`);
  }
});

test("docker-publish.yml gates tag/release publishes behind the environment and verifier, PR validation ungated", () => {
  const workflow = read(".github/workflows/docker-publish.yml");
  for (const required of [
    // The PR validation path (build-only, no push) must not queue on the
    // mission-#1 reviewer: it evaluates to the empty string, which GitHub
    // Actions treats as "no environment".
    "environment: ${{ github.event_name != 'pull_request' && 'production-release' || '' }}",
    "node scripts/verify-release-authorization.mjs",
    '--ref "refs/reelier/release-authorizations/',
    'git fetch origin "+refs/reelier/*',
    "node-version: 24",
    "npm ci",
    "npm run build",
    "if: startsWith(github.ref, 'refs/tags/')", // R5: same tags-only condition already on the ancestor guard
    "uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4",
    // D1 prep pass: pin the remaining mutable tags on this gated workflow
    // (checkout + the three docker/* actions) so a future edit can't
    // silently regress it back to floating major tags.
    "uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4",
    "uses: docker/setup-buildx-action@8d2750c68a42422c14e847fe6c8ac0403b4cbd6f # v3",
    "uses: docker/login-action@c94ce9fb468520275223c153574b00df6fe4bcc9 # v3",
    "uses: docker/metadata-action@c299e40c65443455700f0fdfc63efafe5b349051 # v5",
    "uses: docker/build-push-action@10e90e3645eae34f1e60eeb005ba3a3d33f178e8 # v6",
  ]) assert.ok(workflow.includes(required), `docker-publish.yml is missing: ${required}`);
  assert.ok(workflow.indexOf("check-release-ancestor.mjs") < workflow.indexOf("verify-release-authorization.mjs"), "verifier must run after the ancestor guard");
  assert.ok(workflow.indexOf("verify-release-authorization.mjs") < workflow.indexOf("docker/setup-buildx-action"), "verifier must run before the docker buildx step");
});

test("docker-publish.yml never reintroduces the corrected-away insecure forms", () => {
  const workflow = read(".github/workflows/docker-publish.yml");
  for (const forbidden of ["--from-tag", "REELIER_RELEASE_SIGNER_"]) {
    assert.ok(!workflow.includes(forbidden), `docker-publish.yml must never contain: ${forbidden}`);
  }
});
