import canonicalize from "canonicalize";
import path from "node:path";
import {
  CERTIFICATION_SCENARIOS,
  CERTIFICATION_SCENARIO_IDS,
  type CertificationCleanupCommitment,
  type CertificationMetadataSection,
  type CertificationResourceSection,
  type CertificationScenarioId,
  type CertificationSecretSlot,
} from "./scenarios.js";

const ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const DNS = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const SEMVER = /^\d+\.\d+\.\d+$/;
const SCENARIO_SET = new Set<string>(CERTIFICATION_SCENARIO_IDS);

export const CERTIFICATION_SECRET_SLOTS = [
  "cloudflareCredential",
  "flyApiCredential",
  "githubCredential",
  "neonApiCredential",
  "neonDatabaseUrl",
  "slackCredential",
  "vercelCredential",
] as const satisfies readonly CertificationSecretSlot[];

export const CODEX_CERTIFICATION_PROFILES = [
  "code_implementer",
  "communication",
  "coordinator",
  "database_migration",
  "independent_verifier",
  "infrastructure",
  "release",
  "secret_lifecycle",
  "security_reviewer",
  "test_agent",
] as const;

export interface GitHubIssueLabelsCertificationResourceV2 { readonly apiBaseUrl: string; readonly owner: string; readonly repository: string; readonly issueNumber: number }
export interface CloudflareDnsCertificationResourceV2 { readonly apiBaseUrl: string; readonly accountId: string; readonly zoneId: string; readonly recordId: string; readonly recordName: string }
export interface SlackTopicCertificationResourceV2 { readonly apiBaseUrl: string; readonly teamId: string; readonly channelId: string }
export interface CloudflareVercelSecretCertificationResourceV2 { readonly cloudflareApiBaseUrl: string; readonly cloudflareAccountId: string; readonly tokenName: string; readonly vercelApiBaseUrl: string; readonly vercelAccountId: string; readonly projectId: string }
export interface VercelPromotionCertificationResourceV2 { readonly apiBaseUrl: string; readonly accountId: string; readonly projectId: string; readonly deploymentId: string; readonly domains: readonly string[] }
export interface NeonMigrationCertificationResourceV2 { readonly apiBaseUrl: string; readonly accountId: string; readonly projectId: string; readonly branchId: string; readonly database: string; readonly role: string }

export type CertificationResourceV2 =
  | GitHubIssueLabelsCertificationResourceV2
  | CloudflareDnsCertificationResourceV2
  | SlackTopicCertificationResourceV2
  | CloudflareVercelSecretCertificationResourceV2
  | VercelPromotionCertificationResourceV2
  | NeonMigrationCertificationResourceV2;

export interface FlyTopologyCertificationMetadataV2 {
  readonly appName: string;
  readonly authorityMachineId: string;
  readonly agentAppName: string;
  readonly agentMachineId: string;
  readonly egressAppName: string;
  readonly egressMachineId: string;
  readonly orgSlug: string;
  readonly region: string;
  readonly flyctlPath: string;
  readonly flyctlVersion: string;
  readonly egressProxyBaseUrl: string;
  readonly authorityImageDigest: string;
  readonly agentImageDigest: string;
  readonly gatewayImageDigest: string;
  readonly networkPolicyDigest: string;
  readonly schemaDigest: string;
}

export interface CodexTenPrincipalCertificationMetadataV2 {
  readonly binaryPath: string;
  readonly version: string;
  readonly authorityEndpoint: string;
  readonly codexHomePath: string;
  readonly workspacePath: string;
  readonly sessionDirectory: string;
  readonly profiles: readonly typeof CODEX_CERTIFICATION_PROFILES[number][];
}

export interface CertificationOperatorConfigV2 {
  readonly v: "reelier.certification-operator-config/v2";
  readonly authorityConfigPath: string;
  readonly evidenceDirectory: string;
  readonly scenarios: readonly CertificationScenarioId[];
  readonly resources: Readonly<Record<string, CertificationResourceV2>>;
  readonly cleanup: Readonly<Record<string, readonly string[]>>;
  readonly metadata: Readonly<Partial<{
    flyTopology: FlyTopologyCertificationMetadataV2;
    codexTenPrincipal: CodexTenPrincipalCertificationMetadataV2;
  }>>;
  readonly secretReferences: Readonly<Partial<Record<CertificationSecretSlot, string>>>;
}

