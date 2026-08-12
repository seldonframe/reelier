import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { copyFile, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { authorityCanonicalBytes, authorityDigest, signAuthorityDigest, signJobCard, signedJobCardDigest } from "../../src/authority/index.js";
import { connectionAdoptionCommitmentDigest, connectionDescriptorDigest, createOpaqueConnectionRouteRegistry, digestNormalizedMcpToolSchemas } from "../../src/connections.js";
import { buildAuthorityDeployment } from "../../src/authority/host/deploy.js";
import { createLocalAuthorityRuntime } from "../../src/authority/host/local.js";
import { createSignedCertificationReadiness, parseAuthorityKeyDescriptor } from "../../src/authority/certification/authority.js";
import type { DispatchAdapter } from "../../src/authority/host/dispatch.js";
import { gmailPackDigest, gmailReplyDefinitionDigest, gmailResolverId, gmailProjectionSchemaId, gmailReadEndpointId, gmailReplyWriteEndpointId, gmailPolicySchemaId } from "../../src/packs/gmail/index.js";
import { bindableTempRoot } from "./bindable-root.js";

const sha = (seed: string) => `sha256:${seed.repeat(64).slice(0, 64)}`;

function jobCardTrustPin(jobPublicKey: ReturnType<typeof generateKeyPairSync>["publicKey"]) {
  const readinessSigner = generateKeyPairSync("ed25519");
  const cellSigner = generateKeyPairSync("ed25519");
  const jobDescriptor = parseAuthorityKeyDescriptor({ v: "reelier.authority-key-descriptor/v1", keyId: "job_sponsor", role: "human-sponsor", purpose: "signed-job-card", algorithm: "ed25519", publicKeySpkiBase64: jobPublicKey.export({ type: "spki", format: "der" }).toString("base64") });
  const human = parseAuthorityKeyDescriptor({ v: "reelier.authority-key-descriptor/v1", keyId: `signer_${"e".repeat(24)}`, role: "human-sponsor", purpose: "certification-readiness", algorithm: "ed25519", publicKeySpkiBase64: readinessSigner.publicKey.export({ type: "spki", format: "der" }).toString("base64") });
  const cell = parseAuthorityKeyDescriptor({ v: "reelier.authority-key-descriptor/v1", keyId: "cell_receipt_key", role: "authority-cell", purpose: "authority-receipt", algorithm: "ed25519", publicKeySpkiBase64: cellSigner.publicKey.export({ type: "spki", format: "der" }).toString("base64") });
  const event = (sequence: number, descriptor: typeof human, previousEventDigest: string | null) => ({ v: "reelier.authority-trust-event/v1" as const, eventId: `trust_${sequence}_${"f".repeat(12)}`, sequence, action: "activate" as const, keyDescriptorDigest: authorityDigest(descriptor), occurredAt: "2026-01-01T00:00:00.000Z", previousEventDigest });
  const first = event(0, human, null); const second = event(1, jobDescriptor, authorityDigest(first)); const third = event(2, cell, authorityDigest(second));
  const readiness: any = { v: "reelier.certification-readiness-candidate/v1", status: "awaiting-human-signature", preparationReady: true, signatureStatus: "absent", authorization: "absent", dispatchable: false, completeness: "unchecked", configDigest: sha("1"), selectionDigest: sha("2"), preflightDigest: "", scenarios: ["github-issue-labels"], identifiers: { taskId: `task_${"a".repeat(24)}`, jobCardId: `job_${"b".repeat(24)}`, rootGrantId: `grant_${"c".repeat(24)}`, authorityCellId: `cell_${"d".repeat(24)}`, signerId: human.keyId }, commitments: { resources: [], cleanup: [], credentials: [], runners: { status: "configured", artifacts: [] }, tests: { status: "configured", artifacts: [] }, topology: "absent", signatureStatus: "absent" } };
  const preflightBody: any = { v: "reelier.certification-preflight/v2", configDigest: readiness.configDigest, selectionDigest: readiness.selectionDigest, identifiers: readiness.identifiers, scenarios: readiness.scenarios, resources: [], cleanup: [], credentialReferences: [], inputs: { runners: readiness.commitments.runners, tests: readiness.commitments.tests }, topology: "absent", trust: "unchecked", signatureStatus: "absent", authorization: "absent", completeness: "unchecked", missing: [], ok: true, preparationReady: true };
  const preflight = { ...preflightBody, digest: authorityDigest(preflightBody) }; readiness.preflightDigest = preflight.digest;
  const keyDescriptors = [human, jobDescriptor, cell]; const readinessTrustEvents = [first, second, third];
  const signedReadiness = createSignedCertificationReadiness({ readinessCandidate: readiness, readinessCandidateDigest: authorityDigest(readiness), preflight, humanKeyDescriptor: human, jobCardKeyDescriptors: [jobDescriptor], cellKeyDescriptors: [cell], trustEvents: readinessTrustEvents, humanPrivateKey: readinessSigner.privateKey, authorizedAt: "2026-01-02T00:00:00.000Z" });
  return { v: "reelier.job-card-trust-pin/v1" as const, signedReadiness, readinessCandidate: readiness, preflight, humanTrustRoot: human, keyDescriptors, readinessTrustEvents, currentTrustEvents: readinessTrustEvents };
}

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
    const jobSponsor = generateKeyPairSync("ed25519");
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
    const jobCard = signJobCard({ v: "reelier.signed-job-card/v1", jobId: "customer_reply", title: "Reply to a customer", taskShapeDigest: sha("a"), semanticClasses: ["communication_commit_v1"], definitionAliases: ["gmail_reply_send_v1"], connectorIds: ["gmail"], accountIdentities: [descriptor.account.identity], connectionDescriptorDigests: [connectionDescriptorDigest(descriptor)], adoptionCommitmentDigests: [connectionAdoptionCommitmentDigest(adoptionBody)], sourceRefs: ["thread"], audiences: ["operator"], limitsDigest: authorityDigest(limits), instructionsDigest: sha("b"), packDigests: [gmailPackDigest], exceptionPolicy: ["ambiguous-reconcile"], coverage: "declared-surface" }, "job_sponsor", jobSponsor.privateKey);
    const trustPin = jobCardTrustPin(jobSponsor.publicKey);
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
    const built = await buildAuthorityDeployment(candidateFile, path.join(authorityRoot, "deployments", "customer_reply"), trustPin);

    const adapter: DispatchAdapter = {
      async dispatch() { dispatches++; return { kind: "acknowledged", resultDigest: authorityDigest({ v: "fake-provider-response/v1", messageId: "provider-message-1" }) }; },
      async reconcile() { reconciliations++; return { kind: "acknowledged", resultDigest: authorityDigest({ v: "fake-read-back/v1", messageId: "provider-message-1" }), reconciliationStatus: "matched", normalizedProjectionDigest: authorityDigest({ v: "fake-message/v1", messageId: "provider-message-1" }) }; },
    };
    const unsafeConfig = { version: 1 as const, tenant: "tenant_1", requester: "operator", definitions: ["gmail_reply_send_v1"], ledgerDir: path.join(authorityRoot, "unsafe-ledger"), decisionDir: path.join(authorityRoot, "unsafe-decisions"), receiptDir: path.join(authorityRoot, "unsafe-receipts"), endpoints: [], deploymentPath: built.deploymentFile, jobCardTrustPinPath: built.jobCardTrustEvidenceFile };
    await assert.rejects(() => createLocalAuthorityRuntime(unsafeConfig, { dispatchAdapter: adapter }), /trust pin.*outside deployment-controlled output/i);
    const linkedDeployment = path.join(authorityRoot, "linked-deployment");
    await symlink(built.directory, linkedDeployment, process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(() => createLocalAuthorityRuntime({ ...unsafeConfig, jobCardTrustPinPath: path.join(linkedDeployment, "job-card-trust-evidence.json") }, { dispatchAdapter: adapter }), /trust pin.*outside deployment-controlled output|link.*indirection/i);
    if (process.platform === "win32") await assert.rejects(() => createLocalAuthorityRuntime({ ...unsafeConfig, jobCardTrustPinPath: built.jobCardTrustEvidenceFile.toUpperCase() }, { dispatchAdapter: adapter }), /trust pin.*outside deployment-controlled output/i);
    const hostTrustPinPath = path.join(authorityRoot, "trust", "job-card-trust-pin.json");
    await mkdir(path.dirname(hostTrustPinPath), { recursive: true });
    await copyFile(built.jobCardTrustEvidenceFile, hostTrustPinPath);
    assert.equal(hostTrustPinPath.startsWith(`${built.directory}${path.sep}`), false, "host trust pin must remain outside deployment-controlled output");
    const config = { version: 1 as const, tenant: "tenant_1", requester: "operator", definitions: ["gmail_reply_send_v1"], ledgerDir: path.join(authorityRoot, "ledger"), decisionDir: path.join(authorityRoot, "decisions"), receiptDir: path.join(authorityRoot, "receipts"), gateKeyFile: path.join(authorityRoot, "keys", "local-gate.pem"), endpoints: [], deploymentPath: built.deploymentFile, jobCardTrustPinPath: hostTrustPinPath };
    await assert.rejects(() => createLocalAuthorityRuntime({ ...config, definitions: ["slack_channel_topic_set_v1"] }, { dispatchAdapter: adapter, jobCardTrustPin: built.jobCardTrustPin }), /definitions.*signed Job Card/i);
    const deploymentBytes = await readFile(built.deploymentFile, "utf8");
    const wrongPack = JSON.parse(deploymentBytes) as any;
    const { signerId: _signer, signature: _signature, ...unsignedWrongPack } = wrongPack.jobCard;
    wrongPack.jobCard = signJobCard({ ...unsignedWrongPack, packDigests: [sha("9")] }, "job_sponsor", jobSponsor.privateKey);
    for (const item of wrongPack.connectionAdoptions) item.signedDeploymentBinding = signedJobCardDigest(wrongPack.jobCard);
    await writeFile(built.deploymentFile, JSON.stringify(wrongPack));
    await assert.rejects(() => createLocalAuthorityRuntime(config, { dispatchAdapter: adapter }), /pack digest.*installed reviewed packs/i);
    await writeFile(built.deploymentFile, deploymentBytes);
    const stripped = JSON.parse(deploymentBytes) as Record<string, unknown>;
    delete stripped.jobCard; delete stripped.jobCardAuthority; stripped.connectionDescriptors = []; stripped.connectionAdoptions = [];
    await writeFile(built.deploymentFile, JSON.stringify(stripped));
    await assert.rejects(() => createLocalAuthorityRuntime(config, { dispatchAdapter: adapter }), /requires a signed Job Card/i);
    await writeFile(built.deploymentFile, deploymentBytes);
    const connectionRoutes = createOpaqueConnectionRouteRegistry();
    connectionRoutes.register({ sidecarRouteId: descriptor.callableRoute.routeId, descriptor, verifier: { provider: "gmail", sourceEndpointIds: [gmailReadEndpointId], writeEndpointIds: [gmailReplyWriteEndpointId], expectedToolSchemaDigests: descriptor.toolSchemas.map(item => item.digest), accountProbe: { toolName: gmailReadEndpointId, args: {}, reviewedReadOnly: true, extractAccountIdentity: () => descriptor.account.identity } }, resolve: async () => { adoptedRouteOpens++; return { name: "gmail-mcp", advertisedName: "gmail-mcp", tools: liveTools, async call() { return { content: [] }; }, async close() {} }; } });
    const runtime = await createLocalAuthorityRuntime(config, { dispatchAdapter: adapter, connectionRoutes, jobCardTrustPin: built.jobCardTrustPin });
    assert.equal(adoptedRouteOpens, 0, "deployment loading must not open adopted provider routes");
    await runtime.resolveAdoptedConnection("gmail");
    assert.equal(adoptedRouteOpens, 1);
    const request = { v: "reelier.outcome-request/v1", requestId: "customer-request-1", sourceRefs: { thread: "thread_1" }, choices: {} };
    const found = await runtime.jobsSearch!({ query: "customer" }, { tenant: "tenant_1", requester: "operator" }) as any;
    assert.deepEqual(found.jobs, [{ jobId: "customer_reply", alias: "gmail_reply_send_v1" }]);
    const aliasLoad = await runtime.jobLoad!({ jobId: "gmail_reply_send_v1" }, { tenant: "tenant_1", requester: "operator" }) as any;
    assert.equal(aliasLoad.verdict, "refused");
    const loaded = await runtime.jobLoad!({ jobId: "customer_reply" }, { tenant: "tenant_1", requester: "operator" }) as any;
    assert.equal(loaded.jobRef, "customer_reply");
    const aliasInvoke = await runtime.invoke!({ ...request, requestId: "alias-invoke", jobRef: "gmail_reply_send_v1" }, { tenant: "tenant_1", requester: "operator" });
    assert.equal(aliasInvoke.verdict, "refused");
    const first = await runtime.invoke!({ ...request, jobRef: "customer_reply" }, { tenant: "tenant_1", requester: "operator" });
    assert.equal(first.verdict, "accepted", JSON.stringify(first));
    assert.equal(first.lifecycleState, "reconciled");
    assert.ok(first.receiptRef);
    assert.equal(dispatches, 1);
    assert.equal(reconciliations, 1);
    const unauthorized = await runtime.outcome("gmail_reply_send_v1", { ...request, requestId: "unauthorized-request-1" }, { tenant: "tenant_1", requester: "intruder" });
    assert.equal(unauthorized.verdict, "refused");
    assert.equal(dispatches, 1);
    const duplicate = await runtime.outcome("gmail_reply_send_v1", request, { tenant: "tenant_1", requester: "operator" });
    assert.equal(duplicate.verdict, "accepted");
    assert.equal(dispatches, 1);
    const restarted = await createLocalAuthorityRuntime(config, { dispatchAdapter: adapter, jobCardTrustPin: built.jobCardTrustPin });
    const status = await restarted.status({ requestId: request.requestId }, { tenant: "tenant_1", requester: "operator" });
    assert.equal(status.lifecycleState, "reconciled");
    assert.equal(dispatches, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});
