import { stat } from "node:fs/promises";
import { spawn } from "node:child_process";

const ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const SECRET_REF = /^(?:env:[A-Za-z_][A-Za-z0-9_]{0,127}|file:.+)$/;
const DNS = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export interface GitHubCertificationResource { readonly apiBaseUrl: string; readonly accountId: string; readonly credentialRef: string; readonly cleanupRef: string; readonly repository: string; readonly issueNumber: number }
export interface VercelCertificationResource { readonly apiBaseUrl: string; readonly accountId: string; readonly credentialRef: string; readonly cleanupRef: string; readonly projectId: string; readonly deploymentId: string; readonly domains: readonly string[] }
export interface NeonCertificationResource { readonly apiBaseUrl: string; readonly accountId: string; readonly credentialRef: string; readonly cleanupRef: string; readonly projectId: string; readonly branchId: string; readonly database: string; readonly role: string; readonly databaseUrlRef: string }
export interface CloudflareCertificationResource { readonly apiBaseUrl: string; readonly accountId: string; readonly credentialRef: string; readonly cleanupRef: string; readonly zoneId: string; readonly recordId: string; readonly recordName: string; readonly tokenName: string }
export interface HubSpotCertificationResource { readonly apiBaseUrl: string; readonly accountId: string; readonly credentialRef: string; readonly cleanupRef: string; readonly ticketId: string; readonly contactId: string; readonly approvedProperties: readonly string[] }
export interface SlackCertificationResource { readonly apiBaseUrl: string; readonly accountId: string; readonly credentialRef: string; readonly cleanupRef: string; readonly channelId: string }
export interface FlyCertificationResource { readonly appName: string; readonly agentAppName: string; readonly orgSlug: string; readonly region: string; readonly apiCredentialRef: string; readonly authorityImageDigest: string; readonly networkPolicyDigest: string; readonly schemaDigest: string }
export interface CodexCertificationResource { readonly binaryPath: string; readonly version: string; readonly authorityEndpoint: string; readonly taskId: string }

export interface CertificationOperatorConfigV1 {
  readonly v: "reelier.certification-operator-config/v1";
  readonly authorityConfigPath: string;
  readonly evidenceDirectory: string;
  readonly providers: Readonly<{
    github: GitHubCertificationResource;
    vercel: VercelCertificationResource;
    neon: NeonCertificationResource;
    cloudflare: CloudflareCertificationResource;
    hubspot: HubSpotCertificationResource;
    slack: SlackCertificationResource;
  }>;
  readonly fly: FlyCertificationResource;
  readonly codex: CodexCertificationResource;
}

export interface CertificationSecretReferenceStatus {
  readonly owner: "github" | "vercel" | "neon" | "cloudflare" | "hubspot" | "slack" | "fly";
  readonly slot: "credential" | "database" | "api";
  readonly kind: "environment" | "file";
  readonly status: "configured" | "missing";
}

export function parseCertificationOperatorConfig(value: unknown): CertificationOperatorConfigV1 {
  const root = object(value, "certification operator config");
  closed(root, ["v", "authorityConfigPath", "evidenceDirectory", "providers", "fly", "codex"], "certification operator config");
  if (root.v !== "reelier.certification-operator-config/v1") throw new TypeError("certification operator config version is invalid");
  const providers = object(root.providers, "certification providers");
  closed(providers, ["github", "vercel", "neon", "cloudflare", "hubspot", "slack"], "certification providers");
  const parsed = {
    v: "reelier.certification-operator-config/v1" as const,
    authorityConfigPath: safePath(root.authorityConfigPath, "authorityConfigPath"),
    evidenceDirectory: safePath(root.evidenceDirectory, "evidenceDirectory"),
    providers: Object.freeze({
      github: github(providers.github),
      vercel: vercel(providers.vercel),
      neon: neon(providers.neon),
      cloudflare: cloudflare(providers.cloudflare),
      hubspot: hubspot(providers.hubspot),
      slack: slack(providers.slack),
    }),
    fly: fly(root.fly),
    codex: codex(root.codex),
  };
  return Object.freeze(parsed);
}