export function parseCertificationOperatorConfigV2(value: unknown): CertificationOperatorConfigV2 {
  const root = object(value, "certification operator config v2");
  closed(root, ["v", "authorityConfigPath", "evidenceDirectory", "scenarios", "resources", "cleanup", "metadata", "secretReferences"], "certification operator config v2");
  if (root.v !== "reelier.certification-operator-config/v2") throw new TypeError("certification operator config v2 version is invalid");
  const scenarios = scenarioList(root.scenarios);
  const requirements = requirementsFor(scenarios);
  const resourcesRaw = exactSectionObject(root.resources, requirements.resources, "certification resources");
  const cleanupRaw = exactSectionObject(root.cleanup, requirements.cleanup, "certification cleanup");
  const metadataRaw = exactSectionObject(root.metadata, requirements.metadata, "certification metadata");
  const secretsRaw = exactSectionObject(root.secretReferences, requirements.secrets, "certification secret references");

  const resources: Record<string, CertificationResourceV2> = {};
  for (const section of requirements.resources) resources[section] = parseResource(section, resourcesRaw[section]);
  const cleanup: Record<string, readonly string[]> = {};
  for (const section of requirements.cleanup) cleanup[section] = uniqueSortedIds(cleanupRaw[section], `${section} cleanup commitments`);
  const metadata: Record<string, FlyTopologyCertificationMetadataV2 | CodexTenPrincipalCertificationMetadataV2> = {};
  for (const section of requirements.metadata) metadata[section] = section === "flyTopology" ? flyTopology(metadataRaw[section]) : codexTenPrincipal(metadataRaw[section]);
  const secretReferences: Partial<Record<CertificationSecretSlot, string>> = {};
  for (const slot of requirements.secrets) secretReferences[slot] = secretRef(secretsRaw[slot], slot);

  return Object.freeze({
    v: "reelier.certification-operator-config/v2" as const,
    authorityConfigPath: safePath(root.authorityConfigPath, "authorityConfigPath"),
    evidenceDirectory: safePath(root.evidenceDirectory, "evidenceDirectory"),
    scenarios,
    resources: Object.freeze(resources),
    cleanup: Object.freeze(cleanup),
    metadata: Object.freeze(metadata),
    secretReferences: Object.freeze(secretReferences),
  });
}

export function canonicalizeCertificationOperatorConfigV2(value: unknown): string {
  const canonical = canonicalize(parseCertificationOperatorConfigV2(value));
  if (canonical === undefined) throw new TypeError("certification operator config v2 is not canonicalizable");
  return canonical;
}

