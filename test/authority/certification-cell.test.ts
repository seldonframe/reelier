import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
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
  await writeFile(configPath, JSON.stringify({ v: "reelier.certification-operator-config/v3", authorityConfigPath: "authority/authority.yml", evidenceDirectory: "authority/receipts/certification", scenarios, resources: { "github-issue-labels": { apiBaseUrl: "https://api.github.com", owner: "fixlyai", repository: "reelier-certification", issueNumber: 1 }, ...(hasSlack ? { "slack-topic": { apiBaseUrl: "https://slack.com", teamId: "T012345", channelId: "C012345" } } : {}) }, cleanup: { "github-issue-labels": ["restore-github-labels"], ...(hasSlack ? { "slack-topic": ["restore-slack-channel-topic"] } : {}) }, desiredState: { "github-issue-labels": { labels: ["certification-after"] }, ...(hasSlack ? { "slack-topic": { topic: "Certification after" } } : {}) }, metadata: {}, secretReferences: { githubCredential: "env:REELIER_GITHUB_TOKEN", ...(hasSlack ? { slackCredential: "env:REELIER_SLACK_TOKEN" } : {}) } }), "utf8");
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
  const host = await cell.createCertificationCellHost({ workspace: initialized.workspace, currentTrustPinPath, delegationAuthority: delegation, principalRegistry: principals, now: () => new Date("2026-08-11T20:10:00.000Z") });
  return { root, initialized, pin, currentTrustPinPath, jobCard, constraints, delegationKey, delegationSigner, delegation, principals, host };
}

