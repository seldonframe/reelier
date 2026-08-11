import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { authorityDigest, authorityCanonicalBytes, signJobCard, signedJobCardDigest, verifySignedJobCard, verifyAuthoritySignature } from "../../src/authority/index.js";
import { parseAuthorityKeyDescriptor } from "../../src/authority/certification/authority.js";
import { buildAuthorityDeployment } from "../../src/authority/host/deploy.js";
import { loadAuthorityDeployment } from "../../src/authority/host/deployment.js";
import { connectionAdoptionCommitmentDigest, connectionDescriptorDigest } from "../../src/connections.js";

const sha = (seed: string) => `sha256:${seed.repeat(64).slice(0, 64)}`;
const jobCardAuthority = (publicKey: ReturnType<typeof generateKeyPairSync>["publicKey"]) => {
  const descriptor = parseAuthorityKeyDescriptor({ v: "reelier.authority-key-descriptor/v1", keyId: "human_sponsor", role: "human-sponsor", purpose: "signed-job-card", algorithm: "ed25519", publicKeySpkiBase64: publicKey.export({ type: "spki", format: "der" }).toString("base64") });
  const event = { v: "reelier.authority-trust-event/v1" as const, eventId: "trust_job_card_1", sequence: 0, action: "activate" as const, keyDescriptorDigest: authorityDigest(descriptor), occurredAt: "2026-01-01T00:00:00.000Z", previousEventDigest: null };
  return { signedReadinessDigest: sha("2"), signerKeyDescriptorDigest: authorityDigest(descriptor), keyDescriptors: [descriptor], trustEvents: [event], trustHistoryDigest: authorityDigest([event]), trustHeadDigest: authorityDigest(event) };
};
const unsignedJob = {
  v: "reelier.signed-job-card/v1" as const,
  jobId: "customer_reply",
  title: "Reply to a customer",
  taskShapeDigest: sha("a"),
  semanticClasses: ["communication_commit_v1" as const],
  definitionAliases: ["gmail_reply_send_v1"],
  connectorIds: ["gmail"],
  accountIdentities: ["gmail:owner-example-test"],
  connectionDescriptorDigests: [sha("9")],
  adoptionCommitmentDigests: [sha("8")],
  sourceRefs: ["thread"],
  audiences: ["agent_operator"],
  limitsDigest: sha("b"),
  instructionsDigest: sha("c"),
  packDigests: [sha("d")],
  exceptionPolicy: ["ambiguous-reconcile"],
  coverage: "declared-surface" as const,
};

test("signed job cards bind their payload to the signing key", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const card = signJobCard(unsignedJob, "operator", privateKey);
  assert.equal(verifySignedJobCard(card, publicKey), true);
  assert.equal(verifyAuthoritySignature(publicKey, "principal", signedJobCardDigest(unsignedJob), card.signature), false);
  assert.notEqual(signedJobCardDigest(unsignedJob), authorityDigest({ ...unsignedJob, title: "changed" }));
  assert.equal(verifySignedJobCard({ ...card, title: "changed" }, publicKey), false);
});

