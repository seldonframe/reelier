import test from "node:test";
import assert from "node:assert/strict";
import { createPublicKey, generateKeyPairSync } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { authorityDigest } from "../../src/authority/wire.js";
import { signJobCard } from "../../src/authority/job.js";
import { createSignedCertificationReadiness } from "../../src/authority/certification/authority.js";
import { initializeCertification } from "../../src/authority/certification/initializer.js";
import { preflightCertification } from "../../src/authority/certification/preflight.js";
import { sealCertificationReadiness } from "../../src/authority/certification/readiness.js";
import { createCertificationCellHost, certificationCellHostInternalState, certificationTaskShapeDigest } from "../../src/authority/certification/cell.js";
import { createDelegationAuthority } from "../../src/authority/host/delegation-service.js";
import { createFilePrincipalRegistry } from "../../src/authority/host/principal-registry.js";
import { createGitHubIssueLabelsHermeticComposition } from "../../src/authority/certification/github-issue-labels-runner.js";
import { __testSetAuthorityCellHostPlatform } from "../../src/authority/host/platform.js";
import { createCertificationArtifactKeyBinding, createCertificationLifecycleAuthorityCeremony } from "../../src/authority/certification/lifecycle-authority.js";
import { verifyAuthorityReceiptBundle } from "../../src/authority/verify.js";
import { verifyCertificationTaskReceiptGraph } from "../../src/authority/certification/task-receipt-graph.js";
import { writeCertificationInputManifests } from "./certification-input-fixture.js";
import { AUTHORITY_ADAPTER_CONTRACT_V1_DIGEST } from "../../src/authority/adapter-contract.js";

const at = "2026-08-11T20:00:00.000Z", expiry = "2026-08-11T21:00:00.000Z";
const descriptor = (keyId: string, role: "human-sponsor" | "authority-cell", purpose: string, publicKey: ReturnType<typeof generateKeyPairSync>["publicKey"]) => ({ v: "reelier.authority-key-descriptor/v1", keyId, role, purpose, algorithm: "ed25519", publicKeySpkiBase64: publicKey.export({ type: "spki", format: "der" }).toString("base64") });
const restorePlatform = __testSetAuthorityCellHostPlatform("linux");
test.after(() => restorePlatform());

type LifecycleActivationInput = Parameters<Awaited<ReturnType<typeof createCertificationCellHost>>["activateRootTask"]>[0];
function compileTimeLifecycleActivationBoundary(): void {
  // @ts-expect-error Lifecycle Cell callers must never be able to type-check raw signer material.
  const forbidden: LifecycleActivationInput = { jobCard: {}, jobCardTrustPin: {} as never, constraints: {} as never, effects: 1, issuedAt: at, expiresAt: expiry, delegationKeyDescriptor: {}, delegationPrivateKey: generateKeyPairSync("ed25519").privateKey };
  void forbidden;
}
void compileTimeLifecycleActivationBoundary;

async function fixture(mode: "normal" | "source-drift" | "effect-drift" | "provider-503" | "accessor-response" | "cut-after-budget" | "cut-after-dispatched" | "cut-after-send-intent" | "cut-after-cleanup-publication" | "pause-after-dispatched" = "normal", authorityMode: "valid" | "absent" | "substituted" | "contract-substituted" = "valid") {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-github-cell-"));
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
  return { root, initialized, cell, runner, credential, delegation, pin, lifecycle, activation, jobCard, constraints };
}

test("only a genuine Cell host can compose the fixed runner", async () => {
  await assert.rejects(() => createGitHubIssueLabelsHermeticComposition({ verifyDispatchReadiness: async () => ({}), revalidateDispatchPermit: async () => undefined } as never), /genuine|brand|Cell/i);
});

test("runner refuses absent or caller-substituted contract and gate authority", async () => {
  await assert.rejects(() => fixture("normal", "absent"), /activated|descriptor|signer|authority|closed/i);
  await assert.rejects(() => fixture("normal", "substituted"), /match|descriptor|signer|authority/i);
});