export function migrateCertificationOperatorConfig(value: unknown): CertificationOperatorConfigV2 {
  const root = object(value, "certification operator config");
  if (root.v === "reelier.certification-operator-config/v2") return parseCertificationOperatorConfigV2(root);
  if (root.v !== "reelier.certification-operator-config/v1") throw new TypeError("certification operator config migration requires v1 or v2");
  const legacy = legacyV1(root);
  const scenarios = [...CERTIFICATION_SCENARIO_IDS];
  return parseCertificationOperatorConfigV2({
    v: "reelier.certification-operator-config/v2",
    authorityConfigPath: legacy.authorityConfigPath,
    evidenceDirectory: legacy.evidenceDirectory,
    scenarios,
    resources: {
      "cloudflare-dns": { apiBaseUrl: legacy.cloudflare.apiBaseUrl, accountId: legacy.cloudflare.accountId, zoneId: legacy.cloudflare.zoneId, recordId: legacy.cloudflare.recordId, recordName: legacy.cloudflare.recordName },
      "cloudflare-vercel-secret": { cloudflareApiBaseUrl: legacy.cloudflare.apiBaseUrl, cloudflareAccountId: legacy.cloudflare.accountId, tokenName: legacy.cloudflare.tokenName, vercelApiBaseUrl: legacy.vercel.apiBaseUrl, vercelAccountId: legacy.vercel.accountId, projectId: legacy.vercel.projectId },
      "github-issue-labels": { apiBaseUrl: legacy.github.apiBaseUrl, owner: legacy.github.accountId, repository: legacy.github.repository, issueNumber: legacy.github.issueNumber },
      "neon-migration": { apiBaseUrl: legacy.neon.apiBaseUrl, accountId: legacy.neon.accountId, projectId: legacy.neon.projectId, branchId: legacy.neon.branchId, database: legacy.neon.database, role: legacy.neon.role },
      "slack-topic": { apiBaseUrl: legacy.slack.apiBaseUrl, teamId: legacy.slack.accountId, channelId: legacy.slack.channelId },
      "vercel-promotion": { apiBaseUrl: legacy.vercel.apiBaseUrl, accountId: legacy.vercel.accountId, projectId: legacy.vercel.projectId, deploymentId: legacy.vercel.deploymentId, domains: legacy.vercel.domains },
    },
    cleanup: {
      "cloudflare-dns": [legacy.cloudflare.cleanupRef],
      "cloudflare-vercel-secret": [legacy.cloudflare.cleanupRef, legacy.vercel.cleanupRef].sort(),
      "github-issue-labels": [legacy.github.cleanupRef],
      "neon-migration": [legacy.neon.cleanupRef],
      "slack-topic": [legacy.slack.cleanupRef],
      "vercel-promotion": [legacy.vercel.cleanupRef],
    },
    metadata: {
      codexTenPrincipal: { binaryPath: legacy.codex.binaryPath, version: legacy.codex.version, authorityEndpoint: legacy.codex.authorityEndpoint, codexHomePath: legacy.codex.codexHomePath, workspacePath: legacy.codex.workspacePath, sessionDirectory: legacy.codex.sessionCredentialDirectory, profiles: [...CODEX_CERTIFICATION_PROFILES] },
      flyTopology: { appName: legacy.fly.appName, authorityMachineId: legacy.fly.authorityMachineId, agentAppName: legacy.fly.agentAppName, agentMachineId: legacy.fly.agentMachineId, egressAppName: legacy.fly.egressAppName, egressMachineId: legacy.fly.egressMachineId, orgSlug: legacy.fly.orgSlug, region: legacy.fly.region, flyctlPath: legacy.fly.flyctlPath, flyctlVersion: legacy.fly.flyctlVersion, egressProxyBaseUrl: legacy.fly.egressProxyBaseUrl, authorityImageDigest: legacy.fly.authorityImageDigest, agentImageDigest: legacy.fly.agentImageDigest, gatewayImageDigest: legacy.fly.gatewayImageDigest, networkPolicyDigest: legacy.fly.networkPolicyDigest, schemaDigest: legacy.fly.schemaDigest },
    },
    secretReferences: {
      cloudflareCredential: legacy.cloudflare.credentialRef,
      flyApiCredential: legacy.fly.apiCredentialRef,
      githubCredential: legacy.github.credentialRef,
      neonApiCredential: legacy.neon.credentialRef,
      neonDatabaseUrl: legacy.neon.databaseUrlRef,
      slackCredential: legacy.slack.credentialRef,
      vercelCredential: legacy.vercel.credentialRef,
    },
  });
}

function requirementsFor(scenarios: readonly CertificationScenarioId[]): Readonly<{
  resources: readonly CertificationResourceSection[];
  cleanup: readonly CertificationCleanupCommitment[];
  metadata: readonly CertificationMetadataSection[];
  secrets: readonly CertificationSecretSlot[];
}> {
  const collect = <T extends string>(select: (definition: typeof CERTIFICATION_SCENARIOS[CertificationScenarioId]) => readonly T[]): readonly T[] =>
    Object.freeze([...new Set(scenarios.flatMap(scenario => select(CERTIFICATION_SCENARIOS[scenario])))].sort());
  return Object.freeze({
    resources: collect(definition => definition.resourceSections),
    cleanup: collect(definition => definition.cleanupCommitments),
    metadata: collect(definition => definition.metadataSections),
    secrets: collect(definition => definition.secretSlots),
  });
}

