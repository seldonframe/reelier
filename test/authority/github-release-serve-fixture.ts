import { createHash, generateKeyPairSync, type KeyObject } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { authorityCanonicalBytes, authorityDigest, signAuthorityDigest, signJobCard, signedJobCardDigest } from "../../src/authority/index.js";
import { createSignedReleaseAuthorizationBundleV1, createSignedReleaseOperationPlanV1, createSignedReleasePolicyV1, createSignedReleaseVerifierEvidenceV1, createSignedStagedCandidateManifestV1, type ReleaseEvidenceLaneV1, type ReleaseVerifierEvidenceV1 } from "../../src/authority/release-contracts.js";
import { connectionAdoptionCommitmentDigest, connectionDescriptorDigest, digestNormalizedMcpToolSchemas } from "../../src/connections.js";
import { buildAuthorityDeployment } from "../../src/authority/host/deploy.js";
import { githubReleasePacks } from "../../src/packs/github-release/index.js";
import { githubReleaseAliases, githubReleaseEffects, githubReleaseManifest, githubReleasePolicySchemaId, githubReleaseProjectionSchemaId, githubReleaseReadEndpointId, githubReleaseRiskClass } from "../../src/packs/github-release/manifest.js";
import { createGitHubLinearOutcomePackV1, githubReviewedReleasePackDigestV1 } from "../../src/authority/packs/github-linear-outcomes.js";
import { jobCardTrustPinFixture } from "./job-card-trust-pin-fixture.js";

const sha = (seed: string) => `sha256:${seed.repeat(64).slice(0, 64)}`;
const AUTHORIZATION_HANDLE = "release-authorization-01";
const WRONG_SIGNER_HANDLE = "release-authorization-wrong-signer";

/** Signed with the SAME shapes `release-contracts.test.ts` verifies, using the same public
 * `createSigned*` helpers, so a bundle this fixture writes is one the production verifier accepts. */
const RELEASE_AUTHORITY_SIGNER_ID = "release-authority-2026";
const RELEASE_GRAPH_MAKER_SIGNER_ID = "release-graph-maker-2026";
const AUTHORIZATION_ISSUED_AT = "2026-08-18T05:00:00.000Z";
const AUTHORIZATION_EXPIRES_AT = "2026-08-18T17:00:00.000Z";
const AUTHORIZATION_OBSERVED_AT = "2026-08-18T05:30:00.000Z";
/** Inside `[issuedAt, expiresAt)` and at or after every evidence `observedAt`. */
const AUTHORIZATION_NOW = new Date("2026-08-18T06:00:00.000Z");
const RELEASE_BASE_COMMIT = "e600ad5c2dc5e1bde0714915e7a84980c8d5602b";
/** R3 frozen-contract amendment (operator exception, 2026-08-20): the repository is signed bundle
 * data, not a contract constant. One knob for both artifacts — `verifyReleaseAuthorizationBundleV1`
 * now refuses a manifest and a plan that name different repositories, so they cannot drift apart
 * here by accident. Pass a rehearsal repository to `authorizationBundle` to scope a bundle to one. */
const RELEASE_REPOSITORY = "seldonframe/reelier";
/** `[...QUALITY_LANES, ...RECEIPT_LANES]` in the exact order `parseReleaseAuthorizationBundleV1` pins. */
const LANE_SIGNERS: ReadonlyArray<readonly [ReleaseEvidenceLaneV1, string]> = [
  ["ci-coverage", "quality-coverage-verifier"], ["ci-full-tests", "quality-full-tests-verifier"], ["ci-mutation", "quality-mutation-verifier"],
  ["candidate-branch", "receipt-candidate-branch"], ["candidate-pull-request", "receipt-candidate-pr"], ["ghcr-immutable-manifest", "receipt-ghcr-manifest"], ["ghcr-tags", "receipt-ghcr-tags"],
  ["human-authorization", "receipt-human-authorization"], ["human-exceptions", "receipt-human-exceptions"], ["human-interruptions", "receipt-human-interruptions"], ["human-post-release-review", "receipt-human-review"],
  ["installed-linux", "receipt-installed-linux"], ["installed-windows", "receipt-installed-windows"], ["mcp-registry-version", "receipt-mcp-version"], ["merge-exact-sha", "receipt-merge-sha"],
  ["npm-integrity", "receipt-npm-integrity"], ["npm-provenance", "receipt-npm-provenance"], ["tag-immutable-ref", "receipt-tag-ref"],
];
const releaseDigest = (character: string) => `sha256:${character.repeat(64)}`;
const releaseCommit = (character: string) => character.repeat(40);
const spkiBase64 = (key: KeyObject) => key.export({ format: "der", type: "spki" }).toString("base64");
const spkiDigest = (key: KeyObject) => `sha256:${createHash("sha256").update(key.export({ format: "der", type: "spki" })).digest("hex")}`;

