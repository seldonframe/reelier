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

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-cert-cell-"));
  const configPath = path.join(root, "certification.local.json");
  await writeFile(configPath, JSON.stringify({ v: "reelier.certification-operator-config/v2", authorityConfigPath: "authority/authority.yml", evidenceDirectory: "authority/receipts/certification", scenarios: ["github-issue-labels"], resources: { "github-issue-labels": { apiBaseUrl: "https://api.github.com", owner: "fixlyai", repository: "reelier-certification", issueNumber: 1 } }, cleanup: { "github-issue-labels": ["restore-github-labels"] }, metadata: {}, secretReferences: { githubCredential: "env:REELIER_GITHUB_TOKEN" } }), "utf8");
  const initialized = await initializeCertification({ configPath });
  await writeCertificationInputManifests(initialized.workspace, ["github-issue-labels"]);
  const preflight = await preflightCertification({ workspace: initialized.workspace, scenario: "github-issue-labels" });
  const sealed = await sealCertificationReadiness({ workspace: initialized.workspace, scenario: "github-issue-labels" });
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
  const constraints = { definitionAliases: ["github_issue_labels"], audiences: ["certification_agent"], connectorAccounts: [{ connectorId: "github", accountId: "github:fixlyai/reelier-certification" }], projectionPointers: ["/labels"], riskClasses: ["record-state"], limits: { maxEffectsPerWindow: 2, windowSeconds: 3600, maxEffectsPerSourceTrigger: 1, maxBodyBytes: 4096 } };
  const taskShapeDigest = cell.certificationTaskShapeDigest({ identifiers: initialized.identifiers, scenarios: ["github-issue-labels"], constraints });
  const jobCard = signJobCard({ v: "reelier.signed-job-card/v1", jobId: initialized.identifiers.jobCardId, title: "Certification", taskShapeDigest, semanticClasses: ["record_state_set_v1"], definitionAliases: constraints.definitionAliases, connectorIds: ["github"], accountIdentities: ["github:fixlyai/reelier-certification"], connectionDescriptorDigests: [`sha256:${"1".repeat(64)}`], adoptionCommitmentDigests: [`sha256:${"2".repeat(64)}`], sourceRefs: ["certification"], audiences: constraints.audiences, limitsDigest: authorityDigest(constraints.limits), instructionsDigest: `sha256:${"3".repeat(64)}`, packDigests: [`sha256:${"4".repeat(64)}`], exceptionPolicy: ["ambiguous-reconcile"], coverage: "declared-surface" }, jobSigner.keyId, jobKey.privateKey);
  const delegation = createDelegationAuthority({ root: path.join(initialized.workspace, "authority", "delegation"), now: () => new Date("2026-08-11T20:10:00.000Z"), signGrant: async () => { throw new Error("child delegation not expected"); } });
  const principals = createFilePrincipalRegistry({ tenant: initialized.identifiers.authorityCellId, file: path.join(initialized.workspace, "authority", "principals", "registry.jsonl") });
  return { root, initialized, pin, jobCard, constraints, delegationKey, delegationSigner, delegation, principals };
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
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("dispatch permit is opaque, nonserializable, one-use, and invokes the runner exactly once", async () => {
  const f = await fixture();
  try {
    await cell.activateCertificationRootTask({ workspace: f.initialized.workspace, jobCard: f.jobCard, jobCardTrustPin: f.pin, delegationKeyDescriptor: f.delegationSigner, delegationPrivateKey: f.delegationKey.privateKey, constraints: f.constraints, effects: 2, issuedAt: at, expiresAt: expiry, delegationAuthority: f.delegation });
    const credential = await cell.activateCertificationPrincipalSession({ workspace: f.initialized.workspace, delegationAuthority: f.delegation, principalRegistry: f.principals, now: new Date("2026-08-11T20:10:00.000Z") });
    const readiness = { workspace: f.initialized.workspace, scenario: "github-issue-labels" as const, bearerToken: credential.token, delegationAuthority: f.delegation, principalRegistry: f.principals, credentialAvailable: async (slot: string) => slot === "githubCredential", now: () => new Date("2026-08-11T20:10:00.000Z") };
    const permit = await cell.verifyCertificationDispatchReadiness(readiness);
    assert.throws(() => JSON.stringify(permit), /opaque|serializ/i);
    let calls = 0;
    assert.equal(await cell.runCertificationWithPermit(permit, async () => { calls += 1; return "ran"; }), "ran");
    assert.equal(calls, 1);
    await assert.rejects(() => cell.runCertificationWithPermit(permit, async () => { calls += 1; }), /used|permit/i);
    assert.equal(calls, 1);

    const missing = await cell.verifyCertificationDispatchReadiness({ ...readiness, credentialAvailable: async () => true });
    await f.delegation.revoke(f.initialized.identifiers.authorityCellId, f.initialized.identifiers.taskId);
    await assert.rejects(() => cell.runCertificationWithPermit(missing, async () => { calls += 1; }), /revoked|active|stale/i);
    assert.equal(calls, 1);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
