import { createHash } from "node:crypto";
import { authorityDigest } from "../wire.js";

export const CERTIFICATION_PROVIDER_IDS = ["cloudflare", "codex", "fly", "github", "hubspot", "neon", "slack", "vercel"] as const;
export type CertificationProviderId = typeof CERTIFICATION_PROVIDER_IDS[number];
export type CertificationClaim = "verified" | "failed" | "unchecked" | "absent";

const DIGEST = /^sha256:[0-9a-f]{64}$/;

export interface CertificationResourceInput {
  readonly provider: CertificationProviderId | string;
  readonly accountId: string;
  readonly credentialRef?: string;
  readonly cleanupRef?: string;
}

export interface CertificationPreflightInput {
  readonly packageVersion: string;
  readonly expectedPackageVersion: string;
  readonly cloud: { readonly deploymentId: string; readonly status: "ready" | "unknown" | "failed" };
  readonly migrations: { readonly status: "applied" | "unknown" | "failed"; readonly digest: string };
  readonly runtime: { readonly codex: "available" | "missing"; readonly fly: "available" | "missing" };
  readonly resources: readonly CertificationResourceInput[];
}

export interface CertificationResourceReport {
  readonly provider: CertificationProviderId;
  readonly accountIdDigest: string;
  readonly credentialRefStatus: "configured" | "missing";
  readonly cleanupRefStatus: "configured" | "missing";
}

export interface CertificationPreflightReport {
  readonly v: "reelier.certification-preflight/v1";
  readonly ok: boolean;
  readonly claims: Readonly<Record<"package" | "cloud" | "migrations" | "runtime", CertificationClaim>>;
  readonly resources: readonly CertificationResourceReport[];
  readonly missing: readonly string[];
  readonly nextActions: readonly string[];
  readonly digest: string;
}

export interface CertificationEvidence {
  readonly v: "reelier.certification-evidence/v1";
  readonly provider: CertificationProviderId;
  readonly scenarioId: string;
  readonly status: "passed" | "failed" | "ambiguous" | "skipped";
  readonly writes: number;
  readonly cleanup: "verified" | "failed" | "unchecked";
  readonly receiptGraphDigest: string | null;
  readonly exceptionDigest: string | null;
}

export interface ReleaseEvidenceManifest {
  readonly v: "reelier.release-evidence/v1";
  readonly package: { readonly version: string; readonly tarballDigest: string };
  readonly cloud: { readonly deploymentId: string; readonly deploymentDigest: string; readonly migrationsDigest: string };
  readonly tests: readonly { readonly name: string; readonly status: "passed" | "failed" | "unchecked"; readonly digest: string }[];
  readonly topologyEvidenceDigest: string | null;
  readonly providerEvidence: readonly string[];
  readonly dogfoodGraphDigest: string | null;
}

export function createCertificationPreflight(input: CertificationPreflightInput): CertificationPreflightReport {
  if (!input || typeof input !== "object") throw new TypeError("certification preflight input is required");
  if (!DIGEST.test(input.migrations.digest)) throw new TypeError("certification migration digest is invalid");
  const missing: string[] = [];
  const claims = {
    package: input.packageVersion === input.expectedPackageVersion ? "verified" : "failed",
    cloud: input.cloud.status === "ready" ? "verified" : input.cloud.status === "failed" ? "failed" : "unchecked",
    migrations: input.migrations.status === "applied" ? "verified" : input.migrations.status === "failed" ? "failed" : "unchecked",
    runtime: input.runtime.codex === "available" && input.runtime.fly === "available" ? "verified" : "unchecked",
  } as const;
  if (claims.package !== "verified") missing.push("package.version");
  if (claims.cloud !== "verified") missing.push("cloud.status");
  if (claims.migrations !== "verified") missing.push("migrations.status");
  if (input.runtime.codex !== "available") missing.push("runtime:codex");
  if (input.runtime.fly !== "available") missing.push("runtime:fly");
  const resources = input.resources.map(resource => {
    if (!isProvider(resource.provider)) throw new TypeError(`unknown certification provider: ${resource.provider}`);
    if (!resource.accountId) throw new TypeError(`resource ${resource.provider} account is required`);
    const report: CertificationResourceReport = {
      provider: resource.provider,
      accountIdDigest: digestOpaque(resource.accountId),
      credentialRefStatus: resource.credentialRef ? "configured" : "missing",
      cleanupRefStatus: resource.cleanupRef ? "configured" : "missing",
    };
    if (!resource.credentialRef) missing.push(`resource:${resource.provider}:credentialRef`);
    if (!resource.cleanupRef) missing.push(`resource:${resource.provider}:cleanupRef`);
    return Object.freeze(report);
  }).sort((left, right) => left.provider.localeCompare(right.provider));
  const sortedMissing = Object.freeze([...missing].sort());
  const nextActions = Object.freeze(sortedMissing.map(item => `provide ${item}`));
  const body = { v: "reelier.certification-preflight/v1" as const, ok: sortedMissing.length === 0, claims, resources, missing: sortedMissing, nextActions };
  return Object.freeze({ ...body, digest: authorityDigest(body) });
}

export function createReleaseEvidenceManifest(input: ReleaseEvidenceManifest): ReleaseEvidenceManifest {
  if (!input || input.v !== "reelier.release-evidence/v1") throw new TypeError("release evidence manifest version is invalid");
  if (!/^0\.[0-9]+\.[0-9]+$/.test(input.package.version)) throw new TypeError("release evidence package version is invalid");
  if (!DIGEST.test(input.package.tarballDigest) || !DIGEST.test(input.cloud.deploymentDigest) || !DIGEST.test(input.cloud.migrationsDigest)) throw new TypeError("release evidence digest is invalid");
  return Object.freeze({ ...input, tests: Object.freeze([...input.tests].map(test => Object.freeze({ ...test })).sort((left, right) => left.name.localeCompare(right.name))), providerEvidence: Object.freeze([...input.providerEvidence].sort()) });
}

function isProvider(value: string): value is CertificationProviderId {
  return (CERTIFICATION_PROVIDER_IDS as readonly string[]).includes(value);
}

function digestOpaque(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}
