import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { authorityCanonicalBytes, authorityDigest, signAuthorityDigest, signJobCard, signedJobCardDigest } from "../../src/authority/index.js";
import { connectionAdoptionCommitmentDigest, connectionDescriptorDigest, digestNormalizedMcpToolSchemas } from "../../src/connections.js";
import { buildAuthorityDeployment } from "../../src/authority/host/deploy.js";
import { createDelegationAuthority } from "../../src/authority/host/delegation-service.js";
import type { DispatchAdapter } from "../../src/authority/host/dispatch.js";
import { createLocalAuthorityRuntime } from "../../src/authority/host/local.js";
import { __testSetAuthorityCellHostPlatform } from "../../src/authority/host/platform.js";
import { gmailPackDigest, gmailPolicySchemaId, gmailProjectionSchemaId, gmailReadEndpointId, gmailReplyDefinitionDigest, gmailReplyWriteEndpointId, gmailResolverId } from "../../src/packs/gmail/index.js";
import { slackChannelTopicPackDigest } from "../../src/packs/slack-topic/index.js";
import { jobCardTrustPinFixture } from "./job-card-trust-pin-fixture.js";
import type { AuthorityExecutionContextV1, DelegationGrant } from "../../src/authority/types.js";

const GMAIL = "gmail_reply_send_v1";
const SLACK = "slack_channel_topic_set_v1";
const sha = (seed: string) => `sha256:${seed.repeat(64).slice(0, 64)}`;

let restorePlatform: (() => void) | undefined;
test.before(() => { restorePlatform = __testSetAuthorityCellHostPlatform("linux"); });
test.after(() => { restorePlatform?.(); });

