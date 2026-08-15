import { createPublicKey, generateKeyPairSync, type KeyObject } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { authorityCanonicalBytes, authorityDigest, parseAuthorityWire } from "../../src/authority/wire.js";
import { signAuthorityDigest } from "../../src/authority/crypto.js";
import { definitionRegistrationDigest } from "../../src/authority/pack.js";
import { createFirstPartyPackRegistry } from "../../src/packs/index.js";
import {
  githubIssueLabelsAlias,
  githubIssueLabelsDefinitionDigest,
  githubIssueLabelsPackDigest,
} from "../../src/packs/github/manifest.js";
import {
  OUTCOME_PROFILE_CONTRACT_V1_DIGEST,
  type OutcomeProfileDraftV1,
  type ProfileConformanceReportV1,
  type ProfileTrustPinV1,
  type SignedOutcomeProfileConformanceV1,
  type SignedTenantProfileActivationV1,
} from "../../src/authority/outcome-profile.js";
import { createCertificationLifecycleAuthorityCeremony, createCertificationArtifactKeyBinding, consumeCertificationLifecycleAuthority, registerCertificationLifecycleTrustContext } from "../../src/authority/certification/lifecycle-authority.js";
import { createSignedCertificationReadiness } from "../../src/authority/certification/authority.js";
import { certificationRunnerRegistryDigest } from "../../src/authority/certification/runner-registry.js";
import { signAuthorityDigest as signDigest } from "../../src/authority/crypto.js";
import type { AuthorityReceiptSigningAuthorityV1 } from "../../src/authority/host/receipt-authority.js";
import { signJobCard, signedJobCardDigest } from "../../src/authority/job.js";
import { jobCardTrustMaterialFromPin } from "../../src/authority/host/deployment.js";
import { connectorRegistrationDigest, createConnectorRegistry } from "../../src/authority/connector.js";
import { createTrustRoots, trustRootSetDigest } from "../../src/authority/trust.js";
import { parseAuthorityDeploymentSnapshot, parseAuthorityRouteScope } from "../../src/authority/outcome-profile.js";
import { createProfileVerificationRoots } from "../../src/authority/outcome-profile.js";
import { canonicalizeJsonHttpsRoute, jsonHttpsRouteDigest } from "../../src/authority/host/json-https-route.js";
import { githubIssueLabelsPolicySchemaId, githubIssueLabelsProjectionSchemaId, githubIssueLabelsReadEndpointId, githubIssueLabelsResolverId, githubIssueLabelsRiskClass, githubIssueLabelsWriteEndpointId } from "../../src/packs/github/manifest.js";
import { createPreparedDispatch } from "../../src/authority/host/prepared-dispatch.js";
import { buildMaterializedHttpRequestProjection } from "../../src/authority/drivers/json-https.js";
import { connectionAdoptionCommitmentDigest, connectionDescriptorDigest, digestNormalizedMcpToolSchemas } from "../../src/connections.js";

const certifier = generateKeyPairSync("ed25519");
const operator = generateKeyPairSync("ed25519");
export const packs = createFirstPartyPackRegistry();
export const governanceRef = "github_labels_governance_1";
export const tenant = "tenant_1";
export const verificationTime = new Date("2026-08-14T12:00:00.000Z");
export const sha = (character: string) => `sha256:${character.repeat(64)}`;
export const spki = (key: KeyObject) => key.export({ type: "spki", format: "der" }).toString("base64");

function signArtifact<T extends Readonly<Record<string, unknown>>>(artifact: T, purpose: "profile-conformance" | "profile-activation", key: KeyObject) {
  return signAuthorityDigest(key, "authority-evidence", authorityDigest({
    v: "reelier.outcome-profile-signature-preimage/v1",
    purpose,
    artifactDigest: authorityDigest(artifact),
  }));
}

function trustKeyDigest(signerId: string, purpose: "profile-conformance" | "profile-activation", publicKeySpkiBase64: string): string {
  return authorityDigest({ v: "reelier.outcome-profile-trust-key/v1", tenant, governanceRef, signerId, purpose, publicKeySpkiBase64 });
}

function eventHead(events: readonly ProfileTrustPinV1["currentTrustEvents"][number][]): string {
  let head = "";
  for (const event of events) {
    const eventDigest = authorityDigest({ v: "reelier.outcome-profile-trust-event/v1", tenant, governanceRef, index: event.index, action: event.action, keyPurpose: event.keyPurpose, keyDigest: event.keyDigest, at: event.at, previousHeadDigest: event.previousHeadDigest });
    head = authorityDigest({ v: "reelier.outcome-profile-trust-head/v1", tenant, governanceRef, index: event.index, previousHeadDigest: event.previousHeadDigest, eventDigest });
  }
  return head;
}

