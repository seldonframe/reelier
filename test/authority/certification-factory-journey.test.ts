import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, lstat, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runAuthorityCommand } from "../../src/authority/cli.js";
import { authorityDigest } from "../../src/authority/wire.js";
import { __testSetFactoryJourneyFault, type FactoryJourneyFault } from "../../src/authority/certification/factory-journey.js";
import { verifyCertificationTaskReceiptGraph } from "../../src/authority/certification/task-receipt-graph.js";
import { __testSetAuthorityCellHostPlatform } from "../../src/authority/host/platform.js";

type AuthorityCommand = Parameters<typeof runAuthorityCommand>[0];

async function capture(command: AuthorityCommand): Promise<Readonly<{ code: number; stdout: string[]; stderr: string[] }>> {
  const stdout: string[] = [], stderr: string[] = [];
  const log = console.log, error = console.error;
  console.log = (...values: unknown[]) => { stdout.push(values.join(" ")); };
  console.error = (...values: unknown[]) => { stderr.push(values.join(" ")); };
  try { return { code: await runAuthorityCommand(command), stdout, stderr }; }
  finally { console.log = log; console.error = error; }
}

function command(out: string, overrides: Partial<AuthorityCommand> = {}): AuthorityCommand {
  return { positional: ["certify", "factory-journey"], flags: new Set(), opts: { out }, ...overrides };
}

function assertRefused(result: Awaited<ReturnType<typeof capture>>): void {
  assert.equal(result.code, 1);
  assert.deepEqual(result.stdout, []);
  assert.deepEqual(result.stderr, [JSON.stringify({ status: "refused", reasonCode: "factory-journey-refused" })]);
}

async function privateResidue(parent: string): Promise<string[]> {
  return (await readdir(parent)).filter(name => name.startsWith(".reelier-factory-"));
}

const rawDigest = (bytes: Buffer): string => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const FACTORY_SECRET_CANARY = "REELIER_FACTORY_SECRET_CANARY_V1_6F4E91C28A73";

async function writeFactoryEvidenceMetadata(evidence: string, tarball: string): Promise<void> {
  const files = ["graph.json", "trust-pin.json", "factory-journey-summary.json"];
  const [graphDigest, trustPinDigest, summaryDigest] = await Promise.all(files.map(async file => rawDigest(await readFile(path.join(evidence, file)))));
  const metadata = { v: "reelier.factory-evidence-metadata/v1", workflowSourceSha: "review-falsifier", tarballSha256: rawDigest(await readFile(tarball)).slice(7), adapterContractDigest: (await import("../../src/authority/adapter-contract.js")).AUTHORITY_ADAPTER_CONTRACT_V1_DIGEST, graphDigest, trustPinDigest, summaryDigest, secretCanaryResult: "empty" };
  await writeFile(path.join(evidence, "factory-evidence-metadata.json"), `${JSON.stringify(metadata)}\n`);
}

function packCurrentCheckout(destination: string): string {
  const npmCli = [process.env.npm_execpath, path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"), path.resolve(path.dirname(process.execPath), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js")].find(value => value && existsSync(value));
  assert.ok(npmCli, "npm CLI is available");
  const packed = JSON.parse(execFileSync(process.execPath, [npmCli, "pack", "--ignore-scripts", "--json", "--pack-destination", destination], { cwd: process.cwd(), encoding: "utf8" })) as [{ filename: string }];
  return path.join(destination, packed[0].filename);
}

