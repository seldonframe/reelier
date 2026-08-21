import test from "node:test";
import assert from "node:assert/strict";
import { createPrivateKey, createPublicKey, generateKeyPairSync } from "node:crypto";
import { access, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { authorityCanonicalBytes, authorityDigest, signAuthorityDigest, signJobCard, signedJobCardDigest } from "../../src/authority/index.js";
import { createGitHubLinearMissionRuntimeV1, requireVerifiedGovernedMissionSequenceV1 } from "../../src/authority/host/index.js";
import { buildAuthorityDeployment } from "../../src/authority/host/deploy.js";
import { createFileOutcomeKernelStorage } from "../../src/authority/host/outcome-kernel-fs-storage.js";
import { createReleaseAuthorizationResolver, createGitHubReleaseRunnerFromOperatorConfig, parseGitHubReleaseRunnerOperatorConfig } from "../../src/authority/host/github-release-runner-config.js";
import { createGitHubReleaseRunner } from "../../src/authority/host/github-release-runner.js";
import { FsAuthorityLedger } from "../../src/authority/host/fs-ledger.js";
import { createSignedJournal } from "../../src/authority/host/signed-journal.js";
import { __testSetAuthorityCellHostPlatform } from "../../src/authority/host/platform.js";
import { createGovernedOutcomeCompositionProfileV1, createGitHubLinearOutcomePackV1, governedOutcomeCompositionAliasesV1, orderedGitHubLinearOperationsV1 } from "../../src/authority/packs/github-linear-outcomes.js";
import { connectionAdoptionCommitmentDigest, connectionDescriptorDigest, digestNormalizedMcpToolSchemas } from "../../src/connections.js";
import { githubReleaseDefinitions } from "../../src/packs/github-release/index.js";
import { githubReleaseEffects, githubReleaseManifest, githubReleasePolicySchemaId, githubReleaseProjectionSchemaId, githubReleaseReadEndpointId, githubReleaseRiskClass } from "../../src/packs/github-release/manifest.js";
import { linearOutcomeDefinitions } from "../../src/packs/linear-outcomes/index.js";
import { linearOutcomeManifest, linearOutcomePolicySchemaId, linearOutcomeProjectionSchemaId, linearOutcomeReadEndpointId, linearOutcomeRiskClass } from "../../src/packs/linear-outcomes/manifest.js";
import { jobCardTrustPinFixture } from "./job-card-trust-pin-fixture.js";
import { releaseServeFixture } from "./github-release-serve-fixture.js";

test("legacy raw authority and generic provider runtime options refuse before filesystem or provider access", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "reelier-genuine-runtime-refusal-")), rootDir = path.join(parent, "not-created");
  let providerCalls = 0, bindingCalls = 0;
  try {
    await assert.rejects(() => createGitHubLinearMissionRuntimeV1({
      rootDir,
      authority: Object.freeze({ raw: true }),
      provider: { async dispatch() { providerCalls += 1; return { outcome: "applied", data: {} }; }, async readback() { providerCalls += 1; return { outcome: "applied", data: {} }; } },
      async resolveHostBindings() { bindingCalls += 1; return { credential: "must-not-read", account: "a", destination: "d", limit: "l" }; },
      now: () => Date.now(),
    }), /legacy|raw|prohibited|genuine/i);
    await assert.rejects(() => access(rootDir), /ENOENT/);
    assert.deepEqual({ providerCalls, bindingCalls }, { providerCalls: 0, bindingCalls: 0 });
  } finally { await rm(parent, { recursive: true, force: true }); }
});

const sha = (seed: string): string => `sha256:${seed.repeat(64).slice(0, 64)}`;
const git = (seed: string): string => seed.repeat(40);

test("mission success requires all five verified Outcomes and exact coordinator publication heads", () => {
  const exact = governedOutcomeCompositionAliasesV1.map((alias, index) => Object.freeze({
    alias,
    status: "verified" as const,
    publicationReceiptRef: sha(String(index + 1)),
    predecessorReceiptRef: index === 4 ? sha("4") : null,
  }));
  assert.doesNotThrow(() => requireVerifiedGovernedMissionSequenceV1(governedOutcomeCompositionAliasesV1, exact));
  for (const changed of [
    exact.slice(1),
    exact.map((item, index) => index === 0 ? { ...item, status: "failed" as const } : item),
    exact.map((item, index) => index === 1 ? { ...item, status: "partial" as const } : item),
    exact.map((item, index) => index === 3 ? { ...item, publicationReceiptRef: null } : item),
    exact.map((item, index) => index === 4 ? { ...item, predecessorReceiptRef: sha("0") } : item),
  ]) assert.throws(() => requireVerifiedGovernedMissionSequenceV1(governedOutcomeCompositionAliasesV1, changed as never), /sequence|verified|publication|predecessor/i);
});