export function profileGovernanceFixture(
  activationOverrides: Partial<Pick<SignedTenantProfileActivationV1, "jobCardDigest" | "contractDigest" | "deploymentDigest" | "routeScopeDigest" | "authorityTrustHeadDigest" | "validFrom" | "validUntil">> = {},
  draftOverrides: Partial<Pick<OutcomeProfileDraftV1, "provider">> = {},
) {
  const first = { index: 0, action: "activate" as const, keyPurpose: "profile-conformance" as const, keyDigest: trustKeyDigest("certifier_1", "profile-conformance", spki(certifier.publicKey)), at: "2026-08-14T10:00:00.000Z", previousHeadDigest: null };
  const events = [first, { index: 1, action: "activate" as const, keyPurpose: "profile-activation" as const, keyDigest: trustKeyDigest("operator_1", "profile-activation", spki(operator.publicKey)), at: "2026-08-14T10:01:00.000Z", previousHeadDigest: eventHead([first]) }];
  const trustHeadDigest = eventHead(events);
  const trustPin: ProfileTrustPinV1 = { v: "reelier.outcome-profile-trust-pin/v1", tenant, governanceRef, certifier: { signerId: "certifier_1", purpose: "profile-conformance", publicKeySpkiBase64: spki(certifier.publicKey) }, operator: { signerId: "operator_1", purpose: "profile-activation", publicKeySpkiBase64: spki(operator.publicKey) }, currentTrustEvents: events, currentTrustEventsDigest: authorityDigest({ v: "reelier.outcome-profile-trust-events/v1", tenant, governanceRef, events }), trustHeadDigest };
  const draft: OutcomeProfileDraftV1 = { v: "reelier.outcome-profile-draft/v1", profileId: "github_labels_profile_1", profileVersion: "1.0.0", status: "draft", authorization: "absent", conformance: "unchecked", dispatchable: false, provider: "github", packAlias: githubIssueLabelsAlias, packDigest: githubIssueLabelsPackDigest, definitionDigest: githubIssueLabelsDefinitionDigest, definitionRegistrationDigest: definitionRegistrationDigest(packs, githubIssueLabelsAlias), accountProbeDigest: sha("1"), sourceAuthorityDigest: sha("2"), argumentAuthorityDigest: sha("3"), semanticIdentityDigest: sha("4"), responseSemanticsProfileDigest: sha("5"), reconciliationRecipeDigest: sha("6"), topologyRequirementsDigest: sha("7"), conformanceVectorSetDigest: sha("8"), nonClaims: { contentCorrectness: "not-proved", providerCertification: "not-proved", safety: "not-proved", trafficCompleteness: "not-proved" }, ...draftOverrides };
  const report: ProfileConformanceReportV1 = { v: "reelier.outcome-profile-conformance-report/v1", profileDigest: authorityDigest(draft), packDigest: draft.packDigest, definitionDigest: draft.definitionDigest, definitionRegistrationDigest: draft.definitionRegistrationDigest, harnessId: "github_labels_harness_1", harnessDigest: sha("9"), vectorSetDigest: draft.conformanceVectorSetDigest, sourceRevision: "315b896e4a4c8aa38e4b4eb70fbd9ea9624e20b1", checks: [{ checkId: "account_binding", vectorDigest: sha("a"), status: "passed", evidenceDigest: sha("b") }, { checkId: "reconciliation", vectorDigest: sha("c"), status: "passed", evidenceDigest: sha("d") }], claims: { closure: "verified", determinism: "verified", accountBinding: "verified", noSecrets: "verified", reconciliation: "verified" } };
  const unsignedConformance = { v: "reelier.outcome-profile-conformance/v1" as const, tenant, profileDigest: authorityDigest(draft), packDigest: draft.packDigest, definitionDigest: draft.definitionDigest, definitionRegistrationDigest: draft.definitionRegistrationDigest, harnessId: report.harnessId, harnessDigest: report.harnessDigest, vectorSetDigest: draft.conformanceVectorSetDigest, reportDigest: authorityDigest(report), sourceRevision: report.sourceRevision, claims: report.claims, signerId: "certifier_1" };
  const conformance: SignedOutcomeProfileConformanceV1 = { ...unsignedConformance, signature: signArtifact(unsignedConformance, "profile-conformance", certifier.privateKey) };
  const unsignedActivation = { v: "reelier.outcome-profile-activation/v1" as const, tenant, activationId: "activation_1", profileDigest: authorityDigest(draft), conformanceDigest: authorityDigest(conformance), jobCardDigest: sha("e"), contractDigest: OUTCOME_PROFILE_CONTRACT_V1_DIGEST, deploymentDigest: sha("f"), routeScopeDigest: sha("7"), trustHeadDigest, authorityTrustHeadDigest: sha("8"), validFrom: "2026-08-14T11:00:00.000Z", validUntil: "2026-08-14T13:00:00.000Z", ...activationOverrides, state: "activated" as const, signerId: "operator_1" };
  const activation: SignedTenantProfileActivationV1 = { ...unsignedActivation, signature: signArtifact(unsignedActivation, "profile-activation", operator.privateKey) };
  const manifest = { v: "reelier.outcome-profile-governance-manifest/v1" as const, tenant, governanceRef, profileDigest: authorityDigest(draft), conformanceDigest: authorityDigest(conformance), activationDigest: authorityDigest(activation), conformanceReportDigest: authorityDigest(report), trustPinDigest: authorityDigest(trustPin), trustHeadDigest };
  return { draft, report, conformance, activation, trustPin, manifest, manifestDigest: authorityDigest(manifest), packs, certifier, operator };
}

