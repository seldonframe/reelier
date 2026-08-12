import test from "node:test";
import assert from "node:assert/strict";
import {
  runGitHubIssueLabelsHermeticCertificationSuite,
  verifyGitHubIssueLabelsCertificationExport,
} from "../../src/authority/certification/github-issue-labels-runner.js";
import { getCertificationRunnerRegistryEntry } from "../../src/authority/certification/runner-registry.js";

test("GitHub issue-label certification executes the fixed private lifecycle and verifies its portable graph offline", async () => {
  const suite = await runGitHubIssueLabelsHermeticCertificationSuite();
  const normal = suite.cases.find(item => item.caseId === "normal")!;

  assert.deepEqual(normal.lifecycle, [
    "prepare", "authoritative-read-1", "compile-1", "reserve",
    "authoritative-read-2", "compile-2", "permit-revalidate",
    "durable-dispatched", "budget-consumed", "provider-write",
    "authoritative-readback", "reconciled", "receipt",
    "cleanup-authorized", "cleanup-dispatched", "cleanup-provider-write",
    "cleanup-readback", "cleanup-reconciled", "cleanup-receipt",
  ]);
  assert.equal(normal.status, "passed");
  assert.equal(normal.providerWrites, 2);
  assert.equal(normal.receipts.length, 2);
  assert.equal(normal.receipts[1]?.priorReceiptDigest, normal.receipts[0]?.digest);
  assert.deepEqual(normal.beforeLabels, ["before", "triage"]);
  assert.deepEqual(normal.afterLabels, ["certification-after"]);
  assert.deepEqual(normal.finalLabels, normal.beforeLabels);
  assert.doesNotMatch(JSON.stringify(normal), /Bearer |REELIER_GITHUB_TOKEN|token_[A-Za-z0-9]/);

  const verified = verifyGitHubIssueLabelsCertificationExport(suite.exported);
  assert.equal(verified.graphDigest, suite.graphDigest);
  assert.equal(verified.receiptCount, suite.graph.receipts.length);
  assert.equal(verified.secretsRequired, false);
});

test("drift, effect mismatch, and caller substitution refuse before any provider write", async () => {
  const suite = await runGitHubIssueLabelsHermeticCertificationSuite();
  for (const caseId of ["source-drift", "effect-mismatch", "caller-substitution"] as const) {
    const result = suite.cases.find(item => item.caseId === caseId)!;
    assert.equal(result.status, "refused", caseId);
    assert.equal(result.providerWrites, 0, caseId);
    assert.equal(result.lifecycle.includes("provider-write"), false, caseId);
  }
});

test("apply-then-cut ambiguity persists, reconciles later, and never resends", async () => {
  const suite = await runGitHubIssueLabelsHermeticCertificationSuite();
  const result = suite.cases.find(item => item.caseId === "apply-then-cut")!;
  assert.equal(result.status, "passed");
  assert.equal(result.lifecycle.includes("ambiguous-persisted"), true);
  assert.equal(result.lifecycle.includes("reconcile-later"), true);
  assert.equal(result.primaryWriteAttempts, 1);
  assert.equal(result.resentAfterAmbiguity, false);
});

test("acknowledgement alone never reconciles and failed cleanup is stranded, never passed", async () => {
  const suite = await runGitHubIssueLabelsHermeticCertificationSuite();
  const acknowledgement = suite.cases.find(item => item.caseId === "acknowledgement-only")!;
  assert.equal(acknowledgement.status, "exception");
  assert.equal(acknowledgement.reconciliation, "unavailable");
  assert.equal(acknowledgement.lifecycle.includes("provider-acknowledged"), true);
  assert.equal(acknowledgement.lifecycle.includes("reconciled"), false);

  const cleanup = suite.cases.find(item => item.caseId === "cleanup-failure")!;
  assert.equal(cleanup.status, "stranded");
  assert.equal(cleanup.cleanup, "failed");
  assert.notEqual(cleanup.status, "passed");
});

test("GitHub alone carries hermetic implementation and executed-test readiness", () => {
  const github = getCertificationRunnerRegistryEntry("github-issue-labels");
  assert.equal(github.executionReady, true);
  assert.equal(github.dispatchable, true);
  assert.match(github.implementationDigest ?? "", /^sha256:[0-9a-f]{64}$/);
  assert.match(github.testEvidenceDigest ?? "", /^sha256:[0-9a-f]{64}$/);
  for (const scenario of ["cloudflare-dns", "cloudflare-vercel-secret", "neon-migration", "slack-topic", "vercel-promotion"] as const) {
    const runner = getCertificationRunnerRegistryEntry(scenario);
    assert.equal(runner.executionReady, false, scenario);
    assert.equal(runner.dispatchable, false, scenario);
  }
});
