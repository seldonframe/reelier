import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

const args = process.argv.slice(2), tarballIndex = args.indexOf("--tarball"), outIndex = args.indexOf("--out"), evidenceIndex = args.indexOf("--verify-evidence");
const expectedArgs = outIndex >= 0 ? ["--tarball", args[tarballIndex + 1], "--out", args[outIndex + 1]] : ["--tarball", args[tarballIndex + 1], "--verify-evidence", args[evidenceIndex + 1]];
if (tarballIndex !== 0 || (outIndex < 0) === (evidenceIndex < 0) || args.length !== 4 || !args.every((value, index) => value === expectedArgs[index])) throw new Error("usage: --tarball <absolute-path> (--out <absolute-path>|--verify-evidence <absolute-path>)");
const tarball = args[tarballIndex + 1], out = args[outIndex + 1];
const evidence = args[evidenceIndex + 1];
assert.ok(path.isAbsolute(tarball) && existsSync(tarball), "tarball must be an existing absolute path"); if (outIndex >= 0) assert.ok(path.isAbsolute(out) && !existsSync(out), "out must be an absent absolute path"); else assert.ok(path.isAbsolute(evidence) && existsSync(evidence), "evidence must be an existing absolute path");
const digest = value => "sha256:" + createHash("sha256").update(readFileSync(value)).digest("hex");
const consumer = mkdtempSync(path.join(os.tmpdir(), "reelier-factory-consumer-"));
try {
  const npmCli = [process.env.npm_execpath, path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"), path.resolve(path.dirname(process.execPath), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js")].find(value => value && existsSync(value)); assert.ok(npmCli);
  const exec = (command, arguments_) => { const result = spawnSync(command, arguments_, { cwd: consumer, encoding: "utf8" }); assert.equal(result.error, undefined); return result; };
  const npm = arguments_ => { const result = exec(process.execPath, [npmCli, ...arguments_]); assert.equal(result.status, 0, result.stderr); }; npm(["init", "-y"]); npm(["install", "--ignore-scripts", "--no-package-lock", tarball]);
  const require = createRequire(path.join(consumer, "consumer.cjs")), authorityPath = require.resolve("reelier/authority"); assert.equal(path.relative(consumer, authorityPath).startsWith(".."), false, "installed module stays in clean consumer");
  const authority = await import(pathToFileURL(authorityPath).href);
  if (evidenceIndex >= 0) {
    const metadata = JSON.parse(readFileSync(path.join(evidence, "factory-evidence-metadata.json"), "utf8")), expected = ["adapterContractDigest", "graphDigest", "secretCanaryResult", "summaryDigest", "tarballSha256", "trustPinDigest", "v", "workflowSourceSha"];
    assert.deepEqual(Object.keys(metadata).sort(), expected); assert.equal(metadata.v, "reelier.factory-evidence-metadata/v1"); assert.equal(metadata.secretCanaryResult, "empty");
    const graph = JSON.parse(readFileSync(path.join(evidence, "graph.json"), "utf8")), trustPin = JSON.parse(readFileSync(path.join(evidence, "trust-pin.json"), "utf8")), summary = JSON.parse(readFileSync(path.join(evidence, "factory-journey-summary.json"), "utf8"));
    assert.deepEqual(require("node:fs").readdirSync(evidence).sort(), ["factory-evidence-metadata.json", "factory-journey-summary.json", "graph.json", "trust-pin.json"]);
    assert.equal(authority.verifyCertificationTaskReceiptGraph(graph, { trustPin }).status, "verified"); assert.equal(digest(path.join(evidence, "graph.json")), metadata.graphDigest); assert.equal(digest(path.join(evidence, "trust-pin.json")), metadata.trustPinDigest); assert.equal(digest(path.join(evidence, "factory-journey-summary.json")), metadata.summaryDigest); assert.equal(digest(tarball).slice(7), metadata.tarballSha256); assert.equal(authority.AUTHORITY_ADAPTER_CONTRACT_V1_DIGEST, metadata.adapterContractDigest);
    const schemaPath = require.resolve("reelier/contract/certification/v1/factory-journey-summary.schema.json"); assert.equal(path.relative(consumer, schemaPath).startsWith(".."), false, "summary schema stays in clean consumer");
    const Ajv2020 = require("ajv/dist/2020").default, validateSummary = new Ajv2020({ strict: true }).compile(JSON.parse(readFileSync(schemaPath, "utf8"))); assert.equal(validateSummary(summary), true, JSON.stringify(validateSummary.errors));
    const taskAuthority = graph.taskAuthorities[0], nonClaims = ["semantic-correctness", "general-software-factory-capability", "live-human-review"], graphDigest = authority.authorityDigest(graph);
    const reviewerPacket = {
      humanApprovedTaskBinding: { taskId: graph.taskId, authorityCellId: graph.authorityCellId, signedReadinessDigest: taskAuthority.activation.signedReadinessDigest, authorization: graph.signedReadiness.authorization, dispatchable: graph.signedReadiness.dispatchable },
      declared: { trigger: taskAuthority.declaredTrigger, intent: taskAuthority.declaredIntent, operation: taskAuthority.signedJobCard.semanticClasses },
      compiledEffect: graph.outcomes.map(item => item.effectDigest),
      lineage: { principals: graph.principals.map(item => item.principalId), grants: graph.grants.map(item => item.digest), allocations: graph.allocations.map(item => item.allocationId) },
      policyStatus: graph.policyEvidence.map(item => ({ artifact: item.artifact, status: item.status })),
      postStateConfidence: graph.postStateEvidence.map(item => item.confidence),
      providerObservation: graph.receipts.map(item => item.receipt.value.claims.providerAcknowledgment),
      reconciliationResult: graph.receipts.map(item => item.evidence.value.reconciliation.verdict),
      cleanupResult: graph.receipts.filter(item => item.receipt.value.decisionContext.requestId.endsWith(".cleanup")).map(item => item.evidence.value.reconciliation.verdict),
      duplicateDecisions: graph.duplicateDecisions,
      exceptions: graph.exceptions,
      receiptChain: graph.receipts.map(item => ({ receiptDigest: authority.authorityDigest(item.receipt.value), priorReceiptDigest: item.receipt.value.priorReceiptDigest })),
      fixtureOperatorConfirmation: { kind: "fixture", basis: "signed-readiness-construction", signedReadinessDigest: taskAuthority.activation.signedReadinessDigest, liveHuman: false, grantsAuthority: false },
      graphDigest,
      nonClaims,
    };
    assert.deepEqual(summary, { v: "reelier.factory-journey-summary/v1", journey: "github-issue-labels", graphDigest, stages: ["classification", "preparation", "consequential-execution", "independent-review"], authorityBoundaryCeremonies: 1, fixtureOperatorConfirmations: 1, liveHumanReview: "absent", providerCredentialValueHandling: 0, clientBearerResolution: 0, providerSdkCalls: 0, externalSockets: 0, unsupportedCategories: { ambiguity: "absent", manual: "absent", blocked: "absent" }, nonClaims, logicalOperatorSteps: 4, elapsedMs: summary.elapsedMs, reviewerPacket });
    process.exit(0);
  }
  const bin = path.join(consumer, "node_modules", ".bin", process.platform === "win32" ? "reelier.cmd" : "reelier");
  const result = exec(bin, ["authority", "certify", "factory-journey", "--out", out]); assert.equal(result.status, 0, result.stderr); assert.equal(result.stderr, ""); assert.match(result.stdout, /^[^\r\n]+\r?\n$/);
  const line = JSON.parse(result.stdout.trim()); assert.deepEqual(Object.keys(line).sort(), ["graphDigest", "graphPath", "journey", "status", "summaryDigest", "summaryPath", "trustPath"]); assert.equal(line.status, "verified"); assert.equal(line.journey, "github-issue-labels");
  assert.equal(path.resolve(line.graphPath), path.join(out, "graph.json")); assert.equal(path.resolve(line.trustPath), path.join(out, "trust-pin.json")); assert.equal(path.resolve(line.summaryPath), path.join(out, "factory-journey-summary.json"));
  const graph = JSON.parse(readFileSync(line.graphPath, "utf8")), trustPin = JSON.parse(readFileSync(line.trustPath, "utf8")), summary = JSON.parse(readFileSync(line.summaryPath, "utf8"));
  assert.equal(authority.verifyCertificationTaskReceiptGraph(graph, { trustPin }).status, "verified"); assert.equal(line.graphDigest, authority.authorityDigest(graph)); assert.equal(line.summaryDigest, authority.authorityDigest(summary)); assert.equal(summary.graphDigest, line.graphDigest);
  for (const file of [line.graphPath, line.trustPath, line.summaryPath]) { const relative = path.relative(out, file); assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative)); assert.ok(existsSync(file)); }
  assert.deepEqual(require("node:fs").readdirSync(out).sort(), ["factory-journey-summary.json", "graph.json", "trust-pin.json"]);
} finally { rmSync(consumer, { recursive: true, force: true }); }
