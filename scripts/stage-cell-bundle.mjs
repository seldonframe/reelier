#!/usr/bin/env node
// Stages the COMPLETE volume payload a Fly Authority Cell needs for the governed production
// release, entirely locally, from the operator's own ceremony keys.
//
//   node scripts/stage-cell-bundle.mjs --keys <dir> --out <dir> --repository <owner/name> \
//     [--token-ref env:REELIER_RELEASE_GITHUB_PAT] [--audience <principal>] \
//     [--authorization-handle <handle>]
//
// WHAT IT PRODUCES, under `<out>/authority/` — laid out exactly as `/data/authority` on the volume
// (`infra/fly/authority-cell/authority-cell.toml`):
//
//   authority.yml                       four-alias host config (JSON is the canonical emitted form)
//   deployment/deployment.json          signed deployment built by `buildAuthorityDeployment`
//   deployment/job.json                 the signed Job Card
//   deployment/job-card-trust-evidence.json   exported copy (review only, never the host pin)
//   deployment/trust/keys/*.pem         PUBLIC SPKI keys of the deployment trust roots
//   deployment/sources/<handle>.json    the authorization-handle source projection document
//   trust/job-card.json                 the host-owned Job Card trust pin (OUTSIDE deployment/)
//   release-runner.config.json          closed `reelier.github-release-runner-config/v1`
//   keys/journal-signer.key.pem         Cell journal signing key  (KEY MATERIAL)
//   keys/evidence-signer.key.pem        Cell evidence signing key (KEY MATERIAL)
//   authorizations/                     empty; the per-release signed bundle lands here
//   principals/                         empty; the durable principal registry lands here
//
// WHAT IT NEVER DOES:
//   - The release-authority PRIVATE key never enters the bundle and is never printed. It is read
//     only to derive its public SPKI, which is what every schema actually needs.
//   - No token, bearer, or credential VALUE is ever written. `githubTokenRef` is a SecretResolver
//     reference (`env:NAME`), which is the only form the closed schema accepts.
//   - It writes nothing outside `--out` except newly generated ceremony keys inside `--keys`, and
//     it never overwrites a key file that already exists.
//
// KEYS. `--keys` must already contain the three operator ceremony keys, all Ed25519 PKCS#8 PEM:
//   release-authority.key.pem   signs release authorization bundles offline  (signer id reelier.release-authority.2026)
//   journal-signer.key.pem      Cell release-runner journal                  (signer id reelier.cell.journal.2026)
//   evidence-signer.key.pem     Cell release-runner evidence                 (signer id reelier.cell.evidence.2026)
//
// The verification chain in `src/authority/host/local.ts` needs four MORE signing identities that
// the release authority cannot stand in for, so the script mints them into `--keys` on first run
// and reuses them (never overwrites) afterwards:
//   job-signer.key.pem          signs the Job Card. `deployment.ts` (`jobCardTrustMaterialFromPin`)
//                               requires a `human-sponsor` / `signed-job-card` key descriptor whose
//                               keyId equals `jobCard.signerId`, and `verifyJobCardTrust` refuses a
//                               signer that appears in the card's own audiences — so it is
//                               structurally a DIFFERENT key from both the release authority and
//                               the agent principal.
//   readiness-signer.key.pem    the human-sponsor root of the trust pin. The pin's authority comes
//                               from a signed certification readiness (`createSignedCertificationReadiness`),
//                               and this key is what activates the Job Card signer descriptor.
//   deployment-operator.key.pem signs the delegation-grant envelopes in the deployment states.
//   deployment-contract.key.pem signs the outcome-contract envelopes in the deployment states.
// Only the journal and evidence PEMs are copied into the bundle. The other five stay operator-held.
//
// The pinned Cell key descriptor is bound to the EVIDENCE signer's public key rather than to a
// freshly generated throwaway, so the descriptor names a key that genuinely runs in the Cell.
//
// HONEST LIMIT ON THE READINESS ARTIFACT. The Job Card trust pin's root is a
// `reelier.signed-certification-readiness/v1` record, whose schema requires a certification
// scenario id. There is no release scenario id in `CERTIFICATION_SCENARIO_IDS`, so the readiness
// names `github-issue-labels` with empty commitments. That record carries NO release authority:
// `authorization: "absent"` and `dispatchable: false` on the candidate. Its only job here is to
// root the Job Card signer descriptor. Do not read it as a certification of anything.
//
// BUILD PREREQUISITE: imports the built modules under `dist/` (`npm ci && npm run build` first).
// `REELIER_STAGE_CELL_DIST` overrides the root that is imported from; the test points it at
// `dist-test/src` so the hermetic run needs no separate production build.