test("factory journey atomically publishes an exact verified packet derived from the signed graph", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-factory-journey-test-"));
  const out = path.join(root, "evidence");
  const restorePlatform = __testSetAuthorityCellHostPlatform("linux");
  try {
    const result = await capture(command(out));
    assert.equal(result.code, 0);
    assert.deepEqual(result.stderr, []);
    assert.equal(result.stdout.length, 1);
    const line = JSON.parse(result.stdout[0]!) as Record<string, string>;
    assert.deepEqual(Object.keys(line).sort(), ["graphDigest", "graphPath", "journey", "status", "summaryDigest", "summaryPath", "trustPath"]);
    assert.deepEqual({ status: line.status, journey: line.journey }, { status: "verified", journey: "github-issue-labels" });
    assert.deepEqual([line.graphPath, line.trustPath, line.summaryPath], [path.join(out, "graph.json"), path.join(out, "trust-pin.json"), path.join(out, "factory-journey-summary.json")]);
    assert.deepEqual((await readdir(out)).sort(), ["factory-journey-summary.json", "graph.json", "trust-pin.json"]);
    assert.deepEqual(await privateResidue(root), []);

    const graph = JSON.parse(await readFile(line.graphPath, "utf8"));
    const trustPin = JSON.parse(await readFile(line.trustPath, "utf8"));
    const summary = JSON.parse(await readFile(line.summaryPath, "utf8"));
    assert.equal(verifyCertificationTaskReceiptGraph(graph, { trustPin }).status, "verified");
    assert.equal(line.graphDigest, authorityDigest(graph));
    assert.equal(line.summaryDigest, authorityDigest(summary));
    assert.deepEqual(Object.keys(summary), ["v", "journey", "graphDigest", "stages", "authorityBoundaryCeremonies", "fixtureOperatorConfirmations", "liveHumanReview", "providerCredentialValueHandling", "clientBearerResolution", "providerSdkCalls", "externalSockets", "unsupportedCategories", "nonClaims", "logicalOperatorSteps", "elapsedMs", "reviewerPacket"]);
    assert.deepEqual(summary.stages, ["classification", "preparation", "consequential-execution", "independent-review"]);
    assert.deepEqual(summary.unsupportedCategories, { ambiguity: "absent", manual: "absent", blocked: "absent" });
    assert.deepEqual({ ceremonies: summary.authorityBoundaryCeremonies, fixtureConfirmations: summary.fixtureOperatorConfirmations, liveHumanReview: summary.liveHumanReview, providerCredentials: summary.providerCredentialValueHandling, bearerResolution: summary.clientBearerResolution, providerSdkCalls: summary.providerSdkCalls, externalSockets: summary.externalSockets, steps: summary.logicalOperatorSteps }, { ceremonies: 1, fixtureConfirmations: 1, liveHumanReview: "absent", providerCredentials: 0, bearerResolution: 0, providerSdkCalls: 0, externalSockets: 0, steps: 4 });
    assert.deepEqual(summary.nonClaims, ["semantic-correctness", "general-software-factory-capability", "live-human-review"]);

    const packet = summary.reviewerPacket;
    assert.deepEqual(Object.keys(packet), ["humanApprovedTaskBinding", "declared", "compiledEffect", "lineage", "policyStatus", "postStateConfidence", "providerObservation", "reconciliationResult", "cleanupResult", "duplicateDecisions", "exceptions", "receiptChain", "fixtureOperatorConfirmation", "graphDigest", "nonClaims"]);
    assert.equal(packet.graphDigest, authorityDigest(graph));
    assert.deepEqual(packet.humanApprovedTaskBinding, { taskId: graph.taskId, authorityCellId: graph.authorityCellId, signedReadinessDigest: graph.taskAuthorities[0].activation.signedReadinessDigest, authorization: "human-signed", dispatchable: false });
    assert.deepEqual(packet.declared, { trigger: graph.taskAuthorities[0].declaredTrigger, intent: graph.taskAuthorities[0].declaredIntent, operation: graph.taskAuthorities[0].signedJobCard.semanticClasses });
    assert.deepEqual(packet.compiledEffect, graph.outcomes.map((item: any) => item.effectDigest));
    assert.deepEqual(packet.lineage, { principals: graph.principals.map((item: any) => item.principalId), grants: graph.grants.map((item: any) => item.digest), allocations: graph.allocations.map((item: any) => item.allocationId) });
    assert.deepEqual(packet.policyStatus, graph.policyEvidence.map((item: any) => ({ artifact: item.artifact, status: item.status })));
    assert.deepEqual(packet.postStateConfidence, graph.postStateEvidence.map((item: any) => item.confidence));
    assert.deepEqual(packet.providerObservation, graph.receipts.map((item: any) => item.receipt.value.claims.providerAcknowledgment));
    assert.deepEqual(packet.reconciliationResult, graph.receipts.map((item: any) => item.evidence.value.reconciliation.verdict));
    assert.deepEqual(packet.cleanupResult, graph.receipts.filter((item: any) => item.receipt.value.decisionContext.requestId.endsWith(".cleanup")).map((item: any) => item.evidence.value.reconciliation.verdict));
    assert.ok(packet.cleanupResult.length > 0, "reviewer packet reports the signed cleanup result");
    assert.deepEqual(packet.duplicateDecisions, graph.duplicateDecisions);
    assert.deepEqual(packet.exceptions, graph.exceptions);
    assert.deepEqual(packet.receiptChain, graph.receipts.map((item: any) => ({ receiptDigest: authorityDigest(item.receipt.value), priorReceiptDigest: item.receipt.value.priorReceiptDigest })));
    assert.deepEqual(packet.fixtureOperatorConfirmation, { kind: "fixture", basis: "signed-readiness-construction", signedReadinessDigest: graph.taskAuthorities[0].activation.signedReadinessDigest, liveHuman: false, grantsAuthority: false });
    assert.deepEqual(packet.nonClaims, summary.nonClaims);
  } finally { restorePlatform(); await rm(root, { recursive: true, force: true }); }
});

