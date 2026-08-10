import { CERTIFICATION_TARGET_PACKAGE_VERSION, createCertificationPreflight, type CertificationEvidence, type CertificationProviderId } from "./certification.js";
import type { GuardedLiveProviderConfig } from "./live-certification.js";

const DIGEST = /^sha256:[0-9a-f]{64}$/;

export interface CertificationAdapterRunResult {
  readonly status: "passed" | "failed" | "ambiguous";
  readonly writes: number;
  readonly receiptGraphDigest: string | null;
  readonly exceptionDigest: string | null;
  readonly resentAfterAmbiguity: boolean;
}

export interface CertificationAdapter {
  readonly id: string;
  readonly provider: CertificationProviderId;
  readonly run: (input: Readonly<{ config: GuardedLiveProviderConfig }>) => Promise<CertificationAdapterRunResult>;
  readonly cleanup: (input: Readonly<{ config: GuardedLiveProviderConfig; result: CertificationAdapterRunResult }>) => Promise<"verified" | "failed" | "unchecked">;
}

export async function runCertification(input: Readonly<{
  readonly config: GuardedLiveProviderConfig;
  readonly acknowledgeLive: boolean;
  readonly adapterId: string;
  readonly adapters: readonly CertificationAdapter[];
}>): Promise<CertificationEvidence> {
  if (!input.config.enabled || !input.acknowledgeLive) throw new TypeError("explicit live certification acknowledgement is required");
  const adapter = input.adapters.find(candidate => candidate.id === input.adapterId);
  if (!adapter) throw new TypeError(`unknown certification adapter: ${input.adapterId}`);
  if (adapter.provider !== input.config.provider) throw new TypeError("certification adapter provider does not match configured provider");
  const result = await adapter.run({ config: input.config });
  if (!Number.isSafeInteger(result.writes) || result.writes < 1) throw new TypeError("certification must report at least one provider write");
  if (result.resentAfterAmbiguity) throw new TypeError("automatic resend after ambiguity is prohibited");
  if (result.receiptGraphDigest !== null && !DIGEST.test(result.receiptGraphDigest)) throw new TypeError("certification receipt graph digest is invalid");
  if (result.exceptionDigest !== null && !DIGEST.test(result.exceptionDigest)) throw new TypeError("certification exception digest is invalid");
  const cleanup = await adapter.cleanup({ config: input.config, result });
  if (cleanup !== "verified") throw new TypeError("certification cleanup is not verified");
  const evidence: CertificationEvidence = {
    v: "reelier.certification-evidence/v1",
    provider: adapter.provider,
    scenarioId: adapter.id,
    status: result.status,
    writes: result.writes,
    cleanup,
    receiptGraphDigest: result.receiptGraphDigest,
    exceptionDigest: result.exceptionDigest,
  };
  return Object.freeze(evidence);
}

export function certificationPreflightForAdapter(input: Readonly<{ config: GuardedLiveProviderConfig; adapter: CertificationAdapter }>) {
  return createCertificationPreflight({
    packageVersion: process.env.npm_package_version ?? CERTIFICATION_TARGET_PACKAGE_VERSION,
    expectedPackageVersion: CERTIFICATION_TARGET_PACKAGE_VERSION,
    cloud: { deploymentId: "local", status: "ready" },
    migrations: { status: "applied", digest: "sha256:" + "0".repeat(64) },
    runtime: { codex: "missing", fly: "missing" },
    resources: [{ provider: input.adapter.provider, accountId: input.config.accountId, credentialRef: input.config.credentialRef, cleanupRef: input.config.cleanupRef }],
  });
}
