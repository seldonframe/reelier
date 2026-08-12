import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { authorityDigest } from "../../src/authority/wire.js";
import { signJobCard } from "../../src/authority/job.js";
import { createSignedCertificationReadiness } from "../../src/authority/certification/authority.js";
import { initializeCertification } from "../../src/authority/certification/initializer.js";
import { preflightCertification } from "../../src/authority/certification/preflight.js";
import { sealCertificationReadiness } from "../../src/authority/certification/readiness.js";
import { createCertificationCellHost, certificationTaskShapeDigest } from "../../src/authority/certification/cell.js";
import { createDelegationAuthority } from "../../src/authority/host/delegation-service.js";
import { createFilePrincipalRegistry } from "../../src/authority/host/principal-registry.js";
import { createGitHubIssueLabelsHermeticComposition } from "../../src/authority/certification/github-issue-labels-runner.js";
import { __testSetAuthorityCellHostPlatform } from "../../src/authority/host/platform.js";
import { createCertificationArtifactKeyBinding, createCertificationLifecycleAuthorityCeremony } from "../../src/authority/certification/lifecycle-authority.js";
import { writeCertificationInputManifests } from "./certification-input-fixture.js";

const at = "2026-08-11T20:00:00.000Z", expiry = "2026-08-11T21:00:00.000Z";
const descriptor = (keyId: string, role: "human-sponsor" | "authority-cell", purpose: string, publicKey: ReturnType<typeof generateKeyPairSync>["publicKey"]) => ({ v: "reelier.authority-key-descriptor/v1", keyId, role, purpose, algorithm: "ed25519", publicKeySpkiBase64: publicKey.export({ type: "spki", format: "der" }).toString("base64") });
const restorePlatform = __testSetAuthorityCellHostPlatform("linux");
test.after(() => restorePlatform());

async function fixture(mode: "normal" | "source-drift" | "effect-drift" | "provider-503" | "accessor-response" | "cut-after-budget" | "cut-after-dispatched" | "cut-after-send-intent" | "pause-after-dispatched" = "normal", authorityMode: "valid" | "absent" | "substituted" = "valid") {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-github-cell-"));
  const configPath = path.join(root, "certification.local.json");
  await writeFile(configPath, JSON.stringify({ v: "reelier.certification-operator-config/v3", authorityConfigPath: "authority/authority.yml", evidenceDirectory: "authority/receipts/certification", scenarios: ["github-issue-labels"], resources: { "github-issue-labels": { apiBaseUrl: "https://api.github.com", owner: "fixlyai", repository: "reelier-certification", issueNumber: 1 } }, cleanup: { "github-issue-labels": ["restore-github-labels"] }, desiredState: { "github-issue-labels": { labels: ["certification-after"] } }, metadata: {}, secretReferences: { githubCredential: "env:REELIER_GITHUB_TOKEN" } }), "utf8");
  const initialized = await initializeCertification({ configPath }); await writeCertificationInputManifests(initialized.workspace, ["github-issue-labels"]);
  const selection = { workspace: initialized.workspace, scenario: "github-issue-labels" as const };
  const preflight = await preflightCertification(selection), sealed = await sealCertificationReadiness(selection);
  const readinessKey = generateKeyPairSync("ed25519"), jobKey = generateKeyPairSync("ed25519"), ceremony = createCertificationLifecycleAuthorityCeremony();
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
  const lifecycleAuthority = { handle: ceremony.opaqueHandle, binding: authorityMode === "substituted" ? { ...lifecycle.binding, taskId: "task_substituted" } : lifecycle.binding, commitment: lifecycle.humanCommitment };
  const cell = await createCertificationCellHost({ workspace: initialized.workspace, currentTrustPinPath: trustPath, delegationAuthority: delegation, principalRegistry: principals, now: () => new Date("2026-08-11T20:10:00.000Z"), ...(authorityMode === "absent" ? {} : { lifecycleAuthority }) });
  await cell.activateRootTask({ jobCard, jobCardTrustPin: pin, constraints, effects: 2, issuedAt: at, expiresAt: expiry });
  const credential = await cell.activatePrincipalSession();
  const runner = await createGitHubIssueLabelsHermeticComposition(cell, { mode } as never);
  return { root, initialized, cell, runner, credential, delegation };
}

