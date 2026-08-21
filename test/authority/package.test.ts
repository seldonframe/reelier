import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import ts from "typescript";
import { profileGovernanceFixture } from "./profile-governance-fixture.js";

const SUPPORTED_LINUX_HOST_ROOTS = ["createAuthorityEgressGateway", "createAuthorityHostRuntime", "createAuthorityHostServer", "createCertificationCellHost", "createDelegationAuthority", "createDispatchCoordinator", "createFileReceiptPublication", "createGovernedAuthorityCell", "createLocalAuthorityRuntime"] as const;
const EXPECTED_AUTHORITY_DECLARATION_EXPORTS = [
  "AGENT_MANDATE_CONTRACT_V1", "AGENT_MANDATE_CONTRACT_V1_DIGEST", "AUTHORITY_ADAPTER_CONTRACT_V1", "AUTHORITY_ADAPTER_CONTRACT_V1_DIGEST", "AgentDestinationV1", "AgentDocumentV1", "AgentHarnessV1", "AgentMandate", "AgentMandateV1", "AgentMandateV2", "ApprovalReplayProtectorV1", "AttemptV1", "AuthorityAdapterContractV1", "AuthorityDeploymentSnapshotV1", "AuthorityEvidence", "AuthorityExecutionContextV1", "AuthorityKeyDescriptorV1", "AuthorityKind", "AuthorityLimits", "AuthorityLimitsV1", "AuthorityReceipt", "AuthorityReceiptBundle", "AuthorityReceiptVerificationOptions", "AuthorityRouteScopeV1", "AuthoritySignature", "AuthoritySignaturePurpose", "AuthorityWire", "AuthorityWireByKind", "ClaimStatus", "CompiledCapability", "ConfidentialTransferCommitmentV1", "ConnectorAccount", "ConservedBudgetV1", "CustomerApprovalProofV1", "CustomerAuthorityPayloadV1", "CustomerAuthorityPurposeV1", "DecisionArtifactPresence", "DecisionContext", "DecisionContextPresence", "DelegationBudgetEventV1", "DelegationConstraints", "DelegationGrant", "DelegationPolicy", "EffectReservationV1", "EvidenceGradeV1", "GateEvent", "GovernedEffect", "GovernedEffectClassV1", "GovernedOutcomeV1", "GovernedOutcomeVerificationContextV1", "GovernedReceiptV1", "HostedAuthorityEnvelopeV1", "MandateLockV1", "MandatedMissionV1", "MandatedMissionV2", "MissionChildGrantV1", "MissionClaimV1", "NativeCandidateV1", "NativeCandidateVerificationInputs", "OUTCOME_PROFILE_CONTRACT_V1_DIGEST", "ObservationV1", "OutcomeContract", "OutcomePackManifest", "OutcomeProfileDraftV1", "OutcomeRequest", "OutcomeSemanticClass", "Principal", "ProfileConformanceReportV1", "ProfileGovernanceManifestV1", "ProfileGovernanceVerificationInputV1", "ProfileGovernanceVerificationV1", "ProfileTrustPinV1", "ProfileVerificationAnchorV1", "ProfileVerificationRootsV1", "ProviderOutcomePackV1", "ReconciledOutcomeStatusV1", "ReconciledOutcomeV1", "ReleaseAuthorizationBundleV1", "ReleaseContractSignerV1", "ReleaseContractVerifierV1", "ReleaseDestinationV1", "ReleaseEffectAllocationV1", "ReleaseEvidenceLaneV1", "ReleaseEvidenceStatus", "ReleaseEvidenceVerificationV1", "ReleaseEvidenceVerifierBindingV1", "ReleasePolicyV1", "ReleaseProviderEffectV1", "ReleaseReceiptGraphMakerBindingV1", "ReleaseReceiptGraphV1", "ReleaseVerifierEvidenceV1", "SignedAuthorityArtifact", "SignedAuthorityLeaseV1", "SignedCertificationReadinessV1", "SignedJobCardV1", "SignedOutcomeProfileConformanceV1", "SignedProfileAuthorityBindingV1", "SignedReleaseArtifactV1", "SignedReleaseAuthorizationBundleV1", "SignedReleasePolicyV1", "SignedReleaseReceiptGraphV1", "SignedReleaseVerifierEvidenceV1", "SignedStagedCandidateManifestV1", "SignedTenantProfileActivationV1", "SourceBundle", "SourceClaim", "SourceObservationEvidence", "StagedCandidateManifestV1", "StandingAuthorityEnvelopeV1", "TaskReceiptGraphV1", "ToolEffectContractV1", "TopologyProbeEvidenceV1", "TransportEffect", "TrustDomainDescriptorV1", "TrustEventV1", "TrustedCustomerCredentialResolverV1", "TrustedCustomerCredentialV1", "UnsignedJobCardV1", "VerifiedAuthorityReceiptBundle", "VerifiedCertificationTaskReceiptGraphV1", "VerifiedCustomerRootedAuthorityV1", "VerifiedMandateLockV1", "VerifiedReleaseAuthorizationV1", "VerifiedReleaseReceiptGraphV1",
  "assertAcceptedDecisionContext", "authorityCanonicalBytes", "authorityDigest", "authorityEvidenceCanonicalBytes", "authorityKinds", "createApprovalReplayProtectorV1", "createAuthorityEvidence", "createAuthorityReceipt", "createAuthorityReceiptBundle", "createMandateLockV1", "createProfileVerificationRoots", "createSignedReleaseAuthorizationBundleV1", "createSignedReleasePolicyV1", "createSignedReleaseReceiptGraphV1", "createSignedReleaseVerifierEvidenceV1", "createSignedStagedCandidateManifestV1", "decisionContextPresence", "deriveMandatedMissionV1", "deriveMandatedMissionV2", "digestAgentMandateV1", "digestAgentMandateV2", "digestAttemptV1", "digestAuthorityReceiptBundle", "digestEffectReservationV1", "digestGovernedOutcomeV1", "digestGovernedReceiptV1", "digestMissionClaimV1", "digestObservationV1", "digestProviderOutcomePackV1", "digestToolEffectContractV1", "normalizeSignedJobCard", "parseAgentDocumentV1", "parseAgentMandate", "parseAgentMandateV1", "parseAgentMandateV2", "parseAttemptV1", "parseAuthorityDeploymentSnapshot", "parseAuthorityKeyDescriptor", "parseAuthorityReceiptBundle", "parseAuthorityRouteScope", "parseAuthorityWire", "parseCanonicalAuthorityJson", "parseCanonicalSignedReleaseAuthorizationBundleV1", "parseCanonicalSignedReleasePolicyV1", "parseCanonicalSignedReleaseReceiptGraphV1", "parseCanonicalSignedStagedCandidateManifestV1", "parseCustomerApprovalProofV1", "parseCustomerAuthorityPayloadV1", "parseEffectReservationV1", "parseGovernedOutcomeV1", "parseGovernedReceiptV1", "parseHostedAuthorityEnvelopeV1", "parseMandateLockV1", "parseMissionChildGrantV1", "parseMissionClaimV1", "parseObservationV1", "parseOutcomeProfileDraft", "parsePortableAuthorityEvidence", "parseProfileConformanceReport", "parseProfileGovernanceManifest", "parseProfileTrustPin", "parseProviderOutcomePackV1", "parseReconciledOutcomeV1", "parseSignedCertificationReadiness", "parseSignedOutcomeProfileConformance", "parseSignedProfileAuthorityBinding", "parseSignedReleaseAuthorizationBundleV1", "parseSignedReleasePolicyV1", "parseSignedReleaseReceiptGraphV1", "parseSignedReleaseVerifierEvidenceV1", "parseSignedStagedCandidateManifestV1", "parseSignedTenantProfileActivation", "parseStandingAuthorityEnvelopeV1", "parseToolEffectContractV1", "parseTrustDomainDescriptorV1", "parseTrustEvents", "signAuthorityDigest", "signJobCard", "signedJobCardDigest", "verifyAuthorityAdapterContractV1", "verifyAuthorityReceipt", "verifyAuthorityReceiptBundle", "verifyAuthoritySignature", "verifyCertificationTaskReceiptGraph", "verifyCustomerRootedAuthorityV1", "verifyGovernedOutcomeTransitionV1", "verifyMandateLockV1", "verifyNativeCandidate", "verifyProfileGovernanceOffline", "verifyReleaseAuthorizationBundleV1", "verifyReleaseReceiptGraphV1", "verifySignedCertificationReadiness", "verifySignedJobCard",
] as const;

