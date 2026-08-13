import type { CertificationAdapter, CertificationAdapterRunResult } from "./certification-runner.js";
import { runCertification } from "./certification-runner.js";
import type { GuardedLiveProviderConfig } from "./live-certification.js";

export const CERTIFICATION_SCENARIO_IDS = ["github-vercel-release", "cloudflare-dns", "neon-migration", "cloudflare-vercel-secret", "hubspot-slack-flow", "github-slack-conformance"] as const;
export type CertificationScenarioId = typeof CERTIFICATION_SCENARIO_IDS[number];

const PROVIDER_BY_SCENARIO: Readonly<Record<CertificationScenarioId, CertificationAdapter["provider"]>> = {
  "github-vercel-release": "github",
  "cloudflare-dns": "cloudflare",
  "neon-migration": "neon",
  "cloudflare-vercel-secret": "cloudflare",
  "hubspot-slack-flow": "hubspot",
  "github-slack-conformance": "slack",
};

export interface ProviderCertificationOperations {
  readonly runScenario: (input: Readonly<{ scenarioId: CertificationScenarioId; config: GuardedLiveProviderConfig }>) => Promise<CertificationAdapterRunResult>;
  readonly cleanupScenario: (input: Readonly<{ scenarioId: CertificationScenarioId; config: GuardedLiveProviderConfig; result: CertificationAdapterRunResult }>) => Promise<"verified" | "failed" | "unchecked">;
}

export function createProviderCertificationAdapters(operations: ProviderCertificationOperations): readonly CertificationAdapter[] {
  if (!operations || typeof operations.runScenario !== "function" || typeof operations.cleanupScenario !== "function") throw new TypeError("provider certification operations are required");
  return Object.freeze(CERTIFICATION_SCENARIO_IDS.map(id => Object.freeze({
    id,
    provider: PROVIDER_BY_SCENARIO[id],
    run: (input: Readonly<{ config: GuardedLiveProviderConfig }>) => operations.runScenario({ scenarioId: id, config: input.config }),
    cleanup: (input: Readonly<{ config: GuardedLiveProviderConfig; result: CertificationAdapterRunResult }>) => operations.cleanupScenario({ scenarioId: id, config: input.config, result: input.result }),
  })));
}

export async function runCertificationSuite(input: Readonly<{ acknowledgeLive: boolean; scenarios: readonly GuardedLiveProviderConfig[]; adapters: readonly CertificationAdapter[] }>) {
  if (!input.acknowledgeLive) throw new TypeError("explicit live certification acknowledgement is required");
  const results = [];
  for (const scenarioId of CERTIFICATION_SCENARIO_IDS) {
    const adapter = input.adapters.find(candidate => candidate.id === scenarioId);
    const config = input.scenarios.find(candidate => candidate.provider === PROVIDER_BY_SCENARIO[scenarioId]);
    if (!adapter || !config) throw new TypeError(`certification scenario is not configured: ${scenarioId}`);
    results.push(await runCertification({ config, acknowledgeLive: input.acknowledgeLive, adapterId: scenarioId, adapters: [adapter] }));
  }
  return Object.freeze(results);
}