test("only a genuine Cell host can compose the fixed runner", async () => {
  await assert.rejects(() => createGitHubIssueLabelsHermeticComposition({ verifyDispatchReadiness: async () => ({}), revalidateDispatchPermit: async () => undefined } as never, { mode: "normal" }), /genuine|brand|Cell/i);
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
    assert.equal((await f.delegation.budget.get(f.initialized.identifiers.rootGrantId))?.consumed, 1);
    assert.equal((await f.runner.status({ bearerToken: f.credential.token, requestId: "request_normal" })).status, "acknowledged");
    const duplicate = await f.runner.run({ bearerToken: f.credential.token, requestId: "request_normal" }); assert.equal(duplicate.providerWrites, 1);
    await assert.rejects(() => f.runner.run({ bearerToken: "invalid", requestId: "request_normal" }), /credential|principal|bearer/i);
    assert.equal((await (f.runner as any).status({ bearerToken: f.credential.token, requestId: "request_normal" })).status, "acknowledged");
    await assert.rejects(() => (f.runner as any).status({ bearerToken: "invalid", requestId: "request_normal" }), /credential|principal|bearer/i);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

for (const mode of ["source-drift", "effect-drift"] as const) test(`${mode} refuses with zero writes and no budget consumption`, async () => { const f = await fixture(mode); try { const result = await f.runner.run({ bearerToken: f.credential.token, requestId: `request_${mode}` }); assert.equal(result.status, "refused"); assert.equal(result.providerWrites, 0); const budget = await f.delegation.budget.get(f.initialized.identifiers.rootGrantId); assert.equal(budget?.consumed, 0); assert.equal(budget?.remaining, 2); } finally { await rm(f.root, { recursive: true, force: true }); } });

for (const mode of ["provider-503", "accessor-response"] as const) test(`${mode} is never acknowledged`, async () => { const f = await fixture(mode); try { const result = await f.runner.run({ bearerToken: f.credential.token, requestId: `request_${mode}` }); assert.notEqual(result.status, "acknowledged"); assert.equal(result.success, false); assert.equal(result.providerWrites, 1); } finally { await rm(f.root, { recursive: true, force: true }); } });

for (const mode of ["cut-after-budget", "cut-after-dispatched", "cut-after-send-intent"] as const) test(`${mode} recovery converges without resending`, async () => { const f = await fixture(mode); try { await assert.rejects(() => f.runner.run({ bearerToken: f.credential.token, requestId: `request_${mode}` }), /controlled cut/i); const restarted = await createGitHubIssueLabelsHermeticComposition(f.cell, { mode: "normal" }); const recovered = await restarted.recover(); const status = await restarted.status({ bearerToken: f.credential.token, requestId: `request_${mode}` }); assert.equal(status.providerWrites <= 1, true); assert.equal(recovered.includes(`request_${mode}`), true); const budget = await f.delegation.budget.get(f.initialized.identifiers.rootGrantId); assert.equal(budget?.remaining, mode === "cut-after-budget" ? 2 : 1); if (mode !== "cut-after-budget") assert.equal(status.status, "pending-reconciliation"); } finally { await rm(f.root, { recursive: true, force: true }); } });

test("well-shaped journal tampering refuses recovery without budget mutation or provider action", async () => {
  const f = await fixture("cut-after-budget"); try {
    await assert.rejects(() => f.runner.run({ bearerToken: f.credential.token, requestId: "request_tamper" }), /controlled cut/i);
    const journalPath = path.join(f.initialized.workspace, "authority", "github-label-runner", "request_tamper.journal.json");
    const journal = JSON.parse(await readFile(journalPath, "utf8")); journal.effectDigest = `sha256:${"0".repeat(64)}`; await writeFile(journalPath, `${JSON.stringify(journal)}\n`, "utf8");
    const restarted = await createGitHubIssueLabelsHermeticComposition(f.cell, { mode: "normal" });
    await assert.rejects(() => restarted.recover(), /signature|tamper|journal/i);
    const budget = await f.delegation.budget.get(f.initialized.identifiers.rootGrantId); assert.equal(budget?.consumed, 1); assert.equal(budget?.remaining, 1);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("a previously valid signed journal cannot roll acknowledged ledger truth backward", async () => {
  const f = await fixture("pause-after-dispatched"); try {
    const journalPath = path.join(f.initialized.workspace, "authority", "github-label-runner", "request_rollback.journal.json");
    const running = f.runner.run({ bearerToken: f.credential.token, requestId: "request_rollback" });
    let old = ""; for (let attempts = 0; attempts < 1000; attempts += 1) { try { const bytes = await readFile(journalPath, "utf8"); if (JSON.parse(bytes).phase === "dispatched") { old = bytes; break; } } catch {} await new Promise(resolve => setTimeout(resolve, 2)); }
    const result = await running; assert.equal(result.status, "acknowledged"); assert.notEqual(old, ""); await writeFile(journalPath, old, "utf8");
    const restarted = await createGitHubIssueLabelsHermeticComposition(f.cell, { mode: "normal" });
    await assert.rejects(() => restarted.recover(), /rollback|ledger|phase|binding/i);
    const budget = await f.delegation.budget.get(f.initialized.identifiers.rootGrantId); assert.equal(budget?.consumed, 1); assert.equal(budget?.remaining, 1);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("concurrent recovery cannot release a live dispatched request before its one write", async () => {
  const f = await fixture("pause-after-dispatched"); try {
    const running = f.runner.run({ bearerToken: f.credential.token, requestId: "request_race" });
    const journalPath = path.join(f.initialized.workspace, "authority", "github-label-runner", "request_race.journal.json");
    for (let attempts = 0; attempts < 100; attempts += 1) { try { if (JSON.parse(await readFile(journalPath, "utf8")).phase === "dispatched") break; } catch {} await new Promise(resolve => setTimeout(resolve, 5)); }
    const restarted = await createGitHubIssueLabelsHermeticComposition(f.cell, { mode: "normal" });
    await assert.rejects(() => restarted.recover(), /busy|lock/i);
    const result = await running; assert.equal(result.status, "acknowledged"); assert.equal(result.providerWrites, 1);
    const budget = await f.delegation.budget.get(f.initialized.identifiers.rootGrantId); assert.equal(budget?.consumed, 1); assert.equal(budget?.remaining, 1);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("cut after authoritative apply reconciles from durable provider state without resend and cleanup restores exact before labels", async () => {
  const f = await fixture("cut-after-apply" as never); try {
    await assert.rejects(() => f.runner.run({ bearerToken: f.credential.token, requestId: "request_cut_apply" }), /controlled cut/i);
    const restarted = await createGitHubIssueLabelsHermeticComposition(f.cell, { mode: "normal" });
    await restarted.recover();
    const reconciled = await restarted.status({ bearerToken: f.credential.token, requestId: "request_cut_apply" });
    assert.equal(reconciled.status, "acknowledged");
    assert.equal(reconciled.providerWrites, 1);
    const cleaned = await restarted.cleanup({ bearerToken: f.credential.token, requestId: "request_cut_apply" });
    assert.equal(cleaned.status, "cleaned");
    assert.deepEqual(cleaned.labels, ["before"]);
    assert.equal(cleaned.providerWrites, 2);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("semantic duplicate and conflicting bytes do not write or consume additional budget", async () => {
  const f = await fixture(); try {
    const first = await f.runner.run({ bearerToken: f.credential.token, requestId: "request_original" });
    assert.equal(first.providerWrites, 1);
    const duplicate = await f.runner.run({ bearerToken: f.credential.token, requestId: "request_semantic_duplicate" });
    assert.equal(duplicate.status, "duplicate");
    assert.equal(duplicate.providerWrites, 1);
    const conflict = await f.runner.conflict({ bearerToken: f.credential.token, requestId: "request_original" });
    assert.equal(conflict.status, "conflict");
    assert.equal(conflict.providerWrites, 1);
    assert.equal((await f.delegation.budget.get(f.initialized.identifiers.rootGrantId))?.consumed, 1);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("linked config, plan, and journal paths refuse before authority recovery or provider action", async t => {
  for (const target of ["config", "plan", "journal"] as const) await t.test(target, async t => {
    const f = await fixture(target === "journal" ? "cut-after-budget" : "normal"); try {
      if (target === "journal") await assert.rejects(() => f.runner.run({ bearerToken: f.credential.token, requestId: "request_link" }), /controlled cut/i);
      const original = target === "config" ? path.join(f.initialized.workspace, "config.json") : target === "plan" ? path.join(f.initialized.workspace, "inputs", "plans") : path.join(f.initialized.workspace, "authority", "github-label-runner");
      const real = `${original}.real`; await rename(original, real);
      try { await symlink(real, original, target === "config" ? "file" : "junction"); } catch (error) { if ((error as NodeJS.ErrnoException).code === "EPERM") { t.skip("symlink privilege unavailable"); return; } throw error; }
      const budgetBefore = await f.delegation.budget.get(f.initialized.identifiers.rootGrantId);
      await assert.rejects(() => createGitHubIssueLabelsHermeticComposition(f.cell, { mode: "normal" }), /linked|reparse|confined/i);
      const budgetAfter = await f.delegation.budget.get(f.initialized.identifiers.rootGrantId); assert.equal(budgetAfter?.consumed, budgetBefore?.consumed); assert.equal(budgetAfter?.remaining, budgetBefore?.remaining);
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });
});