export async function writeProfileGovernanceFixture(homedir: string, activationOverrides: Parameters<typeof profileGovernanceFixture>[0] = {}, draftOverrides: Parameters<typeof profileGovernanceFixture>[1] = {}) {
  const fixture = profileGovernanceFixture(activationOverrides, draftOverrides);
  const root = path.join(homedir, ".reelier", "trust", "outcome-profiles", tenant, governanceRef);
  await mkdir(root, { recursive: true });
  await Promise.all([
    ["trust-pin.json", fixture.trustPin],
    ["manifest.json", fixture.manifest],
    ["profile.json", fixture.draft],
    ["conformance-report.json", fixture.report],
    ["conformance.json", fixture.conformance],
    ["activation.json", fixture.activation],
  ].map(([name, value]) => writeFile(path.join(root, String(name)), `${JSON.stringify(value)}\n`, { flag: "wx" })));
  return { ...fixture, root };
}

export type DispatchCounters = {
  sourceReads: number;
  credentialReads: number;
  reservations: number;
  preparedSends: number;
  providerWrites: number;
};

export function createDispatchCounters(): DispatchCounters {
  return { sourceReads: 0, credentialReads: 0, reservations: 0, preparedSends: 0, providerWrites: 0 };
}

/** Inert shared fixture: it registers no tests and retains every private key inside signer callbacks. */
export function governedReceiptSigningFixture(now = verificationTime) {
  const observedAt = new Date(now.getTime() - 300_000).toISOString(), expiresAt = new Date(now.getTime() + 3_600_000).toISOString();
  const ceremony = createCertificationLifecycleAuthorityCeremony();
  const readinessKey = generateKeyPairSync("ed25519"), jobKey = generateKeyPairSync("ed25519"), gateKey = generateKeyPairSync("ed25519");
  const human: any = { v: "reelier.authority-key-descriptor/v1", keyId: `signer_${"e".repeat(24)}`, role: "human-sponsor", purpose: "certification-readiness", algorithm: "ed25519", publicKeySpkiBase64: spki(readinessKey.publicKey) };
  const job: any = { v: "reelier.authority-key-descriptor/v1", keyId: "job_human", role: "human-sponsor", purpose: "signed-job-card", algorithm: "ed25519", publicKeySpkiBase64: spki(jobKey.publicKey) };
  const gate: any = { v: "reelier.authority-key-descriptor/v1", keyId: "local-gate", role: "authority-cell", purpose: "gate-event", algorithm: "ed25519", publicKeySpkiBase64: spki(gateKey.publicKey) };
  const identifiers = { taskId: `task_${"a".repeat(24)}`, jobCardId: `job_${"b".repeat(24)}`, rootGrantId: `grant_${"c".repeat(24)}`, authorityCellId: `cell_${"d".repeat(24)}`, signerId: human.keyId };
  const emptyInput = Object.freeze({ status: "configured" as const, artifacts: Object.freeze([]) });
  const commitments = Object.freeze({ resources: Object.freeze([]), cleanup: Object.freeze([]), credentials: Object.freeze([]), runners: emptyInput, tests: emptyInput, plans: emptyInput, endpoints: emptyInput, runnerRegistryDigest: certificationRunnerRegistryDigest, topology: "absent" as const, signatureStatus: "absent" as const });
  const readiness: any = { v: "reelier.certification-readiness-candidate/v1", status: "awaiting-human-signature", preparationReady: true, signatureStatus: "absent", authorization: "absent", dispatchable: false, completeness: "unchecked", configDigest: sha("1"), selectionDigest: sha("2"), preflightDigest: "", scenarios: ["github-issue-labels"], identifiers, commitments };
  const preflightBody = { v: "reelier.certification-preflight/v2" as const, configDigest: readiness.configDigest, selectionDigest: readiness.selectionDigest, identifiers, scenarios: readiness.scenarios, resources: commitments.resources, cleanup: commitments.cleanup, credentialReferences: commitments.credentials, inputs: { runners: commitments.runners, tests: commitments.tests, plans: commitments.plans, endpoints: commitments.endpoints }, runnerRegistryDigest: commitments.runnerRegistryDigest, topology: commitments.topology, trust: "unchecked" as const, signatureStatus: "absent" as const, authorization: "absent" as const, completeness: "unchecked" as const, missing: Object.freeze([]), ok: true, preparationReady: true, executionReady: false as const, dispatchable: false as const };
  const preflight = Object.freeze({ ...preflightBody, digest: authorityDigest(preflightBody) }); readiness.preflightDigest = preflight.digest;
  const descriptors: any[] = [human, job, gate, ...ceremony.publicDescriptors.filter(item => item.purpose !== "gate-event")];
  const events: any[] = [];
  for (const descriptor of descriptors) { const sequence = events.length; events.push({ v: "reelier.authority-trust-event/v1", eventId: `trust_${sequence}_${"f".repeat(12)}`, sequence, action: "activate", keyDescriptorDigest: authorityDigest(descriptor), occurredAt: observedAt, previousEventDigest: sequence ? authorityDigest(events[sequence - 1]) : null }); }
  const signedReadiness = createSignedCertificationReadiness({ readinessCandidate: readiness, readinessCandidateDigest: authorityDigest(readiness), preflight, humanKeyDescriptor: human, cellKeyDescriptors: descriptors.filter(item => item.role === "authority-cell"), jobCardKeyDescriptors: [job], trustEvents: events, humanPrivateKey: readinessKey.privateKey, authorizedAt: new Date(now.getTime() - 240_000).toISOString() });
  const pin: any = Object.freeze({ v: "reelier.job-card-trust-pin/v1", signedReadiness, readinessCandidate: readiness, preflight, humanTrustRoot: human, keyDescriptors: Object.freeze(descriptors), readinessTrustEvents: Object.freeze(events), currentTrustEvents: Object.freeze(events) });
  const bound = createCertificationArtifactKeyBinding(ceremony.opaqueHandle, { authorityCellId: identifiers.authorityCellId, taskId: identifiers.taskId, readinessDigest: authorityDigest(signedReadiness), humanDescriptor: human, humanPrivateKey: readinessKey.privateKey, issuedAt: observedAt, expiresAt });
  const material = consumeCertificationLifecycleAuthority(ceremony.opaqueHandle, bound.binding, bound.humanCommitment, { authorityCellId: identifiers.authorityCellId, taskId: identifiers.taskId, readinessDigest: authorityDigest(signedReadiness), descriptors, humanDescriptor: human, now });
  registerCertificationLifecycleTrustContext(material,{jobCardTrustPin:pin,expectedAuthorityCellId:identifiers.authorityCellId,expectedTaskId:identifiers.taskId,observedAt:now});
  const signer = (purpose: string, key: any) => Object.freeze({ purpose, signerId: key.descriptor.keyId, publicKey: createPublicKey(key.privateKey), async sign(input: any) { return signDigest(key.privateKey, input.purpose, input.digest); } });
  const receiptSigningAuthority: AuthorityReceiptSigningAuthorityV1 = Object.freeze({ artifactAuthorization: { binding: bound.binding, commitment: bound.humanCommitment }, sourceBundle: signer("source-bundle", material.artifacts.get("source-bundle")!), compiledCapability: signer("compiled-capability", material.artifacts.get("compiled-capability")!), transportEffect: signer("transport-effect", material.artifacts.get("transport-effect")!), evidence: signer("authority-evidence", material.direct.get("authority-evidence")!), receipt: signer("authority-receipt", material.direct.get("authority-receipt")!), packManifest: signer("pack-manifest", material.artifacts.get("pack-manifest")!) } as AuthorityReceiptSigningAuthorityV1);
  return { ceremony, material, pin, identifiers, human, job, jobKey, gate, gateKey, receiptSigningAuthority, observedAt, expiresAt };
}