export async function inspectCertificationSecretReferences(config: CertificationOperatorConfigV1, env: Readonly<Record<string, string | undefined>> = process.env): Promise<readonly CertificationSecretReferenceStatus[]> {
  const refs: readonly [CertificationSecretReferenceStatus["owner"], CertificationSecretReferenceStatus["slot"], string][] = [
    ["github", "credential", config.providers.github.credentialRef],
    ["vercel", "credential", config.providers.vercel.credentialRef],
    ["neon", "credential", config.providers.neon.credentialRef],
    ["neon", "database", config.providers.neon.databaseUrlRef],
    ["cloudflare", "credential", config.providers.cloudflare.credentialRef],
    ["hubspot", "credential", config.providers.hubspot.credentialRef],
    ["slack", "credential", config.providers.slack.credentialRef],
    ["fly", "api", config.fly.apiCredentialRef],
  ];
  const reports = await Promise.all(refs.map(async ([owner, slot, reference]) => {
    const environment = reference.startsWith("env:");
    const configured = environment
      ? Boolean(env[reference.slice(4)])
      : await fileExistsAndIsNonEmpty(reference.slice(5));
    return Object.freeze({ owner, slot, kind: environment ? "environment" as const : "file" as const, status: configured ? "configured" as const : "missing" as const });
  }));
  return Object.freeze(reports);
}