test("signed Job Card activates exact durable root state and a derived restart-safe principal", async () => {
  const f = await fixture();
  try {
    const input = { jobCard: f.jobCard, jobCardTrustPin: f.pin, delegationKeyDescriptor: f.delegationSigner, delegationPrivateKey: f.delegationKey.privateKey, constraints: f.constraints, effects: 2, issuedAt: at, expiresAt: expiry };
    const first = await f.host.activateRootTask(input);
    const replay = await f.host.activateRootTask(input);
    assert.deepEqual(replay, first);
    assert.equal(first.taskId, f.initialized.identifiers.taskId);
    assert.equal(first.jobId, f.initialized.identifiers.jobCardId);
    assert.equal(first.grantId, f.initialized.identifiers.rootGrantId);
    assert.equal(first.allocationId, f.initialized.identifiers.rootGrantId);
    assert.equal(first.authorityCellId, f.initialized.identifiers.authorityCellId);
    assert.equal("currentTrustPinPath" in first, false);
    assert.match(first.currentTrustPinPathDigest, /^sha256:[0-9a-f]{64}$/);
    assert.notEqual(first.signerKeyId, f.initialized.identifiers.signerId);
    await assert.rejects(() => f.host.activateRootTask({ ...input, effects: 1 }), /conflict|commitment/i);
    const credential = await f.host.activatePrincipalSession();
    assert.match(credential.token, /^rat_/);
    assert.doesNotMatch(await readFile(path.join(f.initialized.workspace, "authority", "principals", "registry.jsonl"), "utf8"), new RegExp(credential.token));
    const restarted = createFilePrincipalRegistry({ tenant: f.initialized.identifiers.authorityCellId, file: path.join(f.initialized.workspace, "authority", "principals", "registry.jsonl") });
    assert.deepEqual(await restarted.resolve(credential.token, new Date("2026-08-11T20:11:00.000Z")), credential.context);
    const restartedHost = await cell.createCertificationCellHost({ workspace: f.initialized.workspace, currentTrustPinPath: f.currentTrustPinPath, delegationAuthority: f.delegation, principalRegistry: restarted, now: () => new Date("2026-08-11T20:11:00.000Z") });
    await assert.rejects(() => restartedHost.activatePrincipalSession(), /active runtime session/i);
    const activationPath = path.join(f.initialized.workspace, "authority", "delegation", "root-activation.json");
    const activation = JSON.parse(await readFile(activationPath, "utf8"));
    activation.signedRootGrant.signature.sig += "\n";
    await writeFile(activationPath, JSON.stringify(activation));
    await assert.rejects(() => restartedHost.activatePrincipalSession(), /canonical|signature/i);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("Task 4A runner metadata cannot issue a dispatch permit and consumes no budget access", async () => {
  const f = await fixture();
  try {
    await f.host.activateRootTask({ jobCard: f.jobCard, jobCardTrustPin: f.pin, delegationKeyDescriptor: f.delegationSigner, delegationPrivateKey: f.delegationKey.privateKey, constraints: f.constraints, effects: 2, issuedAt: at, expiresAt: expiry });
    const credential = await f.host.activatePrincipalSession();
    const readiness = { scenario: "github-issue-labels" as const, bearerToken: credential.token };
    assert.equal("createCertifiedRunnerRegistry" in cell, false);
    assert.equal("runCertificationWithPermit" in cell, false);
    await assert.rejects(() => f.host.verifyDispatchReadiness({ ...readiness, bearerToken: "rat_not-the-issued-token" }), /execution is unavailable|non-dispatchable/i);
    assert.equal((await f.delegation.budget.get(f.initialized.identifiers.rootGrantId))?.remaining, 2);
    const budget = f.delegation.budget as any;
    const get = budget.get.bind(budget);
    let budgetReads = 0;
    budget.get = async (...args: unknown[]) => { budgetReads += 1; return get(...args); };
    await assert.rejects(() => f.host.verifyDispatchReadiness(readiness), /execution is unavailable|non-dispatchable/i);
    assert.equal(budgetReads, 0);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("Task 4A cannot issue a permit before later task revocation", async () => {
  const f = await fixture();
  try {
    await f.host.activateRootTask({ jobCard: f.jobCard, jobCardTrustPin: f.pin, delegationKeyDescriptor: f.delegationSigner, delegationPrivateKey: f.delegationKey.privateKey, constraints: f.constraints, effects: 1, issuedAt: at, expiresAt: expiry });
    const credential = await f.host.activatePrincipalSession();
    await assert.rejects(() => f.host.verifyDispatchReadiness({ scenario: "github-issue-labels", bearerToken: credential.token }), /execution is unavailable|non-dispatchable/i);
    await f.delegation.revoke(f.initialized.identifiers.authorityCellId, f.initialized.identifiers.taskId);
    await assert.rejects(() => f.host.activatePrincipalSession(), /active|revoked/i);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("readiness exposes no caller callback and callers cannot select the trust pin", async () => {
  const f = await fixture();
  try {
    await f.host.activateRootTask({ jobCard: f.jobCard, jobCardTrustPin: f.pin, delegationKeyDescriptor: f.delegationSigner, delegationPrivateKey: f.delegationKey.privateKey, constraints: f.constraints, effects: 2, issuedAt: at, expiresAt: expiry });
    const credential = await f.host.activatePrincipalSession();
    await assert.rejects(() => f.host.verifyDispatchReadiness({ scenario: "github-issue-labels", bearerToken: credential.token, currentTrustPinPath: path.join(f.root, "stale-copy.json") } as never), /closed|trust pin|unknown/i);
    await assert.rejects(() => f.host.verifyDispatchReadiness({ scenario: "github-issue-labels", bearerToken: credential.token, credentialAvailable: async () => { throw new Error("CALLBACK_MUST_NOT_RUN"); } } as never), /closed|callback|unknown/i);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("full multi-scenario metadata remains non-dispatchable", async () => {
  const f = await fixture(["github-issue-labels", "slack-topic"]);
  try {
    await f.host.activateRootTask({ jobCard: f.jobCard, jobCardTrustPin: f.pin, delegationKeyDescriptor: f.delegationSigner, delegationPrivateKey: f.delegationKey.privateKey, constraints: f.constraints, effects: 2, issuedAt: at, expiresAt: expiry });
    const credential = await f.host.activatePrincipalSession();
    await assert.rejects(() => f.host.verifyDispatchReadiness({ scenario: "github-issue-labels", bearerToken: credential.token }), /execution is unavailable|non-dispatchable/i);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("host runtime owns the immutable trust path and activation only commits its digest", async () => {
  const f = await fixture();
  try {
    const host = await cell.createCertificationCellHost({ workspace: f.initialized.workspace, currentTrustPinPath: f.currentTrustPinPath, delegationAuthority: f.delegation, principalRegistry: f.principals, now: () => new Date("2026-08-11T20:10:00.000Z") });
    const activationInput = { jobCard: f.jobCard, jobCardTrustPin: f.pin, delegationKeyDescriptor: f.delegationSigner, delegationPrivateKey: f.delegationKey.privateKey, constraints: f.constraints, effects: 2, issuedAt: at, expiresAt: expiry };
    for (const extra of [
      { currentTrustPinPath: path.join(f.root, "stale-copy.json") },
      { workspace: f.root },
      { delegationAuthority: { registerRoot: async () => { throw new Error("CALLER_AUTHORITY_RAN"); } } },
      { credentialAvailable: async () => { throw new Error("CALLBACK_RAN"); } },
      { constructor: "caller" },
      { prototype: "caller" },
      JSON.parse('{"__proto__":"caller"}'),
    ]) await assert.rejects(() => host.activateRootTask({ ...activationInput, ...extra } as never), /closed|unknown|caller/i);
    const symbolActivation = { ...activationInput, [Symbol("caller")]: true };
    await assert.rejects(() => host.activateRootTask(symbolActivation as never), /closed|unknown|caller/i);
    const activation = await host.activateRootTask(activationInput);
    assert.equal("currentTrustPinPath" in activation, false);
    assert.match(activation.currentTrustPinPathDigest, /^sha256:[0-9a-f]{64}$/);
    const credential = await host.activatePrincipalSession();
    await assert.rejects(() => (host.activatePrincipalSession as any)({ workspace: f.root }), /argument|closed|unknown/i);
    await assert.rejects(() => (host.revalidateDispatchPermit as any)({ permit: {}, workspace: f.root }), /permit|invalid|closed/i);
    await assert.rejects(() => host.verifyDispatchReadiness(Object.assign({ scenario: "github-issue-labels", bearerToken: credential.token }, { [Symbol("caller")]: true }) as never), /closed|unknown|caller/i);
    const activationFile = path.join(f.initialized.workspace, "authority", "delegation", "root-activation.json");
    const tampered = JSON.parse(await readFile(activationFile, "utf8"));
    tampered.currentTrustPinPathDigest = `sha256:${"0".repeat(64)}`;
    await writeFile(activationFile, JSON.stringify(tampered));
    await assert.rejects(() => host.verifyDispatchReadiness({ scenario: "github-issue-labels", bearerToken: credential.token }), /trust.*path|commitment|substitut/i);
    assert.equal("activateCertificationRootTask" in cell, false);
    assert.equal("verifyCertificationDispatchReadiness" in cell, false);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
