export const CERTIFICATION_SCENARIO_IDS = [
  "cloudflare-dns",
  "cloudflare-vercel-secret",
  "codex-ten-principal",
  "fly-topology",
  "github-issue-labels",
  "neon-migration",
  "slack-topic",
  "vercel-promotion",
] as const;

export type CertificationScenarioId = typeof CERTIFICATION_SCENARIO_IDS[number];
export type CertificationResourceSection = Exclude<CertificationScenarioId, "codex-ten-principal" | "fly-topology">;
export type CertificationCleanupCommitment = CertificationResourceSection;
export type CertificationMetadataSection = "codexTenPrincipal" | "flyTopology";
export type CertificationSecretSlot =
  | "githubCredential"
  | "vercelCredential"
  | "neonApiCredential"
  | "neonDatabaseUrl"
  | "cloudflareCredential"
  | "slackCredential"
  | "flyApiCredential";

export interface CertificationScenarioDefinition {
  readonly scenarioId: CertificationScenarioId;
  readonly resourceSections: readonly CertificationResourceSection[];
  readonly cleanupCommitments: readonly CertificationCleanupCommitment[];
  readonly metadataSections: readonly CertificationMetadataSection[];
  readonly secretSlots: readonly CertificationSecretSlot[];
}

function scenario(
  scenarioId: CertificationScenarioId,
  resourceSections: readonly CertificationResourceSection[],
  cleanupCommitments: readonly CertificationCleanupCommitment[],
  metadataSections: readonly CertificationMetadataSection[],
  secretSlots: readonly CertificationSecretSlot[],
): CertificationScenarioDefinition {
  return Object.freeze({
    scenarioId,
    resourceSections: Object.freeze([...resourceSections]),
    cleanupCommitments: Object.freeze([...cleanupCommitments]),
    metadataSections: Object.freeze([...metadataSections]),
    secretSlots: Object.freeze([...secretSlots]),
  });
}

export const CERTIFICATION_SCENARIOS: Readonly<Record<CertificationScenarioId, CertificationScenarioDefinition>> = Object.freeze({
  "cloudflare-dns": scenario("cloudflare-dns", ["cloudflare-dns"], ["cloudflare-dns"], [], ["cloudflareCredential"]),
  "cloudflare-vercel-secret": scenario("cloudflare-vercel-secret", ["cloudflare-vercel-secret"], ["cloudflare-vercel-secret"], [], ["cloudflareCredential", "vercelCredential"]),
  "codex-ten-principal": scenario("codex-ten-principal", [], [], ["codexTenPrincipal"], []),
  "fly-topology": scenario("fly-topology", [], [], ["flyTopology"], ["flyApiCredential"]),
  "github-issue-labels": scenario("github-issue-labels", ["github-issue-labels"], ["github-issue-labels"], [], ["githubCredential"]),
  "neon-migration": scenario("neon-migration", ["neon-migration"], ["neon-migration"], [], ["neonApiCredential", "neonDatabaseUrl"]),
  "slack-topic": scenario("slack-topic", ["slack-topic"], ["slack-topic"], [], ["slackCredential"]),
  "vercel-promotion": scenario("vercel-promotion", ["vercel-promotion"], ["vercel-promotion"], [], ["vercelCredential"]),
});
