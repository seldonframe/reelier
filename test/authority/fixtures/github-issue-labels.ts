import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { authorityDigest } from "../../../src/authority/wire.js";
import { signJobCard } from "../../../src/authority/job.js";
import { createSignedCertificationReadiness } from "../../../src/authority/certification/authority.js";
import { initializeCertification } from "../../../src/authority/certification/initializer.js";
import { preflightCertification } from "../../../src/authority/certification/preflight.js";
import { sealCertificationReadiness } from "../../../src/authority/certification/readiness.js";
import { createCertificationCellHost, certificationTaskShapeDigest } from "../../../src/authority/certification/cell.js";
import { createDelegationAuthority } from "../../../src/authority/host/delegation-service.js";
import { createFilePrincipalRegistry } from "../../../src/authority/host/principal-registry.js";
import { createGitHubIssueLabelsHermeticComposition } from "../../../src/authority/certification/github-issue-labels-runner.js";
import { createCertificationArtifactKeyBinding, createCertificationLifecycleAuthorityCeremony } from "../../../src/authority/certification/lifecycle-authority.js";
import { __testSetAuthorityCellHostPlatform } from "../../../src/authority/host/platform.js";
import { writeCertificationInputManifests } from "../certification-input-fixture.js";

export type GitHubIssueLabelsFixtureMode =
  | "normal"
  | "source-drift"
  | "effect-drift"
  | "provider-503"
  | "accessor-response"
  | "cut-after-budget"
  | "cut-after-dispatched"
  | "cut-after-send-intent"
  | "cut-after-cleanup-publication"
  | "cut-after-conflict-publication"
  | "cut-after-conflict-receipt-before-extension"
  | "pause-after-dispatched";

export type GitHubIssueLabelsAuthorityMode =
  | "valid"
  | "absent"
  | "substituted"
  | "contract-substituted";

const at = "2026-08-11T20:00:00.000Z", expiry = "2026-08-11T21:00:00.000Z";
const descriptor = (keyId: string, role: "human-sponsor" | "authority-cell", purpose: string, publicKey: ReturnType<typeof generateKeyPairSync>["publicKey"]) => ({ v: "reelier.authority-key-descriptor/v1", keyId, role, purpose, algorithm: "ed25519", publicKeySpkiBase64: publicKey.export({ type: "spki", format: "der" }).toString("base64") });

