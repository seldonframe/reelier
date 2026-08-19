import { generateKeyPairSync } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { authorityCanonicalBytes, authorityDigest, signAuthorityDigest, signJobCard, signedJobCardDigest } from "../../src/authority/index.js";
import { connectionAdoptionCommitmentDigest, connectionDescriptorDigest, digestNormalizedMcpToolSchemas } from "../../src/connections.js";
import { buildAuthorityDeployment } from "../../src/authority/host/deploy.js";
import { githubReleasePacks } from "../../src/packs/github-release/index.js";
import { githubReleaseAliases, githubReleaseEffects, githubReleaseManifest, githubReleasePolicySchemaId, githubReleaseProjectionSchemaId, githubReleaseReadEndpointId, githubReleaseRiskClass } from "../../src/packs/github-release/manifest.js";
import { jobCardTrustPinFixture } from "./job-card-trust-pin-fixture.js";

const sha = (seed: string) => `sha256:${seed.repeat(64).slice(0, 64)}`;
const AUTHORIZATION_HANDLE = "release-authorization-01";

export interface ReleaseServeFixture {
  readonly root: string;
  /** Signed four-alias `authority.yml`, exactly the production release definition set. */
  readonly configFile: string;
  /** Closed `reelier.github-release-runner-config/v1` file with a loopback fixture provider. */
  readonly runnerConfigFile: string;
  readonly configBody: Record<string, unknown>;
  readonly runnerConfigBody: Record<string, unknown>;
  /** Writes a sibling config file so relative paths resolve identically. */
  writeConfig(name: string, body: Record<string, unknown>): Promise<string>;
}

/** A real signed four-definition GitHub release deployment plus the operator-owned runner config
 * that `authority serve --release-runner-config` must construct and inject. Modeled on
 * `multiDefinitionFixture` in local-multi-definition-jobs.test.ts. */
export async function releaseServeFixture(title = "Governed production release"): Promise<ReleaseServeFixture> {
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

  const runnerConfigBody = {
    v: "reelier.github-release-runner-config/v1",
    rootDir: path.join(runnerRoot, "state"),
    journalSignerId: "release-journal-2026",
    journalKeyFile,
    evidenceSignerId: "release-provider-verifier",
    evidenceKeyFile,
    releaseAuthority: { signerId: "release-authority-2026", publicKeySpkiBase64: releaseAuthorityKeys.publicKey.export({ type: "spki", format: "der" }).toString("base64") },
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
  return Object.freeze({ root, configFile, runnerConfigFile, configBody, runnerConfigBody, writeConfig });
}