test("signed five-definition runtime recovers an exact Linear-only mission without GitHub effects or resend", async () => {
  const restorePlatform = __testSetAuthorityCellHostPlatform("linux"), release = await releaseServeFixture();
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-genuine-five-runtime-"));
  let linearWrites = 0, linearReads = 0;
  try {
    const reviewed = reviewedAuthority(), pack = createGitHubLinearOutcomePackV1(reviewed);
    const profile = createGovernedOutcomeCompositionProfileV1({ aliases: governedOutcomeCompositionAliasesV1, pack, operations: orderedGitHubLinearOperationsV1(pack, "github-linear") });
    const fixture = await fiveDefinitionDeployment(root, pack, release.authorizationHandle);
    const operatorConfig = parseGitHubReleaseRunnerOperatorConfig(release.runnerConfigBody as never), runner = await createGitHubReleaseRunnerFromOperatorConfig(operatorConfig, () => release.authorizationNow);
    let linearStatus = reviewed.linear.preStatus;
    const linearProvider = {
      comment(_input: unknown, sink: any) { linearWrites += 1; sink.success(JSON.stringify({ outcome: "applied", data: { workspace: reviewed.linear.workspace, team: reviewed.linear.team, project: reviewed.linear.project, issue: reviewed.linear.issue, commentMarker: reviewed.linear.commentMarker, evidenceUrl: reviewed.linear.evidenceUrl, evidenceContentDigest: reviewed.linear.evidenceContentDigest, commentId: "comment_1" } })); },
      readComment(_input: unknown, sink: any) { linearReads += 1; sink.success(JSON.stringify({ workspace: reviewed.linear.workspace, team: reviewed.linear.team, project: reviewed.linear.project, issue: reviewed.linear.issue, commentMarker: reviewed.linear.commentMarker, evidenceUrl: reviewed.linear.evidenceUrl, evidenceContentDigest: reviewed.linear.evidenceContentDigest, commentId: "comment_1" })); },
      transitionStatus(_input: unknown, sink: any) { linearWrites += 1; linearStatus = reviewed.linear.targetStatus; sink.success(JSON.stringify({ outcome: "applied", data: { workspace: reviewed.linear.workspace, team: reviewed.linear.team, project: reviewed.linear.project, issue: reviewed.linear.issue, preStatus: reviewed.linear.preStatus, targetStatus: reviewed.linear.targetStatus, status: linearStatus } })); },
      readStatus(_input: unknown, sink: any) { linearReads += 1; sink.success(JSON.stringify({ workspace: reviewed.linear.workspace, team: reviewed.linear.team, project: reviewed.linear.project, issue: reviewed.linear.issue, preStatus: reviewed.linear.preStatus, targetStatus: reviewed.linear.targetStatus, status: linearStatus })); },
    } as never;
    const journalKeys = generateKeyPairSync("ed25519");
    const makeRuntime = async () => { const baseJournal = await createSignedJournal({ rootDir: path.join(root, "mission-journal"), journalId: "genuine-five", signerId: "mission-journal", privateKey: journalKeys.privateKey, publicKey: journalKeys.publicKey }); return createGitHubLinearMissionRuntimeV1({
      config: fixture.config, profile, githubReleaseRunner: runner, linearProvider,
      resolveHostBindings: async bindings => ({ credential: "linear-test-secret", account: reviewed.linear.workspace, destination: reviewed.linear.issue, limit: pack.linearPolicyDigest }),
      journal: baseJournal,
      outcomeReceiptPublication: await createFileOutcomeKernelStorage({ rootDir: path.join(root, "outcomes") }),
      localOptions: fixture.localOptions, observationAuthKey: "a".repeat(64), now: () => Date.now(),
    }); };
    const context = fixture.context, first = await makeRuntime();
    const jobs = await first.agentTools.agentStatus({}, context) as any;
    const linearRef = jobs.outcomeRefs[1];
    const request = { v: "reelier.outcome-request/v1", jobRef: linearRef, requestId: "linear-only-recovery", sourceRefs: { authorization: release.authorizationHandle }, choices: {} };
    const initial = await first.agentTools.outcomeRequest({ outcomeRef: linearRef, requestId: request.requestId, sourceRefs: request.sourceRefs, choices: request.choices }, context) as any;
    assert.equal(initial.lifecycleState, "reconciled", JSON.stringify({ initial, linearWrites, linearReads, linearStatus, evidence: await first.inspectEvidence() }));
    assert.deepEqual({ linearWrites, linearReads }, { linearWrites: 2, linearReads: 2 });
    const restarted = await makeRuntime(), recovered = await restarted.agentTools.outcomeStatus({ requestId: request.requestId }, context) as any;
    assert.equal(recovered.lifecycleState, "reconciled");
    assert.deepEqual({ linearWrites, linearReads }, { linearWrites: 2, linearReads: 2 }, "restart adopts durable Outcomes and never resends");
    const evidence = await restarted.inspectEvidence();
    assert.deepEqual(evidence.requests[0]?.joins.map(item => item.alias), governedOutcomeCompositionAliasesV1.slice(3));
    const runnerPrivateKey = createPrivateKey(await readFile(operatorConfig.journalKeyFile)), runnerJournal = await createSignedJournal({ rootDir: path.join(operatorConfig.rootDir, "journal"), journalId: "github-release", signerId: operatorConfig.journalSignerId, privateKey: runnerPrivateKey, publicKey: createPublicKey(runnerPrivateKey) });
    assert.deepEqual(await runnerJournal.listRequestIds(), [], "Linear-only reaches no GitHub runner call");
    const recoveredLedger = await new FsAuthorityLedger(fixture.config.ledgerDir).recover();
    assert.equal(recoveredLedger.ok, true);
    const reservedAliases = recoveredLedger.ok ? recoveredLedger.reservations.map(item => item.intent.definitionAlias) : [];
    assert.equal(governedOutcomeCompositionAliasesV1.slice(0, 3).some(alias => reservedAliases.includes(alias)), false, "Linear-only creates no GitHub reservation");
    assert.deepEqual(reservedAliases.sort(), [...governedOutcomeCompositionAliasesV1.slice(3)].sort(), "both Linear reservations are durable");
  } finally { restorePlatform(); await Promise.all([rm(root, { recursive: true, force: true }), rm(release.root, { recursive: true, force: true })]); }
});