test("installed offline verifier rejects a recomputed unsigned reviewer-packet substitution", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-factory-packed-substitution-"));
  const produced = path.join(root, "produced"), evidence = path.join(root, "evidence");
  const restorePlatform = __testSetAuthorityCellHostPlatform("linux");
  try {
    assert.equal((await capture(command(produced))).code, 0);
    await cp(produced, evidence, { recursive: true });
    const tarball = packCurrentCheckout(root);
    const summaryPath = path.join(evidence, "factory-journey-summary.json");
    const summary = JSON.parse(await readFile(summaryPath, "utf8"));
    summary.reviewerPacket.humanApprovedTaskBinding.taskId = "substituted_unsigned_task";
    await writeFile(summaryPath, `${JSON.stringify(summary)}\n`);
    await writeFactoryEvidenceMetadata(evidence, tarball);
    const result = spawnSync(process.execPath, [path.join(process.cwd(), "test", "packed", "authority-factory-journey.mjs"), "--tarball", tarball, "--verify-evidence", evidence], { cwd: process.cwd(), encoding: "utf8" });
    assert.notEqual(result.status, 0, "installed verifier must derive the reviewer packet from the verified signed graph");
  } finally { restorePlatform(); await rm(root, { recursive: true, force: true }); }
});

test("installed offline verifier scans downloaded artifacts instead of trusting empty canary metadata", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-factory-packed-canary-"));
  const produced = path.join(root, "produced"), evidence = path.join(root, "evidence");
  const restorePlatform = __testSetAuthorityCellHostPlatform("linux");
  try {
    assert.equal((await capture(command(produced))).code, 0);
    await cp(produced, evidence, { recursive: true });
    const tarball = packCurrentCheckout(root);
    await writeFactoryEvidenceMetadata(evidence, tarball);
    const metadataPath = path.join(evidence, "factory-evidence-metadata.json"), metadata = JSON.parse(await readFile(metadataPath, "utf8"));
    metadata.workflowSourceSha = FACTORY_SECRET_CANARY;
    await writeFile(metadataPath, `${JSON.stringify(metadata)}\n`);
    const result = spawnSync(process.execPath, [path.join(process.cwd(), "test", "packed", "authority-factory-journey.mjs"), "--tarball", tarball, "--verify-evidence", evidence], { cwd: process.cwd(), encoding: "utf8" });
    assert.notEqual(result.status, 0, "installed verifier must scan actual evidence bytes for the deterministic canary");
  } finally { restorePlatform(); await rm(root, { recursive: true, force: true }); }
});

test("factory journey refuses the complete closed CLI corpus without authority or private residue", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-factory-refusal-test-"));
  const restorePlatform = __testSetAuthorityCellHostPlatform("linux");
  try {
    const existingFile = path.join(root, "existing-file"); await writeFile(existingFile, "sentinel");
    const existingDirectory = path.join(root, "existing-directory"); await mkdir(existingDirectory);
    const existingTarget = path.join(root, "symlink-target"); await mkdir(existingTarget);
    const existingSymlink = path.join(root, "existing-symlink"); await symlink(existingTarget, existingSymlink, process.platform === "win32" ? "junction" : "dir");
    const unknownOptions = ["config", "credential", "provider", "signer", "ledger", "callback", "network", "retry", "task", "grant", "principal", "allocation"];
    const cases: AuthorityCommand[] = [
      command("relative-output"),
      command(existingFile), command(existingDirectory), command(existingSymlink),
      command(path.join(root, "extra-positional"), { positional: ["certify", "factory-journey", "extra"] }),
      command(path.join(root, "unknown-flag"), { flags: new Set(["offline"]) }),
      ...unknownOptions.map(option => command(path.join(root, `unknown-${option}`), { opts: { out: path.join(root, `unknown-${option}`), [option]: "attacker-value" } })),
    ];
    for (const candidate of cases) {
      const before = await privateResidue(root);
      assertRefused(await capture(candidate));
      assert.deepEqual(await privateResidue(root), before);
    }
    assert.equal(await readFile(existingFile, "utf8"), "sentinel");
    assert.equal((await lstat(existingDirectory)).isDirectory(), true);
    assert.equal((await lstat(existingSymlink)).isSymbolicLink(), true);

    const nonLinuxOut = path.join(root, "non-linux");
    restorePlatform();
    const restoreWindows = __testSetAuthorityCellHostPlatform("win32");
    try { assertRefused(await capture(command(nonLinuxOut))); assert.equal(existsSync(nonLinuxOut), false); }
    finally { restoreWindows(); }
  } finally { restorePlatform(); await rm(root, { recursive: true, force: true }); }
});

test("factory journey removes requested output and all private residue at every lifecycle fault", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-factory-fault-test-"));
  const restorePlatform = __testSetAuthorityCellHostPlatform("linux");
  const faults: FactoryJourneyFault[] = ["staging", "root", "graph-write", "trust-write", "summary-write", "cleanup", "rename"];
  try {
    for (const fault of faults) {
      const out = path.join(root, `evidence-${fault}`);
      const restoreFault = __testSetFactoryJourneyFault(fault);
      try { assertRefused(await capture(command(out))); }
      finally { restoreFault(); }
      assert.equal(existsSync(out), false, `${fault} must leave requested output absent`);
      assert.deepEqual(await privateResidue(root), [], `${fault} must leave no private residue`);
    }
  } finally { restorePlatform(); await rm(root, { recursive: true, force: true }); }
});