export async function probePinnedCodexBinary(binaryPath: string, expectedVersion: string, timeoutMs = 5_000): Promise<"available" | "missing"> {
  if (typeof binaryPath !== "string" || binaryPath.length === 0 || typeof expectedVersion !== "string" || !/^\d+\.\d+\.\d+$/.test(expectedVersion)) throw new TypeError("pinned Codex probe input is invalid");
  return new Promise(resolve => {
    let output = "";
    let settled = false;
    const child = spawn(binaryPath, ["--version"], { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const finish = (value: "available" | "missing") => { if (settled) return; settled = true; clearTimeout(timer); resolve(value); };
    const collect = (chunk: Buffer) => { if (output.length < 4096) output += chunk.toString("utf8"); };
    child.stdout.on("data", collect); child.stderr.on("data", collect);
    child.once("error", () => finish("missing"));
    child.once("close", code => finish(code === 0 && new RegExp(`(?:^|\\s)${escapeRegExp(expectedVersion)}(?:\\s|$)`).test(output) ? "available" : "missing"));
    const timer = setTimeout(() => { child.kill(); finish("missing"); }, timeoutMs);
    timer.unref();
  });
}

function github(value: unknown): GitHubCertificationResource {
  const raw = resource(value, "github", ["repository", "issueNumber"]);
  const issueNumber = raw.issueNumber;
  if (!Number.isSafeInteger(issueNumber) || (issueNumber as number) < 1) throw new TypeError("github issueNumber is invalid");
  return Object.freeze({ ...base(raw, "github"), repository: id(raw.repository, "github repository"), issueNumber: issueNumber as number });
}
function vercel(value: unknown): VercelCertificationResource {
  const raw = resource(value, "vercel", ["projectId", "deploymentId", "domains"]);
  return Object.freeze({ ...base(raw, "vercel"), projectId: id(raw.projectId, "vercel projectId"), deploymentId: id(raw.deploymentId, "vercel deploymentId"), domains: dnsList(raw.domains, "vercel domains") });
}
function neon(value: unknown): NeonCertificationResource {
  const raw = resource(value, "neon", ["projectId", "branchId", "database", "role", "databaseUrlRef"]);
  return Object.freeze({ ...base(raw, "neon"), projectId: id(raw.projectId, "neon projectId"), branchId: id(raw.branchId, "neon branchId"), database: id(raw.database, "neon database"), role: id(raw.role, "neon role"), databaseUrlRef: secretRef(raw.databaseUrlRef, "neon databaseUrlRef") });
}
function cloudflare(value: unknown): CloudflareCertificationResource {
  const raw = resource(value, "cloudflare", ["zoneId", "recordId", "recordName", "tokenName"]);
  const recordName = text(raw.recordName, "cloudflare recordName", 253).toLowerCase();
  if (!DNS.test(recordName)) throw new TypeError("cloudflare recordName is invalid");
  return Object.freeze({ ...base(raw, "cloudflare"), zoneId: id(raw.zoneId, "cloudflare zoneId"), recordId: id(raw.recordId, "cloudflare recordId"), recordName, tokenName: id(raw.tokenName, "cloudflare tokenName") });
}
function hubspot(value: unknown): HubSpotCertificationResource {
  const raw = resource(value, "hubspot", ["ticketId", "contactId", "approvedProperties"]);
  return Object.freeze({ ...base(raw, "hubspot"), ticketId: id(raw.ticketId, "hubspot ticketId"), contactId: id(raw.contactId, "hubspot contactId"), approvedProperties: idList(raw.approvedProperties, "hubspot approvedProperties") });
}
function slack(value: unknown): SlackCertificationResource {
  const raw = resource(value, "slack", ["channelId"]);
  return Object.freeze({ ...base(raw, "slack"), channelId: id(raw.channelId, "slack channelId") });
}
function fly(value: unknown): FlyCertificationResource {
  const raw = object(value, "fly certification resource");
  closed(raw, ["appName", "agentAppName", "orgSlug", "region", "apiCredentialRef", "authorityImageDigest", "networkPolicyDigest", "schemaDigest"], "fly certification resource");
  return Object.freeze({ appName: id(raw.appName, "fly appName"), agentAppName: id(raw.agentAppName, "fly agentAppName"), orgSlug: id(raw.orgSlug, "fly orgSlug"), region: id(raw.region, "fly region"), apiCredentialRef: secretRef(raw.apiCredentialRef, "fly apiCredentialRef"), authorityImageDigest: digest(raw.authorityImageDigest, "fly authorityImageDigest"), networkPolicyDigest: digest(raw.networkPolicyDigest, "fly networkPolicyDigest"), schemaDigest: digest(raw.schemaDigest, "fly schemaDigest") });
}
function codex(value: unknown): CodexCertificationResource {
  const raw = object(value, "codex certification resource");
  closed(raw, ["binaryPath", "version", "authorityEndpoint", "taskId"], "codex certification resource");
  if (typeof raw.version !== "string" || !/^\d+\.\d+\.\d+$/.test(raw.version)) throw new TypeError("codex version is invalid");
  return Object.freeze({ binaryPath: text(raw.binaryPath, "codex binaryPath", 1024), version: raw.version, authorityEndpoint: https(raw.authorityEndpoint, "codex authorityEndpoint"), taskId: id(raw.taskId, "codex taskId") });
}
function resource(value: unknown, label: string, extras: readonly string[]): Record<string, unknown> {
  const raw = object(value, `${label} certification resource`);
  closed(raw, ["apiBaseUrl", "accountId", "credentialRef", "cleanupRef", ...extras], `${label} certification resource`);
  return raw;
}
function base(raw: Record<string, unknown>, label: string) { return { apiBaseUrl: https(raw.apiBaseUrl, `${label} apiBaseUrl`), accountId: id(raw.accountId, `${label} accountId`), credentialRef: secretRef(raw.credentialRef, `${label} credentialRef`), cleanupRef: id(raw.cleanupRef, `${label} cleanupRef`) }; }
function object(value: unknown, label: string): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`); return value as Record<string, unknown>; }
function closed(raw: Record<string, unknown>, keys: readonly string[], label: string): void { if (Object.keys(raw).length !== keys.length || Object.keys(raw).some(key => !keys.includes(key))) throw new TypeError(`${label} is closed`); }
function id(value: unknown, label: string): string { if (typeof value !== "string" || !ID.test(value)) throw new TypeError(`${label} is invalid`); return value; }
function text(value: unknown, label: string, max: number): string { if (typeof value !== "string" || value.length === 0 || value.length > max || /[\0\r\n]/.test(value)) throw new TypeError(`${label} is invalid`); return value; }
function https(value: unknown, label: string): string { const raw = text(value, label, 2048); let url: URL; try { url = new URL(raw); } catch { throw new TypeError(`${label} is invalid`); } if (url.protocol !== "https:" || url.username || url.password || url.hash || url.search) throw new TypeError(`${label} must be an HTTPS URL without credentials or query`); return url.toString().replace(/\/$/, ""); }
function secretRef(value: unknown, label: string): string { if (typeof value !== "string" || !SECRET_REF.test(value) || /[\0\r\n]/.test(value)) throw new TypeError(`${label} is invalid`); return value; }
function digest(value: unknown, label: string): string { if (typeof value !== "string" || !DIGEST.test(value)) throw new TypeError(`${label} is invalid`); return value; }
function safePath(value: unknown, label: string): string { const result = text(value, label, 1024); if (/^(?:https?:|file:)/i.test(result) || result.includes("\0")) throw new TypeError(`${label} is invalid`); return result; }
function idList(value: unknown, label: string): readonly string[] { if (!Array.isArray(value) || value.length === 0 || value.length > 64) throw new TypeError(`${label} is invalid`); const values = value.map(item => id(item, label)); if (new Set(values).size !== values.length) throw new TypeError(`${label} must be unique`); return Object.freeze(values.sort()); }
function dnsList(value: unknown, label: string): readonly string[] { if (!Array.isArray(value) || value.length === 0 || value.length > 64) throw new TypeError(`${label} is invalid`); const values = value.map(item => text(item, label, 253).toLowerCase()); if (values.some(item => !DNS.test(item)) || new Set(values).size !== values.length) throw new TypeError(`${label} is invalid`); return Object.freeze(values.sort()); }
async function fileExistsAndIsNonEmpty(file: string): Promise<boolean> { try { return (await stat(file)).size > 0; } catch { return false; } }
function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