test("real Cell permit, gate reservation, exact plan and budget precede one fixed provider write", async () => {
  const f = await fixture("pause-after-dispatched"); try {
    await assert.rejects(() => f.cell.verifyDispatchReadiness({ scenario: "github-issue-labels", bearerToken: f.credential.token }), /execution is unavailable|non-dispatchable/i);
    const result = await f.runner.run({ bearerToken: f.credential.token, requestId: "request_normal" });
    assert.equal(result.status, "acknowledged"); assert.equal(result.success, false); assert.equal(result.providerWrites, 1);
    assert.equal((await f.delegation.budget.get(f.activation.allocationId))?.consumed, 1);
    assert.equal((await f.runner.status({ bearerToken: f.credential.token, requestId: "request_normal" })).status, "acknowledged");
    const duplicate = await f.runner.run({ bearerToken: f.credential.token, requestId: "request_normal" }); assert.equal(duplicate.providerWrites, 1);
    await assert.rejects(() => f.runner.run({ bearerToken: "invalid", requestId: "request_normal" }), /credential|principal|bearer/i);
    assert.equal((await (f.runner as any).status({ bearerToken: f.credential.token, requestId: "request_normal" })).status, "acknowledged");
    await assert.rejects(() => (f.runner as any).status({ bearerToken: "invalid", requestId: "request_normal" }), /credential|principal|bearer/i);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

for (const mode of ["source-drift", "effect-drift"] as const) test(`${mode} refuses with zero writes and no budget consumption`, async () => { const f = await fixture(mode); try { const result = await f.runner.run({ bearerToken: f.credential.token, requestId: `request_${mode}` }); assert.equal(result.status, "refused"); assert.equal(result.providerWrites, 0); const budget = await f.delegation.budget.get(f.activation.allocationId); assert.equal(budget?.consumed, 0); assert.equal(budget?.remaining, 2); } finally { await rm(f.root, { recursive: true, force: true }); } });

for (const mode of ["provider-503", "accessor-response"] as const) test(`${mode} is never acknowledged`, async () => { const f = await fixture(mode); try { const result = await f.runner.run({ bearerToken: f.credential.token, requestId: `request_${mode}` }); assert.notEqual(result.status, "acknowledged"); assert.equal(result.success, false); assert.equal(result.providerWrites, 1); } finally { await rm(f.root, { recursive: true, force: true }); } });

test("503 after apply is ambiguous, retains budget, and blocks cleanup until authoritative reconciliation", async () => {
  const f = await fixture("provider-503"); try {
    const result = await f.runner.run({ bearerToken: f.credential.token, requestId: "request_503_ambiguous" });
    assert.equal(result.status, "pending-reconciliation");
    assert.equal((await f.delegation.budget.get(f.activation.allocationId))?.consumed, 1);
    await assert.rejects(() => f.runner.cleanup({ bearerToken: f.credential.token, requestId: "request_503_ambiguous" }), /reconciliation|acknowledged/i);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("Adapter Contract digest is bound before dispatch and by every portable receipt extension", async () => {
  await assert.rejects(() => fixture("normal", "contract-substituted"), /adapter|contract|binding|signature/i);
  const f = await fixture(); try {
    assert.equal((f.lifecycle.binding as any).adapterContractDigest, AUTHORITY_ADAPTER_CONTRACT_V1_DIGEST);
    assert.equal((f.lifecycle.humanCommitment as any).adapterContractDigest, AUTHORITY_ADAPTER_CONTRACT_V1_DIGEST);
    const internal: any = certificationCellHostInternalState(f.cell), permit = await internal.issueHermeticGitHubPermit(f.credential.token);
    assert.deepEqual(internal.hermeticGitHubPermitSnapshot(permit), { digest: internal.hermeticGitHubPermitSnapshot(permit).digest, adapterContractDigest: AUTHORITY_ADAPTER_CONTRACT_V1_DIGEST });
    await internal.revalidateHermeticGitHubPermit(permit);
    await f.runner.run({ bearerToken: f.credential.token, requestId: "request_contract_binding" });
    const graph: any = await f.runner.exportGraph({ bearerToken: f.credential.token });
    assert.equal(graph.receiptExtensions.length, graph.receipts.length);
    assert.equal(graph.receiptExtensions.every((item: any) => item.adapterContractDigest === AUTHORITY_ADAPTER_CONTRACT_V1_DIGEST), true);
    assert.deepEqual(graph.receiptExtensions.map((item: any) => item.receiptDigest), graph.receipts.map((item: any) => authorityDigest(item.receipt.value)));
    assert.equal(verifyCertificationTaskReceiptGraph(graph, { trustPin: f.pin }).status, "verified");
    const changed = structuredClone(graph); changed.receiptExtensions[0].adapterContractDigest = `sha256:${"0".repeat(64)}`;
    assert.throws(() => verifyCertificationTaskReceiptGraph(changed, { trustPin: f.pin }), /adapter|contract|extension|terminal|digest/i);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("lifecycle Cell activation rejects every caller-supplied raw delegation key field before access", async () => {
  const f = await fixture(); try {
    let accesses = 0;
    const rawKey = new Proxy({}, { get() { accesses += 1; throw new Error("RAW_KEY_ACCESSED"); } });
    await assert.rejects(() => f.cell.activateRootTask({ jobCard: f.jobCard, jobCardTrustPin: f.pin, constraints: f.constraints, effects: 2, issuedAt: at, expiresAt: expiry, delegationKeyDescriptor: rawKey, delegationPrivateKey: rawKey } as never), /closed|unknown|caller/i);
    assert.equal(accesses, 0);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("lifecycle activation delegates to a narrower child principal and child allocation", async () => {
  const f = await fixture(); try {
    const activation: any = f.activation;
    assert.equal(activation.signedRootGrant.grant.delegationPolicy.mayDelegate, true);
    assert.equal(activation.signedChildGrant.grant.parentDigest, activation.signedRootGrant.digest);
    assert.equal(activation.signedChildGrant.grant.grantor, activation.signedRootGrant.grant.grantee);
    assert.equal(activation.principalId, activation.signedChildGrant.grant.grantee);
    assert.notEqual(activation.allocationId, activation.rootAllocationId);
    assert.equal(f.credential.context.grantId, activation.signedChildGrant.grant.grantId);
    const rootBudget = await f.delegation.budget.get(activation.rootAllocationId), childBudget = await f.delegation.budget.get(activation.allocationId);
    assert.equal(rootBudget?.remaining, 0);
    assert.equal(childBudget?.effects, 2);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("pending reconciliation uses an authoritative read and converges without resend", async () => {
  const f = await fixture("provider-503"); try {
    const pending = await f.runner.run({ bearerToken: f.credential.token, requestId: "request_503_recover" });
    assert.equal(pending.status, "pending-reconciliation");
    assert.equal(pending.providerWrites, 1);
    const restarted = await createGitHubIssueLabelsHermeticComposition(f.cell);
    assert.deepEqual(await restarted.recover(), ["request_503_recover"]);
    const reconciled = await restarted.status({ bearerToken: f.credential.token, requestId: "request_503_recover" });
    assert.equal(reconciled.status, "acknowledged");
    assert.equal(reconciled.providerWrites, 1);
    const cleaned = await restarted.cleanup({ bearerToken: f.credential.token, requestId: "request_503_recover" });
    assert.equal(cleaned.status, "cleaned");
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

for (const mode of ["cut-after-budget", "cut-after-dispatched", "cut-after-send-intent"] as const) test(`${mode} recovery converges without resending`, async () => { const f = await fixture(mode); try { await assert.rejects(() => f.runner.run({ bearerToken: f.credential.token, requestId: `request_${mode}` }), /controlled cut/i); const restarted = await createGitHubIssueLabelsHermeticComposition(f.cell); const recovered = await restarted.recover(); const status = await restarted.status({ bearerToken: f.credential.token, requestId: `request_${mode}` }); assert.equal(status.providerWrites <= 1, true); assert.equal(recovered.includes(`request_${mode}`), true); const budget = await f.delegation.budget.get(f.activation.allocationId); assert.equal(budget?.remaining, mode === "cut-after-budget" ? 2 : 1); if (mode !== "cut-after-budget") assert.equal(status.status, "pending-reconciliation"); } finally { await rm(f.root, { recursive: true, force: true }); } });

test("well-shaped journal tampering refuses recovery without budget mutation or provider action", async () => {
  const f = await fixture("cut-after-budget"); try {
    await assert.rejects(() => f.runner.run({ bearerToken: f.credential.token, requestId: "request_tamper" }), /controlled cut/i);
    const journalPath = path.join(f.initialized.workspace, "authority", "github-label-runner", "request_tamper.journal.json");
    const journal = JSON.parse(await readFile(journalPath, "utf8")); journal.effectDigest = `sha256:${"0".repeat(64)}`; await writeFile(journalPath, `${JSON.stringify(journal)}\n`, "utf8");
    const restarted = await createGitHubIssueLabelsHermeticComposition(f.cell);
    await assert.rejects(() => restarted.recover(), /signature|tamper|journal/i);
    const budget = await f.delegation.budget.get(f.activation.allocationId); assert.equal(budget?.consumed, 1); assert.equal(budget?.remaining, 1);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("a previously valid signed journal cannot roll acknowledged ledger truth backward", async () => {
  const f = await fixture("pause-after-dispatched"); try {
    const journalPath = path.join(f.initialized.workspace, "authority", "github-label-runner", "request_rollback.journal.json");
    const running = f.runner.run({ bearerToken: f.credential.token, requestId: "request_rollback" });
    let old = ""; for (let attempts = 0; attempts < 1000; attempts += 1) { try { const bytes = await readFile(journalPath, "utf8"); if (JSON.parse(bytes).phase === "dispatched") { old = bytes; break; } } catch {} await new Promise(resolve => setTimeout(resolve, 2)); }
    const result = await running; assert.equal(result.status, "acknowledged"); assert.notEqual(old, ""); await writeFile(journalPath, old, "utf8");
    const restarted = await createGitHubIssueLabelsHermeticComposition(f.cell);
    await assert.rejects(() => restarted.recover(), /rollback|ledger|phase|binding/i);
    const budget = await f.delegation.budget.get(f.activation.allocationId); assert.equal(budget?.consumed, 1); assert.equal(budget?.remaining, 1);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("concurrent recovery cannot release a live dispatched request before its one write", async () => {
  const f = await fixture("pause-after-dispatched"); try {
    const running = f.runner.run({ bearerToken: f.credential.token, requestId: "request_race" });
    const journalPath = path.join(f.initialized.workspace, "authority", "github-label-runner", "request_race.journal.json");
    for (let attempts = 0; attempts < 100; attempts += 1) { try { if (JSON.parse(await readFile(journalPath, "utf8")).phase === "dispatched") break; } catch {} await new Promise(resolve => setTimeout(resolve, 5)); }
    const restarted = await createGitHubIssueLabelsHermeticComposition(f.cell);
    await assert.rejects(() => restarted.recover(), /busy|lock/i);
    const result = await running; assert.equal(result.status, "acknowledged"); assert.equal(result.providerWrites, 1);
    const budget = await f.delegation.budget.get(f.activation.allocationId); assert.equal(budget?.consumed, 1); assert.equal(budget?.remaining, 1);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("cut after authoritative apply reconciles from durable provider state without resend and cleanup restores exact before labels", async () => {
  const f = await fixture("cut-after-apply" as never); try {
    await assert.rejects(() => f.runner.run({ bearerToken: f.credential.token, requestId: "request_cut_apply" }), /controlled cut/i);
    const restarted = await createGitHubIssueLabelsHermeticComposition(f.cell);
    await restarted.recover();
    const reconciled = await restarted.status({ bearerToken: f.credential.token, requestId: "request_cut_apply" });
    assert.equal(reconciled.status, "acknowledged");
    assert.equal(reconciled.providerWrites, 1);
    const cleaned = await restarted.cleanup({ bearerToken: f.credential.token, requestId: "request_cut_apply" });
    assert.equal(cleaned.status, "cleaned");
    assert.deepEqual(cleaned.labels, ["before"]);
    assert.equal(cleaned.providerWrites, 2);
    assert.equal((await f.delegation.budget.get(f.activation.allocationId))?.consumed, 2);
    const replay = await restarted.cleanup({ bearerToken: f.credential.token, requestId: "request_cut_apply" });
    assert.equal(replay.providerWrites, 2);
    assert.equal((await f.delegation.budget.get(f.activation.allocationId))?.consumed, 2);
    const portable = path.join(f.initialized.workspace, "authority", "github-label-runner", "receipts", "portable");
    assert.equal((await readdir(portable)).length >= 5, true);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("semantic duplicate and conflicting bytes do not write or consume additional budget", async () => {
  const f = await fixture(); try {
    const first = await f.runner.run({ bearerToken: f.credential.token, requestId: "request_original" });
    assert.equal(first.providerWrites, 1);
    const duplicate = await f.runner.run({ bearerToken: f.credential.token, requestId: "request_semantic_duplicate" });
    assert.equal(duplicate.status, "duplicate");
    assert.equal(duplicate.providerWrites, 1);
    const exactBytes = Buffer.from('{"labels":["conflicting"]}', "utf8").toString("base64");
    const conflict = await f.runner.conflict({ bearerToken: f.credential.token, requestId: "request_original", exactBytes });
    assert.equal(conflict.status, "conflict");
    assert.equal(conflict.providerWrites, 1);
    assert.equal((conflict as any).exactBytesDigest, authorityDigest({ v: "reelier.exact-conflicting-bytes/v1", base64: exactBytes }));
    assert.deepEqual(await f.runner.conflict({ bearerToken: f.credential.token, requestId: "request_original", exactBytes }), conflict);
    await assert.rejects(() => f.runner.conflict({ bearerToken: f.credential.token, requestId: "request_original", exactBytes: Buffer.from("changed").toString("base64") }), /conflict.*bytes|changed.*bytes|exact/i);
    assert.equal((await f.delegation.budget.get(f.activation.allocationId))?.consumed, 1);
    const graph = await f.runner.exportGraph({ bearerToken: f.credential.token });
    assert.equal(graph.exceptions.some((item: any) => item.kind === "conflict" && item.exactBytesDigest === (conflict as any).exactBytesDigest), true);
    assert.equal(verifyCertificationTaskReceiptGraph(graph, { trustPin: f.pin }).status, "verified");
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("dispatch and reconciliation mint portable chained receipts accepted by the existing offline verifier", async () => {
  const f = await fixture(); try {
    await f.runner.run({ bearerToken: f.credential.token, requestId: "request_receipts" });
    const directory = path.join(f.initialized.workspace, "authority", "github-label-runner", "receipts", "portable");
    const bundles = await Promise.all((await readdir(directory)).map(async name => JSON.parse(await readFile(path.join(directory, name), "utf8"))));
    assert.equal(bundles.length, 3);
    const activation = JSON.parse(await readFile(path.join(f.initialized.workspace, "authority", "delegation", "root-activation.json"), "utf8"));
    const direct = f.pin.keyDescriptors.filter((item: any) => item.role === "authority-cell").map((item: any) => ({ tenant: activation.authorityCellId, signerId: item.keyId, principalId: item.purpose === "delegation-grant" ? activation.signedRootGrant.grant.grantor : activation.principalId, publicKey: createPublicKey({ key: Buffer.from(item.publicKeySpkiBase64, "base64"), format: "der", type: "spki" }), purposes: [item.purpose] }));
    const delegated = f.lifecycle.binding.entries.map(item => ({ tenant: activation.authorityCellId, signerId: item.keyId, principalId: activation.principalId, publicKey: createPublicKey({ key: Buffer.from(item.publicKeySpkiBase64, "base64"), format: "der", type: "spki" }), purposes: [item.artifactPurpose] }));
    const first = bundles.find(bundle => bundle.receipt.value.priorReceiptDigest === null), second = bundles.find(bundle => bundle.receipt.value.priorReceiptDigest === authorityDigest(first?.receipt.value)), third = bundles.find(bundle => bundle.receipt.value.priorReceiptDigest === authorityDigest(second?.receipt.value));
    assert.ok(first); assert.ok(second); assert.ok(third);
    verifyAuthorityReceiptBundle(first, { tenant: activation.authorityCellId, trustRoots: [...direct, ...delegated] as never });
    verifyAuthorityReceiptBundle(second, { tenant: activation.authorityCellId, trustRoots: [...direct, ...delegated] as never, priorReceipt: first.receipt.value });
    verifyAuthorityReceiptBundle(third, { tenant: activation.authorityCellId, trustRoots: [...direct, ...delegated] as never, priorReceipt: second.receipt.value });
    assert.equal(second.receipt.value.priorReceiptDigest, authorityDigest(first.receipt.value));
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("closed task receipt graph verifies offline and rejects tampering, omission, duplication, imbalance, forks, contract drift, and confidential leakage", async () => {
  const f = await fixture(); try {
    await f.runner.run({ bearerToken: f.credential.token, requestId: "request_graph" });
    await f.runner.cleanup({ bearerToken: f.credential.token, requestId: "request_graph" });
    const graph = await f.runner.exportGraph({ bearerToken: f.credential.token });
    assert.throws(() => verifyCertificationTaskReceiptGraph(graph), /external|trust pin|operator/i);
    assert.equal(verifyCertificationTaskReceiptGraph(graph, { trustPin: f.pin }).status, "verified");
    for (const mutate of [
      (g: any) => { g.adapterContractDigest = `sha256:${"0".repeat(64)}`; },
      (g: any) => { g.receipts.pop(); },
      (g: any) => { g.receipts.push(g.receipts[0]); },
      (g: any) => { g.allocations[0].consumed += 1; },
      (g: any) => { g.priorReceiptLinks.find((item: any) => item.priorReceiptDigest !== null).priorReceiptDigest = null; },
      (g: any) => { g.receipts[0].contract.value.contractId = "substituted"; },
      (g: any) => { g.secretToken = "canary-private-token"; },
      (g: any) => { g.receipts.pop(); g.priorReceiptLinks.pop(); g.outcomes.pop(); g.budgetEvents.pop(); },
    ]) { const changed = structuredClone(graph); mutate(changed); assert.throws(() => verifyCertificationTaskReceiptGraph(changed, { trustPin: f.pin }), /graph|receipt|contract|budget|confidential|closed|digest|chain/i); }
    const attacker: any = structuredClone(graph); attacker.keyDescriptors = attacker.keyDescriptors.map((item: any) => ({ ...item, keyId: `attacker_${item.keyId}` }));
    assert.throws(() => verifyCertificationTaskReceiptGraph(attacker, { trustPin: f.pin }), /trust|descriptor|activated|readiness|graph/i);
    assert.equal(JSON.stringify(graph).includes("canary-private-token"), false);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("linked config, plan, and journal paths refuse before authority recovery or provider action", async t => {
  for (const target of ["config", "plan", "journal"] as const) await t.test(target, async t => {
    const f = await fixture(target === "journal" ? "cut-after-budget" : "normal"); try {
      if (target === "journal") await assert.rejects(() => f.runner.run({ bearerToken: f.credential.token, requestId: "request_link" }), /controlled cut/i);
      const original = target === "config" ? path.join(f.initialized.workspace, "config.json") : target === "plan" ? path.join(f.initialized.workspace, "inputs", "plans") : path.join(f.initialized.workspace, "authority", "github-label-runner");
      const real = `${original}.real`; await rename(original, real);
      try { await symlink(real, original, target === "config" ? "file" : "junction"); } catch (error) { if ((error as NodeJS.ErrnoException).code === "EPERM") { t.skip("symlink privilege unavailable"); return; } throw error; }
      const budgetBefore = await f.delegation.budget.get(f.activation.allocationId);
      await assert.rejects(() => createGitHubIssueLabelsHermeticComposition(f.cell), /linked|reparse|confined/i);
      const budgetAfter = await f.delegation.budget.get(f.activation.allocationId); assert.equal(budgetAfter?.consumed, budgetBefore?.consumed); assert.equal(budgetAfter?.remaining, budgetBefore?.remaining);
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });
});

test("restart publishes a missing cleanup receipt after authoritative restore without resend or extra budget", async () => {
  const f = await fixture("cut-after-cleanup-publication"); try {
    await f.runner.run({ bearerToken: f.credential.token, requestId: "request_cleanup_publish" });
    await assert.rejects(() => f.runner.cleanup({ bearerToken: f.credential.token, requestId: "request_cleanup_publish" }), /controlled cut/i);
    const root = path.join(f.initialized.workspace, "authority", "github-label-runner");
    const pending = JSON.parse(await readFile(path.join(root, "request_cleanup_publish.journal.json"), "utf8"));
    assert.equal(pending.phase, "cleanup-publication-pending");
    assert.equal(pending.providerWrites, 2);
    assert.equal((await f.delegation.budget.get(f.activation.allocationId))?.consumed, 2);
    const restarted = await createGitHubIssueLabelsHermeticComposition(f.cell);
    assert.deepEqual(await restarted.recover(), ["request_cleanup_publish"]);
    const cleaned = await restarted.status({ bearerToken: f.credential.token, requestId: "request_cleanup_publish" });
    assert.equal(cleaned.status, "cleaned");
    assert.equal(cleaned.providerWrites, 2);
    assert.equal((await f.delegation.budget.get(f.activation.allocationId))?.consumed, 2);
    const generations = await Promise.all((await readdir(root)).filter(name => name.startsWith("request_cleanup_publish.journal-generation.")).map(async name => JSON.parse(await readFile(path.join(root, name), "utf8"))));
    assert.deepEqual(generations.map(item => item.phase).filter((phase: string) => phase.startsWith("cleanup-")), ["cleanup-reserved", "cleanup-budget-consumed", "cleanup-dispatched", "cleanup-send-intent", "cleanup-applied", "cleanup-publication-pending", "cleanup-receipted"]);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("task graph exports the complete canonical journal and budget chronology", async () => {
  const f = await fixture(); try {
    await f.runner.run({ bearerToken: f.credential.token, requestId: "request_graph_chronology" });
    await f.runner.cleanup({ bearerToken: f.credential.token, requestId: "request_graph_chronology" });
    const graph: any = await f.runner.exportGraph({ bearerToken: f.credential.token });
    assert.deepEqual(graph.outcomes.map((item: any) => item.eventSequence), Array.from({ length: 14 }, (_, index) => index));
    assert.deepEqual(graph.outcomes.map((item: any) => item.phase), ["reserved", "budget-intent", "budget-consumed", "dispatched", "provider-send-intent", "provider-applied", "acknowledged", "cleanup-reserved", "cleanup-budget-consumed", "cleanup-dispatched", "cleanup-send-intent", "cleanup-applied", "cleanup-publication-pending", "cleanup-receipted"]);
    assert.deepEqual(graph.budgetEvents.map((item: any) => item.event.type), ["allocated", "allocated", "consumed", "consumed"]);
    assert.deepEqual(graph.budgetEvents.map((item: any) => item.sequence), [0, 1, 2, 3]);
    assert.equal(graph.budgetEvents[0].priorBudgetEventDigest, null);
    for (let index = 1; index < graph.budgetEvents.length; index += 1) assert.equal(graph.budgetEvents[index].priorBudgetEventDigest, authorityDigest(graph.budgetEvents[index - 1]));
    assert.deepEqual(graph.topology, { status: "unchecked" });
    assert.deepEqual(graph.leases, { status: "absent", entries: [] });
    assert.deepEqual(graph.terminalCommitment.counts, { grants: 2, principals: 2, allocations: 2, budgetEvents: 4, outcomes: 14, exceptions: 0, topologyEvidence: 0, leases: 0, receipts: 6, priorReceiptLinks: 6, keyDescriptors: 8, bindingEntries: 4 });
    for (const key of ["grants", "principals", "allocations", "budgetEvents", "outcomes", "exceptions", "receipts", "priorReceiptLinks", "keyDescriptors"] as const) assert.equal(graph.terminalCommitment.collectionDigests[key], authorityDigest(graph[key]));
    assert.equal(verifyCertificationTaskReceiptGraph(graph, { trustPin: f.pin }).status, "verified");
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("certification-local task graph schema is closed and accepts the exported graph", async () => {
  const f = await fixture(); try {
    await f.runner.run({ bearerToken: f.credential.token, requestId: "request_graph_schema" });
    const graph = await f.runner.exportGraph({ bearerToken: f.credential.token });
    const bytes = await readFile(path.resolve("contract/certification/v1/task-receipt-graph.schema.json"), "utf8").catch(() => null);
    assert.ok(bytes, "certification-local task graph schema must exist");
    const Ajv2020 = createRequire(import.meta.url)("ajv/dist/2020").default, ajv = new Ajv2020({ strict: false });
    const validate = ajv.compile(JSON.parse(bytes));
    assert.equal(validate(graph), true, JSON.stringify(validate.errors));
    for (const mutate of [
      (g: any) => { g.extra = true; },
      (g: any) => { g.topology.extra = true; },
      (g: any) => { g.leases.status = "verified"; },
      (g: any) => { g.budgetEvents[0].event.extra = true; },
      (g: any) => { g.outcomes[0].extra = true; },
      (g: any) => { g.terminalCommitment.counts.extra = 1; },
    ]) { const changed: any = structuredClone(graph); mutate(changed); assert.equal(validate(changed), false); }
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("cleanup journal is append-only and refuses a valid old signed head rollback", async () => {
  const f = await fixture(); try {
    await f.runner.run({ bearerToken: f.credential.token, requestId: "request_cleanup_rollback" });
    const head = path.join(f.initialized.workspace, "authority", "github-label-runner", "request_cleanup_rollback.journal.json");
    const acknowledged = await readFile(head);
    await f.runner.cleanup({ bearerToken: f.credential.token, requestId: "request_cleanup_rollback" });
    const cleaned = JSON.parse(await readFile(head, "utf8"));
    assert.equal(cleaned.phase, "cleanup-receipted");
    assert.equal(cleaned.eventSequence > 0, true);
    assert.match(cleaned.priorJournalDigest, /^sha256:/);
    await writeFile(head, acknowledged);
    const restarted = await createGitHubIssueLabelsHermeticComposition(f.cell);
    await assert.rejects(() => restarted.status({ bearerToken: f.credential.token, requestId: "request_cleanup_rollback" }), /rollback|journal head|generation/i);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("offline graph verification refuses an evidence root revoked by the external current trust history", async () => {
  const f = await fixture(); try {
    await f.runner.run({ bearerToken: f.credential.token, requestId: "request_revoked_evidence" });
    const graph = await f.runner.exportGraph({ bearerToken: f.credential.token });
    const evidence = f.pin.keyDescriptors.find((item: any) => item.role === "authority-cell" && item.purpose === "authority-evidence");
    assert.ok(evidence);
    const previous = f.pin.currentTrustEvents[f.pin.currentTrustEvents.length - 1];
    const revoke = { v: "reelier.authority-trust-event/v1", eventId: "trust_revoke_evidence", sequence: f.pin.currentTrustEvents.length, action: "revoke", keyDescriptorDigest: authorityDigest(evidence), occurredAt: new Date(Date.parse(previous.occurredAt) + 1).toISOString(), previousEventDigest: authorityDigest(previous) };
    const revoked = { ...f.pin, currentTrustEvents: [...f.pin.currentTrustEvents, revoke] };
    assert.throws(() => verifyCertificationTaskReceiptGraph(graph, { trustPin: revoked }), /evidence.*revoked|currently active|current trust/i);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("a junction-substituted receipt store refuses cleanup and leaves the external target untouched", async t => {
  const f = await fixture(); const outside = await mkdtemp(path.join(tmpdir(), "reelier-receipt-outside-")); try {
    await f.runner.run({ bearerToken: f.credential.token, requestId: "request_receipt_link" });
    const receipts = path.join(f.initialized.workspace, "authority", "github-label-runner", "receipts"), real = `${receipts}.real`;
    await rename(receipts, real); try { await symlink(outside, receipts, "junction"); } catch (error) { if ((error as NodeJS.ErrnoException).code === "EPERM") { t.skip("symlink privilege unavailable"); return; } throw error; }
    await assert.rejects(() => f.runner.cleanup({ bearerToken: f.credential.token, requestId: "request_receipt_link" }), /linked|reparse|confined/i);
    assert.deepEqual(await readdir(outside), []);
  } finally { await rm(f.root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});