test("deploy requires a pre-existing human-signed job card bound to an adopted descriptor", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-deploy-"));
  try {
    const candidateRoot = path.join(root, "candidate");
    const candidateKeys = path.join(candidateRoot, "keys");
    const sourceDirectory = path.join(candidateRoot, "sources");
    await mkdir(candidateKeys, { recursive: true });
    await mkdir(sourceDirectory, { recursive: true });
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const authority = jobCardAuthority(publicKey);
    await writeFile(path.join(candidateKeys, "operator.pem"), publicKey.export({ type: "spki", format: "pem" }));
    await writeFile(path.join(sourceDirectory, "thread.json"), '{"message":"hello"}\n');
    const contract = { v: "reelier.outcome-contract/v1", tenant: "tenant_1", alias: "gmail_reply_send_v1", contractId: "contract_1", validFrom: "2026-01-01T00:00:00.000Z", validUntil: "2027-01-01T00:00:00.000Z", packDigest: sha("e"), definitionDigest: sha("f"), sponsor: "operator", audiences: ["operator"], delegationGrantDigest: sha("1"), connectorId: "gmail", accountId: "gmail:owner@example.test", sourceAuthority: { resolverId: "gmail_thread", projectionSchemaId: "gmail.thread/v1", allowedReadEndpointIds: ["gmail.read"], authorizedProjectionPointers: ["/message"], maxFreshnessSeconds: 60 }, riskClasses: ["message"], limits: { maxEffectsPerWindow: 1, windowSeconds: 3600, maxEffectsPerSourceTrigger: 1, maxBodyBytes: 4096 }, policyCommitment: { schemaId: "policy/v1", jcsBase64: Buffer.from("{}\n").toString("base64"), digest: authorityDigest({}) } };
    const contractBytes = authorityCanonicalBytes(contract);
    const descriptor = { v: "reelier.connection-descriptor/v1", connectionId: "gmail", kind: "adopted-mcp-stdio", provider: { id: "gmail", toolServerName: "gmail-mcp" }, callableRoute: { kind: "mcp-stdio", routeId: "route.gmail", endpointIds: ["gmail.read", "gmail.send"] }, account: { status: "verified", identity: "gmail:owner-example-test" }, toolSchemas: [{ toolName: "gmail.read", digest: sha("7") }, { toolName: "gmail.send", digest: sha("8") }], secretOwner: "host", coverage: { v: "reelier.host-coverage/v1", host: "codex", observation: "observed", outcomeInvocation: "supported", exclusiveEnforcement: "unknown", limitations: ["raw-write-reachability-unmeasured"] } } as const;
    const adoptionBody = { v: "reelier.connection-adoption/v1" as const, adoptionId: "adopt_gmail", descriptorDigest: connectionDescriptorDigest(descriptor), selectedAccountIdentity: descriptor.account.identity, mode: "existing" as const, sidecarRouteId: descriptor.callableRoute.routeId, rawWriteReachability: "reachable" as const, activationState: "active" as const, secureConnectionCommitment: null };
    const jobCard = signJobCard({ ...unsignedJob, connectionDescriptorDigests: [connectionDescriptorDigest(descriptor)], adoptionCommitmentDigests: [connectionAdoptionCommitmentDigest(adoptionBody)] }, "human_sponsor", privateKey);
    const adoption = { ...adoptionBody, signedDeploymentBinding: signedJobCardDigest(jobCard) };
    const candidate = { v: "reelier.authority-deployment-candidate/v1", jobCard, jobCardAuthority: authority, connectionDescriptors: [descriptor], connectionAdoptions: [adoption], state: { tenant: "tenant_1", definitionAlias: "gmail_reply_send_v1", stateVersion: 1, candidates: [{ contractEnvelope: { canonicalBase64: contractBytes.toString("base64"), advertisedDigest: authorityDigest(contract), signerId: "operator", signature: { alg: "ed25519", sig: Buffer.alloc(64, 1).toString("base64") } }, delegationEnvelopes: [], stateEvents: [{ index: 0, kind: "activated", contractDigest: authorityDigest(contract), at: "2026-01-01T00:00:00.000Z" }] }] }, connectors: [{ tenant: "tenant_1", connectorId: "gmail", accountId: "acct_1", providerAccountIdentity: descriptor.account.identity, allowedReadEndpointIds: ["gmail.read"], allowedWriteEndpointIds: ["gmail.send"], riskClasses: ["message"], operatorConfigurationDigest: sha("5") }], trust: [{ signerId: "operator", principalId: "operator", publicKeyFile: "keys/operator.pem", purposes: ["outcome-contract"] }], sourceDirectory: "sources" };
    const candidateFile = path.join(candidateRoot, "candidate.json");
    await writeFile(candidateFile, `${JSON.stringify(candidate)}\n`);
    const built = await buildAuthorityDeployment(candidateFile, path.join(root, "deployments", "customer_reply"));
    await assert.rejects(() => loadAuthorityDeployment(built.deploymentFile), /host.pinned|job.card.*trust/i);
    const manifest = JSON.parse(await readFile(built.deploymentFile, "utf8")) as Record<string, unknown>;
    assert.equal(manifest.v, "reelier.authority-deployment/v1");
    assert.equal((manifest.jobCard as Record<string, unknown>).v, "reelier.signed-job-card/v1");
    assert.equal((manifest.jobCard as Record<string, unknown>).signerId, "human_sponsor");
    assert.equal(JSON.stringify(manifest).includes("routeSpec"), false);
    assert.equal(built.manifest.connectionAdoptions[0]?.rawWriteReachability, "reachable");
    assert.equal(built.manifest.enforcement.completeness, "unchecked");
    assert.equal((await readFile(path.join(built.directory, "sources", "thread.json"), "utf8")).trim(), '{"message":"hello"}');
    const original = JSON.parse(await readFile(built.deploymentFile, "utf8")) as Record<string, unknown>;
    const expectRefusal = async (mutate: (copy: Record<string, unknown>) => void, pattern: RegExp) => {
      const copy = structuredClone(original); mutate(copy); await writeFile(built.deploymentFile, JSON.stringify(copy));
      await assert.rejects(() => loadAuthorityDeployment(built.deploymentFile, { jobCardTrustPin: built.jobCardTrustPin }), pattern);
    };
    await expectRefusal(copy => { ((copy.connectionAdoptions as Array<Record<string, unknown>>)[0]!).sidecarRouteId = "route.other"; }, /adoption.*(?:binding|set)/i);
    await expectRefusal(copy => { ((copy.connectionDescriptors as Array<Record<string, unknown>>)[0]!).account = { status: "verified", identity: "gmail:other@example.test" }; }, /descriptor.*commitment|adoption.*binding/i);
    await expectRefusal(copy => { ((copy.connectors as Array<Record<string, unknown>>)[0]!).providerAccountIdentity = "gmail:other-example-test"; }, /connector.*account|adoption.*binding/i);
    await expectRefusal(copy => { ((copy.jobCardAuthority as Record<string, unknown>).signerKeyDescriptorDigest) = sha("6"); }, /job.card.*authority|signer.*descriptor|host.pinned/i);
    await expectRefusal(copy => { ((copy.trust as Array<Record<string, unknown>>)[0]!).status = "inactive"; }, /not active|trust/i);
    await expectRefusal(copy => { ((copy.enforcement as Record<string, unknown>).bypasses) = []; }, /bypass.*raw-write|enforcement.*bypass/i);
    await expectRefusal(copy => {
      const descriptors = copy.connectionDescriptors as Array<any>;
      const secondDescriptor = { ...structuredClone(descriptors[0]), connectionId: "gmail_secondary", callableRoute: { ...structuredClone(descriptors[0].callableRoute), routeId: "route.gmail.secondary" }, account: { status: "verified", identity: "gmail:secondary-example-test" } };
      descriptors.push(secondDescriptor);
      (copy.connectors as Array<any>).push({ ...(copy.connectors as Array<any>)[0], connectorId: "gmail_secondary", providerAccountIdentity: secondDescriptor.account.identity });
      const adoptions = copy.connectionAdoptions as Array<any>;
      const secondAdoption = { ...structuredClone(adoptions[0]), adoptionId: "adopt_gmail_duplicate" };
      adoptions.push(secondAdoption);
      const commitment = (item: any) => { const { signedDeploymentBinding: _binding, ...body } = item; return connectionAdoptionCommitmentDigest(body); };
      const existing = copy.jobCard as any;
      const { signerId: _signer, signature: _signature, ...unsigned } = existing;
      const rebound = signJobCard({ ...unsigned, connectorIds: ["gmail", "gmail_secondary"], accountIdentities: [descriptor.account.identity, secondDescriptor.account.identity], connectionDescriptorDigests: descriptors.map(connectionDescriptorDigest).sort(), adoptionCommitmentDigests: adoptions.map(commitment).sort() }, "human_sponsor", privateKey);
      copy.jobCard = rebound;
      for (const item of adoptions) item.signedDeploymentBinding = signedJobCardDigest(rebound);
    }, /adoption descriptor set|adoption.*set/i);
    await expectRefusal(copy => {
      const item = (copy.connectionAdoptions as Array<Record<string, unknown>>)[0]!;
      item.mode = "managed"; item.rawWriteReachability = "refused"; item.secureConnectionCommitment = sha("6");
      const { signedDeploymentBinding: _binding, ...body } = item;
      const existing = copy.jobCard as any;
      const { signerId: _signer, signature: _signature, ...unsigned } = existing;
      const rebound = signJobCard({ ...unsigned, adoptionCommitmentDigests: [connectionAdoptionCommitmentDigest(body as never)] }, "human_sponsor", privateKey);
      copy.jobCard = rebound;
      item.signedDeploymentBinding = signedJobCardDigest(rebound);
    }, /managed.*topology/i);
    await writeFile(built.deploymentFile, JSON.stringify(original));
    const revoke = { v: "reelier.authority-trust-event/v1" as const, eventId: "trust_job_card_revoke", sequence: 1, action: "revoke" as const, keyDescriptorDigest: authority.signerKeyDescriptorDigest, occurredAt: "2026-01-02T00:00:00.000Z", previousEventDigest: authority.trustHeadDigest };
    const revokedPin = { ...built.jobCardTrustPin, trustEvents: [...built.jobCardTrustPin.trustEvents, revoke], trustHistoryDigest: authorityDigest([...built.jobCardTrustPin.trustEvents, revoke]), trustHeadDigest: authorityDigest(revoke) };
    await assert.rejects(() => loadAuthorityDeployment(built.deploymentFile, { jobCardTrustPin: revokedPin }), /revoked|currently active/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("deploy refuses the legacy approved auto-sign candidate", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-deploy-refuse-"));
  try {
    const file = path.join(root, "candidate.json");
    await writeFile(file, JSON.stringify({ v: "reelier.authority-deployment-candidate/v1", approved: true, job: unsignedJob, state: {}, connectors: [], trust: [], sourceDirectory: "sources" }));
    await assert.rejects(() => buildAuthorityDeployment(file, path.join(root, "deployment")), /signed job|closed|candidate/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});