test("declared authority host barrel exposes only supported composition roots as Gate 0 claims", async () => {
  const host = await import("reelier/authority/host");
  for (const root of SUPPORTED_LINUX_HOST_ROOTS) assert.equal(Object.hasOwn(host, root), true, root);
  assert.equal(Object.hasOwn(host, "FsAuthorityLedger"), false, "the raw ledger is not a declared host-barrel export");
  profileGovernanceFixture();
  for (const internal of ["loadProfileGovernanceFromOperatorTrust", "assertAdmittedProfileGovernance", "profileGovernanceAdmissionSnapshot", "createAdmittedLocalAuthorityRuntime", "selectEligibleAuthorityContract", "constructAuthorityReceiptBundle", "loadExistingLocalGateSigner", "validateAuthorityReceiptSigningAuthority"]) assert.equal(Object.hasOwn(host, internal), false, internal);
  const exportsMap = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as { exports: Record<string, string> };
  assert.equal(exportsMap.exports["./authority/host"], "./dist/authority/host/index.js");
  assert.equal(Object.hasOwn(exportsMap.exports, "./authority/host/fs-ledger"), false);
  assert.equal(Object.hasOwn(exportsMap.exports, "./authority/host/fs-ledger.js"), false);
  const hostRuntimeNames = Object.keys(host).sort();
  const excludedHostRuntimeNames = hostRuntimeNames.filter(name => !SUPPORTED_LINUX_HOST_ROOTS.includes(name as typeof SUPPORTED_LINUX_HOST_ROOTS[number]));
  for (const witness of ["FsDelegationBudgetLedger", "executeJsonHttpsEffect", "launchCodexDogfood", "runCertification", "runCertificationSuite"]) assert.equal(excludedHostRuntimeNames.includes(witness), true, witness);
  assert.match(`sha256:${createHash("sha256").update(JSON.stringify(excludedHostRuntimeNames), "utf8").digest("hex")}`, /^sha256:[0-9a-f]{64}$/);
});