test("signed five-definition composite stops at ambiguous merge then recreates and reconciles without resend", async () => {
  const restorePlatform = __testSetAuthorityCellHostPlatform("linux"), release = await releaseServeFixture("Governed executable composition", { executableCandidate: true }), root = await mkdtemp(path.join(os.tmpdir(), "reelier-genuine-composite-runtime-"));
  const runnerConfig = parseGitHubReleaseRunnerOperatorConfig(release.runnerConfigBody as never), plan = (release.authorizationBundleBody.operationPlan as any).value;
  const reviewed = { ...reviewedAuthority(), github: { ...reviewedAuthority().github, baseBranch: plan.destinationBranch, baseSha: plan.baseCommit, headBranch: plan.candidateBranch, headSha: plan.expectedCommitSha, workflowPath: plan.workflowCommitments[0].path, workflowDigest: plan.workflowCommitments[0].digest, requiredChecks: plan.requiredChecks, postMergeTreeSha: plan.expectedTreeSha } };
  const refs = new Map<string, string>([[`heads/${plan.destinationBranch}`, plan.baseCommit]]), mergeSha = git("9");
  let blobWrites = 0, treeWrites = 0, commitWrites = 0, refWrites = 0, prWrites = 0, readyWrites = 0, mergeWrites = 0, pullRequest: any = null, loseMergeReadback = false;
  const provider: any = {
    async createBlob() { return { sha: plan.files[blobWrites++]!.blobSha }; },
    async createTree() { treeWrites += 1; return { sha: plan.expectedTreeSha }; },
    async createCommit() { commitWrites += 1; return { sha: plan.expectedCommitSha }; },
    async getRef({ ref }: any) { return refs.has(ref) ? { sha: refs.get(ref)! } : null; },
    async createRef({ ref, sha: value }: any) { refWrites += 1; refs.set(ref, value); return { sha: value }; },
    async getCommit({ sha: value }: any) { return { sha: value, parentSha: plan.baseCommit, treeSha: value === plan.baseCommit ? plan.baseTreeSha : plan.expectedTreeSha }; },
    async findPullRequests() { return pullRequest ? [pullRequest] : []; },
    async createPullRequest(metadata: any) { prWrites += 1; pullRequest = { base: metadata.base, body: metadata.body, draft: metadata.draft, head: metadata.head, headSha: plan.expectedCommitSha, mergeCommitSha: null, merged: false, number: 1, title: metadata.title }; return pullRequest; },
    async markPullRequestReady() { readyWrites += 1; pullRequest = { ...pullRequest, draft: false }; return pullRequest; },
    async getPullRequest() { if (loseMergeReadback) { loseMergeReadback = false; throw { v: "reelier.github-release-provider-fault/v1", kind: "transport-uncertain", reason: "merge readback unavailable" }; } return pullRequest; },
    async getChecks() { return plan.requiredChecks.map((name: string) => ({ name, status: "success", workflowDigest: plan.workflowCommitments[0].digest, workflowPath: plan.workflowCommitments[0].path })); },
    async mergePullRequest() { mergeWrites += 1; pullRequest = { ...pullRequest, merged: true, mergeCommitSha: mergeSha }; refs.set(`heads/${plan.destinationBranch}`, mergeSha); loseMergeReadback = true; throw new Error("socket lost after merge"); },
    async npmVersionExists() { return false; }, async readPackageManifest() { return { name: plan.packageName, version: plan.packageVersion }; },
  };
  try {
    const pack = createGitHubLinearOutcomePackV1(reviewed), profile = createGovernedOutcomeCompositionProfileV1({ aliases: governedOutcomeCompositionAliasesV1, pack, operations: orderedGitHubLinearOperationsV1(pack, "github-linear") }), fixture = await fiveDefinitionDeployment(root, pack, release.authorizationHandle, reviewed);
    let linearWrites = 0, linearReads = 0, linearStatus = reviewed.linear.preStatus;
    const commentReadback = { workspace: reviewed.linear.workspace, team: reviewed.linear.team, project: reviewed.linear.project, issue: reviewed.linear.issue, commentMarker: reviewed.linear.commentMarker, evidenceUrl: reviewed.linear.evidenceUrl, evidenceContentDigest: reviewed.linear.evidenceContentDigest, commentId: "comment_composite" };
    const linearProvider: any = { comment(_input: unknown, sink: any) { linearWrites += 1; sink.success(JSON.stringify({ outcome: "applied", data: commentReadback })); }, readComment(_input: unknown, sink: any) { linearReads += 1; sink.success(JSON.stringify(commentReadback)); }, transitionStatus(_input: unknown, sink: any) { linearWrites += 1; linearStatus = reviewed.linear.targetStatus; sink.success(JSON.stringify({ outcome: "applied", data: { workspace: reviewed.linear.workspace, team: reviewed.linear.team, project: reviewed.linear.project, issue: reviewed.linear.issue, preStatus: reviewed.linear.preStatus, targetStatus: reviewed.linear.targetStatus, status: linearStatus } })); }, readStatus(_input: unknown, sink: any) { linearReads += 1; sink.success(JSON.stringify({ workspace: reviewed.linear.workspace, team: reviewed.linear.team, project: reviewed.linear.project, issue: reviewed.linear.issue, preStatus: reviewed.linear.preStatus, targetStatus: reviewed.linear.targetStatus, status: linearStatus })); } };
    const journalKeys = generateKeyPairSync("ed25519"), journalPrivateKey = createPrivateKey(await readFile(runnerConfig.journalKeyFile)), evidencePrivateKey = createPrivateKey(await readFile(runnerConfig.evidenceKeyFile));
    const makeRunner = () => createGitHubReleaseRunner({ rootDir: runnerConfig.rootDir, journalSigner: { signerId: runnerConfig.journalSignerId, privateKey: journalPrivateKey, publicKey: createPublicKey(journalPrivateKey) }, evidenceSigner: { signerId: runnerConfig.evidenceSignerId, privateKey: evidencePrivateKey }, authorizationResolver: createReleaseAuthorizationResolver(runnerConfig, () => release.authorizationNow), provider, now: () => release.authorizationNow });
    const makeRuntime = async () => createGitHubLinearMissionRuntimeV1({ config: fixture.config, profile, githubReleaseRunner: await makeRunner(), linearProvider, resolveHostBindings: async references => references.accountRef === reviewed.github.accountRef ? { credential: "github-test-secret", account: reviewed.github.repository, destination: reviewed.github.headBranch, limit: pack.githubPolicyDigest } : { credential: "linear-test-secret", account: reviewed.linear.workspace, destination: reviewed.linear.issue, limit: pack.linearPolicyDigest }, journal: await createSignedJournal({ rootDir: path.join(root, "mission-journal"), journalId: "genuine-composite", signerId: "mission-journal", privateKey: journalKeys.privateKey, publicKey: journalKeys.publicKey }), outcomeReceiptPublication: await createFileOutcomeKernelStorage({ rootDir: path.join(root, "outcomes") }), localOptions: fixture.localOptions, observationAuthKey: "b".repeat(64), now: () => Date.now() });
    const first = await makeRuntime(), jobs = await first.agentTools.agentStatus({}, fixture.context) as any, compositeRef = jobs.outcomeRefs[0], requestId = "composite-merge-recovery";
    const pending = await first.agentTools.outcomeRequest({ outcomeRef: compositeRef, requestId, sourceRefs: { authorization: release.authorizationHandle }, choices: {} }, fixture.context) as any;
    assert.equal(pending.lifecycleState, "pending");
    assert.deepEqual((await first.inspectEvidence()).requests[0]?.joins.map(item => item.alias), governedOutcomeCompositionAliasesV1.slice(0, 3), "pending merge stops before every Linear reservation");
    const runnerJournal = await createSignedJournal({ rootDir: path.join(runnerConfig.rootDir, "journal"), journalId: "github-release", signerId: runnerConfig.journalSignerId, privateKey: journalPrivateKey, publicKey: createPublicKey(journalPrivateKey) }), runnerIds = await runnerJournal.listRequestIds(), runnerPhases = await Promise.all(runnerIds.map(async id => [id, (await runnerJournal.load(id)).map(event => event.phase)]));
    assert.deepEqual({ blobWrites, treeWrites, commitWrites, refWrites, prWrites, readyWrites, mergeWrites, linearWrites, linearReads }, { blobWrites: plan.files.length, treeWrites: 1, commitWrites: 1, refWrites: 1, prWrites: 1, readyWrites: 1, mergeWrites: 1, linearWrites: 0, linearReads: 0 }, JSON.stringify({ runnerPhases, refs: [...refs] }));
    const restarted = await makeRuntime(), recovered = await restarted.agentTools.outcomeStatus({ requestId }, fixture.context) as any;
    const recoveredIds = await runnerJournal.listRequestIds(), recoveredPhases = await Promise.all(recoveredIds.map(async id => [id, (await runnerJournal.load(id)).map(event => event.phase)]));
    assert.equal(recovered.lifecycleState, "reconciled", JSON.stringify({ recovered, recoveredPhases, mergeWrites, linearWrites, linearReads }));
    assert.deepEqual({ mergeWrites, linearWrites, linearReads }, { mergeWrites: 1, linearWrites: 2, linearReads: 2 }, "merge recovery is readback-only and later Linear effects execute once");
    assert.deepEqual((await restarted.inspectEvidence()).requests[0]?.joins.map(item => item.alias), governedOutcomeCompositionAliasesV1);
    assert.deepEqual({ blobWrites, treeWrites, commitWrites, refWrites, prWrites, readyWrites }, { blobWrites: plan.files.length, treeWrites: 1, commitWrites: 1, refWrites: 1, prWrites: 1, readyWrites: 1 });
  } finally { restorePlatform(); await Promise.all([rm(root, { recursive: true, force: true }), rm(release.root, { recursive: true, force: true })]); }
});

