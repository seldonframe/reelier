const ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/;

export interface GuardedLiveProviderConfig {
  readonly enabled: boolean;
  readonly provider: string;
  readonly endpoint: string;
  readonly accountId: string;
  readonly credentialRef: string;
  readonly cleanupRef: string;
}

export interface LiveCertificationResult {
  readonly provider: string;
  readonly status: "skipped" | "passed";
  readonly writes: number;
  readonly cleanupRequired: boolean;
}

export function readGuardedLiveProviderConfig(env: Readonly<Record<string, string | undefined>> = process.env): GuardedLiveProviderConfig {
  const enabled = env.REELIER_LIVE_CERTIFY === "1";
  if (!enabled) return Object.freeze({ enabled: false, provider: "", endpoint: "", accountId: "", credentialRef: "", cleanupRef: "" });
  const provider = env.REELIER_LIVE_PROVIDER ?? "";
  const endpoint = env.REELIER_LIVE_ENDPOINT ?? "";
  const accountId = env.REELIER_LIVE_ACCOUNT ?? "";
  const credentialRef = env.REELIER_LIVE_CREDENTIAL_REF ?? "";
  const cleanupRef = env.REELIER_LIVE_CLEANUP_REF ?? "";
  if (!ID.test(provider) || !/^https:\/\//.test(endpoint) || !ID.test(accountId) || !ID.test(credentialRef) || !ID.test(cleanupRef)) throw new TypeError("guarded live certification requires HTTPS endpoint, account, credential reference, and cleanup reference");
  return Object.freeze({ enabled, provider, endpoint, accountId, credentialRef, cleanupRef });
}

export async function runGuardedLiveProviderCertification(input: Readonly<{ config: GuardedLiveProviderConfig; execute: () => Promise<Readonly<{ writes: number; cleanupRequired?: boolean }>> }): Promise<LiveCertificationResult> {
  if (!input.config.enabled) return Object.freeze({ provider: input.config.provider, status: "skipped", writes: 0, cleanupRequired: false });
  const result = await input.execute();
  if (!Number.isSafeInteger(result.writes) || result.writes < 1) throw new TypeError("guarded certification must report at least one provider write");
  return Object.freeze({ provider: input.config.provider, status: "passed", writes: result.writes, cleanupRequired: result.cleanupRequired !== false });
}