export interface ReleaseServeFixture {
  readonly root: string;
  /** Signed four-alias `authority.yml`, exactly the production release definition set. */
  readonly configFile: string;
  /** Closed `reelier.github-release-runner-config/v1` file with a loopback fixture provider. */
  readonly runnerConfigFile: string;
  readonly configBody: Record<string, unknown>;
  readonly runnerConfigBody: Record<string, unknown>;
  /** `<authorizationDir>/<handle>.json` — a bundle the release verifier ACCEPTS under
   * `runnerConfigBody.releaseAuthority` at `authorizationNow`. */
  readonly authorizationHandle: string;
  /** Same shapes, every artifact re-signed by a foreign key. Signature verification must refuse. */
  readonly wrongSignerHandle: string;
  readonly authorizationDir: string;
  readonly authorizationBundleBody: Record<string, unknown>;
  /** The signed authorization bundle's digest — the identity the verifier brands. */
  readonly authorizationDigest: string;
  /** A verification clock inside the authorization's exact 12-hour validity window. */
  readonly authorizationNow: Date;
  /** Writes a sibling config file so relative paths resolve identically. */
  writeConfig(name: string, body: Record<string, unknown>): Promise<string>;
  /** Writes an arbitrary bundle body at `<authorizationDir>/<handle>.json` for refusal cases. */
  writeAuthorizationBundle(handle: string, body: unknown): Promise<string>;
}

/** A real signed four-definition GitHub release deployment plus the operator-owned runner config
 * that `authority serve --release-runner-config` must construct and inject. Modeled on
 * `multiDefinitionFixture` in local-multi-definition-jobs.test.ts. */