async function multiDefinitionFixture(title = "Production release") {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-local-multi-jobs-"));
  const candidateRoot = path.join(root, "candidate");
  await mkdir(path.join(candidateRoot, "keys"), { recursive: true });
  await mkdir(path.join(candidateRoot, "sources"), { recursive: true });
  const operator = generateKeyPairSync("ed25519");
  const sponsor = generateKeyPairSync("ed25519");
  const contractSigner = generateKeyPairSync("ed25519");
  await writeFile(path.join(candidateRoot, "keys", "operator.pem"), operator.publicKey.export({ type: "spki", format: "pem" }));
  await writeFile(path.join(candidateRoot, "keys", "contract.pem"), contractSigner.publicKey.export({ type: "spki", format: "pem" }));
  await writeFile(path.join(candidateRoot, "sources", "thread_1.json"), `${JSON.stringify({ threadId: "thread_1", messageId: "message_1", recipient: "customer@example.test", subject: "Question", labelIds: ["INBOX"] })}\n`);
  const tools = [{ name: gmailReadEndpointId, inputSchema: {} }, { name: gmailReplyWriteEndpointId, inputSchema: {} }];
  const descriptor = {
    v: "reelier.connection-descriptor/v1" as const,
    connectionId: "gmail",
    kind: "adopted-mcp-stdio" as const,
    provider: { id: "gmail", toolServerName: "gmail-mcp" },
    callableRoute: { kind: "mcp-stdio" as const, routeId: "route.gmail", endpointIds: [gmailReadEndpointId, gmailReplyWriteEndpointId] },
    account: { status: "verified" as const, identity: "gmail-owner-example-test" },
    toolSchemas: digestNormalizedMcpToolSchemas(tools),
    secretOwner: "host" as const,
    coverage: { v: "reelier.host-coverage/v1" as const, host: "codex", observation: "observed" as const, outcomeInvocation: "supported" as const, exclusiveEnforcement: "unknown" as const, limitations: ["raw-write-reachability-unmeasured"] },
  };
  const adoptionBody = { v: "reelier.connection-adoption/v1" as const, adoptionId: "adopt_gmail", descriptorDigest: connectionDescriptorDigest(descriptor), selectedAccountIdentity: descriptor.account.identity, mode: "existing" as const, sidecarRouteId: descriptor.callableRoute.routeId, rawWriteReachability: "reachable" as const, activationState: "active" as const, secureConnectionCommitment: null };
  const limits = { maxEffectsPerWindow: 2, windowSeconds: 3600, maxEffectsPerSourceTrigger: 1, maxBodyBytes: 4096 };
  const grant = { v: "reelier.delegation-grant/v1" as const, tenant: "tenant_1", grantId: "grant_1", parentDigest: null, sponsor: "operator", grantor: "operator", grantee: "agent_1", issuedAt: "2026-01-01T00:00:00.000Z", expiresAt: "2027-01-01T00:00:00.000Z", constraints: { definitionAliases: [GMAIL, SLACK], audiences: ["agent_1"], connectorAccounts: [{ connectorId: "gmail", accountId: "account_1" }], projectionPointers: ["/threadId", "/messageId", "/recipient", "/subject", "/labelIds"], riskClasses: ["gmail_send"], limits } };
  const grantDigest = authorityDigest(grant);
  const contractGrant = { ...grant, grantId: "contract_grant", grantee: "contract-signer", constraints: { ...grant.constraints, definitionAliases: [GMAIL] } };
  const contractGrantDigest = authorityDigest(contractGrant);
  const policy = { text: "Thanks for reaching out." };
  const contract = { v: "reelier.outcome-contract/v1", tenant: "tenant_1", alias: GMAIL, contractId: "contract_1", validFrom: "2026-01-01T00:00:00.000Z", validUntil: "2027-01-01T00:00:00.000Z", packDigest: gmailPackDigest, definitionDigest: gmailReplyDefinitionDigest, sponsor: "operator", audiences: ["agent_1"], delegationGrantDigest: contractGrantDigest, connectorId: "gmail", accountId: "account_1", sourceAuthority: { resolverId: gmailResolverId, projectionSchemaId: gmailProjectionSchemaId, allowedReadEndpointIds: [gmailReadEndpointId], authorizedProjectionPointers: ["/threadId", "/messageId", "/recipient", "/subject", "/labelIds"], maxFreshnessSeconds: 60 }, riskClasses: ["gmail_send"], limits, policyCommitment: { schemaId: gmailPolicySchemaId, jcsBase64: authorityCanonicalBytes(policy).toString("base64"), digest: authorityDigest(policy) } };
  const contractDigest = authorityDigest(contract);
  const jobCard = signJobCard({
    v: "reelier.signed-job-card/v1", jobId: "production_release", title, taskShapeDigest: sha("a"),
    semanticClasses: ["communication_commit_v1", "record_state_set_v1"], definitionAliases: [GMAIL, SLACK], connectorIds: ["gmail"],
    accountIdentities: [descriptor.account.identity], connectionDescriptorDigests: [connectionDescriptorDigest(descriptor)], adoptionCommitmentDigests: [connectionAdoptionCommitmentDigest(adoptionBody)],
    sourceRefs: ["thread"], audiences: ["agent_1"], limitsDigest: authorityDigest(limits), instructionsDigest: sha("c"), packDigests: [gmailPackDigest, slackChannelTopicPackDigest],
    exceptionPolicy: ["ambiguous-reconcile"], coverage: "declared-surface",
  }, "job_sponsor", sponsor.privateKey);
  const trustPin = jobCardTrustPinFixture(sponsor.publicKey, "job_sponsor", "cell_receipt_key");
  const candidate = {
    v: "reelier.authority-deployment-candidate/v1", jobCard, connectionDescriptors: [descriptor], connectionAdoptions: [{ ...adoptionBody, signedDeploymentBinding: signedJobCardDigest(jobCard) }],
    state: { tenant: "tenant_1", definitionAlias: GMAIL, stateVersion: 1, candidates: [{ contractEnvelope: { canonicalBase64: authorityCanonicalBytes(contract).toString("base64"), advertisedDigest: contractDigest, signerId: "contract-signer", signature: signAuthorityDigest(contractSigner.privateKey, "outcome-contract", contractDigest) }, delegationEnvelopes: [{ index: 0, canonicalBase64: authorityCanonicalBytes(contractGrant).toString("base64"), advertisedDigest: contractGrantDigest, signerId: "operator", signature: signAuthorityDigest(operator.privateKey, "delegation-grant", contractGrantDigest) }], stateEvents: [{ index: 0, kind: "activated", contractDigest, at: "2026-01-01T00:00:00.000Z" }] }] },
    connectors: [{ tenant: "tenant_1", connectorId: "gmail", accountId: "account_1", providerAccountIdentity: descriptor.account.identity, allowedReadEndpointIds: [gmailReadEndpointId], allowedWriteEndpointIds: [gmailReplyWriteEndpointId], riskClasses: ["gmail_send"], operatorConfigurationDigest: sha("d") }],
    trust: [{ signerId: "operator", principalId: "operator", publicKeyFile: "keys/operator.pem", purposes: ["delegation-grant"] }, { signerId: "contract-signer", principalId: "contract-signer", publicKeyFile: "keys/contract.pem", purposes: ["outcome-contract"] }], sourceDirectory: "sources",
  };
  const candidateFile = path.join(candidateRoot, "candidate.json");
  await writeFile(candidateFile, `${JSON.stringify(candidate)}\n`);
  const authorityRoot = path.join(root, "authority");
  const built = await buildAuthorityDeployment(candidateFile, path.join(authorityRoot, "deployment"), trustPin);
  const manifest = JSON.parse(await readFile(built.deploymentFile, "utf8"));
  manifest.states.push({ tenant: "tenant_1", definitionAlias: SLACK, stateVersion: 1, candidates: [] });
  await writeFile(built.deploymentFile, `${JSON.stringify(manifest)}\n`);
  const hostPin = path.join(authorityRoot, "trust", "job-card.json");
  await mkdir(path.dirname(hostPin), { recursive: true });
  await copyFile(built.jobCardTrustEvidenceFile, hostPin);
  const config = { version: 1 as const, tenant: "tenant_1", requester: "agent_1", definitions: [GMAIL, SLACK], ledgerDir: path.join(authorityRoot, "ledger"), decisionDir: path.join(authorityRoot, "decisions"), receiptDir: path.join(authorityRoot, "receipts"), gateKeyFile: path.join(authorityRoot, "keys", "gate.pem"), endpoints: [], deploymentPath: built.deploymentFile, jobCardTrustPinPath: hostPin };
  const delegationRoot = path.join(authorityRoot, "delegation");
  const signGrant = async (value: DelegationGrant) => ({ grant: value, digest: authorityDigest(value), signerId: "operator", signature: signAuthorityDigest(operator.privateKey, "delegation-grant", authorityDigest(value)) });
  const delegation = createDelegationAuthority({ root: delegationRoot, now: () => new Date("2026-06-01T00:00:00.000Z"), signGrant });
  await delegation.registerRoot({ taskId: "task_1", rootGrant: { grant, digest: grantDigest, signerId: "operator", signature: signAuthorityDigest(operator.privateKey, "delegation-grant", grantDigest) }, effects: 2 });
  const context: { tenant: string; requester: string; executionContext: AuthorityExecutionContextV1 } = { tenant: "tenant_1", requester: "agent_1", executionContext: { v: "reelier.authority-execution-context/v1", taskId: "task_1", principalId: "agent_1", grantId: grant.grantId, grantDigest, allocationId: "root", runtimeSessionId: "session_1", jobId: jobCard.jobId, authorityCellId: "cell_1" } };
  return { root, config, context, trustPin, delegation, delegationRoot, signGrant };
}