function scenarioList(value: unknown): readonly CertificationScenarioId[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > CERTIFICATION_SCENARIO_IDS.length) throw new TypeError("certification scenarios are invalid");
  if (value.some(item => typeof item !== "string" || !SCENARIO_SET.has(item))) throw new TypeError("certification scenario is unknown");
  const scenarios = value as CertificationScenarioId[];
  if (new Set(scenarios).size !== scenarios.length) throw new TypeError("certification scenarios must be unique");
  if (scenarios.some((item, index) => index > 0 && scenarios[index - 1] >= item)) throw new TypeError("certification scenarios must be sorted");
  return Object.freeze([...scenarios]);
}

function parseResource(section: CertificationResourceSection, value: unknown): CertificationResourceV2 {
  const raw = object(value, `${section} resource`);
  switch (section) {
    case "github-issue-labels": {
      closed(raw, ["apiBaseUrl", "owner", "repository", "issueNumber"], `${section} resource`);
      if (!Number.isSafeInteger(raw.issueNumber) || (raw.issueNumber as number) < 1) throw new TypeError("github issue number is invalid");
      return Object.freeze({ apiBaseUrl: providerUrl(raw.apiBaseUrl, "https://api.github.com", "github apiBaseUrl"), owner: id(raw.owner, "github owner"), repository: id(raw.repository, "github repository"), issueNumber: raw.issueNumber as number });
    }
    case "cloudflare-dns":
      closed(raw, ["apiBaseUrl", "accountId", "zoneId", "recordId", "recordName"], `${section} resource`);
      return Object.freeze({ apiBaseUrl: providerUrl(raw.apiBaseUrl, "https://api.cloudflare.com", "cloudflare apiBaseUrl"), accountId: id(raw.accountId, "cloudflare accountId"), zoneId: id(raw.zoneId, "cloudflare zoneId"), recordId: id(raw.recordId, "cloudflare recordId"), recordName: dns(raw.recordName, "cloudflare recordName") });
    case "slack-topic":
      closed(raw, ["apiBaseUrl", "teamId", "channelId"], `${section} resource`);
      return Object.freeze({ apiBaseUrl: providerUrl(raw.apiBaseUrl, "https://slack.com", "slack apiBaseUrl"), teamId: id(raw.teamId, "slack teamId"), channelId: id(raw.channelId, "slack channelId") });
    case "cloudflare-vercel-secret":
      closed(raw, ["cloudflareApiBaseUrl", "cloudflareAccountId", "tokenName", "vercelApiBaseUrl", "vercelAccountId", "projectId"], `${section} resource`);
      return Object.freeze({ cloudflareApiBaseUrl: providerUrl(raw.cloudflareApiBaseUrl, "https://api.cloudflare.com", "cloudflare apiBaseUrl"), cloudflareAccountId: id(raw.cloudflareAccountId, "cloudflare accountId"), tokenName: id(raw.tokenName, "cloudflare tokenName"), vercelApiBaseUrl: providerUrl(raw.vercelApiBaseUrl, "https://api.vercel.com", "vercel apiBaseUrl"), vercelAccountId: id(raw.vercelAccountId, "vercel accountId"), projectId: id(raw.projectId, "vercel projectId") });
    case "vercel-promotion":
      closed(raw, ["apiBaseUrl", "accountId", "projectId", "deploymentId", "domains"], `${section} resource`);
      return Object.freeze({ apiBaseUrl: providerUrl(raw.apiBaseUrl, "https://api.vercel.com", "vercel apiBaseUrl"), accountId: id(raw.accountId, "vercel accountId"), projectId: id(raw.projectId, "vercel projectId"), deploymentId: id(raw.deploymentId, "vercel deploymentId"), domains: dnsList(raw.domains, "vercel domains") });
    case "neon-migration":
      closed(raw, ["apiBaseUrl", "accountId", "projectId", "branchId", "database", "role"], `${section} resource`);
      return Object.freeze({ apiBaseUrl: providerUrl(raw.apiBaseUrl, "https://console.neon.tech/api/v2", "neon apiBaseUrl"), accountId: id(raw.accountId, "neon accountId"), projectId: id(raw.projectId, "neon projectId"), branchId: id(raw.branchId, "neon branchId"), database: id(raw.database, "neon database"), role: id(raw.role, "neon role") });
  }
}