function reviewedAuthority() {
  return { v: "reelier.github-linear-reviewed-authority/v1" as const, github: { repository: "seldonframe/reelier", baseBranch: "main", baseSha: git("a"), headBranch: "reelier/release/0.33.0", headSha: git("b"), candidateDigest: sha("c"), workflowPath: ".github/workflows/ci.yml", workflowDigest: sha("d"), requiredChecks: ["coverage", "full-tests", "mutation"], mergeMethod: "squash" as const, postMergeTreeSha: git("e"), accountRef: "github_account_ref", destinationRef: "github_repository_ref", credentialRef: "github_credential_ref", limitRef: "github_release_policy_ref" }, linear: { workspace: "workspace_01", team: "team_01", project: "project_01", issue: "REEL-TEST-1", preStatus: "In Progress", targetStatus: "Done", commentMarker: "reelier:evidence:mission_01", evidenceUrl: "https://www.reelier.com/r/receipt_01", evidenceContentDigest: sha("f"), accountRef: "linear_account_ref", destinationRef: "linear_issue_ref", credentialRef: "linear_credential_ref", limitRef: "linear_transition_policy_ref" } };
}

async function fiveDefinitionDeployment(root: string, pack: ReturnType<typeof createGitHubLinearOutcomePackV1>, authorizationHandle: string, reviewed = reviewedAuthority()) {
  const candidateRoot = path.join(root, "candidate"), authorityRoot = path.join(root, "authority"), sourceRoot = path.join(candidateRoot, "sources");
  await Promise.all([mkdir(path.join(candidateRoot, "keys"), { recursive: true }), mkdir(sourceRoot, { recursive: true })]);
  const operator = generateKeyPairSync("ed25519"), sponsor = generateKeyPairSync("ed25519"), contractSigner = generateKeyPairSync("ed25519");
  await Promise.all([writeFile(path.join(candidateRoot, "keys", "operator.pem"), operator.publicKey.export({ type: "spki", format: "pem" })), writeFile(path.join(candidateRoot, "keys", "contract.pem"), contractSigner.publicKey.export({ type: "spki", format: "pem" })), writeFile(path.join(sourceRoot, `${authorizationHandle}.json`), `${JSON.stringify({ authorizationHandle })}\n`)]);
  const githubWrites = githubReleaseEffects.slice(0, 3).map(effect => `github.release.${effect}`), linearWrites = ["linear.outcomes.evidence-comment", "linear.outcomes.status-transition"];
  const descriptors = [descriptor("github", "github-owner", [githubReleaseReadEndpointId, ...githubWrites]), descriptor("linear", "workspace_01", [linearOutcomeReadEndpointId, ...linearWrites])];
  const adoptions = descriptors.map(item => ({ v: "reelier.connection-adoption/v1" as const, adoptionId: `adopt_${item.connectionId}`, descriptorDigest: connectionDescriptorDigest(item), selectedAccountIdentity: item.account.identity, mode: "existing" as const, sidecarRouteId: item.callableRoute.routeId, rawWriteReachability: "reachable" as const, activationState: "active" as const, secureConnectionCommitment: null }));
  const limits = { maxEffectsPerWindow: 5, windowSeconds: 3600, maxEffectsPerSourceTrigger: 5, maxBodyBytes: 65_536 };
  const operations = orderedGitHubLinearOperationsV1(pack, "github-linear"), definitions = [...githubReleaseDefinitions.slice(0, 3), ...linearOutcomeDefinitions];
  const baseGrant = { v: "reelier.delegation-grant/v1" as const, tenant: "tenant_five", grantId: "grant_five", parentDigest: null, sponsor: "operator", grantor: "operator", grantee: "agent_five", issuedAt: "2026-01-01T00:00:00.000Z", expiresAt: "2027-01-01T00:00:00.000Z", constraints: { definitionAliases: [...governedOutcomeCompositionAliasesV1], audiences: ["agent_five"], connectorAccounts: [{ connectorId: "github", accountId: "account_github" }, { connectorId: "linear", accountId: "account_linear" }], projectionPointers: ["/authorizationHandle"], riskClasses: [githubReleaseRiskClass, linearOutcomeRiskClass], limits } };
  const states = definitions.map((definition, index) => { const operation = operations[index]!, effect = index < 3 ? githubReleaseEffects[index]! : index === 3 ? "evidence-comment" : "status-transition", connectorId = index < 3 ? "github" : "linear", accountId = index < 3 ? "account_github" : "account_linear"; const grant = { ...baseGrant, grantId: `contract_grant_${index}`, grantee: "contract-signer", constraints: { ...baseGrant.constraints, definitionAliases: [definition.alias] } }, grantDigest = authorityDigest(grant); const governed = { toolEffectContractDigest: authorityDigest(operation.contract), transportBindingDigest: authorityDigest(operation.binding), operationKind: operation.contract.operation, reviewedPolicyDigest: operation.contract.policyDigest, ...(index === 4 ? { predecessorToolEffectContractDigest: authorityDigest(operations[3]!.contract) } : {}) }; const policy: any = { allocationDigest: sha(String(index + 1)), allocationId: `five-${String(effect).replace(/[^a-z-]/g, "-")}-${index}`, authorizationHandleDigest: authorityDigest({ handle: authorizationHandle }), effect, maxEffects: 1, governed, ...(index === 4 ? { predecessorAlias: governedOutcomeCompositionAliasesV1[3], predecessorContractDigest: authorityDigest(operations[3]!.contract), predecessorReceiptRequired: true } : {}) }; const contract = { v: "reelier.outcome-contract/v1", tenant: "tenant_five", alias: definition.alias, contractId: `contract_${index}`, validFrom: "2026-01-01T00:00:00.000Z", validUntil: "2027-01-01T00:00:00.000Z", packDigest: definition.packDigest, definitionDigest: definition.definitionDigest, sponsor: "operator", audiences: ["agent_five"], delegationGrantDigest: grantDigest, connectorId, accountId, sourceAuthority: { resolverId: definition.resolverId, projectionSchemaId: index < 3 ? githubReleaseProjectionSchemaId : linearOutcomeProjectionSchemaId, allowedReadEndpointIds: [index < 3 ? githubReleaseReadEndpointId : linearOutcomeReadEndpointId], authorizedProjectionPointers: ["/authorizationHandle"], maxFreshnessSeconds: 60 }, riskClasses: [index < 3 ? githubReleaseRiskClass : linearOutcomeRiskClass], limits, policyCommitment: { schemaId: index < 3 ? githubReleasePolicySchemaId : linearOutcomePolicySchemaId, jcsBase64: authorityCanonicalBytes(policy).toString("base64"), digest: authorityDigest(policy) } }, contractDigest = authorityDigest(contract); return { tenant: "tenant_five", definitionAlias: definition.alias, stateVersion: 1, candidates: [{ contractEnvelope: { canonicalBase64: authorityCanonicalBytes(contract).toString("base64"), advertisedDigest: contractDigest, signerId: "contract-signer", signature: signAuthorityDigest(contractSigner.privateKey, "outcome-contract", contractDigest) }, delegationEnvelopes: [{ index: 0, canonicalBase64: authorityCanonicalBytes(grant).toString("base64"), advertisedDigest: grantDigest, signerId: "operator", signature: signAuthorityDigest(operator.privateKey, "delegation-grant", grantDigest) }], stateEvents: [{ index: 0, kind: "activated", contractDigest, at: "2026-01-01T00:00:00.000Z" }] }] }; });
  const jobCard = signJobCard({ v: "reelier.signed-job-card/v1", jobId: "genuine_five", title: "Genuine five outcomes", taskShapeDigest: sha("a"), semanticClasses: ["deployment_release_v1", "record_state_set_v1"], definitionAliases: [...governedOutcomeCompositionAliasesV1], connectorIds: ["github", "linear"], accountIdentities: descriptors.map(item => item.account.identity).sort(), connectionDescriptorDigests: descriptors.map(connectionDescriptorDigest).sort(), adoptionCommitmentDigests: adoptions.map(connectionAdoptionCommitmentDigest).sort(), sourceRefs: ["authorization"], audiences: ["agent_five"], limitsDigest: authorityDigest(limits), instructionsDigest: sha("b"), packDigests: [githubReleaseManifest.packDigest, linearOutcomeManifest.packDigest].sort(), exceptionPolicy: ["ambiguous-reconcile"], coverage: "declared-surface" }, "job_sponsor", sponsor.privateKey);
  const pin = jobCardTrustPinFixture(sponsor.publicKey, "job_sponsor", "cell_receipt_key"), candidate = { v: "reelier.authority-deployment-candidate/v1", jobCard, connectionDescriptors: descriptors, connectionAdoptions: adoptions.map(item => ({ ...item, signedDeploymentBinding: signedJobCardDigest(jobCard) })), state: states[0], connectors: [{ tenant: "tenant_five", connectorId: "github", accountId: "account_github", providerAccountIdentity: "github-owner", allowedReadEndpointIds: [githubReleaseReadEndpointId], allowedWriteEndpointIds: githubWrites, riskClasses: [githubReleaseRiskClass], operatorConfigurationDigest: sha("c") }, { tenant: "tenant_five", connectorId: "linear", accountId: "account_linear", providerAccountIdentity: "workspace_01", allowedReadEndpointIds: [linearOutcomeReadEndpointId], allowedWriteEndpointIds: linearWrites, riskClasses: [linearOutcomeRiskClass], operatorConfigurationDigest: sha("d") }], trust: [{ signerId: "operator", principalId: "operator", publicKeyFile: "keys/operator.pem", purposes: ["delegation-grant"] }, { signerId: "contract-signer", principalId: "contract-signer", publicKeyFile: "keys/contract.pem", purposes: ["outcome-contract"] }], sourceDirectory: "sources" };
  const candidateFile = path.join(candidateRoot, "candidate.json"); await writeFile(candidateFile, `${JSON.stringify(candidate)}\n`); const built = await buildAuthorityDeployment(candidateFile, path.join(authorityRoot, "deployment"), pin); const manifest = JSON.parse(await readFile(built.deploymentFile, "utf8")); manifest.states.push(...states.slice(1)); await writeFile(built.deploymentFile, `${JSON.stringify(manifest)}\n`); const pinPath = path.join(authorityRoot, "trust", "job-card.json"); await mkdir(path.dirname(pinPath), { recursive: true }); await copyFile(built.jobCardTrustEvidenceFile, pinPath);
  const config = { version: 1 as const, tenant: "tenant_five", requester: "agent_five", authorityCellId: "cell_five", definitions: [...governedOutcomeCompositionAliasesV1], ledgerDir: path.join(authorityRoot, "ledger"), decisionDir: path.join(authorityRoot, "decisions"), receiptDir: path.join(authorityRoot, "receipts"), gateKeyFile: path.join(authorityRoot, "keys", "gate.pem"), endpoints: [], deploymentPath: built.deploymentFile, jobCardTrustPinPath: pinPath };
  const context = { tenant: "tenant_five", requester: "agent_five", executionContext: { v: "reelier.authority-execution-context/v1" as const, taskId: "task_five", principalId: "agent_five", grantId: baseGrant.grantId, grantDigest: authorityDigest(baseGrant), allocationId: "allocation_five", runtimeSessionId: "session_five", jobId: jobCard.jobId, authorityCellId: "cell_five" } };
  const localOptions: any = { jobCardTrustPin: pin, routeAuthority(input: any) {
    const operation = input.definitionAlias === governedOutcomeCompositionAliasesV1[0] ? pack.operations.candidatePublish
      : input.definitionAlias === governedOutcomeCompositionAliasesV1[1] ? pack.operations.pullRequestEnsure
        : input.definitionAlias === governedOutcomeCompositionAliasesV1[2] ? pack.operations.exactHeadMerge
          : input.definitionAlias === governedOutcomeCompositionAliasesV1[3] ? pack.operations.linearEvidenceComment
            : pack.operations.linearStatusTransition;
    const model = input.connectorId === "github" ? { authorizationHandle, requestId: input.requestId }
      : input.definitionAlias === governedOutcomeCompositionAliasesV1[3] ? { evidenceUrl: reviewed.linear.evidenceUrl }
        : { requestId: "host-bound-status" };
    const host = input.connectorId === "github" ? { account: reviewed.github.repository, destination: reviewed.github.headBranch, limit: pack.githubPolicyDigest }
      : { account: reviewed.linear.workspace, destination: reviewed.linear.issue, limit: pack.linearPolicyDigest };
    const projection = { v: "reelier.prepared-effect-projection/v1", transport: operation.binding.kind, operationDigest: authorityDigest(operation.binding), requestDigest: authorityDigest({ v: "reelier.governed-effect-transport-request/v1", contractDigest: authorityDigest(operation.contract), bindingDigest: authorityDigest(operation.binding), model, ...host }) };
    return { v: "reelier.route-authority-snapshot/v1", connectorRegistrationDigest: sha("1"), operatorConfigurationDigest: sha("2"), routeDigest: input.connectorId === "github" ? authorityDigest({ v: "reelier.github-release-internal-route/v1", alias: input.definitionAlias, endpointId: input.endpointId }) : sha("3"), providerId: input.connectorId === "github" ? "github-release-runner" : "linear", connectorId: input.connectorId, accountId: input.connectorId === "github" ? "account_github" : "account_linear", providerAccountIdentity: input.connectorId === "github" ? "github-owner" : "workspace_01", endpointId: input.endpointId, credentialSlotId: input.connectorId === "github" ? "internal" : "slot", slotInstanceId: input.connectorId === "github" ? "internal" : "instance", slotVersion: input.connectorId === "github" ? "internal" : "version", authenticatedProviderIdentityDigest: sha("4"), sourceReadRouteDigest: sha("5"), projectionSchemaDigest: sha("6"), expectedMaterializedRequestDigest: authorityDigest(projection), authorityGeneration: input.authorityGeneration, authorityExpiresAt: input.authorityExpiresAt };
  }, authenticatedProviderIdentity: async () => ({}) };
  return { config, context, localOptions };
}

function descriptor(connectionId: string, identity: string, endpointIds: string[]) { return { v: "reelier.connection-descriptor/v1" as const, connectionId, kind: "adopted-mcp-stdio" as const, provider: { id: connectionId, toolServerName: `${connectionId}-mcp` }, callableRoute: { kind: "mcp-stdio" as const, routeId: `route.${connectionId}`, endpointIds }, account: { status: "verified" as const, identity }, toolSchemas: digestNormalizedMcpToolSchemas(endpointIds.map(name => ({ name, inputSchema: {} }))), secretOwner: "host" as const, coverage: { v: "reelier.host-coverage/v1" as const, host: "codex", observation: "observed" as const, outcomeInvocation: "supported" as const, exclusiveEnforcement: "unknown" as const, limitations: ["raw-write-reachability-unmeasured"] } }; }
