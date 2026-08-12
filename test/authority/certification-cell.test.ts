import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { authorityDigest } from "../../src/authority/wire.js";
import { signJobCard } from "../../src/authority/job.js";
import { createSignedCertificationReadiness } from "../../src/authority/certification/authority.js";
import { initializeCertification } from "../../src/authority/certification/initializer.js";
import { preflightCertification } from "../../src/authority/certification/preflight.js";
import { sealCertificationReadiness } from "../../src/authority/certification/readiness.js";
import { createDelegationAuthority } from "../../src/authority/host/delegation-service.js";
import { createFilePrincipalRegistry } from "../../src/authority/host/principal-registry.js";
import * as cell from "../../src/authority/certification/cell.js";
import { writeCertificationInputManifests } from "./certification-input-fixture.js";

const at = "2026-08-11T20:00:00.000Z";
const expiry = "2026-08-11T21:00:00.000Z";

function descriptor(keyId: string, role: "human-sponsor" | "authority-cell", purpose: string, publicKey: ReturnType<typeof generateKeyPairSync>["publicKey"]): any {
  return { v: "reelier.authority-key-descriptor/v1", keyId, role, purpose, algorithm: "ed25519", publicKeySpkiBase64: publicKey.export({ type: "spki", format: "der" }).toString("base64") };
}

async function fixture(scenarios: readonly ("github-issue-labels" | "slack-topic")[] = ["github-issue-labels"]) {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-cert-cell-"));
  const configPath = path.join(root, "certification.local.json");
  const hasSlack = scenarios.includes("slack-topic");
  await writeFile(configPath, JSON.stringify({ v: "reelier.certification-operator-config/v2", authorityConfigPath: "authority/authority.yml", evidenceDirectory: "authority/receipts/certification", scenarios, resources: { "github-issue-labels": { apiBaseUrl: "https://api.github.com", owner: "fixlyai", repository: "reelier-certification", issueNumber: 1 }, ...(hasSlack ? { "slack-topic": { apiBaseUrl: "https://slack.com", teamId: "T012345", channelId: "C012345" } } : {}) }, cleanup: { "github-issue-labels": ["restore-github-labels"], ...(hasSlack ? { "slack-topic": ["restore-slack-channel-topic"] } : {}) }, metadata: {}, secretReferences: { githubCredential: "env:REELIER_GITHUB_TOKEN", ...(hasSlack ? { slackCredential: "env:REELIER_SLACK_TOKEN" } : {}) } }), "utf8");
  const initialized = await initializeCertification({ configPath });
  await writeCertificationInputManifests(initialized.workspace, scenarios);
  const selection = scenarios.length === 1 ? { workspace: initialized.workspace, scenario: scenarios[0] } : { workspace: initialized.workspace, all: true as const };
  const preflight = await preflightCertification(selection);
  const sealed = await sealCertificationReadiness(selection);
  const readinessKey = generateKeyPairSync("ed25519"), jobKey = generateKeyPairSync("ed25519"), delegationKey = generateKeyPairSync("ed25519"), receiptKey = generateKeyPairSync("ed25519");
  const human = descriptor(initialized.identifiers.signerId, "human-sponsor", "certification-readiness", readinessKey.publicKey);
  const jobSigner = descriptor("human_job_card_signer", "human-sponsor", "signed-job-card", jobKey.publicKey);
  const delegationSigner = descriptor("cell_delegation_signer", "authority-cell", "delegation-grant", delegationKey.publicKey);
  const receiptSigner = descriptor("cell_receipt_signer", "authority-cell", "authority-receipt", receiptKey.publicKey);
  const descriptors = [human, jobSigner, delegationSigner, receiptSigner];
  const events: any[] = [];
  for (const item of descriptors) events.push({ v: "reelier.authority-trust-event/v1", eventId: `trust_${events.length}_${"f".repeat(12)}`, sequence: events.length, action: "activate", keyDescriptorDigest: authorityDigest(item), occurredAt: at, previousEventDigest: events.length ? authorityDigest(events[events.length - 1]) : null });
  const signedReadiness = createSignedCertificationReadiness({ readinessCandidate: sealed.candidate, readinessCandidateDigest: sealed.digest, preflight, humanKeyDescriptor: human, cellKeyDescriptors: [delegationSigner, receiptSigner], jobCardKeyDescriptors: [jobSigner], trustEvents: events, humanPrivateKey: readinessKey.privateKey, authorizedAt: "2026-08-11T20:01:00.000Z" });
  const pin: any = { v: "reelier.job-card-trust-pin/v1", signedReadiness, readinessCandidate: sealed.candidate, preflight, humanTrustRoot: human, keyDescriptors: descriptors, readinessTrustEvents: events, currentTrustEvents: events };
  const constraints = { definitionAliases: ["github_issue_labels", ...(hasSlack ? ["slack_channel_topic"] : [])], audiences: ["certification_agent"], connectorAccounts: [{ connectorId: "github", accountId: "github_fixlyai_reelier" }, ...(hasSlack ? [{ connectorId: "slack", accountId: "slack_T012345" }] : [])], projectionPointers: ["/labels", ...(hasSlack ? ["/topic"] : [])], riskClasses: ["record-state"], limits: { maxEffectsPerWindow: 2, windowSeconds: 3600, maxEffectsPerSourceTrigger: 1, maxBodyBytes: 4096 } };
  const taskShapeDigest = cell.certificationTaskShapeDigest({ identifiers: initialized.identifiers, scenarios, constraints });
  const jobCard = signJobCard({ v: "reelier.signed-job-card/v1", jobId: initialized.identifiers.jobCardId, title: "Certification", taskShapeDigest, semanticClasses: ["record_state_set_v1"], definitionAliases: constraints.definitionAliases, connectorIds: ["github", ...(hasSlack ? ["slack"] : [])], accountIdentities: ["github:fixlyai/reelier-certification", ...(hasSlack ? ["slack:T012345"] : [])], connectionDescriptorDigests: [`sha256:${"1".repeat(64)}`], adoptionCommitmentDigests: [`sha256:${"2".repeat(64)}`], sourceRefs: ["certification"], audiences: constraints.audiences, limitsDigest: authorityDigest(constraints.limits), instructionsDigest: `sha256:${"3".repeat(64)}`, packDigests: [`sha256:${"4".repeat(64)}`], exceptionPolicy: ["ambiguous-reconcile"], coverage: "declared-surface" }, jobSigner.keyId, jobKey.privateKey);
  const delegation = createDelegationAuthority({ root: path.join(initialized.workspace, "authority", "delegation"), now: () => new Date("2026-08-11T20:10:00.000Z"), signGrant: async () => { throw new Error("child delegation not expected"); } });
  const principals = createFilePrincipalRegistry({ tenant: initialized.identifiers.authorityCellId, file: path.join(initialized.workspace, "authority", "principals", "registry.jsonl") });
  const currentTrustPinPath = path.join(root, "operator-current-trust.json");
  await writeFile(currentTrustPinPath, `${JSON.stringify(pin)}\n`);
  return { root, initialized, pin, currentTrustPinPath, jobCard, constraints, delegationKey, delegationSigner, delegation, principals };
}