export async function writeGovernedPublicFactoryFixture(home: string, overrides: Readonly<{ profileProvider?: OutcomeProfileDraftV1["provider"] }> = {}) {
  const now = new Date(), signing = governedReceiptSigningFixture(now), authorityRoot = path.join(home, "authority");
  const deploymentRoot = path.join(authorityRoot, "deployment"), keysRoot = path.join(deploymentRoot, "keys"), sourceRoot = path.join(deploymentRoot, "sources");
  await mkdir(keysRoot, { recursive: true }); await mkdir(sourceRoot, { recursive: true });
  const direct = (purpose: "outcome-contract" | "delegation-grant" | "authority-evidence" | "authority-receipt") => signing.material.direct.get(purpose)!;
  const contractKey = direct("outcome-contract"), delegationKey = direct("delegation-grant"), evidenceKey = direct("authority-evidence"), receiptKey = direct("authority-receipt");
  const keyRows = [
    ["contract.pem", contractKey.descriptor, createPublicKey(contractKey.privateKey), ["outcome-contract"]],
    ["delegation.pem", delegationKey.descriptor, createPublicKey(delegationKey.privateKey), ["delegation-grant"]],
    ["gate.pem", signing.gate, signing.gateKey.publicKey, ["gate-event"]],
    ["evidence.pem", evidenceKey.descriptor, createPublicKey(evidenceKey.privateKey), ["authority-evidence"]],
    ["receipt.pem", receiptKey.descriptor, createPublicKey(receiptKey.privateKey), ["authority-receipt"]],
  ] as const;
  for (const [name, , key] of keyRows) await writeFile(path.join(keysRoot, name), key.export({ type: "spki", format: "pem" }));
  const connector = { tenant, connectorId: "github", accountId: "123", providerAccountIdentity: "github:fixture", allowedReadEndpointIds: [githubIssueLabelsReadEndpointId], allowedWriteEndpointIds: [githubIssueLabelsWriteEndpointId], riskClasses: [githubIssueLabelsRiskClass], operatorConfigurationDigest: sha("c") };
  const connectionDescriptor = { v: "reelier.connection-descriptor/v1" as const, connectionId: "github", kind: "adopted-mcp-stdio" as const, provider: { id: "github", toolServerName: "github-mcp" }, callableRoute: { kind: "mcp-stdio" as const, routeId: "route.github", endpointIds: [githubIssueLabelsReadEndpointId, githubIssueLabelsWriteEndpointId] }, account: { status: "verified" as const, identity: connector.providerAccountIdentity }, toolSchemas: digestNormalizedMcpToolSchemas([{ name: githubIssueLabelsReadEndpointId, inputSchema: {} }, { name: githubIssueLabelsWriteEndpointId, inputSchema: {} }]), secretOwner: "host" as const, coverage: { v: "reelier.host-coverage/v1" as const, host: "codex", observation: "observed" as const, outcomeInvocation: "supported" as const, exclusiveEnforcement: "unknown" as const, limitations: ["raw-write-reachability-unmeasured"] } };
  const adoptionBody = { v: "reelier.connection-adoption/v1" as const, adoptionId: "adopt_github", descriptorDigest: connectionDescriptorDigest(connectionDescriptor), selectedAccountIdentity: connectionDescriptor.account.identity, mode: "existing" as const, sidecarRouteId: connectionDescriptor.callableRoute.routeId, rawWriteReachability: "reachable" as const, activationState: "active" as const, secureConnectionCommitment: null };
  const limits = { maxEffectsPerWindow: 2, windowSeconds: 3600, maxEffectsPerSourceTrigger: 1, maxBodyBytes: 4096 };
  const grant = { v: "reelier.delegation-grant/v1", tenant, grantId: "grant_1", parentDigest: null, sponsor: "operator", grantor: signing.identifiers.authorityCellId, grantee: signing.identifiers.authorityCellId, issuedAt: signing.observedAt, expiresAt: signing.expiresAt, constraints: { definitionAliases: [githubIssueLabelsAlias], audiences: ["operator"], connectorAccounts: [{ connectorId: "github", accountId: "123" }], projectionPointers: ["/owner", "/repo", "/issueNumber", "/issueState", "/labels"], riskClasses: [githubIssueLabelsRiskClass], limits } };
  const grantDigest = authorityDigest(grant), policy = { desiredLabels: ["after"] };
  const contract = { v: "reelier.outcome-contract/v1", tenant, alias: githubIssueLabelsAlias, contractId: "contract_1", validFrom: signing.observedAt, validUntil: signing.expiresAt, packDigest: githubIssueLabelsPackDigest, definitionDigest: githubIssueLabelsDefinitionDigest, sponsor: "operator", audiences: ["operator"], delegationGrantDigest: grantDigest, connectorId: "github", accountId: "123", sourceAuthority: { resolverId: githubIssueLabelsResolverId, projectionSchemaId: githubIssueLabelsProjectionSchemaId, allowedReadEndpointIds: [githubIssueLabelsReadEndpointId], authorizedProjectionPointers: ["/owner", "/repo", "/issueNumber", "/issueState", "/labels"], maxFreshnessSeconds: 60 }, riskClasses: [githubIssueLabelsRiskClass], limits, policyCommitment: { schemaId: githubIssueLabelsPolicySchemaId, jcsBase64: authorityCanonicalBytes(policy).toString("base64"), digest: authorityDigest(policy) } };
  const contractDigest = authorityDigest(contract);
  const jobCard = signJobCard({ v: "reelier.signed-job-card/v1", jobId: signing.identifiers.jobCardId, title: "Governed labels", taskShapeDigest: sha("a"), semanticClasses: ["record_state_set_v1"], definitionAliases: [githubIssueLabelsAlias], connectorIds: ["github"], accountIdentities: ["github:fixture"], connectionDescriptorDigests: [connectionDescriptorDigest(connectionDescriptor)], adoptionCommitmentDigests: [connectionAdoptionCommitmentDigest(adoptionBody)], sourceRefs: ["issue"], audiences: ["operator"], limitsDigest: authorityDigest(limits), instructionsDigest: sha("4"), packDigests: [githubIssueLabelsPackDigest], exceptionPolicy: ["ambiguous-reconcile"], coverage: "declared-surface" }, signing.job.keyId, signing.jobKey.privateKey);
  const connectionAdoption = { ...adoptionBody, signedDeploymentBinding: signedJobCardDigest(jobCard) };
  const state = { tenant, definitionAlias: githubIssueLabelsAlias, stateVersion: 1, candidates: [{ contractEnvelope: { canonicalBase64: authorityCanonicalBytes(contract).toString("base64"), advertisedDigest: contractDigest, signerId: contractKey.descriptor.keyId, signature: signDigest(contractKey.privateKey, "outcome-contract", contractDigest) }, delegationEnvelopes: [{ index: 0, canonicalBase64: authorityCanonicalBytes(grant).toString("base64"), advertisedDigest: grantDigest, signerId: delegationKey.descriptor.keyId, signature: signDigest(delegationKey.privateKey, "delegation-grant", grantDigest) }], stateEvents: [{ index: 0, kind: "activated", contractDigest, at: signing.observedAt }] }] };
  const enforcement = { completeness: "unchecked", declaredSurfaceExclusiveEnforcement: "unchecked", bypasses: ["equivalent-raw-write-route-reachable"] };
  const jobCardAuthority = jobCardTrustMaterialFromPin(jobCard, signing.pin).material;
  const trust = keyRows.map(([name, descriptor, , purposes]) => ({ signerId: descriptor.keyId, principalId: signing.identifiers.authorityCellId, publicKeyFile: `keys/${name}`, purposes }));
  const deployment = { v: "reelier.authority-deployment/v1", tenant, states: [state], connectors: [connector], trust, sourceDirectory: "sources", jobCard, jobCardAuthority, connectionDescriptors: [connectionDescriptor], connectionAdoptions: [connectionAdoption], enforcement };
  const deploymentPath = path.join(deploymentRoot, "deployment.json"), pinPath = path.join(authorityRoot, "trust", "job-card-trust-pin.json"), gateKeyFile = path.join(authorityRoot, "keys", "local-gate.pem");
  await mkdir(path.dirname(pinPath), { recursive: true }); await mkdir(path.dirname(gateKeyFile), { recursive: true });
  await writeFile(deploymentPath, `${JSON.stringify(deployment)}\n`); await writeFile(pinPath, `${JSON.stringify(signing.pin)}\n`); await writeFile(gateKeyFile, signing.gateKey.privateKey.export({ type: "pkcs8", format: "pem" }));
  await writeFile(path.join(sourceRoot, "issue_1.json"), `${JSON.stringify({ owner: "fixlyai", repo: "reelier", issueNumber: 1, issueState: "open", labels: ["before"] })}\n`);
  const projectionSchemaDigest = authorityDigest({ schemaId: githubIssueLabelsProjectionSchemaId, pointers: ["/labels"] }), egressPolicyDigest = sha("5");
  const readRoute = canonicalizeJsonHttpsRoute({ v: "reelier.json-https-route/v1", providerId: "github", connectorId: "github", accountId: "123", providerAccountIdentity: "github:fixture", endpointId: githubIssueLabelsReadEndpointId, origin: "https://api.github.com", allowedMethods: ["GET"], allowedPathPrefixes: ["/repos/fixlyai/reelier/issues/1"], credentialSlotId: "slot_1", responseSemanticsProfileId: "github.issue-labels.v1", reconciliationRecipeId: "github_issue_labels_read_v1", readEndpointId: githubIssueLabelsReadEndpointId, egressPolicyDigest, projectionSchemaDigest });
  const writeRoute = canonicalizeJsonHttpsRoute({ ...readRoute, endpointId: githubIssueLabelsWriteEndpointId, allowedMethods: ["PUT"], allowedPathPrefixes: ["/repos/fixlyai/reelier/issues/1/labels"], reconciliationRecipeId: "github_issue_labels_readback_v1" });
  const registry = createConnectorRegistry([connector]), routeScope = parseAuthorityRouteScope({ v: "reelier.authority-route-scope/v1", tenant, definitionAlias: githubIssueLabelsAlias, connectorRegistrationDigest: connectorRegistrationDigest(registry, tenant, "github", "123"), operatorConfigurationDigest: connector.operatorConfigurationDigest, routeDigest: jsonHttpsRouteDigest(writeRoute), providerId: "github", connectorId: "github", accountId: "123", providerAccountIdentity: "github:fixture", endpointId: githubIssueLabelsWriteEndpointId, credentialSlotId: "slot_1", sourceReadRouteDigest: jsonHttpsRouteDigest(readRoute), projectionSchemaDigest });
  const directRoots = keyRows.map(([, descriptor, key, purposes]) => ({ tenant, signerId: descriptor.keyId, principalId: signing.identifiers.authorityCellId, publicKey: key, purposes } as any));
  const deploymentSnapshot = parseAuthorityDeploymentSnapshot({ v: "reelier.authority-deployment-snapshot/v1", tenant, jobCardDigest: signedJobCardDigest(jobCard), jobCardAuthorityDigest: authorityDigest(jobCardAuthority), authorityStateDigest: authorityDigest(state), connectorRegistryDigest: authorityDigest([connectorRegistrationDigest(registry, tenant, "github", "123")]), trustRootSetDigest: trustRootSetDigest(createTrustRoots(directRoots), tenant), connectionDescriptorsDigest: authorityDigest([connectionDescriptor]), connectionAdoptionsDigest: authorityDigest([connectionAdoption]), enforcementDigest: authorityDigest(enforcement), routeScopeDigest: authorityDigest(routeScope) });
  const profile = await writeProfileGovernanceFixture(home, { jobCardDigest: signedJobCardDigest(jobCard), contractDigest, deploymentDigest: authorityDigest(deploymentSnapshot), routeScopeDigest: authorityDigest(routeScope), authorityTrustHeadDigest: authorityDigest(signing.pin.currentTrustEvents.at(-1)), validFrom: signing.observedAt, validUntil: signing.expiresAt }, overrides.profileProvider === undefined ? {} : { provider: overrides.profileProvider });
  const identityKey = generateKeyPairSync("ed25519"), slotExpiresAt = signing.expiresAt, providerBody = { v: "reelier.authenticated-provider-identity/v1" as const, providerId: "github" as const, credentialSlotId: "slot_1", slotInstanceId: "instance_1", slotVersion: "version_1", slotExpiresAt, providerAccountId: "123", providerLogin: "fixture", routeDigest: jsonHttpsRouteDigest(writeRoute), observedAt: now.toISOString() };
  const providerIdentity = Object.freeze({ ...providerBody, signerId: "provider_identity", signature: signDigest(identityKey.privateKey, "authority-evidence", authorityDigest(providerBody)) });
  const body = authorityCanonicalBytes({ labels: ["after"] }), endpoint = { endpointId: githubIssueLabelsWriteEndpointId, baseUrl: writeRoute.origin, allowedMethods: writeRoute.allowedMethods, allowedPathPrefixes: writeRoute.allowedPathPrefixes, accountIdentity: writeRoute.providerAccountIdentity };
  const projection = buildMaterializedHttpRequestProjection(endpoint, "PUT", "/repos/fixlyai/reelier/issues/1/labels", "", { "Content-Type": "application/json" }, body), expectedMaterializedRequestDigest = authorityDigest(projection);
  const routeAuthority = Object.freeze({ v: "reelier.route-authority-snapshot/v1" as const, connectorRegistrationDigest: routeScope.connectorRegistrationDigest, operatorConfigurationDigest: routeScope.operatorConfigurationDigest, routeDigest: routeScope.routeDigest, providerId: routeScope.providerId, connectorId: routeScope.connectorId, accountId: routeScope.accountId, providerAccountIdentity: routeScope.providerAccountIdentity, endpointId: routeScope.endpointId, credentialSlotId: routeScope.credentialSlotId, slotInstanceId: "instance_1", slotVersion: "version_1", authenticatedProviderIdentityDigest: authorityDigest(providerBody), sourceReadRouteDigest: routeScope.sourceReadRouteDigest, projectionSchemaDigest: routeScope.projectionSchemaDigest, expectedMaterializedRequestDigest, authorityGeneration: authorityDigest(state), authorityExpiresAt: slotExpiresAt });
  let activeRouteAuthority = routeAuthority;
  const options: any = {
    receiptSigningAuthority: signing.receiptSigningAuthority,
    sourceReadAdapter: { async execute(plans: readonly any[]) { return { ok: true, observations: plans.map(plan => ({ planDigest: plan.planDigest, rawBytes: Buffer.from(JSON.stringify({ owner: "fixlyai", repo: "reelier", issueNumber: 1, state: "open", labels: ["before"] })) })) }; } },
    routeAuthority: (input: any) => (activeRouteAuthority = Object.freeze({ ...routeAuthority, authorityGeneration: input.authorityGeneration, authorityExpiresAt: input.authorityExpiresAt })),
    authenticatedProviderIdentity: async () => providerIdentity,
    verifyAuthenticatedProviderIdentity: { purpose: "authority-evidence", signerId: "provider_identity", publicKey: identityKey.publicKey },
    dispatchAdapter: { async prepare(stateValue: any) { const reservedRoute = stateValue.reservation.intent.routeAuthority; return createPreparedDispatch({ description: { v: "reelier.prepared-dispatch-description/v1", routeDigest: reservedRoute.routeDigest, materializedRequestDigest: expectedMaterializedRequestDigest, projection, authorityGeneration: reservedRoute.authorityGeneration, authorityExpiresAt: reservedRoute.authorityExpiresAt, absoluteDeadlineMs: performance.now() + 60_000, reservationId: stateValue.reservation.reservationId, allocationId: stateValue.reservation.intent.executionContext?.allocationId ?? "allocation_1" }, send: async () => ({ kind: "acknowledged", resultDigest: sha("f"), materializedRequestDigest: expectedMaterializedRequestDigest }) }); }, async dispatch() { throw new Error("legacy dispatch path must not run"); } },
    certifiedDispatch: { identityProbe: async () => providerIdentity, verifyIdentity: { purpose: "authority-evidence", signerId: "provider_identity", publicKey: identityKey.publicKey }, revalidator: { async revalidate() { return { authorityGeneration: activeRouteAuthority.authorityGeneration, authorityExpiresAt: activeRouteAuthority.authorityExpiresAt, routeAuthorityDigest: authorityDigest(activeRouteAuthority), providerId: "github", connectorId: "github", accountId: "123", endpointId: githubIssueLabelsWriteEndpointId }; }, async routeReread() { return activeRouteAuthority; } } },
  };
  const profileTrustRoots = createProfileVerificationRoots([{ tenant, governanceRef, signerId: profile.trustPin.certifier.signerId, purpose: profile.trustPin.certifier.purpose, publicKeySpkiBase64: profile.trustPin.certifier.publicKeySpkiBase64, currentTrustEvents: profile.trustPin.currentTrustEvents, currentTrustEventsDigest: profile.trustPin.currentTrustEventsDigest, trustHeadDigest: profile.trustPin.trustHeadDigest }, { tenant, governanceRef, signerId: profile.trustPin.operator.signerId, purpose: profile.trustPin.operator.purpose, publicKeySpkiBase64: profile.trustPin.operator.publicKeySpkiBase64, currentTrustEvents: profile.trustPin.currentTrustEvents, currentTrustEventsDigest: profile.trustPin.currentTrustEventsDigest, trustHeadDigest: profile.trustPin.trustHeadDigest }]);
  const contractArtifact = Object.freeze({ kind: "outcome-contract" as const, value: parseAuthorityWire("outcome-contract", contract), digest: contractDigest, signerId: contractKey.descriptor.keyId, signature: signDigest(contractKey.privateKey, "outcome-contract", contractDigest) });
  const delegationArtifact = Object.freeze({ kind: "delegation-grant" as const, value: parseAuthorityWire("delegation-grant", grant), digest: grantDigest, signerId: delegationKey.descriptor.keyId, signature: signDigest(delegationKey.privateKey, "delegation-grant", grantDigest) });
  const packManifest = parseAuthorityWire("pack-manifest", { v: "reelier.outcome-pack-manifest/v1", packId: "github_issue_labels", packDigest: githubIssueLabelsPackDigest, definitions: [githubIssueLabelsAlias] });
  const publicationState = (reservationId: string) => {
    const sourceRefsDigest = sha("1"), observations = [{ index: 0, planDigest: sha("3"), endpointId: githubIssueLabelsReadEndpointId, rawDigest: sha("4") }], readSetDigest = authorityDigest({ v: "reelier.source-read-set/internal-v1", sourceRefsDigest, observations });
    const source = parseAuthorityWire("source-bundle", { v: "reelier.source-bundle/v1", tenant, definitionDigest: githubIssueLabelsDefinitionDigest, projectionSchemaId: githubIssueLabelsProjectionSchemaId, sourceIdentity: "github.fixlyai.reelier.1", triggerIdentity: "sha256.trigger", sourceRefsDigest, readSetDigest, observedAt: signing.observedAt, freshUntil: signing.expiresAt, projection: { owner: "fixlyai", repo: "reelier", issueNumber: 1, issueState: "open", labels: ["before"] }, claims: { grounded: ["owner", "repo", "issueNumber", "issueState", "labels"].map(key => ({ claimId: `github-${key}`, projectionPointer: `/${key}` })), authored: [], unresolved: [] }, provenance: { resolverId: githubIssueLabelsResolverId, observations } });
    const effect = parseAuthorityWire("transport-effect", { v: "reelier.transport-effect/v1", endpointId: githubIssueLabelsWriteEndpointId, method: "PUT", path: "/repos/fixlyai/reelier/issues/1/labels", query: "", headers: { "Content-Type": "application/json" }, bodyBase64: body.toString("base64"), riskClass: githubIssueLabelsRiskClass, idempotency: "native", preconditions: [{ kind: "github-labels-digest", digest: sha("5") }], reconciliation: { recipeId: "github_issue_labels_readback_v1" } });
    const sourceBundleDigest = authorityDigest(source), effectDigest = authorityDigest(effect), requestDigest = sha("6"), requestKey = sha("7"), authorityStateDigest = sha("8"), capabilityId = "cap_governed_race", outcomeKey = sha("9"), limitsDigest = authorityDigest({ v: "reelier.capability-limits/internal-v1", contractDigest, limits });
    const capability = parseAuthorityWire("compiled-capability", { v: "reelier.compiled-capability/v1", tenant, requester: "operator", definitionAlias: githubIssueLabelsAlias, requestDigest, requestKey, contractDigest, sourceBundleDigest, sourceSnapshotDigest: sha("a"), authorityStateDigest, limits, limitsDigest, capabilityId, outcomeKey, effectDigest, issuedAt: signing.observedAt, expiresAt: signing.expiresAt });
    const capabilityDigest = authorityDigest(capability), decisionContext = parseAuthorityWire("decision-context", { v: "reelier.decision-context/v1", tenant, requester: "operator", definitionAlias: githubIssueLabelsAlias, requestId: "governed_race", requestDigest, requestKey, snapshots: { authorityStateDigest, sourceBundleDigest }, contractDigest, capabilityId, capabilityDigest, outcomeKey, effectDigest }), decisionContextDigest = authorityDigest(decisionContext);
    const gateEvent = parseAuthorityWire("gate-event", { v: "reelier.gate-event/v1", eventId: "evt_governed_race", verdict: "accepted", reasonCode: "accepted", decisionContextDigest, at: signing.observedAt }), gateEventDigest = authorityDigest(gateEvent), gateSignature = signDigest(signing.gateKey.privateKey, "gate-event", gateEventDigest);
    return { state: { reservation: { reservationId, state: "reserved" as const, intent: { effectDigest, effectCanonicalBase64: authorityCanonicalBytes(effect).toString("base64"), routeAuthority } }, effect, effectCanonicalBase64: authorityCanonicalBytes(effect).toString("base64"), effectDigest, source: { bundle: source }, capability, capabilityDigest, signedDecision: { decisionContext, decisionContextDigest, gateEvent, gateEventDigest, signerId: signing.gate.keyId, signature: gateSignature } }, capabilityDigest, requestDigest, effectDigest };
  };
  const config = { version: 1 as const, tenant, requester: "operator", authorityCellId: signing.identifiers.authorityCellId, definitions: [githubIssueLabelsAlias], ledgerDir: path.join(authorityRoot, "ledger"), decisionDir: path.join(authorityRoot, "decisions"), receiptDir: path.join(authorityRoot, "receipts"), gateKeyFile, endpoints: [], nativeHttpsRoutes: [readRoute, writeRoute], deploymentPath, jobCardTrustPinPath: pinPath };
  return { signing, profile, jobCard, deploymentSnapshot, foundations: { contract: contractArtifact, delegation: [delegationArtifact], packManifest }, publicationState, routes: [readRoute, writeRoute], config, reference: { v: "reelier.governed-authority-cell-reference/v1" as const, tenant, governanceRef, expectedManifestDigest: profile.manifestDigest, expectedTrustHeadDigest: profile.manifest.trustHeadDigest }, routeScope, routeAuthority, contractDigest, options, verification: { profileTrustRoots, profilePacks: packs, jobCardTrustPin: signing.pin, currentAuthorityTrustEvents: signing.pin.currentTrustEvents, directAuthorityRoots: directRoots, expectedTenant: tenant, expectedAuthorityCellId: signing.identifiers.authorityCellId, expectedTaskId: signing.identifiers.taskId }, request: { v: "reelier.outcome-request/v1", requestId: "governed_request_1", sourceRefs: { issue: "issue_1" }, choices: {} } };
}