import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync } from "node:crypto";
import { copyFile, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** The guest mount from `infra/fly/authority-cell/authority-cell.toml` (`/data` + config dir). */
const GUEST_ROOT = "/data/authority";
const RELEASE_AUTHORITY_SIGNER_ID = "reelier.release-authority.2026";
const JOURNAL_SIGNER_ID = "reelier.cell.journal.2026";
const EVIDENCE_SIGNER_ID = "reelier.cell.evidence.2026";
/** `parseAuthorityKeyDescriptor` KEY_ID is `/^[a-z][a-z0-9_-]{2,127}$/` — dots are refused there,
 * which is why these differ in spelling from the dotted runner-config signer ids above. */
const JOB_CARD_KEY_ID = "reelier_cell_jobcard_2026";
const CELL_KEY_ID = "reelier_cell_evidence_2026";
const TENANT = "tenant_release";
const JOB_ID = "governed_production_release";
const DEFAULT_AUDIENCE = "agent_release";
const DEFAULT_TOKEN_REF = "env:REELIER_RELEASE_GITHUB_PAT";
const DEFAULT_AUTHORIZATION_HANDLE = "release-authorization-01";
const OPERATOR_SIGNER_ID = "operator";
const CONTRACT_SIGNER_ID = "contract-signer";
const REQUIRED_KEYS = Object.freeze(["release-authority.key.pem", "journal-signer.key.pem", "evidence-signer.key.pem"]);
const GENERATED_KEYS = Object.freeze(["job-signer.key.pem", "readiness-signer.key.pem", "deployment-operator.key.pem", "deployment-contract.key.pem"]);
const REPOSITORY = /^[A-Za-z0-9._-]{1,100}\/[A-Za-z0-9._-]{1,100}$/;
const OPAQUE_HANDLE = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/;
const PRINCIPAL = /^[A-Za-z0-9][A-Za-z0-9._~:-]{0,127}$/;

function fail(message) {
  console.error(`stage-cell-bundle: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) fail(`unexpected positional argument ${JSON.stringify(arg)}`);
    const eq = arg.indexOf("=");
    const name = eq > 0 ? arg.slice(2, eq) : arg.slice(2);
    const value = eq > 0 ? arg.slice(eq + 1) : argv[index + (eq > 0 ? 0 : 1)];
    if (eq < 0) index += 1;
    if (value === undefined) fail(`--${name} requires a value`);
    if (opts.has(name)) fail(`--${name} was supplied more than once`);
    opts.set(name, value);
  }
  const known = new Set(["keys", "out", "repository", "token-ref", "audience", "authorization-handle"]);
  for (const name of opts.keys()) if (!known.has(name)) fail(`unknown option --${name}`);
  for (const name of ["keys", "out", "repository"]) if (!opts.has(name)) fail(`--${name} is required`);
  const repository = opts.get("repository");
  if (!REPOSITORY.test(repository)) fail("--repository must be an owner/name identity");
  const audience = opts.get("audience") ?? DEFAULT_AUDIENCE;
  if (!PRINCIPAL.test(audience)) fail("--audience must be a principal identity");
  const handle = opts.get("authorization-handle") ?? DEFAULT_AUTHORIZATION_HANDLE;
  if (!OPAQUE_HANDLE.test(handle)) fail("--authorization-handle is not an opaque handle");
  return Object.freeze({
    keysDir: path.resolve(opts.get("keys")),
    outDir: path.resolve(opts.get("out")),
    repository,
    tokenRef: opts.get("token-ref") ?? DEFAULT_TOKEN_REF,
    audience,
    authorizationHandle: handle,
  });
}

const distRoot = process.env.REELIER_STAGE_CELL_DIST
  ? pathToFileURL(path.resolve(process.env.REELIER_STAGE_CELL_DIST) + path.sep).href
  : new URL("../dist/", import.meta.url).href;

async function load(relative, names) {
  const url = new URL(relative, distRoot).href;
  let module;
  try { module = await import(url); } catch (error) {
    fail(`cannot import ${url}; run "npm ci && npm run build" first (${error instanceof Error ? error.message : String(error)})`);
  }
  for (const name of names) if (module[name] === undefined) fail(`${url} does not export ${name}; the build is stale or the module moved`);
  return module;
}

const { authorityCanonicalBytes, authorityDigest, signAuthorityDigest, signJobCard, signedJobCardDigest, parseAuthorityKeyDescriptor } =
  await load("authority/index.js", ["authorityCanonicalBytes", "authorityDigest", "signAuthorityDigest", "signJobCard", "signedJobCardDigest", "parseAuthorityKeyDescriptor"]);
// Not re-exported by the public barrels; imported by path, which is what `verify-release-authorization.mjs` does too.
const { createSignedCertificationReadiness } = await load("authority/certification/authority.js", ["createSignedCertificationReadiness"]);
const { certificationRunnerRegistryDigest } = await load("authority/certification/runner-registry.js", ["certificationRunnerRegistryDigest"]);
const { buildAuthorityDeployment, loadAuthorityDeployment, validateAuthorityHostConfig } =
  await load("authority/host/index.js", ["buildAuthorityDeployment", "loadAuthorityDeployment", "validateAuthorityHostConfig"]);
const { parseGitHubReleaseRunnerOperatorConfig } = await load("authority/host/github-release-runner-config.js", ["parseGitHubReleaseRunnerOperatorConfig"]);
const { connectionAdoptionCommitmentDigest, connectionDescriptorDigest, digestNormalizedMcpToolSchemas } =
  await load("connections.js", ["connectionAdoptionCommitmentDigest", "connectionDescriptorDigest", "digestNormalizedMcpToolSchemas"]);
const { githubReleasePacks } = await load("packs/github-release/index.js", ["githubReleasePacks"]);
const releasePack = await load("packs/github-release/manifest.js", ["githubReleaseAliases"]);
const {
  githubReleaseAliases, githubReleaseEffects, githubReleaseManifest, githubReleasePolicySchemaId,
  githubReleaseProjectionSchemaId, githubReleaseReadEndpointId, githubReleaseRiskClass,
} = releasePack;

const guest = (...segments) => [GUEST_ROOT, ...segments].join("/");
const spkiBase64 = key => key.export({ format: "der", type: "spki" }).toString("base64");
const publicPem = key => key.export({ format: "pem", type: "spki" });
/** 24 lowercase hex, the shape every `certification identifiers` pattern demands. */
const identifier = (prefix, seed) => `${prefix}_${createHash("sha256").update(seed).digest("hex").slice(0, 24)}`;
const sha256File = async file => `sha256:${createHash("sha256").update(await readFile(file)).digest("hex")}`;

/** Reads an existing Ed25519 private key, or mints one at `file` and returns it. Never overwrites:
 * `wx` refuses an existing path, and an existing path is reused rather than clobbered — a ceremony
 * key that silently changed underneath a committed trust pin is unrecoverable. */
async function readOrCreatePrivateKey(file, label) {
  let pem;
  try { pem = await readFile(file, "utf8"); } catch (error) {
    if ((error && error.code) !== "ENOENT") fail(`${label} at ${file} cannot be read: ${error instanceof Error ? error.message : String(error)}`);
    const generated = generateKeyPairSync("ed25519");
    await writeFile(file, generated.privateKey.export({ format: "pem", type: "pkcs8" }), { encoding: "utf8", flag: "wx", mode: 0o600 });
    return { privateKey: generated.privateKey, publicKey: generated.publicKey, created: true };
  }
  return { ...assertEd25519(pem, file, label), created: false };
}

async function readRequiredPrivateKey(file, label) {
  let pem;
  try { pem = await readFile(file, "utf8"); } catch (error) {
    fail((error && error.code) === "ENOENT" ? `${label} is missing at ${file}` : `${label} at ${file} cannot be read: ${error instanceof Error ? error.message : String(error)}`);
  }
  return assertEd25519(pem, file, label);
}

function assertEd25519(pem, file, label) {
  let privateKey;
  try { privateKey = createPrivateKey(pem); } catch (error) {
    return fail(`${label} at ${file} is not a readable private key: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (privateKey.asymmetricKeyType !== "ed25519") fail(`${label} at ${file} is ${String(privateKey.asymmetricKeyType)}, not ed25519`);
  return { privateKey, publicKey: createPublicKey(privateKey) };
}

/** The trust pin. Same construction the serve path verifies (`jobCardTrustMaterialFromPin` ->
 * `verifySignedCertificationReadiness`), with operator keys instead of the test fixture's. */
function buildJobCardTrustPin(input) {
  const descriptor = (keyId, role, purpose, key) => parseAuthorityKeyDescriptor({
    v: "reelier.authority-key-descriptor/v1", keyId, role, purpose, algorithm: "ed25519", publicKeySpkiBase64: spkiBase64(key),
  });
  const human = descriptor(input.identifiers.signerId, "human-sponsor", "certification-readiness", input.readinessPublicKey);
  const jobDescriptor = descriptor(JOB_CARD_KEY_ID, "human-sponsor", "signed-job-card", input.jobPublicKey);
  const cell = descriptor(CELL_KEY_ID, "authority-cell", "authority-evidence", input.cellPublicKey);
  const event = (sequence, item, previousEventDigest) => ({
    v: "reelier.authority-trust-event/v1", eventId: `trust_${sequence}_${createHash("sha256").update(`${input.identifiers.taskId}\0${sequence}`).digest("hex").slice(0, 12)}`,
    sequence, action: "activate", keyDescriptorDigest: authorityDigest(item), occurredAt: input.occurredAt, previousEventDigest,
  });
  const first = event(0, human, null);
  const second = event(1, jobDescriptor, authorityDigest(first));
  const third = event(2, cell, authorityDigest(second));
  const emptyInput = Object.freeze({ status: "configured", artifacts: Object.freeze([]) });
  const commitments = Object.freeze({
    resources: Object.freeze([]), cleanup: Object.freeze([]), credentials: Object.freeze([]),
    runners: emptyInput, tests: emptyInput, plans: emptyInput, endpoints: emptyInput,
    runnerRegistryDigest: certificationRunnerRegistryDigest, topology: "absent", signatureStatus: "absent",
  });
  const readiness = {
    v: "reelier.certification-readiness-candidate/v1", status: "awaiting-human-signature", preparationReady: true,
    signatureStatus: "absent", authorization: "absent", dispatchable: false, completeness: "unchecked",
    configDigest: input.configDigest, selectionDigest: input.selectionDigest, preflightDigest: "",
    scenarios: ["github-issue-labels"], identifiers: input.identifiers, commitments,
  };
  const preflightBody = {
    v: "reelier.certification-preflight/v2", configDigest: readiness.configDigest, selectionDigest: readiness.selectionDigest,
    identifiers: readiness.identifiers, scenarios: readiness.scenarios, resources: commitments.resources, cleanup: commitments.cleanup,
    credentialReferences: commitments.credentials,
    inputs: { runners: commitments.runners, tests: commitments.tests, plans: commitments.plans, endpoints: commitments.endpoints },
    runnerRegistryDigest: commitments.runnerRegistryDigest, topology: commitments.topology, trust: "unchecked",
    signatureStatus: "absent", authorization: "absent", completeness: "unchecked", missing: Object.freeze([]),
    ok: true, preparationReady: true, executionReady: false, dispatchable: false,
  };
  const preflight = Object.freeze({ ...preflightBody, digest: authorityDigest(preflightBody) });
  readiness.preflightDigest = preflight.digest;
  const keyDescriptors = Object.freeze([human, jobDescriptor, cell]);
  const trustEvents = Object.freeze([first, second, third]);
  const signedReadiness = createSignedCertificationReadiness({
    readinessCandidate: readiness, readinessCandidateDigest: authorityDigest(readiness), preflight,
    humanKeyDescriptor: human, jobCardKeyDescriptors: [jobDescriptor], cellKeyDescriptors: [cell],
    trustEvents, humanPrivateKey: input.readinessPrivateKey, authorizedAt: input.occurredAt,
  });
  return Object.freeze({
    v: "reelier.job-card-trust-pin/v1", signedReadiness, readinessCandidate: readiness, preflight,
    humanTrustRoot: human, keyDescriptors, readinessTrustEvents: trustEvents, currentTrustEvents: trustEvents,
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const authorityOut = path.join(args.outDir, "authority");
  // No silent overwrite: an `authority/` root already present is the operator's previous bundle,
  // and re-staging over it would leave a half-old, half-new payload nobody can attribute.
  try {
    await lstat(authorityOut);
    fail(`${authorityOut} already exists; refusing to overwrite a staged bundle`);
  } catch (error) {
    if ((error && error.code) !== "ENOENT") throw error;
  }
  // `authorityOut` is deliberately NOT created here. Every key refusal below must leave `--out`
  // untouched: a refusal that already made an `authority/` root is a refusal the operator cannot
  // retry, because the next run refuses on the residue it just created. `buildAuthorityDeployment`
  // creates the root as its first side effect, once every input has been validated.

  const releaseAuthority = await readRequiredPrivateKey(path.join(args.keysDir, "release-authority.key.pem"), "release authority key");
  const journal = await readRequiredPrivateKey(path.join(args.keysDir, "journal-signer.key.pem"), "Cell journal signer key");
  const evidence = await readRequiredPrivateKey(path.join(args.keysDir, "evidence-signer.key.pem"), "Cell evidence signer key");
  const jobSigner = await readOrCreatePrivateKey(path.join(args.keysDir, "job-signer.key.pem"), "Job Card signer key");
  const readinessSigner = await readOrCreatePrivateKey(path.join(args.keysDir, "readiness-signer.key.pem"), "readiness human-sponsor key");
  const operatorSigner = await readOrCreatePrivateKey(path.join(args.keysDir, "deployment-operator.key.pem"), "deployment delegation-grant key");
  const contractSigner = await readOrCreatePrivateKey(path.join(args.keysDir, "deployment-contract.key.pem"), "deployment outcome-contract key");

  const occurredAt = new Date().toISOString();
  const ceremonySeed = authorityDigest({
    v: "reelier.governed-release-cell-ceremony/v1", repository: args.repository, tenant: TENANT,
    audience: args.audience, authorizationHandle: args.authorizationHandle,
    definitionAliases: [...githubReleaseAliases], jobSignerSpki: spkiBase64(jobSigner.publicKey),
  });
  const identifiers = Object.freeze({
    taskId: identifier("task", `${ceremonySeed}\0task`),
    jobCardId: identifier("job", `${ceremonySeed}\0jobCard`),
    rootGrantId: identifier("grant", `${ceremonySeed}\0rootGrant`),
    authorityCellId: identifier("cell", `${ceremonySeed}\0cell`),
    signerId: identifier("signer", spkiBase64(readinessSigner.publicKey)),
  });
  const trustPin = buildJobCardTrustPin({
    identifiers, occurredAt,
    readinessPrivateKey: readinessSigner.privateKey, readinessPublicKey: readinessSigner.publicKey,
    jobPublicKey: jobSigner.publicKey, cellPublicKey: evidence.publicKey,
    configDigest: ceremonySeed, selectionDigest: authorityDigest({ v: "reelier.governed-release-cell-selection/v1", repository: args.repository, definitionAliases: [...githubReleaseAliases] }),
  });

  // ---- the reviewed deployment candidate -------------------------------------------------------
  // `connector.ts` ID is `/^[A-Za-z0-9][A-Za-z0-9._~:-]{0,127}$/` — a `/` is refused, so the
  // owner/name separator becomes `:` here. The unsplit `owner/name` stays in the runner config,
  // which is where the provider actually reads it (`assertRepositoryIdentity`).
  const accountIdentity = `github:${args.repository.replace("/", ":")}`;
  const writeEndpointIds = githubReleaseEffects.map(effect => `github.release.${effect}`);
  const endpointIds = [githubReleaseReadEndpointId, ...writeEndpointIds];
  const descriptor = {
    v: "reelier.connection-descriptor/v1", connectionId: "github", kind: "adopted-mcp-stdio",
    provider: { id: "github", toolServerName: "github-mcp" },
    callableRoute: { kind: "mcp-stdio", routeId: "route.github", endpointIds },
    account: { status: "verified", identity: accountIdentity },
    toolSchemas: digestNormalizedMcpToolSchemas(endpointIds.map(name => ({ name, inputSchema: {} }))),
    secretOwner: "host",
    coverage: { v: "reelier.host-coverage/v1", host: "codex", observation: "observed", outcomeInvocation: "supported", exclusiveEnforcement: "unknown", limitations: ["raw-write-reachability-unmeasured"] },
  };
  const adoptionBody = {
    v: "reelier.connection-adoption/v1", adoptionId: "adopt_github_release", descriptorDigest: connectionDescriptorDigest(descriptor),
    selectedAccountIdentity: descriptor.account.identity, mode: "existing", sidecarRouteId: descriptor.callableRoute.routeId,
    rawWriteReachability: "reachable", activationState: "active", secureConnectionCommitment: null,
  };
  const limits = { maxEffectsPerWindow: 4, windowSeconds: 3600, maxEffectsPerSourceTrigger: 1, maxBodyBytes: 65_536 };
  const baseGrant = {
    v: "reelier.delegation-grant/v1", tenant: TENANT, grantId: identifiers.rootGrantId, parentDigest: null,
    sponsor: OPERATOR_SIGNER_ID, grantor: OPERATOR_SIGNER_ID, grantee: args.audience,
    issuedAt: occurredAt, expiresAt: new Date(Date.parse(occurredAt) + 365 * 24 * 3600 * 1000).toISOString(),
    constraints: {
      definitionAliases: [...githubReleaseAliases], audiences: [args.audience],
      connectorAccounts: [{ connectorId: "github", accountId: "account_release" }],
      projectionPointers: ["/authorizationHandle"], riskClasses: [githubReleaseRiskClass], limits,
    },
  };
  const handleDigest = authorityDigest({ handle: args.authorizationHandle });
  const states = githubReleasePacks.map((pack, index) => {
    const alias = pack.definition.alias;
    const effect = githubReleaseEffects[index];
    const contractGrant = { ...baseGrant, grantId: `contract_grant_${effect}`, grantee: CONTRACT_SIGNER_ID, constraints: { ...baseGrant.constraints, definitionAliases: [alias] } };
    const contractGrantDigest = authorityDigest(contractGrant);
    const policy = { allocationDigest: authorityDigest({ v: "reelier.github-release-allocation/v1", effect, handle: args.authorizationHandle, repository: args.repository }), allocationId: `release-${effect}-01`, authorizationHandleDigest: handleDigest, effect, maxEffects: 1 };
    const contract = {
      v: "reelier.outcome-contract/v1", tenant: TENANT, alias, contractId: `contract_${effect}`,
      validFrom: baseGrant.issuedAt, validUntil: baseGrant.expiresAt,
      packDigest: pack.definition.packDigest, definitionDigest: pack.definition.definitionDigest,
      sponsor: OPERATOR_SIGNER_ID, audiences: [args.audience], delegationGrantDigest: contractGrantDigest,
      connectorId: "github", accountId: "account_release",
      sourceAuthority: { resolverId: pack.definition.resolverId, projectionSchemaId: githubReleaseProjectionSchemaId, allowedReadEndpointIds: [githubReleaseReadEndpointId], authorizedProjectionPointers: ["/authorizationHandle"], maxFreshnessSeconds: 60 },
      riskClasses: [githubReleaseRiskClass], limits,
      policyCommitment: { schemaId: githubReleasePolicySchemaId, jcsBase64: authorityCanonicalBytes(policy).toString("base64"), digest: authorityDigest(policy) },
    };
    const contractDigest = authorityDigest(contract);
    return {
      tenant: TENANT, definitionAlias: alias, stateVersion: 1,
      candidates: [{
        contractEnvelope: { canonicalBase64: authorityCanonicalBytes(contract).toString("base64"), advertisedDigest: contractDigest, signerId: CONTRACT_SIGNER_ID, signature: signAuthorityDigest(contractSigner.privateKey, "outcome-contract", contractDigest) },
        delegationEnvelopes: [{ index: 0, canonicalBase64: authorityCanonicalBytes(contractGrant).toString("base64"), advertisedDigest: contractGrantDigest, signerId: OPERATOR_SIGNER_ID, signature: signAuthorityDigest(operatorSigner.privateKey, "delegation-grant", contractGrantDigest) }],
        stateEvents: [{ index: 0, kind: "activated", contractDigest, at: baseGrant.issuedAt }],
      }],
    };
  });

  // Binds the runner's non-secret operator configuration into the signed connector registration.
  // The token reference is a NAME, never a value, so it is safe to commit to.
  const operatorConfigurationDigest = authorityDigest({
    v: "reelier.github-release-runner-operator-configuration/v1", repository: args.repository,
    githubAccountIdentity: accountIdentity, githubTokenRef: args.tokenRef,
    releaseAuthority: { signerId: RELEASE_AUTHORITY_SIGNER_ID, publicKeySpkiBase64: spkiBase64(releaseAuthority.publicKey) },
    journalSignerId: JOURNAL_SIGNER_ID, evidenceSignerId: EVIDENCE_SIGNER_ID, authorizationDir: guest("authorizations"),
  });

  const jobCard = signJobCard({
    v: "reelier.signed-job-card/v1", jobId: JOB_ID, title: "Governed production release",
    taskShapeDigest: authorityDigest({ v: "reelier.governed-release-task-shape/v1", repository: args.repository, definitionAliases: [...githubReleaseAliases], effects: [...githubReleaseEffects], audience: args.audience, authorityCellId: identifiers.authorityCellId, tenant: TENANT }),
    semanticClasses: ["deployment_release_v1"], definitionAliases: [...githubReleaseAliases], connectorIds: ["github"],
    accountIdentities: [accountIdentity], connectionDescriptorDigests: [connectionDescriptorDigest(descriptor)],
    adoptionCommitmentDigests: [connectionAdoptionCommitmentDigest(adoptionBody)],
    sourceRefs: ["authorization"], audiences: [args.audience], limitsDigest: authorityDigest(limits),
    instructionsDigest: authorityDigest({ v: "reelier.governed-release-instructions/v1", repository: args.repository, authorizationHandle: args.authorizationHandle, allocations: githubReleaseEffects.map(effect => `release-${effect}-01`) }),
    packDigests: [githubReleaseManifest.packDigest], exceptionPolicy: ["ambiguous-reconcile"], coverage: "declared-surface",
  }, JOB_CARD_KEY_ID, jobSigner.privateKey);

  const candidateRoot = await mkdtemp(path.join(os.tmpdir(), "reelier-stage-cell-"));
  let deploymentFile;
  try {
    await mkdir(path.join(candidateRoot, "keys"), { recursive: true });
    await mkdir(path.join(candidateRoot, "sources"), { recursive: true });
    await writeFile(path.join(candidateRoot, "keys", "operator.pem"), publicPem(operatorSigner.publicKey), "utf8");
    await writeFile(path.join(candidateRoot, "keys", "contract.pem"), publicPem(contractSigner.publicKey), "utf8");
    // The source projection the four definitions ground `/authorizationHandle` against. The handle
    // is STABLE; the per-release signed bundle that lands at `authorizations/<handle>.json` is not.
    await writeFile(path.join(candidateRoot, "sources", `${args.authorizationHandle}.json`), `${JSON.stringify({ authorizationHandle: args.authorizationHandle })}\n`, "utf8");
    const candidate = {
      v: "reelier.authority-deployment-candidate/v1", jobCard, connectionDescriptors: [descriptor],
      connectionAdoptions: [{ ...adoptionBody, signedDeploymentBinding: signedJobCardDigest(jobCard) }],
      state: states[0],
      connectors: [{ tenant: TENANT, connectorId: "github", accountId: "account_release", providerAccountIdentity: accountIdentity, allowedReadEndpointIds: [githubReleaseReadEndpointId], allowedWriteEndpointIds: writeEndpointIds, riskClasses: [githubReleaseRiskClass], operatorConfigurationDigest }],
      trust: [
        { signerId: OPERATOR_SIGNER_ID, principalId: OPERATOR_SIGNER_ID, publicKeyFile: "keys/operator.pem", purposes: ["delegation-grant"] },
        { signerId: CONTRACT_SIGNER_ID, principalId: CONTRACT_SIGNER_ID, publicKeyFile: "keys/contract.pem", purposes: ["outcome-contract"] },
      ],
      sourceDirectory: "sources",
    };
    const candidateFile = path.join(candidateRoot, "candidate.json");
    await writeFile(candidateFile, `${JSON.stringify(candidate)}\n`, "utf8");
    const built = await buildAuthorityDeployment(candidateFile, path.join(authorityOut, "deployment"), trustPin);
    deploymentFile = built.deploymentFile;
    // `buildAuthorityDeployment` materializes one state; the other three reviewed definitions are
    // appended and the whole manifest is re-loaded below, so nothing is trusted unverified.
    const manifest = JSON.parse(await readFile(built.deploymentFile, "utf8"));
    manifest.states.push(...states.slice(1));
    await writeFile(built.deploymentFile, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  } finally {
    await rm(candidateRoot, { recursive: true, force: true }).catch(() => undefined);
  }

  const trustPinFile = path.join(authorityOut, "trust", "job-card.json");
  await mkdir(path.dirname(trustPinFile), { recursive: true });
  await writeFile(trustPinFile, `${JSON.stringify(trustPin, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });

  const keysOut = path.join(authorityOut, "keys");
  await mkdir(keysOut, { recursive: true });
  await copyFile(path.join(args.keysDir, "journal-signer.key.pem"), path.join(keysOut, "journal-signer.key.pem"));
  await copyFile(path.join(args.keysDir, "evidence-signer.key.pem"), path.join(keysOut, "evidence-signer.key.pem"));
  await mkdir(path.join(authorityOut, "authorizations"), { recursive: true });
  await mkdir(path.join(authorityOut, "principals"), { recursive: true });

  // ---- the two configs -------------------------------------------------------------------------
  // Every path is the ABSOLUTE GUEST path. `ingress.principalRegistryFile` is not decoration: a
  // four-alias signed Job Card makes the runtime multi-definition, and `resolveBoundJobs`
  // (`local.ts`) refuses every job reference without a delegation authority, which `authority serve`
  // only constructs when the config names a durable principal registry.
  const configBody = {
    version: 1, tenant: TENANT, requester: args.audience, authorityCellId: identifiers.authorityCellId,
    definitions: [...githubReleaseAliases], topology: "isolated",
    ingress: { principalRegistryFile: guest("principals", "registry.jsonl"), allowedRequester: args.audience },
    ledgerDir: guest("ledger"), decisionDir: guest("decisions"), receiptDir: guest("receipts"),
    gateKeyFile: guest("keys", "local-gate.pem"),
    endpoints: [], deploymentPath: guest("deployment", "deployment.json"), jobCardTrustPinPath: guest("trust", "job-card.json"),
  };
  const configFile = path.join(authorityOut, "authority.yml");
  await writeFile(configFile, `${JSON.stringify(configBody, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });

  const runnerConfigBody = {
    v: "reelier.github-release-runner-config/v1",
    rootDir: guest("release-runner"),
    journalSignerId: JOURNAL_SIGNER_ID,
    journalKeyFile: guest("keys", "journal-signer.key.pem"),
    evidenceSignerId: EVIDENCE_SIGNER_ID,
    evidenceKeyFile: guest("keys", "evidence-signer.key.pem"),
    releaseAuthority: { signerId: RELEASE_AUTHORITY_SIGNER_ID, publicKeySpkiBase64: spkiBase64(releaseAuthority.publicKey) },
    authorizationDir: guest("authorizations"),
    provider: { kind: "github-https", githubAccountIdentity: accountIdentity, githubTokenRef: args.tokenRef, repository: args.repository },
  };
  const runnerConfigFile = path.join(authorityOut, "release-runner.config.json");
  await writeFile(runnerConfigFile, `${JSON.stringify(runnerConfigBody, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });

  // ---- verify the bundle the same way the serve path will --------------------------------------
  parseGitHubReleaseRunnerOperatorConfig(JSON.parse(await readFile(runnerConfigFile, "utf8")));
  validateAuthorityHostConfig(JSON.parse(await readFile(configFile, "utf8")), authorityOut);
  const loaded = await loadAuthorityDeployment(deploymentFile, { jobCardTrustPin: trustPin });
  if (loaded.states.length !== githubReleaseAliases.length) fail("staged deployment does not carry all four reviewed definitions");

  // ---- the operator summary --------------------------------------------------------------------
  const files = [
    ["authority/authority.yml", configFile],
    ["authority/release-runner.config.json", runnerConfigFile],
    ["authority/deployment/deployment.json", deploymentFile],
    ["authority/deployment/job.json", path.join(authorityOut, "deployment", "job.json")],
    ["authority/deployment/job-card-trust-evidence.json", path.join(authorityOut, "deployment", "job-card-trust-evidence.json")],
    ["authority/deployment/trust/keys/operator.pem", path.join(authorityOut, "deployment", "trust", "keys", "operator.pem")],
    ["authority/deployment/trust/keys/contract.pem", path.join(authorityOut, "deployment", "trust", "keys", "contract.pem")],
    ["authority/deployment/sources/" + args.authorizationHandle + ".json", path.join(authorityOut, "deployment", "sources", `${args.authorizationHandle}.json`)],
    ["authority/trust/job-card.json", trustPinFile],
    ["authority/keys/journal-signer.key.pem", path.join(keysOut, "journal-signer.key.pem")],
    ["authority/keys/evidence-signer.key.pem", path.join(keysOut, "evidence-signer.key.pem")],
  ];
  const manifest = [];
  for (const [relative, file] of files) manifest.push({ path: relative, sha256: await sha256File(file) });

  const generated = [
    ["job-signer.key.pem", jobSigner.created], ["readiness-signer.key.pem", readinessSigner.created],
    ["deployment-operator.key.pem", operatorSigner.created], ["deployment-contract.key.pem", contractSigner.created],
  ];
  const lines = [];
  lines.push(`staged bundle: ${authorityOut}`);
  lines.push(`repository: ${args.repository}   audience: ${args.audience}   tenant: ${TENANT}   cell: ${identifiers.authorityCellId}`);
  lines.push(`authorization handle: ${args.authorizationHandle}   job card signer: ${JOB_CARD_KEY_ID}`);
  lines.push("");
  lines.push("FILES WRITTEN");
  for (const entry of manifest) lines.push(`  ${entry.sha256}  ${entry.path}`);
  lines.push("  (empty)                                                                     authority/authorizations/");
  lines.push("  (empty)                                                                     authority/principals/");
  lines.push("");
  lines.push("KEY MATERIAL IN THE BUNDLE — exactly two files, both PRIVATE Cell signer keys:");
  lines.push("  authority/keys/journal-signer.key.pem");
  lines.push("  authority/keys/evidence-signer.key.pem");
  lines.push("The release-authority PRIVATE key is NOT in the bundle. Only its public SPKI is, inside");
  lines.push("release-runner.config.json (releaseAuthority.publicKeySpkiBase64).");
  lines.push("");
  lines.push("OPERATOR-HELD KEYS IN " + args.keysDir + " (never deployed):");
  lines.push("  release-authority.key.pem  (supplied)");
  for (const [name, created] of generated) lines.push(`  ${name}  (${created ? "GENERATED this run" : "reused, not overwritten"})`);
  lines.push("");
  lines.push("UPLOAD SEQUENCE — run from the repository root against the deployed Cell app:");
  lines.push("  fly ssh console -a <app> -C \"mkdir -p /data/authority/deployment/trust/keys /data/authority/deployment/sources /data/authority/trust /data/authority/keys /data/authority/authorizations /data/authority/principals\"");
  lines.push("  fly ssh sftp shell -a <app>");
  for (const entry of manifest) lines.push(`    put ${path.posix.join(args.outDir.replaceAll("\\", "/"), entry.path)} /data/${entry.path}`);
  lines.push("    exit");
  lines.push("  fly ssh console -a <app> -C \"chmod 600 /data/authority/keys/journal-signer.key.pem /data/authority/keys/evidence-signer.key.pem\"");
  lines.push("");
  lines.push("SECRETS STILL OWED (values never pass through this script):");
  lines.push(`  fly secrets set -a <app> ${args.tokenRef.startsWith("env:") ? args.tokenRef.slice(4) : args.tokenRef}=<github pat>`);
  lines.push("  No ingress bearer secret is owed: authority.yml authenticates ingress through the durable");
  lines.push("  principal registry at /data/authority/principals/registry.jsonl (ingress.bearerRef and");
  lines.push("  ingress.principalRegistryFile are mutually exclusive, and the four-alias signed Job Card");
  lines.push("  requires the registry). Per-session bearers are minted inside the Cell, never set here.");
  lines.push("");
  lines.push("NOT CLAIMED: this bundle is staged and self-verified offline. Nothing here attests that the");
  lines.push("Cell booted, that the volume received these exact bytes, or that any release is authorized.");
  console.log(lines.join("\n"));
}

await main();
