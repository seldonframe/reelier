import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { authorityCanonicalBytes, authorityDigest, signAuthorityDigest, signJobCard, signedJobCardDigest } from "../../src/authority/index.js";
import { connectionAdoptionCommitmentDigest, connectionDescriptorDigest, createOpaqueConnectionRouteRegistry, digestNormalizedMcpToolSchemas } from "../../src/connections.js";
import { buildAuthorityDeployment } from "../../src/authority/host/deploy.js";
import { createLocalAuthorityRuntime } from "../../src/authority/host/local.js";
import type { DispatchAdapter } from "../../src/authority/host/dispatch.js";
import { gmailPackDigest, gmailReplyDefinitionDigest, gmailResolverId, gmailProjectionSchemaId, gmailReadEndpointId, gmailReplyWriteEndpointId, gmailPolicySchemaId } from "../../src/packs/gmail/index.js";
import { bindableTempRoot } from "./bindable-root.js";

const sha = (seed: string) => `sha256:${seed.repeat(64).slice(0, 64)}`;

test("local deployment dispatches once, reconciles, publishes a receipt, and survives restart", async () => {
  const root = await bindableTempRoot("reelier-local-e2e-");
  let dispatches = 0;
  let reconciliations = 0;
  let adoptedRouteOpens = 0;
  try {
    const candidateRoot = path.join(root, "candidate");
    await mkdir(path.join(candidateRoot, "keys"), { recursive: true });
    await mkdir(path.join(candidateRoot, "sources"), { recursive: true });
    const operator = generateKeyPairSync("ed25519");
    const contractSigner = generateKeyPairSync("ed25519");
    await writeFile(path.join(candidateRoot, "keys", "operator.pem"), operator.publicKey.export({ type: "spki", format: "pem" }));
    await writeFile(path.join(candidateRoot, "keys", "contract.pem"), contractSigner.publicKey.export({ type: "spki", format: "pem" }));
    await writeFile(path.join(candidateRoot, "sources", "thread_1.json"), `${JSON.stringify({ threadId: "thread_1", messageId: "message_1", recipient: "customer@example.test", subject: "Question", labelIds: ["INBOX"] })}\n`);

    const limits = { maxEffectsPerWindow: 2, windowSeconds: 3600, maxEffectsPerSourceTrigger: 1, maxBodyBytes: 4096 };
    const grant = { v: "reelier.delegation-grant/v1", tenant: "tenant_1", grantId: "grant_1", parentDigest: null, sponsor: "operator", grantor: "operator", grantee: "contract-signer", issuedAt: "2026-01-01T00:00:00.000Z", expiresAt: "2027-01-01T00:00:00.000Z", constraints: { definitionAliases: ["gmail_reply_send_v1"], audiences: ["operator"], connectorAccounts: [{ connectorId: "gmail", accountId: "account_1" }], projectionPointers: ["/threadId", "/messageId", "/recipient", "/subject", "/labelIds"], riskClasses: ["gmail_send"], limits } };
    const grantDigest = authorityDigest(grant);
    const policy = { text: "Thanks for reaching out." };
    const contract = { v: "reelier.outcome-contract/v1", tenant: "tenant_1", alias: "gmail_reply_send_v1", contractId: "contract_1", validFrom: "2026-01-01T00:00:00.000Z", validUntil: "2027-01-01T00:00:00.000Z", packDigest: gmailPackDigest, definitionDigest: gmailReplyDefinitionDigest, sponsor: "operator", audiences: ["operator"], delegationGrantDigest: grantDigest, connectorId: "gmail", accountId: "account_1", sourceAuthority: { resolverId: gmailResolverId, projectionSchemaId: gmailProjectionSchemaId, allowedReadEndpointIds: [gmailReadEndpointId], authorizedProjectionPointers: ["/threadId", "/messageId", "/recipient", "/subject", "/labelIds"], maxFreshnessSeconds: 60 }, riskClasses: ["gmail_send"], limits, policyCommitment: { schemaId: gmailPolicySchemaId, jcsBase64: authorityCanonicalBytes(policy).toString("base64"), digest: authorityDigest(policy) } };
    const contractDigest = authorityDigest(contract);
    const grantBytes = authorityCanonicalBytes(grant);
    const contractBytes = authorityCanonicalBytes(contract);
    const liveTools = [{ name: gmailReadEndpointId, inputSchema: {} }, { name: gmailReplyWriteEndpointId, inputSchema: {} }];
    const descriptor = { v: "reelier.connection-descriptor/v1" as const, connectionId: "gmail", kind: "adopted-mcp-stdio" as const, provider: { id: "gmail", toolServerName: "gmail-mcp" }, callableRoute: { kind: "mcp-stdio" as const, routeId: "route.gmail", endpointIds: [gmailReadEndpointId, gmailReplyWriteEndpointId] }, account: { status: "verified" as const, identity: "gmail-owner-example-test" }, toolSchemas: digestNormalizedMcpToolSchemas(liveTools), secretOwner: "host" as const, coverage: { v: "reelier.host-coverage/v1" as const, host: "codex", observation: "observed" as const, outcomeInvocation: "supported" as const, exclusiveEnforcement: "unknown" as const, limitations: ["raw-write-reachability-unmeasured"] } };
    const adoptionBody = { v: "reelier.connection-adoption/v1" as const, adoptionId: "adopt_gmail", descriptorDigest: connectionDescriptorDigest(descriptor), selectedAccountIdentity: descriptor.account.identity, mode: "existing" as const, sidecarRouteId: descriptor.callableRoute.routeId, rawWriteReachability: "reachable" as const, activationState: "active" as const, secureConnectionCommitment: null };
    const jobCard = signJobCard({ v: "reelier.signed-job-card/v1", jobId: "customer_reply", title: "Reply to a customer", taskShapeDigest: sha("a"), semanticClasses: ["communication_commit_v1"], definitionAliases: ["gmail_reply_send_v1"], connectorIds: ["gmail"], accountIdentities: [descriptor.account.identity], connectionDescriptorDigests: [connectionDescriptorDigest(descriptor)], adoptionCommitmentDigests: [connectionAdoptionCommitmentDigest(adoptionBody)], sourceRefs: ["thread"], audiences: ["operator"], limitsDigest: authorityDigest(limits), instructionsDigest: sha("b"), packDigests: [gmailPackDigest], exceptionPolicy: ["ambiguous-reconcile"], coverage: "declared-surface" }, "operator", operator.privateKey);
    const candidate = {
      v: "reelier.authority-deployment-candidate/v1",
      jobCard,
      connectionDescriptors: [descriptor],
      connectionAdoptions: [{ ...adoptionBody, signedDeploymentBinding: signedJobCardDigest(jobCard) }],
      state: { tenant: "tenant_1", definitionAlias: "gmail_reply_send_v1", stateVersion: 1, candidates: [{ contractEnvelope: { canonicalBase64: contractBytes.toString("base64"), advertisedDigest: contractDigest, signerId: "contract-signer", signature: signAuthorityDigest(contractSigner.privateKey, "outcome-contract", contractDigest) }, delegationEnvelopes: [{ index: 0, canonicalBase64: grantBytes.toString("base64"), advertisedDigest: grantDigest, signerId: "operator", signature: signAuthorityDigest(operator.privateKey, "delegation-grant", grantDigest) }], stateEvents: [{ index: 0, kind: "activated" as const, contractDigest, at: "2026-01-01T00:00:00.000Z" }] }] },
      connectors: [{ tenant: "tenant_1", connectorId: "gmail", accountId: "account_1", providerAccountIdentity: "gmail-owner-example-test", allowedReadEndpointIds: [gmailReadEndpointId], allowedWriteEndpointIds: [gmailReplyWriteEndpointId], riskClasses: ["gmail_send"], operatorConfigurationDigest: sha("c") }],
      trust: [{ signerId: "operator", principalId: "operator", publicKeyFile: "keys/operator.pem", purposes: ["delegation-grant", "signed-job-card"] }, { signerId: "contract-signer", principalId: "contract-signer", publicKeyFile: "keys/contract.pem", purposes: ["outcome-contract"] }],
      sourceDirectory: "sources",
    };
    const candidateFile = path.join(candidateRoot, "candidate.json");
    await writeFile(candidateFile, `${JSON.stringify(candidate)}\n`);
    const authorityRoot = path.join(root, "authority");
    const built = await buildAuthorityDeployment(candidateFile, path.join(authorityRoot, "deployments", "customer_reply"), path.join(authorityRoot, "keys", "local-gate.pem"));

    const adapter: DispatchAdapter = {
      async dispatch() { dispatches++; return { kind: "acknowledged", resultDigest: authorityDigest({ v: "fake-provider-response/v1", messageId: "provider-message-1" }) }; },
      async reconcile() { reconciliations++; return { kind: "acknowledged", resultDigest: authorityDigest({ v: "fake-read-back/v1", messageId: "provider-message-1" }), reconciliationStatus: "matched", normalizedProjectionDigest: authorityDigest({ v: "fake-message/v1", messageId: "provider-message-1" }) }; },
    };
    const config = { version: 1 as const, tenant: "tenant_1", requester: "operator", definitions: ["gmail_reply_send_v1"], ledgerDir: path.join(authorityRoot, "ledger"), decisionDir: path.join(authorityRoot, "decisions"), receiptDir: path.join(authorityRoot, "receipts"), gateKeyFile: path.join(authorityRoot, "keys", "local-gate.pem"), endpoints: [], deploymentPath: built.deploymentFile };
    const connectionRoutes = createOpaqueConnectionRouteRegistry();
    connectionRoutes.register({ sidecarRouteId: descriptor.callableRoute.routeId, descriptor, verifier: { provider: "gmail", sourceEndpointIds: [gmailReadEndpointId], writeEndpointIds: [gmailReplyWriteEndpointId], expectedToolSchemaDigests: descriptor.toolSchemas.map(item => item.digest), accountProbe: { toolName: gmailReadEndpointId, args: {}, reviewedReadOnly: true, extractAccountIdentity: () => descriptor.account.identity } }, resolve: async () => { adoptedRouteOpens++; return { name: "gmail-mcp", advertisedName: "gmail-mcp", tools: liveTools, async call() { return { content: [] }; }, async close() {} }; } });
    const runtime = await createLocalAuthorityRuntime(config, { dispatchAdapter: adapter, connectionRoutes });
    assert.equal(adoptedRouteOpens, 0, "deployment loading must not open adopted provider routes");
    await runtime.resolveAdoptedConnection("gmail");
    assert.equal(adoptedRouteOpens, 1);
    const request = { v: "reelier.outcome-request/v1", requestId: "customer-request-1", sourceRefs: { thread: "thread_1" }, choices: {} };
    const first = await runtime.outcome("gmail_reply_send_v1", request, { tenant: "tenant_1", requester: "operator" });
    assert.equal(first.verdict, "accepted", JSON.stringify(first));
    assert.equal(first.lifecycleState, "reconciled");
    assert.ok(first.receiptRef);
    assert.equal(dispatches, 1);
    assert.equal(reconciliations, 1);
    const duplicate = await runtime.outcome("gmail_reply_send_v1", request, { tenant: "tenant_1", requester: "operator" });
    assert.equal(duplicate.verdict, "accepted");
    assert.equal(dispatches, 1);
    const restarted = await createLocalAuthorityRuntime(config, { dispatchAdapter: adapter });
    const status = await restarted.status({ requestId: request.requestId }, { tenant: "tenant_1", requester: "operator" });
    assert.equal(status.lifecycleState, "reconciled");
    assert.equal(dispatches, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});
