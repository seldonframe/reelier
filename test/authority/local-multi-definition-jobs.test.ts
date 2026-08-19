import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { authorityCanonicalBytes, authorityDigest, signAuthorityDigest, signJobCard, signedJobCardDigest } from "../../src/authority/index.js";
import { connectionAdoptionCommitmentDigest, connectionDescriptorDigest, digestNormalizedMcpToolSchemas } from "../../src/connections.js";
import { buildAuthorityDeployment } from "../../src/authority/host/deploy.js";
import { createDelegationAuthority } from "../../src/authority/host/delegation-service.js";
import type { DispatchAdapter } from "../../src/authority/host/dispatch.js";
import { createGitHubReleaseAuthorityRuntime, createLocalAuthorityRuntime, createStdioBoundLocalAuthorityRuntime } from "../../src/authority/host/local.js";
import { createAuthorityHostServer } from "../../src/authority/host/server.js";
import { createPrincipalRegistry } from "../../src/authority/host/principal-registry.js";
import { __testSetAuthorityCellHostPlatform } from "../../src/authority/host/platform.js";
import { gmailPackDigest, gmailPolicySchemaId, gmailProjectionSchemaId, gmailReadEndpointId, gmailReplyDefinitionDigest, gmailReplyWriteEndpointId, gmailResolverId } from "../../src/packs/gmail/index.js";
import { slackChannelTopicDefinitionDigest, slackChannelTopicPackDigest, slackChannelTopicPolicySchemaId, slackChannelTopicProjectionSchemaId, slackChannelTopicReadEndpointId, slackChannelTopicResolverId, slackChannelTopicRiskClass, slackChannelTopicWriteEndpointId } from "../../src/packs/slack-topic/index.js";
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
  await writeFile(path.join(candidateRoot, "sources", "channel_1.json"), `${JSON.stringify({ teamId: "T1", channel: { id: "C1", name: "release-private", is_private: true, topic: { value: "Preparing release" } } })}\n`);
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
  const slackDescriptor = {
    v: "reelier.connection-descriptor/v1" as const, connectionId: "slack", kind: "adopted-mcp-stdio" as const,
    provider: { id: "slack", toolServerName: "slack-mcp" }, callableRoute: { kind: "mcp-stdio" as const, routeId: "route.slack", endpointIds: [slackChannelTopicReadEndpointId, slackChannelTopicWriteEndpointId] },
    account: { status: "verified" as const, identity: "slack-team-example" }, toolSchemas: digestNormalizedMcpToolSchemas([{ name: slackChannelTopicReadEndpointId, inputSchema: {} }, { name: slackChannelTopicWriteEndpointId, inputSchema: {} }]), secretOwner: "host" as const,
    coverage: { v: "reelier.host-coverage/v1" as const, host: "codex", observation: "observed" as const, outcomeInvocation: "supported" as const, exclusiveEnforcement: "unknown" as const, limitations: ["raw-write-reachability-unmeasured"] },
  };
  const slackAdoptionBody = { v: "reelier.connection-adoption/v1" as const, adoptionId: "adopt_slack", descriptorDigest: connectionDescriptorDigest(slackDescriptor), selectedAccountIdentity: slackDescriptor.account.identity, mode: "existing" as const, sidecarRouteId: slackDescriptor.callableRoute.routeId, rawWriteReachability: "reachable" as const, activationState: "active" as const, secureConnectionCommitment: null };
  const limits = { maxEffectsPerWindow: 2, windowSeconds: 3600, maxEffectsPerSourceTrigger: 1, maxBodyBytes: 4096 };
  const grant = { v: "reelier.delegation-grant/v1" as const, tenant: "tenant_1", grantId: "grant_1", parentDigest: null, sponsor: "operator", grantor: "operator", grantee: "agent_1", issuedAt: "2026-01-01T00:00:00.000Z", expiresAt: "2027-01-01T00:00:00.000Z", constraints: { definitionAliases: [GMAIL, SLACK], audiences: ["agent_1"], connectorAccounts: [{ connectorId: "gmail", accountId: "account_1" }, { connectorId: "slack", accountId: "account_1" }], projectionPointers: ["/threadId", "/messageId", "/recipient", "/subject", "/labelIds", "/teamId", "/channelId", "/channelName", "/isPrivate", "/topic"], riskClasses: ["gmail_send", slackChannelTopicRiskClass], limits } };
  const grantDigest = authorityDigest(grant);
  const contractGrant = { ...grant, grantId: "contract_grant", grantee: "contract-signer", constraints: { ...grant.constraints, definitionAliases: [GMAIL] } };
  const contractGrantDigest = authorityDigest(contractGrant);
  const slackContractGrant = { ...grant, grantId: "slack_contract_grant", grantee: "contract-signer", constraints: { ...grant.constraints, definitionAliases: [SLACK] } };
  const slackContractGrantDigest = authorityDigest(slackContractGrant);
  const policy = { text: "Thanks for reaching out." };
  const contract = { v: "reelier.outcome-contract/v1", tenant: "tenant_1", alias: GMAIL, contractId: "contract_1", validFrom: "2026-01-01T00:00:00.000Z", validUntil: "2027-01-01T00:00:00.000Z", packDigest: gmailPackDigest, definitionDigest: gmailReplyDefinitionDigest, sponsor: "operator", audiences: ["agent_1"], delegationGrantDigest: contractGrantDigest, connectorId: "gmail", accountId: "account_1", sourceAuthority: { resolverId: gmailResolverId, projectionSchemaId: gmailProjectionSchemaId, allowedReadEndpointIds: [gmailReadEndpointId], authorizedProjectionPointers: ["/threadId", "/messageId", "/recipient", "/subject", "/labelIds"], maxFreshnessSeconds: 60 }, riskClasses: ["gmail_send"], limits, policyCommitment: { schemaId: gmailPolicySchemaId, jcsBase64: authorityCanonicalBytes(policy).toString("base64"), digest: authorityDigest(policy) } };
  const contractDigest = authorityDigest(contract);
  const slackPolicy = { topic: "Release ready" };
  const slackContract = { v: "reelier.outcome-contract/v1", tenant: "tenant_1", alias: SLACK, contractId: "contract_slack", validFrom: "2026-01-01T00:00:00.000Z", validUntil: "2027-01-01T00:00:00.000Z", packDigest: slackChannelTopicPackDigest, definitionDigest: slackChannelTopicDefinitionDigest, sponsor: "operator", audiences: ["agent_1"], delegationGrantDigest: slackContractGrantDigest, connectorId: "slack", accountId: "account_1", sourceAuthority: { resolverId: slackChannelTopicResolverId, projectionSchemaId: slackChannelTopicProjectionSchemaId, allowedReadEndpointIds: [slackChannelTopicReadEndpointId], authorizedProjectionPointers: ["/teamId", "/channelId", "/channelName", "/isPrivate", "/topic"], maxFreshnessSeconds: 60 }, riskClasses: [slackChannelTopicRiskClass], limits, policyCommitment: { schemaId: slackChannelTopicPolicySchemaId, jcsBase64: authorityCanonicalBytes(slackPolicy).toString("base64"), digest: authorityDigest(slackPolicy) } };
  const slackContractDigest = authorityDigest(slackContract);
  const jobCard = signJobCard({
    v: "reelier.signed-job-card/v1", jobId: "production_release", title, taskShapeDigest: sha("a"),
    semanticClasses: ["communication_commit_v1", "record_state_set_v1"], definitionAliases: [GMAIL, SLACK], connectorIds: ["gmail", "slack"],
    accountIdentities: [descriptor.account.identity, slackDescriptor.account.identity].sort(), connectionDescriptorDigests: [connectionDescriptorDigest(descriptor), connectionDescriptorDigest(slackDescriptor)].sort(), adoptionCommitmentDigests: [connectionAdoptionCommitmentDigest(adoptionBody), connectionAdoptionCommitmentDigest(slackAdoptionBody)].sort(),
    sourceRefs: ["channel", "thread"], audiences: ["agent_1"], limitsDigest: authorityDigest(limits), instructionsDigest: sha("c"), packDigests: [gmailPackDigest, slackChannelTopicPackDigest].sort(),
    exceptionPolicy: ["ambiguous-reconcile"], coverage: "declared-surface",
  }, "job_sponsor", sponsor.privateKey);
  const trustPin = jobCardTrustPinFixture(sponsor.publicKey, "job_sponsor", "cell_receipt_key");
  const candidate = {
    v: "reelier.authority-deployment-candidate/v1", jobCard, connectionDescriptors: [descriptor, slackDescriptor], connectionAdoptions: [{ ...adoptionBody, signedDeploymentBinding: signedJobCardDigest(jobCard) }, { ...slackAdoptionBody, signedDeploymentBinding: signedJobCardDigest(jobCard) }],
    state: { tenant: "tenant_1", definitionAlias: GMAIL, stateVersion: 1, candidates: [{ contractEnvelope: { canonicalBase64: authorityCanonicalBytes(contract).toString("base64"), advertisedDigest: contractDigest, signerId: "contract-signer", signature: signAuthorityDigest(contractSigner.privateKey, "outcome-contract", contractDigest) }, delegationEnvelopes: [{ index: 0, canonicalBase64: authorityCanonicalBytes(contractGrant).toString("base64"), advertisedDigest: contractGrantDigest, signerId: "operator", signature: signAuthorityDigest(operator.privateKey, "delegation-grant", contractGrantDigest) }], stateEvents: [{ index: 0, kind: "activated", contractDigest, at: "2026-01-01T00:00:00.000Z" }] }] },
    connectors: [{ tenant: "tenant_1", connectorId: "gmail", accountId: "account_1", providerAccountIdentity: descriptor.account.identity, allowedReadEndpointIds: [gmailReadEndpointId], allowedWriteEndpointIds: [gmailReplyWriteEndpointId], riskClasses: ["gmail_send"], operatorConfigurationDigest: sha("d") }, { tenant: "tenant_1", connectorId: "slack", accountId: "account_1", providerAccountIdentity: slackDescriptor.account.identity, allowedReadEndpointIds: [slackChannelTopicReadEndpointId], allowedWriteEndpointIds: [slackChannelTopicWriteEndpointId], riskClasses: [slackChannelTopicRiskClass], operatorConfigurationDigest: sha("e") }],
    trust: [{ signerId: "operator", principalId: "operator", publicKeyFile: "keys/operator.pem", purposes: ["delegation-grant"] }, { signerId: "contract-signer", principalId: "contract-signer", publicKeyFile: "keys/contract.pem", purposes: ["outcome-contract"] }], sourceDirectory: "sources",
  };
  const candidateFile = path.join(candidateRoot, "candidate.json");
  await writeFile(candidateFile, `${JSON.stringify(candidate)}\n`);
  const authorityRoot = path.join(root, "authority");
  const built = await buildAuthorityDeployment(candidateFile, path.join(authorityRoot, "deployment"), trustPin);
  const manifest = JSON.parse(await readFile(built.deploymentFile, "utf8"));
  manifest.states.push({ tenant: "tenant_1", definitionAlias: SLACK, stateVersion: 1, candidates: [{ contractEnvelope: { canonicalBase64: authorityCanonicalBytes(slackContract).toString("base64"), advertisedDigest: slackContractDigest, signerId: "contract-signer", signature: signAuthorityDigest(contractSigner.privateKey, "outcome-contract", slackContractDigest) }, delegationEnvelopes: [{ index: 0, canonicalBase64: authorityCanonicalBytes(slackContractGrant).toString("base64"), advertisedDigest: slackContractGrantDigest, signerId: "operator", signature: signAuthorityDigest(operator.privateKey, "delegation-grant", slackContractGrantDigest) }], stateEvents: [{ index: 0, kind: "activated", contractDigest: slackContractDigest, at: "2026-01-01T00:00:00.000Z" }] }] });
  await writeFile(built.deploymentFile, `${JSON.stringify(manifest)}\n`);
  const hostPin = path.join(authorityRoot, "trust", "job-card.json");
  await mkdir(path.dirname(hostPin), { recursive: true });
  await copyFile(built.jobCardTrustEvidenceFile, hostPin);
  const config = { version: 1 as const, tenant: "tenant_1", requester: "agent_1", authorityCellId: "cell_1", definitions: [GMAIL, SLACK], ledgerDir: path.join(authorityRoot, "ledger"), decisionDir: path.join(authorityRoot, "decisions"), receiptDir: path.join(authorityRoot, "receipts"), gateKeyFile: path.join(authorityRoot, "keys", "gate.pem"), endpoints: [], deploymentPath: built.deploymentFile, jobCardTrustPinPath: hostPin };
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
    const otherHostConfig = { ...fixture.config, gateKeyFile: path.join(fixture.root, "other-host", "gate.pem"), ledgerDir: path.join(fixture.root, "other-host", "ledger"), decisionDir: path.join(fixture.root, "other-host", "decisions"), receiptDir: path.join(fixture.root, "other-host", "receipts") };
    const otherHost = await createLocalAuthorityRuntime(otherHostConfig, { jobCardTrustPin: fixture.trustPin, delegation: fixture.delegation });
    const otherHostRefs = (await otherHost.jobsSearch!({}, fixture.context) as { jobs: Array<{ jobRef: string }> }).jobs.map(job => job.jobRef);
    assert.notDeepEqual(otherHostRefs, refs, "opaque references must be keyed to host-owned authority");
    const loaded = await restarted.jobLoad!({ jobId: refs[0] }, fixture.context) as { verdict: string; jobRef: string };
    assert.equal(loaded.verdict, "accepted");
    assert.equal(loaded.jobRef, refs[0]);
    assert.equal((await restarted.jobLoad!({ jobId: "production_release" }, fixture.context) as { verdict: string }).verdict, "refused");
    assert.equal((await restarted.jobLoad!({ jobId: GMAIL }, fixture.context) as { verdict: string }).verdict, "refused");
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test("production GitHub release runtime is a public closed four-definition composition", async () => {
  const fixture = await multiDefinitionFixture();
  try {
    await assert.rejects(() => createGitHubReleaseAuthorityRuntime(fixture.config, undefined as never, { jobCardTrustPin: fixture.trustPin, delegation: fixture.delegation }), /four reviewed|release runner|capability/i);
    const host = await import("../../src/authority/host/index.js") as Record<string, unknown>;
    assert.equal(typeof host.createGitHubReleaseAuthorityRuntime, "function");
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test("signed multi-definition references refuse every binding mismatch and stale authority", async () => {
  const fixture = await multiDefinitionFixture();
  const otherCard = await multiDefinitionFixture("Different signed production release");
  const differentlySignedSameBody = await multiDefinitionFixture();
  try {
    await assert.rejects(() => createStdioBoundLocalAuthorityRuntime(fixture.config, { ...fixture.context.executionContext, jobId: "job_other" }, { jobCardTrustPin: fixture.trustPin, delegation: fixture.delegation }), /signed deployment|host identity/i);
    const runtime = await createStdioBoundLocalAuthorityRuntime(fixture.config, fixture.context.executionContext, { jobCardTrustPin: fixture.trustPin, delegation: fixture.delegation });
    const found = await runtime.jobsSearch!({}, fixture.context) as { jobs: Array<{ jobRef: string }> };
    const ref = found.jobs[0]!.jobRef;
    const altered = (patch: Partial<AuthorityExecutionContextV1>, tenant = fixture.context.tenant, requester = fixture.context.requester) => ({ tenant, requester, executionContext: { ...fixture.context.executionContext, ...patch } });
    const attempts = [
      altered({ taskId: "task_other" }),
      altered({}, "tenant_other"),
      altered({ principalId: "agent_other" }, "tenant_1", "agent_other"),
      altered({ grantId: "grant_other" }),
      altered({ allocationId: "allocation_other" }),
      altered({ runtimeSessionId: "session_other" }),
      altered({ authorityCellId: "cell_other" }),
      altered({ jobId: "job_other" }),
      altered({ grantDigest: sha("9") }),
    ];
    for (const context of attempts) {
      const searched = await runtime.jobsSearch!({}, context) as { verdict: string; jobs: unknown[] };
      const loaded = await runtime.jobLoad!({ jobId: ref }, context) as { verdict: string };
      const invoked = await runtime.invoke!({ v: "reelier.outcome-request/v1", jobRef: ref, requestId: `isolation_${context.executionContext.runtimeSessionId}_${context.executionContext.grantId}`, sourceRefs: { thread: "thread_1" }, choices: {} }, context);
      assert.equal(searched.verdict, "refused");
      assert.equal(loaded.verdict, "refused");
      assert.equal(invoked.verdict, "refused");
    }
    await mkdir(path.dirname(otherCard.config.gateKeyFile), { recursive: true });
    await copyFile(fixture.config.gateKeyFile, otherCard.config.gateKeyFile);
    const otherRuntime = await createLocalAuthorityRuntime(otherCard.config, { jobCardTrustPin: otherCard.trustPin, delegation: otherCard.delegation });
    const otherRef = ((await otherRuntime.jobsSearch!({}, otherCard.context) as { jobs: Array<{ jobRef: string }> }).jobs[0]!).jobRef;
    assert.notEqual(otherRef, ref);
    assert.equal((await runtime.jobLoad!({ jobId: otherRef }, fixture.context) as { verdict: string }).verdict, "refused");
    await mkdir(path.dirname(differentlySignedSameBody.config.gateKeyFile), { recursive: true });
    await copyFile(fixture.config.gateKeyFile, differentlySignedSameBody.config.gateKeyFile);
    const differentlySignedRuntime = await createLocalAuthorityRuntime(differentlySignedSameBody.config, { jobCardTrustPin: differentlySignedSameBody.trustPin, delegation: differentlySignedSameBody.delegation });
    const differentlySignedRef = ((await differentlySignedRuntime.jobsSearch!({}, differentlySignedSameBody.context) as { jobs: Array<{ jobRef: string }> }).jobs[0]!).jobRef;
    assert.notEqual(differentlySignedRef, ref, "the exact signed Job Card envelope must bind the reference");
    await fixture.delegation.revoke("tenant_1", "task_1");
    assert.equal((await runtime.jobLoad!({ jobId: ref }, fixture.context) as { verdict: string }).verdict, "refused");
  } finally { await Promise.all([rm(fixture.root, { recursive: true, force: true }), rm(otherCard.root, { recursive: true, force: true }), rm(differentlySignedSameBody.root, { recursive: true, force: true })]); }
});

test("opaque invoke converges exact retries and refuses request-id semantic conflicts before provider dispatch", async () => {
  const fixture = await multiDefinitionFixture();
  let dispatches = 0;
  const dispatchedEndpoints: string[] = [];
  const adapter: DispatchAdapter = {
    async dispatch(state) { dispatches++; dispatchedEndpoints.push((state.effect as { endpointId: string }).endpointId); return { kind: "acknowledged", resultDigest: authorityDigest({ messageId: `provider_${dispatches}` }) }; },
    async reconcile() { return { kind: "acknowledged", resultDigest: authorityDigest({ messageId: "provider_1" }), reconciliationStatus: "matched", normalizedProjectionDigest: authorityDigest({ messageId: "provider_1" }) }; },
  };
  try {
    const runtime = await createLocalAuthorityRuntime(fixture.config, { jobCardTrustPin: fixture.trustPin, delegation: fixture.delegation, dispatchAdapter: adapter });
    const refs = (await runtime.jobsSearch!({}, fixture.context) as { jobs: Array<{ jobRef: string }> }).jobs.map(job => job.jobRef);
    const ref = refs[0]!;
    const request = { v: "reelier.outcome-request/v1", jobRef: ref, requestId: "request_1", sourceRefs: { thread: "thread_1" }, choices: {} };
    const exactRace = await Promise.all([runtime.invoke!(request, fixture.context), runtime.invoke!(request, fixture.context)]);
    assert.deepEqual(exactRace.map(result => result.verdict), ["accepted", "accepted"]);
    assert.equal(dispatches, 1);
    assert.equal((await runtime.invoke!(request, fixture.context)).verdict, "accepted");
    assert.equal(dispatches, 1);
    assert.equal((await runtime.invoke!({ ...request, jobRef: refs[1]! }, fixture.context)).verdict, "refused");
    assert.equal(dispatches, 1);
    const conflict = await runtime.invoke!({ ...request, sourceRefs: { thread: "thread_other" } }, fixture.context);
    assert.equal(conflict.verdict, "refused");
    assert.equal(dispatches, 1);
    assert.equal((await runtime.invoke!({ ...request, requestId: "raw_alias", jobRef: GMAIL }, fixture.context)).verdict, "refused");
    assert.equal(dispatches, 1);
    const secondDefinition = await runtime.invoke!({ ...request, requestId: "second_definition", jobRef: refs[1]!, sourceRefs: { channel: "channel_1" } }, fixture.context);
    assert.equal(secondDefinition.verdict, "accepted", JSON.stringify(secondDefinition));
    assert.equal(dispatches, 2);
    assert.deepEqual(dispatchedEndpoints, [gmailReplyWriteEndpointId, slackChannelTopicWriteEndpointId]);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test("production MCP and HTTP keep signed multi-definition aliases behind authenticated opaque refs", async () => {
  const fixture = await multiDefinitionFixture();
  let dispatches = 0;
  const adapter: DispatchAdapter = {
    async dispatch() { dispatches++; return { kind: "acknowledged", resultDigest: authorityDigest({ messageId: `provider_${dispatches}` }) }; },
    async reconcile() { return { kind: "acknowledged", resultDigest: authorityDigest({ messageId: "provider_1" }), reconciliationStatus: "matched", normalizedProjectionDigest: authorityDigest({ messageId: "provider_1" }) }; },
  };
  const principals = createPrincipalRegistry({ tenant: "tenant_1" });
  const credential = await principals.issue({ ...fixture.context.executionContext, expiresAt: "2027-01-01T00:00:00.000Z" });
  const runtime = await createLocalAuthorityRuntime(fixture.config, { jobCardTrustPin: fixture.trustPin, delegation: fixture.delegation, dispatchAdapter: adapter });
  const server = createAuthorityHostServer(fixture.config, runtime, { principalRegistry: principals, stdioExecutionContext: fixture.context.executionContext });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "multi-definition-production-path", version: "1" }, { capabilities: {} });
  try {
    await server.mcp.connect(serverTransport);
    await client.connect(clientTransport);
    const tools = await client.listTools();
    assert.equal(tools.tools.some(tool => tool.name === `reelier_outcome_${GMAIL}` || tool.name === `reelier_outcome_${SLACK}`), false);
    const searched = await client.callTool({ name: "reelier_jobs_search", arguments: {} });
    const searchedContent = (searched as unknown as { content: Array<{ text: string }> }).content;
    const catalog = JSON.parse(String(searchedContent[0]!.text)) as { verdict: string; jobs: Array<{ jobRef: string }> };
    assert.equal(catalog.verdict, "accepted");
    assert.equal(catalog.jobs.length, 2);
    const loaded = await client.callTool({ name: "reelier_job_load", arguments: { jobId: catalog.jobs[0]!.jobRef } });
    assert.match(String((loaded as unknown as { content: Array<{ text: string }> }).content[0]!.text), /job-loaded/);
    const invoked = await client.callTool({ name: "reelier_outcome_invoke", arguments: { jobRef: catalog.jobs[0]!.jobRef, requestId: "mcp_invoke", sourceRefs: { thread: "thread_1" }, choices: {} } });
    assert.match(String((invoked as unknown as { content: Array<{ text: string }> }).content[0]!.text), /accepted/);
    assert.equal(dispatches, 1);
    const rawMcp = await client.callTool({ name: `reelier_outcome_${GMAIL}`, arguments: { requestId: "raw_mcp", sourceRefs: { thread: "thread_1" }, choices: {} } });
    assert.equal(rawMcp.isError, true);
    assert.equal(dispatches, 1);

    const isolatedServer = createAuthorityHostServer(fixture.config, runtime, { stdioExecutionContext: { ...fixture.context.executionContext, taskId: "task_other" } });
    const [isolatedClientTransport, isolatedServerTransport] = InMemoryTransport.createLinkedPair();
    const isolatedClient = new Client({ name: "multi-definition-isolation", version: "1" }, { capabilities: {} });
    try {
      await isolatedServer.mcp.connect(isolatedServerTransport);
      await isolatedClient.connect(isolatedClientTransport);
      const isolatedSearch = await isolatedClient.callTool({ name: "reelier_jobs_search", arguments: {} });
      assert.match(String((isolatedSearch as unknown as { content: Array<{ text: string }> }).content[0]!.text), /job-authority-refused/);
      const isolatedLoad = await isolatedClient.callTool({ name: "reelier_job_load", arguments: { jobId: catalog.jobs[0]!.jobRef } });
      assert.match(String((isolatedLoad as unknown as { content: Array<{ text: string }> }).content[0]!.text), /job-authority-refused/);
      const isolatedInvoke = await isolatedClient.callTool({ name: "reelier_outcome_invoke", arguments: { jobRef: catalog.jobs[0]!.jobRef, requestId: "isolated_mcp", sourceRefs: { thread: "thread_1" }, choices: {} } });
      assert.match(String((isolatedInvoke as unknown as { content: Array<{ text: string }> }).content[0]!.text), /job-authority-refused/);
      assert.equal(dispatches, 1);
    } finally {
      await isolatedClient.close();
      await isolatedServer.close();
    }

    await server.startHttp(0);
    const address = server.http.address();
    assert.ok(address && typeof address !== "string");
    const rawHttp = await fetch(`http://127.0.0.1:${address.port}/v1/outcomes/${GMAIL}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${credential.token}` }, body: JSON.stringify({ requestId: "raw_http", sourceRefs: { thread: "thread_1" }, choices: {} }) });
    const rawHttpBody = await rawHttp.json() as { verdict: string };
    assert.equal(rawHttpBody.verdict, "refused");
    assert.equal(dispatches, 1);
  } finally {
    await client.close();
    await server.close();
    await rm(fixture.root, { recursive: true, force: true });
  }
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