test("multi-definition signed Job Card returns deterministic opaque references instead of job IDs or aliases", async () => {
  const fixture = await multiDefinitionFixture();
  try {
    const runtime = await createLocalAuthorityRuntime(fixture.config, { jobCardTrustPin: fixture.trustPin, delegation: fixture.delegation });
    const found = await runtime.jobsSearch!({ query: "" }, fixture.context) as { jobs: Array<Record<string, string>> };
    assert.equal(found.jobs.length, 2);
    assert.deepEqual(found.jobs.map(job => Object.keys(job)), [["jobRef"], ["jobRef"]]);
    const refs = found.jobs.map(job => job.jobRef);
    assert.equal(new Set(refs).size, 2);
    for (const ref of refs) {
      assert.match(ref, /^jobref_[0-9a-f]{64}$/);
      assert.equal(ref.includes("production_release"), false);
      assert.equal(ref.includes("gmail"), false);
      assert.equal(ref.includes("slack"), false);
    }
    const restarted = await createLocalAuthorityRuntime(fixture.config, { jobCardTrustPin: fixture.trustPin, delegation: fixture.delegation });
    const recovered = await restarted.jobsSearch!({ query: "ignored" }, fixture.context) as { jobs: Array<{ jobRef: string }> };
    assert.deepEqual(recovered.jobs.map(job => job.jobRef), refs);
    const loaded = await restarted.jobLoad!({ jobId: refs[0] }, fixture.context) as { verdict: string; jobRef: string };
    assert.equal(loaded.verdict, "accepted");
    assert.equal(loaded.jobRef, refs[0]);
    assert.equal((await restarted.jobLoad!({ jobId: "production_release" }, fixture.context) as { verdict: string }).verdict, "refused");
    assert.equal((await restarted.jobLoad!({ jobId: GMAIL }, fixture.context) as { verdict: string }).verdict, "refused");
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test("signed multi-definition references refuse every binding mismatch and stale authority", async () => {
  const fixture = await multiDefinitionFixture();
  const otherCard = await multiDefinitionFixture("Different signed production release");
  try {
    const runtime = await createLocalAuthorityRuntime(fixture.config, { jobCardTrustPin: fixture.trustPin, delegation: fixture.delegation });
    const found = await runtime.jobsSearch!({}, fixture.context) as { jobs: Array<{ jobRef: string }> };
    const ref = found.jobs[0]!.jobRef;
    const altered = (patch: Partial<AuthorityExecutionContextV1>, tenant = fixture.context.tenant, requester = fixture.context.requester) => ({ tenant, requester, executionContext: { ...fixture.context.executionContext, ...patch } });
    const attempts = [
      altered({ taskId: "task_other" }),
      altered({}, "tenant_other"),
      altered({ principalId: "agent_other" }, "tenant_1", "agent_other"),
      altered({ allocationId: "allocation_other" }),
      altered({ jobId: "job_other" }),
      altered({ grantDigest: sha("9") }),
    ];
    for (const context of attempts) {
      const loaded = await runtime.jobLoad!({ jobId: ref }, context) as { verdict: string };
      assert.equal(loaded.verdict, "refused");
    }
    const otherRuntime = await createLocalAuthorityRuntime(otherCard.config, { jobCardTrustPin: otherCard.trustPin, delegation: otherCard.delegation });
    const otherRef = ((await otherRuntime.jobsSearch!({}, otherCard.context) as { jobs: Array<{ jobRef: string }> }).jobs[0]!).jobRef;
    assert.notEqual(otherRef, ref);
    assert.equal((await runtime.jobLoad!({ jobId: otherRef }, fixture.context) as { verdict: string }).verdict, "refused");
    await fixture.delegation.revoke("tenant_1", "task_1");
    assert.equal((await runtime.jobLoad!({ jobId: ref }, fixture.context) as { verdict: string }).verdict, "refused");
  } finally { await Promise.all([rm(fixture.root, { recursive: true, force: true }), rm(otherCard.root, { recursive: true, force: true })]); }
});

test("opaque invoke converges exact retries and refuses request-id semantic conflicts before provider dispatch", async () => {
  const fixture = await multiDefinitionFixture();
  let dispatches = 0;
  const adapter: DispatchAdapter = {
    async dispatch() { dispatches++; return { kind: "acknowledged", resultDigest: authorityDigest({ messageId: "provider_1" }) }; },
    async reconcile() { return { kind: "acknowledged", resultDigest: authorityDigest({ messageId: "provider_1" }), reconciliationStatus: "matched", normalizedProjectionDigest: authorityDigest({ messageId: "provider_1" }) }; },
  };
  try {
    const runtime = await createLocalAuthorityRuntime(fixture.config, { jobCardTrustPin: fixture.trustPin, delegation: fixture.delegation, dispatchAdapter: adapter });
    const ref = ((await runtime.jobsSearch!({}, fixture.context) as { jobs: Array<{ jobRef: string }> }).jobs[0]!).jobRef;
    const request = { v: "reelier.outcome-request/v1", jobRef: ref, requestId: "request_1", sourceRefs: { thread: "thread_1" }, choices: {} };
    const first = await runtime.invoke!(request, fixture.context);
    assert.equal(first.verdict, "accepted", JSON.stringify(first));
    assert.equal(dispatches, 1);
    assert.equal((await runtime.invoke!(request, fixture.context)).verdict, "accepted");
    assert.equal(dispatches, 1);
    const conflict = await runtime.invoke!({ ...request, sourceRefs: { thread: "thread_other" } }, fixture.context);
    assert.equal(conflict.verdict, "refused");
    assert.equal(dispatches, 1);
    assert.equal((await runtime.invoke!({ ...request, requestId: "raw_alias", jobRef: GMAIL }, fixture.context)).verdict, "refused");
    assert.equal(dispatches, 1);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test("persisted references refuse after the bound grant expires across authority restart", async () => {
  const fixture = await multiDefinitionFixture();
  try {
    const runtime = await createLocalAuthorityRuntime(fixture.config, { jobCardTrustPin: fixture.trustPin, delegation: fixture.delegation });
    const ref = ((await runtime.jobsSearch!({}, fixture.context) as { jobs: Array<{ jobRef: string }> }).jobs[0]!).jobRef;
    const expiredDelegation = createDelegationAuthority({ root: fixture.delegationRoot, now: () => new Date("2028-01-01T00:00:00.000Z"), signGrant: fixture.signGrant });
    const restarted = await createLocalAuthorityRuntime(fixture.config, { jobCardTrustPin: fixture.trustPin, delegation: expiredDelegation });
    assert.equal((await restarted.jobLoad!({ jobId: ref }, fixture.context) as { verdict: string }).verdict, "refused");
    assert.equal((await restarted.invoke!({ v: "reelier.outcome-request/v1", jobRef: ref, requestId: "expired", sourceRefs: { thread: "thread_1" }, choices: {} }, fixture.context)).verdict, "refused");
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});