function flyTopology(value: unknown): FlyTopologyCertificationMetadataV2 {
  const raw = object(value, "fly topology metadata");
  closed(raw, ["appName", "authorityMachineId", "agentAppName", "agentMachineId", "egressAppName", "egressMachineId", "orgSlug", "region", "flyctlPath", "flyctlVersion", "egressProxyBaseUrl", "authorityImageDigest", "agentImageDigest", "gatewayImageDigest", "networkPolicyDigest", "schemaDigest"], "fly topology metadata");
  const egressAppName = id(raw.egressAppName, "fly egressAppName");
  const egressProxyBaseUrl = internalHttpOrigin(raw.egressProxyBaseUrl, "fly egressProxyBaseUrl");
  if (new URL(egressProxyBaseUrl).hostname !== `${egressAppName}.internal`) throw new TypeError("fly egress proxy does not match egress app");
  if (typeof raw.flyctlVersion !== "string" || !SEMVER.test(raw.flyctlVersion)) throw new TypeError("fly flyctlVersion is invalid");
  return Object.freeze({ appName: id(raw.appName, "fly appName"), authorityMachineId: id(raw.authorityMachineId, "fly authorityMachineId"), agentAppName: id(raw.agentAppName, "fly agentAppName"), agentMachineId: id(raw.agentMachineId, "fly agentMachineId"), egressAppName, egressMachineId: id(raw.egressMachineId, "fly egressMachineId"), orgSlug: id(raw.orgSlug, "fly orgSlug"), region: id(raw.region, "fly region"), flyctlPath: safePath(raw.flyctlPath, "flyctlPath"), flyctlVersion: raw.flyctlVersion, egressProxyBaseUrl, authorityImageDigest: digest(raw.authorityImageDigest, "fly authority image digest"), agentImageDigest: digest(raw.agentImageDigest, "fly agent image digest"), gatewayImageDigest: digest(raw.gatewayImageDigest, "fly gateway image digest"), networkPolicyDigest: digest(raw.networkPolicyDigest, "fly network policy digest"), schemaDigest: digest(raw.schemaDigest, "fly schema digest") });
}

function codexTenPrincipal(value: unknown): CodexTenPrincipalCertificationMetadataV2 {
  const raw = object(value, "Codex ten-principal metadata");
  closed(raw, ["binaryPath", "version", "authorityEndpoint", "codexHomePath", "workspacePath", "sessionDirectory", "profiles"], "Codex ten-principal metadata");
  if (typeof raw.version !== "string" || !SEMVER.test(raw.version)) throw new TypeError("Codex version is invalid");
  const workspacePath = safePath(raw.workspacePath, "Codex workspacePath");
  const codexHomePath = safePath(raw.codexHomePath, "Codex codexHomePath");
  const sessionDirectory = safePath(raw.sessionDirectory, "Codex sessionDirectory");
  if (isWithin(path.resolve(workspacePath), path.resolve(codexHomePath)) || isWithin(path.resolve(workspacePath), path.resolve(sessionDirectory))) throw new TypeError("Codex home and session directory must be outside the workspace");
  const profiles = exactStringList(raw.profiles, CODEX_CERTIFICATION_PROFILES, "Codex profiles");
  return Object.freeze({ binaryPath: safePath(raw.binaryPath, "Codex binaryPath"), version: raw.version, authorityEndpoint: httpsUrl(raw.authorityEndpoint, "Codex authorityEndpoint"), codexHomePath, workspacePath, sessionDirectory, profiles });
}