export async function releaseServeFixture(title = "Governed production release", options: Readonly<{ executableCandidate?: boolean }> = {}): Promise<ReleaseServeFixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-release-serve-"));
  const candidateRoot = path.join(root, "candidate");
  await mkdir(path.join(candidateRoot, "keys"), { recursive: true });
  await mkdir(path.join(candidateRoot, "sources"), { recursive: true });
  const operator = generateKeyPairSync("ed25519");
  const sponsor = generateKeyPairSync("ed25519");
  const contractSigner = generateKeyPairSync("ed25519");
  await writeFile(path.join(candidateRoot, "keys", "operator.pem"), operator.publicKey.export({ type: "spki", format: "pem" }));
  await writeFile(path.join(candidateRoot, "keys", "contract.pem"), contractSigner.publicKey.export({ type: "spki", format: "pem" }));
  await writeFile(path.join(candidateRoot, "sources", `${AUTHORIZATION_HANDLE}.json`), `${JSON.stringify({ authorizationHandle: AUTHORIZATION_HANDLE })}\n`);

  const writeEndpointIds = githubReleaseEffects.map(effect => `github.release.${effect}`);
  const endpointIds = [githubReleaseReadEndpointId, ...writeEndpointIds];
  const descriptor = {
    v: "reelier.connection-descriptor/v1" as const, connectionId: "github", kind: "adopted-mcp-stdio" as const,
    provider: { id: "github", toolServerName: "github-mcp" },
    callableRoute: { kind: "mcp-stdio" as const, routeId: "route.github", endpointIds },
    account: { status: "verified" as const, identity: "github-seldonframe-release" },
    toolSchemas: digestNormalizedMcpToolSchemas(endpointIds.map(name => ({ name, inputSchema: {} }))),
    secretOwner: "host" as const,
    coverage: { v: "reelier.host-coverage/v1" as const, host: "codex", observation: "observed" as const, outcomeInvocation: "supported" as const, exclusiveEnforcement: "unknown" as const, limitations: ["raw-write-reachability-unmeasured"] },
  };
  const adoptionBody = { v: "reelier.connection-adoption/v1" as const, adoptionId: "adopt_github_release", descriptorDigest: connectionDescriptorDigest(descriptor), selectedAccountIdentity: descriptor.account.identity, mode: "existing" as const, sidecarRouteId: descriptor.callableRoute.routeId, rawWriteReachability: "reachable" as const, activationState: "active" as const, secureConnectionCommitment: null };

  const limits = { maxEffectsPerWindow: 4, windowSeconds: 3600, maxEffectsPerSourceTrigger: 1, maxBodyBytes: 65_536 };
  const baseGrant = { v: "reelier.delegation-grant/v1" as const, tenant: "tenant_release", grantId: "grant_release", parentDigest: null, sponsor: "operator", grantor: "operator", grantee: "agent_release", issuedAt: "2026-01-01T00:00:00.000Z", expiresAt: "2027-01-01T00:00:00.000Z", constraints: { definitionAliases: [...githubReleaseAliases], audiences: ["agent_release"], connectorAccounts: [{ connectorId: "github", accountId: "account_release" }], projectionPointers: ["/authorizationHandle"], riskClasses: [githubReleaseRiskClass], limits } };

  // One signed contract and one signed delegation envelope per reviewed release definition.
  const states = githubReleasePacks.map((pack, index) => {
    const alias = pack.definition.alias;
    const effect = githubReleaseEffects[index]!;
    const contractGrant = { ...baseGrant, grantId: `contract_grant_${effect}`, grantee: "contract-signer", constraints: { ...baseGrant.constraints, definitionAliases: [alias] } };
    const contractGrantDigest = authorityDigest(contractGrant);
    const policy = { allocationDigest: sha(String(index + 1)), allocationId: `release-${effect}-01`, authorizationHandleDigest: authorityDigest({ handle: AUTHORIZATION_HANDLE }), effect, maxEffects: 1 };
    const contract = {
      v: "reelier.outcome-contract/v1", tenant: "tenant_release", alias, contractId: `contract_${effect}`, validFrom: "2026-01-01T00:00:00.000Z", validUntil: "2027-01-01T00:00:00.000Z",
      packDigest: pack.definition.packDigest, definitionDigest: pack.definition.definitionDigest, sponsor: "operator", audiences: ["agent_release"], delegationGrantDigest: contractGrantDigest,
      connectorId: "github", accountId: "account_release",
      sourceAuthority: { resolverId: pack.definition.resolverId, projectionSchemaId: githubReleaseProjectionSchemaId, allowedReadEndpointIds: [githubReleaseReadEndpointId], authorizedProjectionPointers: ["/authorizationHandle"], maxFreshnessSeconds: 60 },
      riskClasses: [githubReleaseRiskClass], limits,
      policyCommitment: { schemaId: githubReleasePolicySchemaId, jcsBase64: authorityCanonicalBytes(policy).toString("base64"), digest: authorityDigest(policy) },
    };
    const contractDigest = authorityDigest(contract);
    return {
      tenant: "tenant_release", definitionAlias: alias, stateVersion: 1,
      candidates: [{
        contractEnvelope: { canonicalBase64: authorityCanonicalBytes(contract).toString("base64"), advertisedDigest: contractDigest, signerId: "contract-signer", signature: signAuthorityDigest(contractSigner.privateKey, "outcome-contract", contractDigest) },
        delegationEnvelopes: [{ index: 0, canonicalBase64: authorityCanonicalBytes(contractGrant).toString("base64"), advertisedDigest: contractGrantDigest, signerId: "operator", signature: signAuthorityDigest(operator.privateKey, "delegation-grant", contractGrantDigest) }],
        stateEvents: [{ index: 0, kind: "activated", contractDigest, at: "2026-01-01T00:00:00.000Z" }],
      }],
    };
  });

  const jobCard = signJobCard({
    v: "reelier.signed-job-card/v1", jobId: "governed_production_release", title, taskShapeDigest: sha("a"),
    semanticClasses: ["deployment_release_v1"], definitionAliases: [...githubReleaseAliases], connectorIds: ["github"],
    accountIdentities: [descriptor.account.identity], connectionDescriptorDigests: [connectionDescriptorDigest(descriptor)], adoptionCommitmentDigests: [connectionAdoptionCommitmentDigest(adoptionBody)],
    sourceRefs: ["authorization"], audiences: ["agent_release"], limitsDigest: authorityDigest(limits), instructionsDigest: sha("c"), packDigests: [githubReleaseManifest.packDigest],
    exceptionPolicy: ["ambiguous-reconcile"], coverage: "declared-surface",
  }, "job_sponsor", sponsor.privateKey);
  const trustPin = jobCardTrustPinFixture(sponsor.publicKey, "job_sponsor", "cell_receipt_key");

  const candidate = {
    v: "reelier.authority-deployment-candidate/v1", jobCard, connectionDescriptors: [descriptor],
    connectionAdoptions: [{ ...adoptionBody, signedDeploymentBinding: signedJobCardDigest(jobCard) }],
    state: states[0],
    connectors: [{ tenant: "tenant_release", connectorId: "github", accountId: "account_release", providerAccountIdentity: descriptor.account.identity, allowedReadEndpointIds: [githubReleaseReadEndpointId], allowedWriteEndpointIds: writeEndpointIds, riskClasses: [githubReleaseRiskClass], operatorConfigurationDigest: sha("d") }],
    trust: [{ signerId: "operator", principalId: "operator", publicKeyFile: "keys/operator.pem", purposes: ["delegation-grant"] }, { signerId: "contract-signer", principalId: "contract-signer", publicKeyFile: "keys/contract.pem", purposes: ["outcome-contract"] }],
    sourceDirectory: "sources",
  };
  const candidateFile = path.join(candidateRoot, "candidate.json");
  await writeFile(candidateFile, `${JSON.stringify(candidate)}\n`);
  const authorityRoot = path.join(root, "authority");
  const built = await buildAuthorityDeployment(candidateFile, path.join(authorityRoot, "deployment"), trustPin);
  const manifest = JSON.parse(await readFile(built.deploymentFile, "utf8"));
  manifest.states.push(...states.slice(1));
  await writeFile(built.deploymentFile, `${JSON.stringify(manifest)}\n`);
  const hostPin = path.join(authorityRoot, "trust", "job-card.json");
  await mkdir(path.dirname(hostPin), { recursive: true });
  await copyFile(built.jobCardTrustEvidenceFile, hostPin);

  // Runner material: only PEM key FILES and a public SPKI reference ever live in the config.
  const runnerRoot = path.join(root, "runner");
  const keyDir = path.join(runnerRoot, "keys");
  const authorizationDir = path.join(runnerRoot, "authorizations");
  const fixtureDir = path.join(runnerRoot, "provider-fixtures");
  await Promise.all([mkdir(keyDir, { recursive: true }), mkdir(authorizationDir, { recursive: true }), mkdir(fixtureDir, { recursive: true })]);
  const journalKeys = generateKeyPairSync("ed25519");
  const evidenceKeys = generateKeyPairSync("ed25519");
  const releaseAuthorityKeys = generateKeyPairSync("ed25519");
  const journalKeyFile = path.join(keyDir, "journal.pem");
  const evidenceKeyFile = path.join(keyDir, "evidence.pem");
  await writeFile(journalKeyFile, journalKeys.privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  await writeFile(evidenceKeyFile, evidenceKeys.privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });

  // One REAL signed authorization bundle set, plus a wrong-signer twin. Everything the resolver
  // reads at `<authorizationDir>/<handle>.json` is produced here by the production signing helpers.
  const laneKeys = new Map(LANE_SIGNERS.map(([lane, laneSignerId]) => [lane, { signerId: laneSignerId, pair: generateKeyPairSync("ed25519") }]));
  const graphMakerKeys = generateKeyPairSync("ed25519");
  const foreignAuthorityKeys = generateKeyPairSync("ed25519");
  const executableRunnerLanes = new Set<ReleaseEvidenceLaneV1>(["candidate-branch", "candidate-pull-request", "merge-exact-sha"]);
  const evidenceVerifierBindings = LANE_SIGNERS.map(([lane, laneSignerId]) => options.executableCandidate && executableRunnerLanes.has(lane) ? ({ lane, publicKeySpkiDigest: spkiDigest(evidenceKeys.publicKey), signerId: "release-provider-verifier" }) : ({ lane, publicKeySpkiDigest: spkiDigest(laneKeys.get(lane)!.pair.publicKey), signerId: laneSignerId }));
  const receiptGraphMakerBinding = { publicKeySpkiDigest: spkiDigest(graphMakerKeys.publicKey), signerId: RELEASE_GRAPH_MAKER_SIGNER_ID };

  const laneEvidence = (lane: ReleaseEvidenceLaneV1, overrides: Partial<ReleaseVerifierEvidenceV1>) => {
    const trusted = laneKeys.get(lane)!;
    return {
      evidence: createSignedReleaseVerifierEvidenceV1({
        v: "reelier.release-verifier-evidence/v1", authorizationBundleDigest: null, candidateCommit: null, count: null, freshUntil: null,
        lane, observation: "workflow-run", observedAt: AUTHORIZATION_OBSERVED_AT, resultValue: null, status: "verified",
        subjectDigest: releaseDigest("f"), workflowDigest: null, workflowPath: null, ...overrides,
      }, { signerId: trusted.signerId, privateKey: trusted.pair.privateKey }),
      verifier: { publicKeySpkiBase64: spkiBase64(trusted.pair.publicKey), signerId: trusted.signerId },
    };
  };

  const authorizationBundle = (privateKey: KeyObject, repository: string = RELEASE_REPOSITORY): Record<string, unknown> => {
    const signer = { signerId: RELEASE_AUTHORITY_SIGNER_ID, privateKey };
    const executableContents = ["CHANGELOG.md", "src/cli.ts", "test/cli-subcommand-help.test.ts"].map((filePath, index) => ({ path: filePath, bytesBase64: Buffer.from(`fixture release file ${index}\n`, "utf8").toString("base64") }));
    const files = options.executableCandidate ? executableContents.map(item => { const bytes = Buffer.from(item.bytesBase64, "base64"); return { blobSha: createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"), contentDigest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`, mode: "100644" as const, path: item.path }; }) : [
      { blobSha: releaseCommit("b"), contentDigest: releaseDigest("b"), mode: "100644" as const, path: "CHANGELOG.md" },
      { blobSha: releaseCommit("c"), contentDigest: releaseDigest("c"), mode: "100644" as const, path: "src/cli.ts" },
      { blobSha: releaseCommit("d"), contentDigest: releaseDigest("d"), mode: "100644" as const, path: "test/cli-subcommand-help.test.ts" },
    ];
    const candidateTreeDigest = authorityDigest({ v: "reelier.release-candidate-tree/v1", files });
    const workflowCommitments = [
      { digest: releaseDigest("3"), path: ".github/workflows/ci.yml" }, { digest: releaseDigest("4"), path: ".github/workflows/docker-publish.yml" },
      { digest: releaseDigest("5"), path: ".github/workflows/mcp-publish.yml" }, { digest: releaseDigest("a"), path: ".github/workflows/npm-publish.yml" },
    ];
    const quality = { coverageEvidenceDigest: releaseDigest("6"), coverageStatus: "non-regressed" as const, fullTestEvidenceDigest: releaseDigest("7"), fullTestsStatus: "verified" as const, headCommit: releaseCommit("a"), mutationEvidenceDigest: releaseDigest("8"), mutationScoreBasisPoints: 9_137 };
    const operationPlan = createSignedReleaseOperationPlanV1({
      v: "reelier.release-operation-plan/v1", baseCommit: RELEASE_BASE_COMMIT, baseTreeSha: releaseCommit("b"), candidateBranch: "reelier/release/0.32.1", candidateTreeDigest,
      commit: { author: { date: "2026-08-18T05:00:00.000Z", email: "release@seldonframe.com", name: "SeldonFrame Release" }, committer: { date: "2026-08-18T05:00:00.000Z", email: "release@seldonframe.com", name: "SeldonFrame Release" }, message: "release: v0.32.1", parentSha: RELEASE_BASE_COMMIT },
      destinationBranch: "main", expectedCommitSha: releaseCommit("a"), expectedTreeSha: releaseCommit("e"), files,
      npmPreflight: { packageName: "reelier", version: "0.32.1", versionMustBeAbsent: true },
      pullRequest: { base: "main", body: "Governed release v0.32.1", draft: true, head: "reelier/release/0.32.1", readyForReview: true, title: "Release v0.32.1" },
      repository, requiredChecks: ["coverage", "full-tests", "mutation"],
      squash: { commitMessage: "release: v0.32.1", commitTitle: "Release v0.32.1" }, tag: "v0.32.1", workflowCommitments,
    } as never, signer);
    const candidateManifest = createSignedStagedCandidateManifestV1({
      v: "reelier.staged-candidate-manifest/v1", baseCommit: RELEASE_BASE_COMMIT, branch: "reelier/release/0.32.1", candidateCommit: releaseCommit("a"), candidateTreeDigest,
      changedBytes: 4_096, changedPaths: ["CHANGELOG.md", "src/cli.ts", "test/cli-subcommand-help.test.ts"], destinationBranch: "main", qualityEvidence: quality,
      packageName: "reelier", packageVersion: "0.32.1", packedTarballDigest: releaseDigest("2"), repository, tag: "v0.32.1", workflowCommitments,
    }, signer);
    const policy = createSignedReleasePolicyV1({
      v: "reelier.release-policy/v1", allowedPaths: ["CHANGELOG.md", "src/cli.ts", "test/cli-subcommand-help.test.ts"], destinations: ["ghcr", "mcp-registry", "npm"],
      effectAllocations: ["candidate-branch", "draft-pr", "exact-sha-merge", "non-force-tag"], expirySeconds: 43_200,
      forbiddenChangeClasses: ["authority-contract", "credential", "dependency", "generated-contract", "lockfile", "policy", "release-script", "workflow"],
      maxChangedBytes: 65_536, maxChangedFiles: 3,
    }, signer);
    const reviewedPack = createGitHubLinearOutcomePackV1({ v: "reelier.github-linear-reviewed-authority/v1", github: { repository, baseBranch: operationPlan.value.destinationBranch, baseSha: operationPlan.value.baseCommit, headBranch: operationPlan.value.candidateBranch, headSha: operationPlan.value.expectedCommitSha, candidateDigest: operationPlan.value.candidateTreeDigest, workflowPath: ".github/workflows/ci.yml", workflowDigest: workflowCommitments[0]!.digest, requiredChecks: operationPlan.value.requiredChecks, mergeMethod: "squash", postMergeTreeSha: operationPlan.value.expectedTreeSha, accountRef: "github_account_ref", destinationRef: "github_repository_ref", credentialRef: "github_credential_ref", limitRef: "github_release_policy_ref" }, linear: { workspace: "workspace_01", team: "team_01", project: "project_01", issue: "REEL-TEST-1", preStatus: "In Progress", targetStatus: "Done", commentMarker: "reelier:evidence:fixture", evidenceUrl: "https://www.reelier.com/r/fixture", evidenceContentDigest: releaseDigest("f"), accountRef: "linear_account_ref", destinationRef: "linear_issue_ref", credentialRef: "linear_credential_ref", limitRef: "linear_transition_policy_ref" } });
    const authorization = createSignedReleaseAuthorizationBundleV1({
      v: "reelier.release-authorization-bundle/v1", authorityCellDigest: releaseDigest("9"),
      effectAllocations: [
        { allocationDigest: releaseDigest("a"), allocationId: "release-candidate-branch-01", effect: "candidate-branch", maxEffects: 1 },
        { allocationDigest: releaseDigest("b"), allocationId: "release-draft-pr-01", effect: "draft-pr", maxEffects: 1 },
        { allocationDigest: releaseDigest("c"), allocationId: "release-exact-sha-merge-01", effect: "exact-sha-merge", maxEffects: 1 },
        { allocationDigest: releaseDigest("d"), allocationId: "release-non-force-tag-01", effect: "non-force-tag", maxEffects: 1 },
      ],
      evidenceVerifierBindings, expiresAt: AUTHORIZATION_EXPIRES_AT, issuedAt: AUTHORIZATION_ISSUED_AT, jobCardDigest: releaseDigest("e"), missionDigest: releaseDigest("f"),
      operationPlanDigest: operationPlan.digest, packDigest: githubReviewedReleasePackDigestV1(reviewedPack), policyDigest: policy.digest, receiptGraphMakerBinding,
      rootGrantDigest: releaseDigest("1"), stagedCandidateManifestDigest: candidateManifest.digest, taskDigest: releaseDigest("2"),
    }, signer);
    const evidence = [
      laneEvidence("ci-coverage", { candidateCommit: releaseCommit("a"), resultValue: 1, subjectDigest: quality.coverageEvidenceDigest, workflowDigest: workflowCommitments[0]!.digest, workflowPath: workflowCommitments[0]!.path as ReleaseVerifierEvidenceV1["workflowPath"] }),
      laneEvidence("ci-full-tests", { candidateCommit: releaseCommit("a"), resultValue: 1, subjectDigest: quality.fullTestEvidenceDigest, workflowDigest: workflowCommitments[0]!.digest, workflowPath: workflowCommitments[0]!.path as ReleaseVerifierEvidenceV1["workflowPath"] }),
      laneEvidence("ci-mutation", { candidateCommit: releaseCommit("a"), resultValue: quality.mutationScoreBasisPoints, subjectDigest: quality.mutationEvidenceDigest, workflowDigest: workflowCommitments[0]!.digest, workflowPath: workflowCommitments[0]!.path as ReleaseVerifierEvidenceV1["workflowPath"] }),
    ];
    return { authorization, candidateManifest, operationPlan, policy, evidence, fileContents: options.executableCandidate ? executableContents : [] };
  };

  const writeAuthorizationBundle = async (handle: string, body: unknown): Promise<string> => {
    const file = path.join(authorizationDir, `${handle}.json`);
    await writeFile(file, `${JSON.stringify(body)}\n`, { mode: 0o600 });
    return file;
  };
  const authorizationBundleBody = authorizationBundle(releaseAuthorityKeys.privateKey);
  await writeAuthorizationBundle(AUTHORIZATION_HANDLE, authorizationBundleBody);
  await writeAuthorizationBundle(WRONG_SIGNER_HANDLE, authorizationBundle(foreignAuthorityKeys.privateKey));

  const runnerConfigBody = {
    v: "reelier.github-release-runner-config/v1",
    rootDir: path.join(runnerRoot, "state"),
    journalSignerId: "release-journal-2026",
    journalKeyFile,
    evidenceSignerId: "release-provider-verifier",
    evidenceKeyFile,
    releaseAuthority: { signerId: RELEASE_AUTHORITY_SIGNER_ID, publicKeySpkiBase64: spkiBase64(releaseAuthorityKeys.publicKey) },
    authorizationDir,
    provider: { kind: "loopback-fixture", fixtureDir },
  };
  const runnerConfigFile = path.join(root, "release-runner.json");
  await writeFile(runnerConfigFile, `${JSON.stringify(runnerConfigBody, null, 2)}\n`, { mode: 0o600 });

  const configBody: Record<string, unknown> = {
    version: 1, tenant: "tenant_release", requester: "agent_release", authorityCellId: "cell_release",
    definitions: [...githubReleaseAliases], topology: "isolated",
    ledgerDir: "ledger", decisionDir: "decisions", receiptDir: "receipts", gateKeyFile: "keys/local-gate.pem",
    endpoints: [], deploymentPath: built.deploymentFile, jobCardTrustPinPath: hostPin,
  };
  const writeConfig = async (name: string, body: Record<string, unknown>): Promise<string> => {
    const file = path.join(authorityRoot, name);
    await writeFile(file, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
    return file;
  };
  const configFile = await writeConfig("authority.yml", configBody);
  return Object.freeze({
    root, configFile, runnerConfigFile, configBody, runnerConfigBody, writeConfig,
    authorizationHandle: AUTHORIZATION_HANDLE, wrongSignerHandle: WRONG_SIGNER_HANDLE, authorizationDir, authorizationBundleBody,
    authorizationDigest: (authorizationBundleBody.authorization as Readonly<{ digest: string }>).digest,
    authorizationNow: AUTHORIZATION_NOW, writeAuthorizationBundle,
  });
}
