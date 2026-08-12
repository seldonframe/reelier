import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { authorityDigest, authorityCanonicalBytes, normalizeSignedJobCard, signJobCard, signedJobCardDigest, verifySignedJobCard, verifyAuthoritySignature } from "../../src/authority/index.js";
import { createSignedCertificationReadiness, parseAuthorityKeyDescriptor } from "../../src/authority/certification/authority.js";
import { gmailPackDigest } from "../../src/packs/gmail/index.js";
import { buildAuthorityDeployment } from "../../src/authority/host/deploy.js";
import { loadAuthorityDeployment } from "../../src/authority/host/deployment.js";
import { connectionAdoptionCommitmentDigest, connectionDescriptorDigest } from "../../src/connections.js";

const sha = (seed: string) => `sha256:${seed.repeat(64).slice(0, 64)}`;
const jobCardTrustPin = (publicKey: ReturnType<typeof generateKeyPairSync>["publicKey"]) => {
  const readinessSigner = generateKeyPairSync("ed25519");
  const cell = generateKeyPairSync("ed25519");
  const descriptor = parseAuthorityKeyDescriptor({ v: "reelier.authority-key-descriptor/v1", keyId: "human_sponsor", role: "human-sponsor", purpose: "signed-job-card", algorithm: "ed25519", publicKeySpkiBase64: publicKey.export({ type: "spki", format: "der" }).toString("base64") });
  const human = parseAuthorityKeyDescriptor({ v: "reelier.authority-key-descriptor/v1", keyId: `signer_${"e".repeat(24)}`, role: "human-sponsor", purpose: "certification-readiness", algorithm: "ed25519", publicKeySpkiBase64: readinessSigner.publicKey.export({ type: "spki", format: "der" }).toString("base64") });
  const cellDescriptor = parseAuthorityKeyDescriptor({ v: "reelier.authority-key-descriptor/v1", keyId: "cell_receipt_key", role: "authority-cell", purpose: "authority-receipt", algorithm: "ed25519", publicKeySpkiBase64: cell.publicKey.export({ type: "spki", format: "der" }).toString("base64") });
  const event = (sequence: number, item: any, previousEventDigest: string | null) => ({ v: "reelier.authority-trust-event/v1" as const, eventId: `trust_${sequence}_${"f".repeat(12)}`, sequence, action: "activate" as const, keyDescriptorDigest: authorityDigest(item), occurredAt: "2026-01-01T00:00:00.000Z", previousEventDigest });
  const first = event(0, human, null); const second = event(1, cellDescriptor, authorityDigest(first)); const third = event(2, descriptor, authorityDigest(second));
  const readiness: any = { v: "reelier.certification-readiness-candidate/v1", status: "awaiting-human-signature", preparationReady: true, signatureStatus: "absent", authorization: "absent", dispatchable: false, completeness: "unchecked", configDigest: sha("1"), selectionDigest: sha("2"), preflightDigest: "", scenarios: ["github-issue-labels"], identifiers: { taskId: `task_${"a".repeat(24)}`, jobCardId: `job_${"b".repeat(24)}`, rootGrantId: `grant_${"c".repeat(24)}`, authorityCellId: `cell_${"d".repeat(24)}`, signerId: human.keyId }, commitments: { resources: [], cleanup: [], credentials: [], runners: { status: "configured", artifacts: [] }, tests: { status: "configured", artifacts: [] }, topology: "absent", signatureStatus: "absent" } };
  const preflightBody: any = { v: "reelier.certification-preflight/v2", configDigest: readiness.configDigest, selectionDigest: readiness.selectionDigest, identifiers: readiness.identifiers, scenarios: readiness.scenarios, resources: [], cleanup: [], credentialReferences: [], inputs: { runners: readiness.commitments.runners, tests: readiness.commitments.tests }, topology: "absent", trust: "unchecked", signatureStatus: "absent", authorization: "absent", completeness: "unchecked", missing: [], ok: true, preparationReady: true };
  const preflight = { ...preflightBody, digest: authorityDigest(preflightBody) }; readiness.preflightDigest = preflight.digest;
  const keyDescriptors = [human, cellDescriptor, descriptor]; const readinessTrustEvents = [first, second, third];
  const signedReadiness = createSignedCertificationReadiness({ readinessCandidate: readiness, readinessCandidateDigest: authorityDigest(readiness), preflight, humanKeyDescriptor: human, cellKeyDescriptors: [cellDescriptor], jobCardKeyDescriptors: [descriptor], trustEvents: readinessTrustEvents, humanPrivateKey: readinessSigner.privateKey, authorizedAt: "2026-01-02T00:00:00.000Z" });
  return { v: "reelier.job-card-trust-pin/v1" as const, signedReadiness, readinessCandidate: readiness, preflight, humanTrustRoot: human, keyDescriptors, readinessTrustEvents, currentTrustEvents: readinessTrustEvents };
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
  packDigests: [gmailPackDigest],
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
  assert.throws(() => normalizeSignedJobCard({ ...card, packDigests: [gmailPackDigest, gmailPackDigest] }), /unique|duplicate/i);
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
    const trustPin = jobCardTrustPin(publicKey);
    assert.deepEqual(Object.keys(trustPin.preflight.inputs).sort(), ["endpoints", "plans", "runners", "tests"]);
    assert.equal(trustPin.preflight.executionReady, false);
    assert.equal(trustPin.preflight.dispatchable, false);
    await writeFile(path.join(candidateKeys, "operator.pem"), publicKey.export({ type: "spki", format: "pem" }));
    await writeFile(path.join(sourceDirectory, "thread.json"), '{"message":"hello"}\n');
    const contract = { v: "reelier.outcome-contract/v1", tenant: "tenant_1", alias: "gmail_reply_send_v1", contractId: "contract_1", validFrom: "2026-01-01T00:00:00.000Z", validUntil: "2027-01-01T00:00:00.000Z", packDigest: sha("e"), definitionDigest: sha("f"), sponsor: "operator", audiences: ["operator"], delegationGrantDigest: sha("1"), connectorId: "gmail", accountId: "gmail:owner@example.test", sourceAuthority: { resolverId: "gmail_thread", projectionSchemaId: "gmail.thread/v1", allowedReadEndpointIds: ["gmail.read"], authorizedProjectionPointers: ["/message"], maxFreshnessSeconds: 60 }, riskClasses: ["message"], limits: { maxEffectsPerWindow: 1, windowSeconds: 3600, maxEffectsPerSourceTrigger: 1, maxBodyBytes: 4096 }, policyCommitment: { schemaId: "policy/v1", jcsBase64: Buffer.from("{}\n").toString("base64"), digest: authorityDigest({}) } };
    const contractBytes = authorityCanonicalBytes(contract);
    const descriptor = { v: "reelier.connection-descriptor/v1", connectionId: "gmail", kind: "adopted-mcp-stdio", provider: { id: "gmail", toolServerName: "gmail-mcp" }, callableRoute: { kind: "mcp-stdio", routeId: "route.gmail", endpointIds: ["gmail.read", "gmail.send"] }, account: { status: "verified", identity: "gmail:owner-example-test" }, toolSchemas: [{ toolName: "gmail.read", digest: sha("7") }, { toolName: "gmail.send", digest: sha("8") }], secretOwner: "host", coverage: { v: "reelier.host-coverage/v1", host: "codex", observation: "observed", outcomeInvocation: "supported", exclusiveEnforcement: "unknown", limitations: ["raw-write-reachability-unmeasured"] } } as const;
    const adoptionBody = { v: "reelier.connection-adoption/v1" as const, adoptionId: "adopt_gmail", descriptorDigest: connectionDescriptorDigest(descriptor), selectedAccountIdentity: descriptor.account.identity, mode: "existing" as const, sidecarRouteId: descriptor.callableRoute.routeId, rawWriteReachability: "reachable" as const, activationState: "active" as const, secureConnectionCommitment: null };
    const jobCard = signJobCard({ ...unsignedJob, connectionDescriptorDigests: [connectionDescriptorDigest(descriptor)], adoptionCommitmentDigests: [connectionAdoptionCommitmentDigest(adoptionBody)] }, "human_sponsor", privateKey);
    const adoption = { ...adoptionBody, signedDeploymentBinding: signedJobCardDigest(jobCard) };
    const candidate = { v: "reelier.authority-deployment-candidate/v1", jobCard, connectionDescriptors: [descriptor], connectionAdoptions: [adoption], state: { tenant: "tenant_1", definitionAlias: "gmail_reply_send_v1", stateVersion: 1, candidates: [{ contractEnvelope: { canonicalBase64: contractBytes.toString("base64"), advertisedDigest: authorityDigest(contract), signerId: "operator", signature: { alg: "ed25519", sig: Buffer.alloc(64, 1).toString("base64") } }, delegationEnvelopes: [], stateEvents: [{ index: 0, kind: "activated", contractDigest: authorityDigest(contract), at: "2026-01-01T00:00:00.000Z" }] }] }, connectors: [{ tenant: "tenant_1", connectorId: "gmail", accountId: "acct_1", providerAccountIdentity: descriptor.account.identity, allowedReadEndpointIds: ["gmail.read"], allowedWriteEndpointIds: ["gmail.send"], riskClasses: ["message"], operatorConfigurationDigest: sha("5") }], trust: [{ signerId: "operator", principalId: "operator", publicKeyFile: "keys/operator.pem", purposes: ["outcome-contract"] }], sourceDirectory: "sources" };
    const candidateFile = path.join(candidateRoot, "candidate.json");
    await writeFile(candidateFile, `${JSON.stringify(candidate)}\n`);
    await assert.rejects(() => buildAuthorityDeployment(candidateFile, path.join(root, "deployments", "missing-pin")), /host.pinned|trust pin/i);
    const built = await buildAuthorityDeployment(candidateFile, path.join(root, "deployments", "customer_reply"), trustPin);
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
    const signerDigest = authorityDigest(trustPin.keyDescriptors.find(item => item.keyId === "human_sponsor")!);
    const previous = trustPin.currentTrustEvents[trustPin.currentTrustEvents.length - 1]!;
    const revoke = { v: "reelier.authority-trust-event/v1" as const, eventId: "trust_job_card_revoke", sequence: trustPin.currentTrustEvents.length, action: "revoke" as const, keyDescriptorDigest: signerDigest, occurredAt: "2026-01-03T00:00:00.000Z", previousEventDigest: authorityDigest(previous) };
    const revokedPin = { ...built.jobCardTrustPin, currentTrustEvents: [...built.jobCardTrustPin.currentTrustEvents, revoke] };
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