function legacyV1(root: Record<string, unknown>): any {
  closed(root, ["v", "authorityConfigPath", "evidenceDirectory", "providers", "fly", "codex"], "legacy certification operator config");
  const providers = object(root.providers, "legacy certification providers");
  for (const name of ["github", "vercel", "neon", "cloudflare", "hubspot", "slack"] as const) {
    if (!Object.prototype.hasOwnProperty.call(providers, name)) throw new TypeError(`legacy ${name} provider is required`);
  }
  closed(providers, ["github", "vercel", "neon", "cloudflare", "hubspot", "slack"], "legacy certification providers");
  const provider = (name: string, extras: readonly string[]): Record<string, unknown> => {
    const raw = object(providers[name], `legacy ${name} provider`);
    closed(raw, ["apiBaseUrl", "accountId", "credentialRef", "cleanupRef", ...extras], `legacy ${name} provider`);
    httpsUrl(raw.apiBaseUrl, `${name} apiBaseUrl`); id(raw.accountId, `${name} accountId`); secretRef(raw.credentialRef, `${name} credential`); id(raw.cleanupRef, `${name} cleanupRef`);
    return raw;
  };
  const github = provider("github", ["repository", "issueNumber"]); id(github.repository, "github repository"); if (!Number.isSafeInteger(github.issueNumber) || (github.issueNumber as number) < 1) throw new TypeError("legacy github issueNumber is invalid");
  const vercel = provider("vercel", ["projectId", "deploymentId", "domains"]); id(vercel.projectId, "vercel projectId"); id(vercel.deploymentId, "vercel deploymentId"); dnsList(vercel.domains, "vercel domains");
  const neon = provider("neon", ["projectId", "branchId", "database", "role", "databaseUrlRef"]); for (const key of ["projectId", "branchId", "database", "role"]) id(neon[key], `neon ${key}`); secretRef(neon.databaseUrlRef, "neon database URL");
  const cloudflare = provider("cloudflare", ["zoneId", "recordId", "recordName", "tokenName"]); for (const key of ["zoneId", "recordId", "tokenName"]) id(cloudflare[key], `cloudflare ${key}`); dns(cloudflare.recordName, "cloudflare recordName");
  const hubspot = provider("hubspot", ["ticketId", "contactId", "approvedProperties"]); for (const key of ["ticketId", "contactId"]) id(hubspot[key], `hubspot ${key}`); uniqueSortedIds(hubspot.approvedProperties, "hubspot approvedProperties");
  const slack = provider("slack", ["channelId"]); id(slack.channelId, "slack channelId");
  const fly = object(root.fly, "legacy fly metadata");
  closed(fly, ["appName", "authorityMachineId", "agentAppName", "agentMachineId", "egressAppName", "egressMachineId", "orgSlug", "region", "apiCredentialRef", "flyctlPath", "flyctlVersion", "egressProxyBaseUrl", "egressProxyBearerRef", "authorityImageDigest", "agentImageDigest", "gatewayImageDigest", "networkPolicyDigest", "schemaDigest"], "legacy fly metadata");
  for (const key of ["appName", "authorityMachineId", "agentAppName", "agentMachineId", "egressAppName", "egressMachineId", "orgSlug", "region"]) id(fly[key], `fly ${key}`);
  secretRef(fly.apiCredentialRef, "fly API credential"); secretRef(fly.egressProxyBearerRef, "legacy egress bearer"); safePath(fly.flyctlPath, "flyctlPath"); if (typeof fly.flyctlVersion !== "string" || !SEMVER.test(fly.flyctlVersion)) throw new TypeError("legacy flyctlVersion is invalid"); internalHttpOrigin(fly.egressProxyBaseUrl, "fly egressProxyBaseUrl"); for (const key of ["authorityImageDigest", "agentImageDigest", "gatewayImageDigest", "networkPolicyDigest", "schemaDigest"]) digest(fly[key], `fly ${key}`);
  const codex = object(root.codex, "legacy Codex metadata");
  closed(codex, ["binaryPath", "version", "authorityEndpoint", "taskId", "jobId", "authorityCellId", "codexHomePath", "workspacePath", "sessionCredentialDirectory"], "legacy Codex metadata");
  if (typeof codex.version !== "string" || !SEMVER.test(codex.version)) throw new TypeError("legacy Codex version is invalid"); for (const key of ["taskId", "jobId", "authorityCellId"]) id(codex[key], `legacy Codex ${key}`); httpsUrl(codex.authorityEndpoint, "Codex authorityEndpoint"); for (const key of ["binaryPath", "codexHomePath", "workspacePath", "sessionCredentialDirectory"]) safePath(codex[key], `Codex ${key}`);
  return { authorityConfigPath: safePath(root.authorityConfigPath, "authorityConfigPath"), evidenceDirectory: safePath(root.evidenceDirectory, "evidenceDirectory"), github, vercel, neon, cloudflare, slack, fly, codex };
}