test("CI keeps both required matrix contexts failing when authority pack prerequisite fails", () => {
  const workflow = readFileSync(path.join(process.cwd(), ".github", "workflows", "ci.yml"), "utf8");
  const testJob = workflow.slice(workflow.indexOf("  test:"));
  assert.match(testJob, /^  test:\r?\n(?:    name: .*\r?\n)?    needs: \[pack-authority-host-boundary, produce-authority-factory-evidence\]\r?\n    # `always\(\)`/m);
  assert.match(testJob, /    if: \$\{\{ always\(\) \}\}/);
  assert.match(testJob, /- name: Enforce authority pack and factory evidence prerequisites\r?\n        if: \$\{\{ always\(\) \}\}/);
  assert.match(testJob, /needs\.pack-authority-host-boundary\.result \}\}[' ]+!= 'success'/);
  assert.match(testJob, /needs\.produce-authority-factory-evidence\.result \}\}[' ]+!= 'success'/);
  const prerequisite = "if: ${{ needs.pack-authority-host-boundary.result == 'success' && needs.produce-authority-factory-evidence.result == 'success' }}";
  const enforcement = testJob.indexOf("- name: Enforce authority pack and factory evidence prerequisites");
  assert.ok(enforcement >= 0);
  for (const step of ["actions/checkout@v4", "actions/setup-node@v4", "- run: npm ci", "- name: Clean build output", "- run: npm run build", "- name: Compile test checkout", "actions/download-artifact@v4", "- name: Verify downloaded authority pack provenance", "- name: Verify downloaded package boundary on native OS", "- name: Run native authority platform evidence", "- name: Run supported tests"]) {
    const position = testJob.indexOf(step, enforcement);
    assert.ok(position > enforcement, step);
    assert.ok(testJob.slice(position, position + 240).includes(prerequisite), `${step} has a prerequisite success guard`);
  }
  const badgeStep = testJob.slice(testJob.indexOf("- name: Check README tests badge", enforcement));
  const badgeGuard = badgeStep.match(/^\s*(if: \$\{\{.*\}\})\r?$/m);
  assert.ok(badgeGuard, "badge step has an if guard");
  const expectedBadgeGuard = "if: ${{ needs.pack-authority-host-boundary.result == 'success' && needs.produce-authority-factory-evidence.result == 'success' && runner.os == 'Linux' }}";
  assert.equal(badgeGuard[1].replace(/\s+/g, " "), expectedBadgeGuard);
  const downstreamSteps = testJob.slice(testJob.indexOf("      - uses: actions/checkout@v4")).split(/(?=^      - )/m).filter(block => block.startsWith("      - "));
  assert.ok(downstreamSteps.length >= 10, "all downstream matrix steps are parsed");
  for (const block of downstreamSteps) {
    if (block.startsWith("      - name: Check README tests badge")) {
      assert.ok(block.includes(expectedBadgeGuard), "badge step has the exact combined prerequisite and OS guard");
    } else if (block.startsWith("      - name: Upload Ubuntu test output")) {
      assert.match(block, /if: \$\{\{ always\(\) && matrix\.os == 'ubuntu-latest' \}\}/);
      assert.match(block, /actions\/upload-artifact@v4/);
    } else {
      assert.ok(block.includes(prerequisite), `downstream step is prerequisite-guarded: ${block.split(/\r?\n/, 1)[0]}`);
    }
  }
  const compilePosition = testJob.indexOf("- name: Compile test checkout");
  const firstDistTestPosition = testJob.indexOf("dist-test/");
  assert.ok(compilePosition > 0 && compilePosition < firstDistTestPosition, "test checkout compiles before the first dist-test invocation");
  assert.match(testJob.slice(compilePosition, firstDistTestPosition), /run: npx tsc -p tsconfig\.test\.json --pretty false/);
  assert.match(testJob, /if \[ '\$\{\{ matrix\.os \}\}' = 'ubuntu-latest' \]; then (?:[A-Z0-9_]+=1 )?timeout[^\n]*npm test/);
  assert.match(testJob, /else node --test --test-concurrency=1 dist-test\/test\/authority\/package\.test\.js dist-test\/test\/authority\/linux-authority-cell\.test\.js dist-test\/test\/authority\/authority-cell-connection\.test\.js dist-test\/test\/authority\/certification-portable-evidence\.test\.js/);
});

test("factory evidence producer is checkout-built but installs and runs only the downloaded packed artifact", () => {
  const workflow = readFileSync(path.join(process.cwd(), ".github", "workflows", "ci.yml"), "utf8");
  const producer = workflow.slice(workflow.indexOf("  produce-authority-factory-evidence:"), workflow.indexOf("  test:"));
  assert.match(producer, /actions\/checkout@v4/);
  assert.match(producer, /actions\/setup-node@v4/);
  assert.match(producer, /authority-host-boundary-pack/);
  assert.match(producer, /authority-adapter-contract\.digest/);
  assert.match(producer, /test\/packed\/authority-factory-journey\.mjs/);
  assert.match(producer, /secretCanaryResult/);
  assert.match(producer, /factory-evidence-metadata\.json/);
  assert.match(producer, /graph\.json/);
  assert.match(producer, /trust-pin\.json/);
  assert.match(producer, /factory-journey-summary\.json/);
  assert.match(producer, /Object\.keys\(metadata\)/);
  assert.match(producer, /adapterContractDigest/);
  assert.match(producer, /trustPinDigest/);
});

test("CI packs exactly once and closes package and evidence contents against obsolete Windows helpers", () => {
  const workflow = readFileSync(path.join(process.cwd(), ".github", "workflows", "ci.yml"), "utf8");
  assert.equal(workflow.match(/\["pack","--ignore-scripts","--json"\]/g)?.length, 1, "one npm pack invocation");
  const pack = workflow.slice(workflow.indexOf("  pack-authority-host-boundary:"), workflow.indexOf("  produce-authority-factory-evidence:"));
  assert.match(pack, /packed\.files/);
  assert.match(pack, /native\\\/windows-k1-helper/);
  assert.match(pack, /dist\\\/authority\\\/host\\\/windows-k1/);
  assert.doesNotMatch(pack, /package\\\/dist\\\/authority\\\/host\\\/windows-k1/);
  assert.match(pack, /fifo/i);
  assert.match(pack, /obsolete Windows FIFO\/native helper was packed/);
  const producer = workflow.slice(workflow.indexOf("  produce-authority-factory-evidence:"), workflow.indexOf("  test:"));
  assert.match(producer, /find factory-evidence -maxdepth 1 -type f/);
  assert.match(producer, /factory-evidence-metadata\.json/);
  assert.match(producer, /wc -l/);
});

test("npm pack filenames are root-relative and the workflow scans the deterministic canary before claiming empty", () => {
  const workflow = readFileSync(path.join(process.cwd(), ".github", "workflows", "ci.yml"), "utf8");
  const producer = workflow.slice(workflow.indexOf("  produce-authority-factory-evidence:"), workflow.indexOf("  test:"));
  assert.match(producer, /REELIER_FACTORY_SECRET_CANARY_V1_6F4E91C28A73/);
  assert.match(producer, /includes\(.*secretCanary/);
  assert.ok(producer.indexOf("secretCanary") < producer.indexOf('secretCanaryResult:"empty"'), "actual bytes are scanned before metadata claims empty");
  const npmCli = [process.env.npm_execpath, path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"), path.resolve(path.dirname(process.execPath), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js")].find(value => value && existsSync(value));
  assert.ok(npmCli, "npm CLI is available");
  const packed = JSON.parse(execFileSync(process.execPath, [npmCli, "pack", "--ignore-scripts", "--dry-run", "--json"], { cwd: process.cwd(), encoding: "utf8" })) as [{ files: { path: string }[] }];
  const names = packed[0].files.map(file => file.path);
  assert.ok(names.some(name => name.startsWith("dist/")), "npm reports packed dist paths");
  assert.equal(names.some(name => name.startsWith("package/")), false, "npm pack JSON paths have no package/ prefix");
});

test("matrix verifies public factory evidence through a clean installed consumer on both operating systems", () => {
  const workflow = readFileSync(path.join(process.cwd(), ".github", "workflows", "ci.yml"), "utf8");
  const testJob = workflow.slice(workflow.indexOf("  test:"));
  assert.match(testJob, /authority-factory-public-evidence/);
  assert.match(testJob, /test\/packed\/authority-factory-journey\.mjs --tarball .* --verify-evidence/);
  const harness = readFileSync(path.join(process.cwd(), "test", "packed", "authority-factory-journey.mjs"), "utf8");
  assert.match(harness, /reelier\/authority/);
  assert.match(harness, /createHash/);
  assert.match(harness, /tarballSha256/);
  assert.match(harness, /AUTHORITY_ADAPTER_CONTRACT_V1_DIGEST/);
  assert.match(harness, /path\.resolve\(line\.graphPath\)/);
  assert.match(harness, /const reviewerPacket =/);
  assert.match(harness, /assert\.deepEqual\(summary, .*reviewerPacket/);
  assert.match(harness, /factory-journey-summary\.schema\.json/);
  assert.match(harness, /scanCanary\(tarball\).*scanCanary\(evidence\)/s);
  assert.match(testJob, /factory-evidence-metadata\.json/);
  assert.match(testJob, /m\.workflowSourceSha.*github\.sha/);
});

test("packed boundary harness invokes npm with an argument array even from metacharacter paths", () => {
  const harness = readFileSync(path.join(process.cwd(), "test", "packed", "authority-host-boundary.mjs"), "utf8");
  assert.doesNotMatch(harness, /ComSpec|cmd\.exe|npmArgs\.join/);
  assert.match(harness, /execFileSync\(process\.execPath, \[npmCli, \.\.\.npmArgs\]/);
  assert.match(harness, /reelier authority & host-/);
});

test("public production export parses DecisionContext and its portable evidence against packaged schemas", async () => {
  execFileSync(process.execPath, ["./dist/authority/wire.js"], { cwd: process.cwd() });
  const authority = await import("reelier/authority");
  const request = { v: "reelier.outcome-request/v1", requestId: "request_1", sourceRefs: { appointment: "ref_1" }, choices: {} };
  assert.deepEqual(authority.parseAuthorityWire("outcome-request", request), request);
  const digest = "sha256:" + "9".repeat(64);
  const limits = { maxEffectsPerWindow: 1, windowSeconds: 60, maxEffectsPerSourceTrigger: 1, maxBodyBytes: 1024 };
  const policy = Buffer.from("{}", "utf8");
  const contract = { v: "reelier.outcome-contract/v1", tenant: "tenant_1", alias: "definition_1", contractId: "contract_1", validFrom: "2026-01-01T00:00:00.000Z", validUntil: "2026-02-01T00:00:00.000Z", packDigest: digest, definitionDigest: digest, sponsor: "sponsor_1", audiences: ["requester_1"], delegationGrantDigest: digest, connectorId: "connector_1", accountId: "account_1", sourceAuthority: { resolverId: "resolver_1", projectionSchemaId: "projection/v1", allowedReadEndpointIds: ["read_1"], authorizedProjectionPointers: ["/x"], maxFreshnessSeconds: 60 }, riskClasses: ["message"], limits, policyCommitment: { schemaId: "policy/v1", jcsBase64: policy.toString("base64"), digest: "sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a" } };
  const grant = { v: "reelier.delegation-grant/v1", tenant: "tenant_1", grantId: "grant_1", parentDigest: null, sponsor: "sponsor_1", grantor: "operator_1", grantee: "gate_1", issuedAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-02-01T00:00:00.000Z", constraints: { definitionAliases: ["definition_1"], audiences: ["requester_1"], connectorAccounts: [{ connectorId: "connector_1", accountId: "account_1" }], projectionPointers: ["/x"], riskClasses: ["message"], limits } };
  const observations = [{ index: 0, planDigest: "sha256:" + "1".repeat(64), endpointId: "read_1", rawDigest: "sha256:" + "2".repeat(64) }];
  const sourceRefsDigest = authority.authorityDigest({ v: "reelier.source-refs/internal-v1", sourceRefs: { appointment: "ref_1" } });
  const source = { v: "reelier.source-bundle/v1", tenant: "tenant_1", definitionDigest: digest, projectionSchemaId: "projection/v1", sourceRefsDigest, readSetDigest: authority.authorityDigest({ v: "reelier.source-read-set/internal-v1", sourceRefsDigest, observations }), sourceIdentity: "source_1", triggerIdentity: "trigger_1", observedAt: "2026-01-01T00:00:00.000Z", freshUntil: "2026-01-01T00:01:00.000Z", provenance: { resolverId: "resolver_1", observations }, claims: { grounded: [{ claimId: "x", projectionPointer: "/x" }], authored: [], unresolved: [] }, projection: { x: 1 } };
  const context = { v: "reelier.decision-context/v1", tenant: "tenant_1", requester: "requester_1", definitionAlias: "definition_1", requestId: "request_1", requestDigest: "sha256:" + "1".repeat(64), requestKey: "sha256:" + "2".repeat(64), contractDigest: "sha256:" + "3".repeat(64), capabilityId: "capability_1", capabilityDigest: "sha256:" + "4".repeat(64), outcomeKey: "sha256:" + "5".repeat(64), effectDigest: "sha256:" + "6".repeat(64), snapshots: { sourceBundleDigest: "sha256:" + "7".repeat(64), authorityStateDigest: "sha256:" + "8".repeat(64) } };
  const decisionContextDigest = authority.authorityDigest(context);
  const gate = { v: "reelier.gate-event/v1", eventId: "event_1", at: "2026-01-01T00:00:00.000Z", verdict: "accepted", reasonCode: "accepted", decisionContextDigest };
  const receipt = { v: "reelier.authority-receipt/v1", receiptId: "receipt_1", gateEventDigest: authority.authorityDigest(gate), decisionContextDigest, decisionContext: context, claims: { authorization: "verified", sourceCompleteness: "verified", dispatch: "verified", providerAcknowledgment: "unchecked", reconciliation: "absent", topology: "unchecked", completeness: "unchecked" } };
  assert.deepEqual(authority.parseAuthorityWire("outcome-contract", contract), contract);
  assert.deepEqual(authority.parseAuthorityWire("delegation-grant", grant), grant);
  assert.deepEqual(authority.parseAuthorityWire("source-bundle", source), source);
  assert.deepEqual(authority.parseAuthorityWire("decision-context", context), context);
  assert.deepEqual(authority.parseAuthorityWire("gate-event", gate), gate);
  assert.deepEqual(authority.parseAuthorityWire("authority-receipt", receipt), receipt);
  assert.deepEqual(authority.parsePortableAuthorityEvidence(gate, receipt), { gateEvent: gate, receipt });
  assert.deepEqual(Object.keys(authority).sort(), [
    "AGENT_MANDATE_CONTRACT_V1", "AGENT_MANDATE_CONTRACT_V1_DIGEST", "AUTHORITY_ADAPTER_CONTRACT_V1", "AUTHORITY_ADAPTER_CONTRACT_V1_DIGEST", "OUTCOME_PROFILE_CONTRACT_V1_DIGEST",
    "assertAcceptedDecisionContext", "authorityCanonicalBytes", "authorityDigest", "authorityEvidenceCanonicalBytes", "authorityKinds",
    "createApprovalReplayProtectorV1", "createAuthorityEvidence", "createAuthorityReceipt", "createAuthorityReceiptBundle", "createMandateLockV1", "createProfileVerificationRoots",
    "createSignedReleaseAuthorizationBundleV1", "createSignedReleasePolicyV1", "createSignedReleaseReceiptGraphV1", "createSignedReleaseVerifierEvidenceV1", "createSignedStagedCandidateManifestV1",
    "decisionContextPresence", "deriveMandatedMissionV1", "deriveMandatedMissionV2", "digestAgentMandateV1", "digestAgentMandateV2", "digestAttemptV1", "digestAuthorityReceiptBundle", "digestEffectReservationV1", "digestGovernedOutcomeV1", "digestGovernedReceiptV1", "digestMissionClaimV1", "digestObservationV1", "digestProviderOutcomePackV1", "digestToolEffectContractV1", "normalizeSignedJobCard",
    "parseAgentDocumentV1", "parseAgentMandate", "parseAgentMandateV1", "parseAgentMandateV2", "parseAttemptV1", "parseAuthorityDeploymentSnapshot", "parseAuthorityKeyDescriptor", "parseAuthorityReceiptBundle", "parseAuthorityRouteScope", "parseAuthorityWire",
    "parseCanonicalAuthorityJson", "parseCanonicalSignedReleaseAuthorizationBundleV1", "parseCanonicalSignedReleasePolicyV1", "parseCanonicalSignedReleaseReceiptGraphV1", "parseCanonicalSignedStagedCandidateManifestV1",
    "parseCustomerApprovalProofV1", "parseCustomerAuthorityPayloadV1", "parseEffectReservationV1", "parseGovernedOutcomeV1", "parseGovernedReceiptV1", "parseHostedAuthorityEnvelopeV1", "parseMandateLockV1", "parseMissionChildGrantV1", "parseMissionClaimV1", "parseObservationV1", "parseOutcomeProfileDraft", "parsePortableAuthorityEvidence",
    "parseProfileConformanceReport", "parseProfileGovernanceManifest", "parseProfileTrustPin", "parseProviderOutcomePackV1", "parseReconciledOutcomeV1", "parseSignedCertificationReadiness", "parseSignedOutcomeProfileConformance", "parseSignedProfileAuthorityBinding",
    "parseSignedReleaseAuthorizationBundleV1", "parseSignedReleasePolicyV1", "parseSignedReleaseReceiptGraphV1", "parseSignedReleaseVerifierEvidenceV1", "parseSignedStagedCandidateManifestV1", "parseSignedTenantProfileActivation",
    "parseStandingAuthorityEnvelopeV1", "parseToolEffectContractV1", "parseTrustDomainDescriptorV1", "parseTrustEvents", "signAuthorityDigest", "signJobCard", "signedJobCardDigest", "verifyAuthorityAdapterContractV1", "verifyAuthorityReceipt", "verifyAuthorityReceiptBundle",
    "verifyAuthoritySignature", "verifyCertificationTaskReceiptGraph", "verifyCustomerRootedAuthorityV1", "verifyGovernedOutcomeTransitionV1", "verifyMandateLockV1", "verifyNativeCandidate", "verifyProfileGovernanceOffline", "verifyReleaseAuthorizationBundleV1", "verifyReleaseReceiptGraphV1", "verifySignedCertificationReadiness", "verifySignedJobCard",
  ], "the public runtime export surface is an exact allowlist");
  for (const obsolete of ["createWindowsK1Helper", "createWindowsFifo", "WindowsK1Helper", "WindowsFifoAuthorityLedger"]) assert.equal(obsolete in authority, false, `${obsolete} is not public`);
  for (const internal of ["authenticateOutcomeRequest", "authenticatedOutcomeRequestState", "createConnectorRegistry", "connectorRegistrationDigest", "createAuthorityStatePort", "digestAuthorityState", "trustRootSetDigest", "definitionRegistrationDigest", "sourceResolverRegistrationDigest", "authoritySignatureDigest", "ingressFaultPoints", "clockFaultPoints", "signProfileConformance", "signProfileActivation", "assertAdmittedProfileGovernance", "createAdmittedProfileGovernance", "lookupStaticPackDefinition"]) assert.equal(internal in authority, false, internal);
  assert.equal("validateSourceBundle" in authority, false, "candidate SourceBundle constructors stay private");
  for (const internal of ["createAuthorityGate", "createReservedDispatchHandle", "unwrapReservedDispatchHandle", "createFileGateDecisionSink", "parseGateDecisionRecord", "GateDecisionSink", "GateDecisionSigner", "ReservedDispatchHandle"]) assert.equal(internal in authority, false, internal);
  const declarations=readFileSync(path.join(process.cwd(),"dist","authority","index.d.ts"),"utf8");
  assert.doesNotMatch(declarations, /export\s+\*\s+from\s+["']\.\/release-contracts\.js["']/, "release contract types and values use an explicit public allowlist");
  assert.doesNotMatch(declarations, /export\s+\*\s+from\s+["']\.\/agent-mandate\.js["']/, "agent mandate types and values use an explicit public allowlist");
  const program = ts.createProgram([path.join(process.cwd(), "dist", "authority", "index.d.ts")], { module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, target: ts.ScriptTarget.ES2022 });
  const declarationSource = program.getSourceFile(path.join(process.cwd(), "dist", "authority", "index.d.ts"));
  const module = declarationSource && program.getTypeChecker().getSymbolAtLocation(declarationSource);
  assert.ok(module, "authority declarations resolve as a module");
  assert.deepEqual(program.getTypeChecker().getExportsOfModule(module).map(symbol => symbol.getName()).sort(), [...EXPECTED_AUTHORITY_DECLARATION_EXPORTS].sort(), "the public declaration export surface is an independently pinned exact allowlist");
  for (const kind of ["outcome-contract", "delegation-grant", "source-bundle", "decision-context", "gate-event", "authority-receipt", "authority-key-descriptor", "trust-event", "signed-certification-readiness"]) assert.ok(existsSync(path.join(process.cwd(), "dist", "authority", "schemas", `${kind}.schema.json`)));
});

test("public authority pack export includes only reviewed pack constructors and validators", async () => {
  const pack = await import("reelier/authority/pack");
  assert.deepEqual(Object.keys(pack).sort(), [
    "GITHUB_RELEASE_OUTCOME_SERVER_SCHEMA_DIGEST_V1",
    "assertGitHubLinearProviderReadbackV1",
    "assertLinearStatusPredecessorV1",
    "assertStaticFirstPartySourcesConform",
    "createGitHubLinearOutcomePackV1",
    "createStaticPackRegistry",
    "definitionRegistrationDigest",
    "githubReleaseOutcomeToolSchemaDigestV1",
    "orderedGitHubLinearOperationsV1",
  ]);
  for (const forbidden of ["credential", "token", "oauth", "linearClient", "createGitHubReleaseOutcomeExecutorV1"]) assert.equal(forbidden in pack, false);
});