export async function createGitHubIssueLabelsFixture(mode: GitHubIssueLabelsFixtureMode = "normal", authorityMode: GitHubIssueLabelsAuthorityMode = "valid") {
  const restorePlatform = __testSetAuthorityCellHostPlatform("linux");
  let root = "";
  try {
  root = await mkdtemp(path.join(tmpdir(), "reelier-github-cell-"));
  const configPath = path.join(root, "certification.local.json");
  await writeFile(configPath, JSON.stringify({ v: "reelier.certification-operator-config/v3", authorityConfigPath: "authority/authority.yml", evidenceDirectory: "authority/receipts/certification", scenarios: ["github-issue-labels"], resources: { "github-issue-labels": { apiBaseUrl: "https://api.github.com", owner: "fixlyai", repository: "reelier-certification", issueNumber: 1 } }, cleanup: { "github-issue-labels": ["restore-github-labels"] }, desiredState: { "github-issue-labels": { labels: ["certification-after"] } }, metadata: {}, secretReferences: { githubCredential: "env:REELIER_GITHUB_TOKEN" } }), "utf8");
  const initialized = await initializeCertification({ configPath }); await writeCertificationInputManifests(initialized.workspace, ["github-issue-labels"]);
  const selection = { workspace: initialized.workspace, scenario: "github-issue-labels" as const };
  const preflight = await preflightCertification(selection), sealed = await sealCertificationReadiness(selection);
  const readinessKey = generateKeyPairSync("ed25519"), jobKey = generateKeyPairSync("ed25519"), ceremony = createCertificationLifecycleAuthorityCeremony({ testSchedule: mode });
  const human = descriptor(initialized.identifiers.signerId, "human-sponsor", "certification-readiness", readinessKey.publicKey), jobSigner = descriptor("human_job_card_signer", "human-sponsor", "signed-job-card", jobKey.publicKey);
  const descriptors = [human, jobSigner, ...ceremony.publicDescriptors], events: any[] = [];
  for (const item of descriptors) events.push({ v: "reelier.authority-trust-event/v1", eventId: `trust_${events.length}_${"f".repeat(12)}`, sequence: events.length, action: "activate", keyDescriptorDigest: authorityDigest(item), occurredAt: at, previousEventDigest: events.length ? authorityDigest(events.at(-1)) : null });
  const signedReadiness = createSignedCertificationReadiness({ readinessCandidate: sealed.candidate, readinessCandidateDigest: sealed.digest, preflight, humanKeyDescriptor: human as any, cellKeyDescriptors: ceremony.publicDescriptors, jobCardKeyDescriptors: [jobSigner] as any, trustEvents: events, humanPrivateKey: readinessKey.privateKey, authorizedAt: "2026-08-11T20:01:00.000Z" });
  const pin: any = { v: "reelier.job-card-trust-pin/v1", signedReadiness, readinessCandidate: sealed.candidate, preflight, humanTrustRoot: human, keyDescriptors: descriptors, readinessTrustEvents: events, currentTrustEvents: events };
  const principalId = `principal_${authorityDigest({ v: "reelier.certification-principal-id/v1", taskId: initialized.identifiers.taskId, authorityCellId: initialized.identifiers.authorityCellId }).slice(7, 31)}`;
  const constraints = { definitionAliases: ["github_issue_labels_set_v1"], audiences: [principalId], connectorAccounts: [{ connectorId: "github", accountId: "github_fixlyai_reelier" }], projectionPointers: ["/owner", "/repo", "/issueNumber", "/issueState", "/labels"], riskClasses: ["github_issue_labels"], limits: { maxEffectsPerWindow: 2, windowSeconds: 3600, maxEffectsPerSourceTrigger: 1, maxBodyBytes: 4096 } };
  const jobCard = signJobCard({ v: "reelier.signed-job-card/v1", jobId: initialized.identifiers.jobCardId, title: "Certification", taskShapeDigest: certificationTaskShapeDigest({ identifiers: initialized.identifiers, scenarios: ["github-issue-labels"], constraints }), semanticClasses: ["record_state_set_v1"], definitionAliases: constraints.definitionAliases, connectorIds: ["github"], accountIdentities: ["github:fixlyai/reelier-certification"], connectionDescriptorDigests: [`sha256:${"1".repeat(64)}`], adoptionCommitmentDigests: [`sha256:${"2".repeat(64)}`], sourceRefs: ["certification"], audiences: constraints.audiences, limitsDigest: authorityDigest(constraints.limits), instructionsDigest: `sha256:${"3".repeat(64)}`, packDigests: [`sha256:${"4".repeat(64)}`], exceptionPolicy: ["ambiguous-reconcile"], coverage: "declared-surface" }, jobSigner.keyId, jobKey.privateKey);
  const delegation = createDelegationAuthority({ root: path.join(initialized.workspace, "authority", "delegation"), now: () => new Date("2026-08-11T20:10:00.000Z"), signGrant: async () => { throw new Error("child delegation not expected"); } });
  const principals = createFilePrincipalRegistry({ tenant: initialized.identifiers.authorityCellId, file: path.join(initialized.workspace, "authority", "principals", "registry.jsonl") });
  const trustPath = path.join(root, "operator-current-trust.json"); await writeFile(trustPath, `${JSON.stringify(pin)}\n`);
  const lifecycle = createCertificationArtifactKeyBinding(ceremony.opaqueHandle, { authorityCellId: initialized.identifiers.authorityCellId, taskId: initialized.identifiers.taskId, readinessDigest: authorityDigest(signedReadiness), humanDescriptor: human as any, humanPrivateKey: readinessKey.privateKey, issuedAt: at, expiresAt: expiry });
  const lifecycleAuthority = { handle: ceremony.opaqueHandle, binding: authorityMode === "substituted" ? { ...lifecycle.binding, taskId: "task_substituted" } : authorityMode === "contract-substituted" ? { ...lifecycle.binding, adapterContractDigest: `sha256:${"0".repeat(64)}` } : lifecycle.binding, commitment: lifecycle.humanCommitment };
  const cell = await createCertificationCellHost({ workspace: initialized.workspace, currentTrustPinPath: trustPath, delegationAuthority: delegation, principalRegistry: principals, now: () => new Date("2026-08-11T20:10:00.000Z"), ...(authorityMode === "absent" ? {} : { lifecycleAuthority }) });
  const activation = await cell.activateRootTask({ jobCard, jobCardTrustPin: pin, constraints, effects: 2, issuedAt: at, expiresAt: expiry });
  const credential = await cell.activatePrincipalSession();
  const runner = await createGitHubIssueLabelsHermeticComposition(cell);
  let closed = false;
  return { root, initialized, cell, runner, credential, delegation, pin, lifecycle, activation, jobCard, constraints, close: async () => {
    if (closed) return;
    closed = true;
    try { await rm(root, { recursive: true, force: true }); }
    finally { restorePlatform(); }
  } };
  } catch (error) {
    try { if (root) await rm(root, { recursive: true, force: true }); } catch {}
    restorePlatform();
    throw error;
  }
}

export type GitHubIssueLabelsFixture = Awaited<
  ReturnType<typeof createGitHubIssueLabelsFixture>
>;