function object(value: unknown, label: string): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`); return value as Record<string, unknown>; }
function closed(raw: Record<string, unknown>, keys: readonly string[], label: string): void { if (Object.keys(raw).length !== keys.length || Object.keys(raw).some(key => !keys.includes(key))) throw new TypeError(`${label} is closed`); }
function exactSectionObject<T extends string>(value: unknown, keys: readonly T[], label: string): Record<T, unknown> { const raw = object(value, label); closed(raw, keys, label); return raw as Record<T, unknown>; }
function id(value: unknown, label: string): string { if (typeof value !== "string" || !ID.test(value)) throw new TypeError(`${label} is invalid`); return value; }
function text(value: unknown, label: string, max = 2048): string { if (typeof value !== "string" || value.length === 0 || value.length > max || /[\0\r\n]/.test(value)) throw new TypeError(`${label} is invalid`); return value; }
function safePath(value: unknown, label: string): string { const result = text(value, label, 1024); if (/^(?:https?:|file:)/i.test(result) || result.split(/[\\/]+/).includes("..")) throw new TypeError(`${label} is unsafe`); return result; }
function secretRef(value: unknown, slot: string): string { if (typeof value !== "string" || /[\0\r\n]/.test(value)) throw new TypeError(`${slot} secret reference is invalid`); if (value.startsWith("env:")) { if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(value.slice(4))) throw new TypeError(`${slot} secret reference is invalid`); } else if (value.startsWith("file:")) { try { safePath(value.slice(5), `${slot} file reference`); } catch { throw new TypeError(`${slot} secret reference is invalid`); } } else throw new TypeError(`${slot} secret reference is invalid`); return value; }
function digest(value: unknown, label: string): string { if (typeof value !== "string" || !DIGEST.test(value)) throw new TypeError(`${label} is invalid`); return value; }
function httpsUrl(value: unknown, label: string): string { const raw = text(value, label); let url: URL; try { url = new URL(raw); } catch { throw new TypeError(`${label} is invalid`); } if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new TypeError(`${label} must be a credential-free HTTPS URL`); return url.toString().replace(/\/$/, ""); }
function providerUrl(value: unknown, expected: string, label: string): string { const parsed = httpsUrl(value, label); if (parsed !== expected) throw new TypeError(`${label} is not the pinned certification API`); return parsed; }
function internalHttpOrigin(value: unknown, label: string): string { const raw = text(value, label); let url: URL; try { url = new URL(raw); } catch { throw new TypeError(`${label} is invalid`); } if (url.protocol !== "http:" || !url.hostname.endsWith(".internal") || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new TypeError(`${label} must be a Fly internal HTTP origin`); return url.toString().replace(/\/$/, ""); }
function dns(value: unknown, label: string): string { const result = text(value, label, 253).toLowerCase(); if (!DNS.test(result)) throw new TypeError(`${label} is invalid`); return result; }
function dnsList(value: unknown, label: string): readonly string[] { if (!Array.isArray(value) || value.length === 0 || value.length > 64) throw new TypeError(`${label} is invalid`); const values = value.map(item => dns(item, label)); if (new Set(values).size !== values.length) throw new TypeError(`${label} must be unique`); values.sort(); return Object.freeze(values); }
function uniqueSortedIds(value: unknown, label: string): readonly string[] { if (!Array.isArray(value) || value.length === 0 || value.length > 64) throw new TypeError(`${label} is invalid`); const values = value.map(item => id(item, label)); if (new Set(values).size !== values.length) throw new TypeError(`${label} must be unique`); if (values.some((item, index) => index > 0 && values[index - 1] >= item)) throw new TypeError(`${label} must be sorted`); return Object.freeze(values); }
function exactStringList<T extends string>(value: unknown, expected: readonly T[], label: string): readonly T[] { if (!Array.isArray(value) || value.length !== expected.length || value.some((item, index) => item !== expected[index])) throw new TypeError(`${label} must contain the exact sorted profile set`); return Object.freeze([...(value as T[])]); }
function isWithin(parent: string, candidate: string): boolean { const relative = path.relative(parent, candidate); return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)); }