test("signed Job Card activates exact durable root state and a derived restart-safe principal", async () => {
  const f = await fixture();
  try {
    const input = { workspace: f.initialized.workspace, jobCard: f.jobCard, jobCardTrustPin: f.pin, delegationKeyDescriptor: f.delegationSigner, delegationPrivateKey: f.delegationKey.privateKey, constraints: f.constraints, effects: 2, issuedAt: at, expiresAt: expiry, delegationAuthority: f.delegation };
    const first = await cell.activateCertificationRootTask(input);
    const replay = await cell.activateCertificationRootTask(input);
    assert.deepEqual(replay, first);
    assert.equal(first.taskId, f.initialized.identifiers.taskId);
    assert.equal(first.jobId, f.initialized.identifiers.jobCardId);
    assert.equal(first.grantId, f.initialized.identifiers.rootGrantId);
    assert.equal(first.allocationId, f.initialized.identifiers.rootGrantId);
    assert.equal(first.authorityCellId, f.initialized.identifiers.authorityCellId);
    assert.notEqual(first.signerKeyId, f.initialized.identifiers.signerId);
    await assert.rejects(() => cell.activateCertificationRootTask({ ...input, effects: 1 }), /conflict|commitment/i);
    const credential = await cell.activateCertificationPrincipalSession({ workspace: f.initialized.workspace, delegationAuthority: f.delegation, principalRegistry: f.principals, now: new Date("2026-08-11T20:10:00.000Z") });
    assert.match(credential.token, /^rat_/);
    assert.doesNotMatch(await readFile(path.join(f.initialized.workspace, "authority", "principals", "registry.jsonl"), "utf8"), new RegExp(credential.token));
    const restarted = createFilePrincipalRegistry({ tenant: f.initialized.identifiers.authorityCellId, file: path.join(f.initialized.workspace, "authority", "principals", "registry.jsonl") });
    assert.deepEqual(await restarted.resolve(credential.token, new Date("2026-08-11T20:11:00.000Z")), credential.context);
    await assert.rejects(() => cell.activateCertificationPrincipalSession({ workspace: f.initialized.workspace, delegationAuthority: f.delegation, principalRegistry: restarted, now: new Date("2026-08-11T20:11:00.000Z") }), /active runtime session/i);
    const activationPath = path.join(f.initialized.workspace, "authority", "delegation", "root-activation.json");
    const activation = JSON.parse(await readFile(activationPath, "utf8"));
    activation.signedRootGrant.signature.sig += "\n";
    await writeFile(activationPath, JSON.stringify(activation));
    await assert.rejects(() => cell.activateCertificationPrincipalSession({ workspace: f.initialized.workspace, delegationAuthority: f.delegation, principalRegistry: restarted, now: new Date("2026-08-11T20:11:00.000Z") }), /canonical|signature/i);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("dispatch permit is opaque, nonserializable, one-use, and invokes the runner exactly once", async () => {
  const f = await fixture();
  try {
    await cell.activateCertificationRootTask({ workspace: f.initialized.workspace, jobCard: f.jobCard, jobCardTrustPin: f.pin, delegationKeyDescriptor: f.delegationSigner, delegationPrivateKey: f.delegationKey.privateKey, constraints: f.constraints, effects: 2, issuedAt: at, expiresAt: expiry, delegationAuthority: f.delegation });
    const credential = await cell.activateCertificationPrincipalSession({ workspace: f.initialized.workspace, delegationAuthority: f.delegation, principalRegistry: f.principals, now: new Date("2026-08-11T20:10:00.000Z") });
    const readiness = { workspace: f.initialized.workspace, scenario: "github-issue-labels" as const, bearerToken: credential.token, currentTrustPinPath: f.currentTrustPinPath, delegationAuthority: f.delegation, principalRegistry: f.principals, credentialAvailable: async (slot: string) => slot === "githubCredential", now: () => new Date("2026-08-11T20:10:00.000Z") };
    let calls = 0;
    const registry = cell.createCertifiedRunnerRegistry();
    const runnerManifest = JSON.parse(await readFile(path.join(f.initialized.workspace, "inputs", "runners", "github-issue-labels.json"), "utf8"));
    const endpointManifest = JSON.parse(await readFile(path.join(f.initialized.workspace, "authority", "endpoints", "github-issue-labels.json"), "utf8"));
    registry.register({ scenarioId: "github-issue-labels", runnerId: runnerManifest.runnerId, implementationDigest: runnerManifest.implementationDigest, endpointManifestDigest: runnerManifest.endpointManifestDigest, dispatchMode: "hermetic-certification", capabilities: endpointManifest.endpoints, run: async (context: { dispatchMode: string }) => { calls += 1; assert.equal(context.dispatchMode, "hermetic-certification"); return "ran"; } });
    await assert.rejects(() => cell.verifyCertificationDispatchReadiness({ ...readiness, credentialAvailable: async () => false }), /credential.*unavailable/i);
    await assert.rejects(() => cell.verifyCertificationDispatchReadiness({ ...readiness, bearerToken: "rat_not-the-issued-token" }), /credential/i);
    assert.equal(calls, 0);
    assert.equal((await f.delegation.budget.get(f.initialized.identifiers.rootGrantId))?.remaining, 2);

    const runnerFile = path.join(f.initialized.workspace, "inputs", "runners", "github-issue-labels.json");
    const testFile = path.join(f.initialized.workspace, "inputs", "tests", "github-issue-labels.json");
    const originalRunner = await readFile(runnerFile, "utf8"), originalTests = await readFile(testFile, "utf8");
    const substitutedRunner = { ...JSON.parse(originalRunner), implementationDigest: `sha256:${"8".repeat(64)}` };
    const substitutedRunnerBytes = `${JSON.stringify(substitutedRunner)}\n`;
    const substitutedTests = { ...JSON.parse(originalTests), runnerManifestDigest: `sha256:${createHash("sha256").update(substitutedRunnerBytes).digest("hex")}` };
    await writeFile(runnerFile, substitutedRunnerBytes); await writeFile(testFile, `${JSON.stringify(substitutedTests)}\n`);
    await assert.rejects(() => cell.verifyCertificationDispatchReadiness(readiness), /signed|readiness|preflight|manifest.*commitment/i);
    assert.equal(calls, 0);
    await writeFile(runnerFile, originalRunner); await writeFile(testFile, originalTests);

    const permit = await cell.verifyCertificationDispatchReadiness(readiness);
    assert.throws(() => JSON.stringify(permit), /opaque|serializ/i);
    const endpointFile = path.join(f.initialized.workspace, "authority", "endpoints", "github-issue-labels.json");
    const endpointBytes = await readFile(endpointFile, "utf8");
    const endpoint = JSON.parse(endpointBytes); endpoint.resourceDigest = `sha256:${"9".repeat(64)}`;
    await writeFile(endpointFile, JSON.stringify(endpoint));
    await assert.rejects(() => cell.runCertificationWithPermit(permit, registry), /endpoint|stale|commitment/i);
    assert.equal(calls, 0);
    assert.equal((await f.delegation.budget.get(f.initialized.identifiers.rootGrantId))?.remaining, 2);
    await writeFile(endpointFile, endpointBytes);

    const valid = await cell.verifyCertificationDispatchReadiness(readiness);
    assert.equal(await cell.runCertificationWithPermit(valid, registry), "ran");
    assert.equal(calls, 1);
    assert.equal((await f.delegation.budget.get(f.initialized.identifiers.rootGrantId))?.remaining, 1);
    await assert.rejects(() => cell.runCertificationWithPermit(valid, registry), /used|permit/i);
    assert.equal(calls, 1);

    const trustPermit = await cell.verifyCertificationDispatchReadiness(readiness);
    const pinFile = f.currentTrustPinPath;
    const pinBytes = await readFile(pinFile, "utf8"), pin = JSON.parse(pinBytes);
    const jobSigner = pin.keyDescriptors.find((item: { purpose: string }) => item.purpose === "signed-job-card");
    const previous = pin.currentTrustEvents[pin.currentTrustEvents.length - 1];
    pin.currentTrustEvents.push({ v: "reelier.authority-trust-event/v1", eventId: `trust_revoke_${"f".repeat(12)}`, sequence: pin.currentTrustEvents.length, action: "revoke", keyDescriptorDigest: authorityDigest(jobSigner), occurredAt: "2026-08-11T20:05:00.000Z", previousEventDigest: authorityDigest(previous) });
    await writeFile(pinFile, JSON.stringify(pin));
    await assert.rejects(() => cell.runCertificationWithPermit(trustPermit, registry), /revoked|active|trust/i);
    assert.equal(calls, 1);
    await writeFile(pinFile, pinBytes);
    await assert.rejects(() => cell.verifyCertificationDispatchReadiness(readiness), /rollback|trust/i);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("task revocation invalidates an already-issued certification permit", async () => {
  const f = await fixture();
  try {
    await cell.activateCertificationRootTask({ workspace: f.initialized.workspace, jobCard: f.jobCard, jobCardTrustPin: f.pin, delegationKeyDescriptor: f.delegationSigner, delegationPrivateKey: f.delegationKey.privateKey, constraints: f.constraints, effects: 1, issuedAt: at, expiresAt: expiry, delegationAuthority: f.delegation });
    const credential = await cell.activateCertificationPrincipalSession({ workspace: f.initialized.workspace, delegationAuthority: f.delegation, principalRegistry: f.principals, now: new Date("2026-08-11T20:10:00.000Z") });
    const permit = await cell.verifyCertificationDispatchReadiness({ workspace: f.initialized.workspace, scenario: "github-issue-labels", bearerToken: credential.token, currentTrustPinPath: f.currentTrustPinPath, delegationAuthority: f.delegation, principalRegistry: f.principals, credentialAvailable: async () => true, now: () => new Date("2026-08-11T20:10:00.000Z") });
    const registry = cell.createCertifiedRunnerRegistry();
    const runner = JSON.parse(await readFile(path.join(f.initialized.workspace, "inputs", "runners", "github-issue-labels.json"), "utf8"));
    const endpoint = JSON.parse(await readFile(path.join(f.initialized.workspace, "authority", "endpoints", "github-issue-labels.json"), "utf8"));
    registry.register({ scenarioId: "github-issue-labels", runnerId: runner.runnerId, implementationDigest: runner.implementationDigest, endpointManifestDigest: runner.endpointManifestDigest, dispatchMode: "hermetic-certification", capabilities: endpoint.endpoints, run: async () => "must-not-run" });
    await f.delegation.revoke(f.initialized.identifiers.authorityCellId, f.initialized.identifiers.taskId);
    await assert.rejects(() => cell.runCertificationWithPermit(permit, registry), /revoked|active|stale/i);
    await assert.rejects(() => cell.activateCertificationPrincipalSession({ workspace: f.initialized.workspace, delegationAuthority: f.delegation, principalRegistry: f.principals, now: new Date("2026-08-11T20:10:00.000Z") }), /active|revoked/i);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("credential availability errors are redacted and runner registrations are exact", async () => {
  const f = await fixture();
  try {
    await cell.activateCertificationRootTask({ workspace: f.initialized.workspace, jobCard: f.jobCard, jobCardTrustPin: f.pin, delegationKeyDescriptor: f.delegationSigner, delegationPrivateKey: f.delegationKey.privateKey, constraints: f.constraints, effects: 2, issuedAt: at, expiresAt: expiry, delegationAuthority: f.delegation });
    const credential = await cell.activateCertificationPrincipalSession({ workspace: f.initialized.workspace, delegationAuthority: f.delegation, principalRegistry: f.principals, now: new Date("2026-08-11T20:10:00.000Z") });
    await assert.rejects(() => cell.verifyCertificationDispatchReadiness({ workspace: f.initialized.workspace, scenario: "github-issue-labels", bearerToken: credential.token, currentTrustPinPath: f.currentTrustPinPath, delegationAuthority: f.delegation, principalRegistry: f.principals, credentialAvailable: async () => { throw new Error("C:/private/TOKEN_CANARY provider body"); }, now: () => new Date("2026-08-11T20:10:00.000Z") }), error => !/TOKEN_CANARY|provider body/.test(String(error)) && /credential.*unavailable/i.test(String(error)));
    const registry = cell.createCertifiedRunnerRegistry();
    assert.throws(() => registry.register({ scenarioId: "github-issue-labels", runnerId: "wrong", implementationDigest: `sha256:${"1".repeat(64)}`, endpointManifestDigest: `sha256:${"2".repeat(64)}`, dispatchMode: "provider-network", capabilities: [], run: async () => undefined } as never), /dispatch mode|hermetic/i);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("one scenario dispatches from a full multi-scenario signed preflight", async () => {
  const f = await fixture(["github-issue-labels", "slack-topic"]);
  try {
    await cell.activateCertificationRootTask({ workspace: f.initialized.workspace, jobCard: f.jobCard, jobCardTrustPin: f.pin, delegationKeyDescriptor: f.delegationSigner, delegationPrivateKey: f.delegationKey.privateKey, constraints: f.constraints, effects: 2, issuedAt: at, expiresAt: expiry, delegationAuthority: f.delegation });
    const credential = await cell.activateCertificationPrincipalSession({ workspace: f.initialized.workspace, delegationAuthority: f.delegation, principalRegistry: f.principals, now: new Date("2026-08-11T20:10:00.000Z") });
    const permit = await cell.verifyCertificationDispatchReadiness({ workspace: f.initialized.workspace, scenario: "github-issue-labels", bearerToken: credential.token, currentTrustPinPath: f.currentTrustPinPath, delegationAuthority: f.delegation, principalRegistry: f.principals, credentialAvailable: async slot => slot === "githubCredential", now: () => new Date("2026-08-11T20:10:00.000Z") });
    const registry = cell.createCertifiedRunnerRegistry();
    const runner = JSON.parse(await readFile(path.join(f.initialized.workspace, "inputs", "runners", "github-issue-labels.json"), "utf8"));
    const endpoint = JSON.parse(await readFile(path.join(f.initialized.workspace, "authority", "endpoints", "github-issue-labels.json"), "utf8"));
    registry.register({ scenarioId: "github-issue-labels", runnerId: runner.runnerId, implementationDigest: runner.implementationDigest, endpointManifestDigest: runner.endpointManifestDigest, dispatchMode: "hermetic-certification", capabilities: endpoint.endpoints, run: async () => "multi-ran" });
    assert.equal(await cell.runCertificationWithPermit(permit, registry), "multi-ran");
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
