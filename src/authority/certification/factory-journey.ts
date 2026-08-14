import { createHash, generateKeyPairSync } from "node:crypto";
import { access, lstat, mkdtemp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { authorityDigest } from "../wire.js";
import { signJobCard } from "../job.js";
import { createSignedCertificationReadiness } from "./authority.js";
import { initializeCertification } from "./initializer.js";
import { preflightCertification } from "./preflight.js";
import { sealCertificationReadiness } from "./readiness.js";
import { createCertificationCellHost, certificationTaskShapeDigest } from "./cell.js";
import { createDelegationAuthority } from "../host/delegation-service.js";
import { createFilePrincipalRegistry } from "../host/principal-registry.js";
import { createGitHubIssueLabelsHermeticComposition } from "./github-issue-labels-runner.js";
import { createCertificationArtifactKeyBinding, createCertificationLifecycleAuthorityCeremony } from "./lifecycle-authority.js";
import { verifyCertificationTaskReceiptGraph } from "./task-receipt-graph.js";
import { assertLinuxAuthorityCellHost } from "../host/platform.js";
import { CERTIFICATION_PROVIDER_SCENARIO_IDS, CERTIFICATION_RUNNER_OPERATIONS, certificationPolicyCommitments, certificationRunnerRegistryDigest, getCertificationRunnerRegistryEntry } from "./runner-registry.js";
import { parseCertificationOperatorConfigV3 } from "./config.js";
import { certificationScenarioPlanBindings } from "./scenario-bindings.js";

const AT = "2026-08-11T20:00:00.000Z", EXPIRY = "2026-08-11T21:00:00.000Z";
const descriptor = (keyId: string, role: "human-sponsor" | "authority-cell", purpose: string, publicKey: ReturnType<typeof generateKeyPairSync>["publicKey"]) => ({ v: "reelier.authority-key-descriptor/v1", keyId, role, purpose, algorithm: "ed25519", publicKeySpkiBase64: publicKey.export({ type: "spki", format: "der" }).toString("base64") });

export type FactoryJourneyFault = "staging" | "root" | "graph-write" | "trust-write" | "summary-write" | "cleanup" | "rename";
let testFault: FactoryJourneyFault | undefined;
export function __testSetFactoryJourneyFault(value: FactoryJourneyFault): () => void {
  const previous = testFault; testFault = value;
  return () => { testFault = previous; };
}
function fault(point: FactoryJourneyFault): void { if (testFault === point) throw new Error(`factory journey test fault: ${point}`); }

async function writeFactoryInputManifests(workspace: string): Promise<void> {
  const config = parseCertificationOperatorConfigV3(JSON.parse(await readFile(path.join(workspace, "config.json"), "utf8")));
  const directories = ["runners", "tests", "plans"].map(name => path.join(workspace, "inputs", name)); await Promise.all(directories.map(directory => mkdir(directory, { recursive: true })));
  for (const scenario of ["github-issue-labels"].filter(value => (CERTIFICATION_PROVIDER_SCENARIO_IDS as readonly string[]).includes(value))) {
    const endpoint = JSON.parse(await readFile(path.join(workspace, "authority", "endpoints", `${scenario}.json`), "utf8")), registry = getCertificationRunnerRegistryEntry(scenario as never), bindings = certificationScenarioPlanBindings(config, scenario as never), stem = scenario.replaceAll("-", "_");
    const runner = { v: "reelier.certification-runner-manifest/v2", scenarioId: scenario, runnerId: registry.runnerId, endpointManifestDigest: authorityDigest(endpoint), metadataDigest: registry.metadataDigest, registryDigest: certificationRunnerRegistryDigest, operations: CERTIFICATION_RUNNER_OPERATIONS, executionReady: false, dispatchable: false }, runnerBytes = `${JSON.stringify(runner)}\n`, runnerDigest = `sha256:${createHash("sha256").update(runnerBytes).digest("hex")}`;
    const tests = { v: "reelier.certification-test-manifest/v1", scenarioId: scenario, suiteId: `${stem}_v1`, runnerManifestDigest: runnerDigest, cases: ["account-binding", "ambiguity", "cleanup", "normal", "redaction", "stale-state"] }, testBytes = `${JSON.stringify(tests)}\n`, testDigest = `sha256:${createHash("sha256").update(testBytes).digest("hex")}`;
    const plan = { v: "reelier.certification-scenario-plan/v1", scenarioId: scenario, definitionAliases: registry.definitionAliases, sourceRefs: bindings.sourceRefs, resourceDigest: bindings.resourceDigest, accountCommitments: bindings.accountCommitments, desiredStateDigest: bindings.desiredStateDigest, policyCommitments: certificationPolicyCommitments(scenario as never), cleanup: { recipeIds: bindings.cleanupRecipeIds, beforeState: "pending" }, controlledCut: { case: "ambiguous-after-dispatch" }, runnerManifestDigest: runnerDigest, testManifestDigest: testDigest, endpointManifestDigest: authorityDigest(endpoint), runnerRegistryDigest: certificationRunnerRegistryDigest };
    await writeFile(path.join(workspace, "inputs", "runners", `${scenario}.json`), runnerBytes, "utf8"); await writeFile(path.join(workspace, "inputs", "tests", `${scenario}.json`), testBytes, "utf8"); await writeFile(path.join(workspace, "inputs", "plans", `${scenario}.json`), `${JSON.stringify(plan)}\n`, "utf8");
  }
}

export async function certifyFactoryJourney(out: string): Promise<Readonly<{ graphPath: string; trustPath: string; summaryPath: string; graphDigest: string; summaryDigest: string }>> {
  const started = Date.now();
  assertLinuxAuthorityCellHost();
  if (!path.isAbsolute(out)) throw new TypeError("factory output must be absolute");
  try { await lstat(out); throw new TypeError("factory output already exists"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const parent = path.dirname(out); let staging: string | undefined, root: string | undefined, published = false;
  try {
    await access(parent); fault("staging"); staging = await mkdtemp(path.join(parent, ".reelier-factory-journey-")); fault("root"); root = await mkdtemp(path.join(parent, ".reelier-factory-cell-"));
    const configPath = path.join(root, "certification.local.json");
    await writeFile(configPath, JSON.stringify({ v: "reelier.certification-operator-config/v3", authorityConfigPath: "authority/authority.yml", evidenceDirectory: "authority/receipts/certification", scenarios: ["github-issue-labels"], resources: { "github-issue-labels": { apiBaseUrl: "https://api.github.com", owner: "fixlyai", repository: "reelier-certification", issueNumber: 1 } }, cleanup: { "github-issue-labels": ["restore-github-labels"] }, desiredState: { "github-issue-labels": { labels: ["certification-after"] } }, metadata: {}, secretReferences: { githubCredential: "env:REELIER_GITHUB_TOKEN" } }), "utf8");
    const initialized = await initializeCertification({ configPath }); await writeFactoryInputManifests(initialized.workspace);
    const selection = { workspace: initialized.workspace, scenario: "github-issue-labels" as const };
    const preflight = await preflightCertification(selection), sealed = await sealCertificationReadiness(selection);
    const readinessKey = generateKeyPairSync("ed25519"), jobKey = generateKeyPairSync("ed25519"), ceremony = createCertificationLifecycleAuthorityCeremony();
    const human = descriptor(initialized.identifiers.signerId, "human-sponsor", "certification-readiness", readinessKey.publicKey), jobSigner = descriptor("human_job_card_signer", "human-sponsor", "signed-job-card", jobKey.publicKey);
    const descriptors = [human, jobSigner, ...ceremony.publicDescriptors], events: any[] = [];
    for (const item of descriptors) events.push({ v: "reelier.authority-trust-event/v1", eventId: `trust_${events.length}_${"f".repeat(12)}`, sequence: events.length, action: "activate", keyDescriptorDigest: authorityDigest(item), occurredAt: AT, previousEventDigest: events.length ? authorityDigest(events.at(-1)) : null });
    const signedReadiness = createSignedCertificationReadiness({ readinessCandidate: sealed.candidate, readinessCandidateDigest: sealed.digest, preflight, humanKeyDescriptor: human as any, cellKeyDescriptors: ceremony.publicDescriptors, jobCardKeyDescriptors: [jobSigner] as any, trustEvents: events, humanPrivateKey: readinessKey.privateKey, authorizedAt: "2026-08-11T20:01:00.000Z" });
    const pin: any = { v: "reelier.job-card-trust-pin/v1", signedReadiness, readinessCandidate: sealed.candidate, preflight, humanTrustRoot: human, keyDescriptors: descriptors, readinessTrustEvents: events, currentTrustEvents: events };
    const principalId = `principal_${authorityDigest({ v: "reelier.certification-principal-id/v1", taskId: initialized.identifiers.taskId, authorityCellId: initialized.identifiers.authorityCellId }).slice(7, 31)}`;
    const constraints = { definitionAliases: ["github_issue_labels_set_v1"], audiences: [principalId], connectorAccounts: [{ connectorId: "github", accountId: "github_fixlyai_reelier" }], projectionPointers: ["/owner", "/repo", "/issueNumber", "/issueState", "/labels"], riskClasses: ["github_issue_labels"], limits: { maxEffectsPerWindow: 2, windowSeconds: 3600, maxEffectsPerSourceTrigger: 1, maxBodyBytes: 4096 } };
    const jobCard = signJobCard({ v: "reelier.signed-job-card/v1", jobId: initialized.identifiers.jobCardId, title: "Certification", taskShapeDigest: certificationTaskShapeDigest({ identifiers: initialized.identifiers, scenarios: ["github-issue-labels"], constraints }), semanticClasses: ["record_state_set_v1"], definitionAliases: constraints.definitionAliases, connectorIds: ["github"], accountIdentities: ["github:fixlyai/reelier-certification"], connectionDescriptorDigests: [`sha256:${"1".repeat(64)}`], adoptionCommitmentDigests: [`sha256:${"2".repeat(64)}`], sourceRefs: ["certification"], audiences: constraints.audiences, limitsDigest: authorityDigest(constraints.limits), instructionsDigest: `sha256:${"3".repeat(64)}`, packDigests: [`sha256:${"4".repeat(64)}`], exceptionPolicy: ["ambiguous-reconcile"], coverage: "declared-surface" }, jobSigner.keyId, jobKey.privateKey);
    const delegation = createDelegationAuthority({ root: path.join(initialized.workspace, "authority", "delegation"), now: () => new Date("2026-08-11T20:10:00.000Z"), signGrant: async () => { throw new Error("child delegation not expected"); } });
    const principals = createFilePrincipalRegistry({ tenant: initialized.identifiers.authorityCellId, file: path.join(initialized.workspace, "authority", "principals", "registry.jsonl") });
    const trustPath = path.join(root, "operator-current-trust.json"); await writeFile(trustPath, `${JSON.stringify(pin)}\n`);
    const lifecycle = createCertificationArtifactKeyBinding(ceremony.opaqueHandle, { authorityCellId: initialized.identifiers.authorityCellId, taskId: initialized.identifiers.taskId, readinessDigest: authorityDigest(signedReadiness), humanDescriptor: human as any, humanPrivateKey: readinessKey.privateKey, issuedAt: AT, expiresAt: EXPIRY });
    const cell = await createCertificationCellHost({ workspace: initialized.workspace, currentTrustPinPath: trustPath, delegationAuthority: delegation, principalRegistry: principals, now: () => new Date("2026-08-11T20:10:00.000Z"), lifecycleAuthority: { handle: ceremony.opaqueHandle, binding: lifecycle.binding, commitment: lifecycle.humanCommitment } });
    const activation = await cell.activateRootTask({ jobCard, jobCardTrustPin: pin, constraints, effects: 2, issuedAt: AT, expiresAt: EXPIRY });
    const credential = await cell.activatePrincipalSession(), runner = await createGitHubIssueLabelsHermeticComposition(cell);
    await runner.run({ bearerToken: credential.token, requestId: "factory_journey" }); await runner.cleanup({ bearerToken: credential.token, requestId: "factory_journey" });
    const graph = await runner.exportGraph({ bearerToken: credential.token });
    const evidenceSignerId = pin.keyDescriptors.find((item: any) => item.role === "authority-cell" && item.purpose === "authority-evidence")?.keyId;
    verifyCertificationTaskReceiptGraph(graph, { trustPin: pin, currentTrustObservation: { v: "reelier.portable-current-trust-observation/v1", observedAt: AT, expiresAt: EXPIRY, activeAuthorityEvidenceSignerIds: [evidenceSignerId] }, now: new Date("2026-08-11T20:10:00.000Z") });
    const graphDigest = authorityDigest(graph);
    const taskAuthority = graph.taskAuthorities[0] as any, readinessArtifact = graph.signedReadiness as any;
    const nonClaims = ["semantic-correctness", "general-software-factory-capability", "live-human-review"];
    const fixtureOperatorConfirmation = Object.freeze({ kind: "fixture", basis: "signed-readiness-construction", signedReadinessDigest: taskAuthority.activation.signedReadinessDigest, liveHuman: false, grantsAuthority: false });
    const reviewerPacket = Object.freeze({
      humanApprovedTaskBinding: { taskId: graph.taskId, authorityCellId: graph.authorityCellId, signedReadinessDigest: taskAuthority.activation.signedReadinessDigest, authorization: readinessArtifact.authorization, dispatchable: readinessArtifact.dispatchable },
      declared: { trigger: taskAuthority.declaredTrigger, intent: taskAuthority.declaredIntent, operation: taskAuthority.signedJobCard.semanticClasses },
      compiledEffect: graph.outcomes.map(item => item.effectDigest),
      lineage: { principals: graph.principals.map(item => item.principalId), grants: graph.grants.map(item => item.digest), allocations: graph.allocations.map(item => item.allocationId) },
      policyStatus: graph.policyEvidence.map((item: any) => ({ artifact: item.artifact, status: item.status })),
      postStateConfidence: graph.postStateEvidence.map((item: any) => item.confidence),
      providerObservation: graph.receipts.map(item => item.receipt.value.claims.providerAcknowledgment),
      reconciliationResult: graph.receipts.map(item => item.evidence.value.reconciliation.verdict),
      cleanupResult: graph.receipts.filter(item => item.receipt.value.decisionContext.requestId.endsWith(".cleanup")).map(item => item.evidence.value.reconciliation.verdict),
      duplicateDecisions: graph.duplicateDecisions,
      exceptions: graph.exceptions,
      receiptChain: graph.receipts.map(item => ({ receiptDigest: authorityDigest(item.receipt.value), priorReceiptDigest: item.receipt.value.priorReceiptDigest })),
      fixtureOperatorConfirmation,
      graphDigest,
      nonClaims,
    });
    const summary = Object.freeze({ v: "reelier.factory-journey-summary/v1", journey: "github-issue-labels", graphDigest, stages: ["classification", "preparation", "consequential-execution", "independent-review"], authorityBoundaryCeremonies: 1, fixtureOperatorConfirmations: 1, liveHumanReview: "absent", providerCredentialValueHandling: 0, clientBearerResolution: 0, providerSdkCalls: 0, externalSockets: 0, unsupportedCategories: { ambiguity: "absent", manual: "absent", blocked: "absent" }, nonClaims, logicalOperatorSteps: 4, elapsedMs: Date.now() - started, reviewerPacket });
    const summaryDigest = authorityDigest(summary);
    fault("cleanup");
    fault("graph-write");
    await writeFile(path.join(staging, "graph.json"), `${JSON.stringify(graph)}\n`, { flag: "wx" });
    fault("trust-write");
    await writeFile(path.join(staging, "trust-pin.json"), `${JSON.stringify(pin)}\n`, { flag: "wx" });
    fault("summary-write");
    await writeFile(path.join(staging, "factory-journey-summary.json"), `${JSON.stringify(summary)}\n`, { flag: "wx" });
    fault("rename");
    await rename(staging, out); published = true;
    return Object.freeze({ graphPath: path.join(out, "graph.json"), trustPath: path.join(out, "trust-pin.json"), summaryPath: path.join(out, "factory-journey-summary.json"), graphDigest, summaryDigest });
  } catch (error) { if (staging && !published) await rm(staging, { recursive: true, force: true }).catch(() => undefined); throw error; }
  finally { if (root) await rm(root, { recursive: true, force: true }).catch(() => undefined); }
}
