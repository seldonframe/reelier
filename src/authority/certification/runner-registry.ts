import { authorityDigest } from "../wire.js";
import {
  githubIssueLabelsAlias,
  githubIssueLabelsReadEndpointId,
  githubIssueLabelsWriteEndpointId,
} from "../../packs/github/manifest.js";
import {
  cloudflareDnsRecordSetAlias,
  cloudflareDnsRecordSetReadEndpointId,
  cloudflareDnsRecordSetWriteEndpointId,
} from "../../packs/cloudflare/manifest.js";
import {
  slackChannelTopicAlias,
  slackChannelTopicReadEndpointId,
  slackChannelTopicWriteEndpointId,
} from "../../packs/slack-topic/manifest.js";
import {
  vercelDeploymentReleaseAlias,
  vercelDeploymentReleaseReadEndpointId,
  vercelDeploymentReleaseWriteEndpointId,
} from "../../packs/vercel/manifest.js";
import {
  neonDatabaseMigrationAlias,
  neonDatabaseMigrationReadEndpointId,
  neonDatabaseMigrationWriteEndpointId,
} from "../../packs/neon/manifest.js";
import {
  cloudflareTokenCreateAlias,
  cloudflareTokenCreateReadEndpointId,
  cloudflareTokenCreateWriteEndpointId,
} from "../../packs/cloudflare-token/create.js";
import {
  vercelProjectEnvironmentSecretSetAlias,
  vercelProjectEnvironmentSecretSetReadEndpointId,
  vercelProjectEnvironmentSecretSetWriteEndpointId,
} from "../../packs/vercel-environment-secret/manifest.js";
import type { CertificationScenarioId, CertificationSecretSlot } from "./scenarios.js";

export const CERTIFICATION_RUNNER_OPERATIONS = Object.freeze([
  "prepare", "authoritative-read", "compile", "reserve", "authoritative-reread", "recompile",
  "dispatch", "controlled-cut", "reconcile", "receipt", "cleanup", "export", "offline-verify",
] as const);

export type CertificationProvider = "cloudflare" | "github" | "neon" | "slack" | "vercel";
export interface CertificationRegistryEndpoint {
  readonly endpointId: string;
  readonly provider: CertificationProvider;
  readonly credentialSlot: CertificationSecretSlot;
  readonly direction: "read" | "write";
  readonly method: "GET" | "POST" | "PUT";
}
export interface CertificationRunnerRegistryEntry {
  readonly scenarioId: Extract<CertificationScenarioId, "cloudflare-dns" | "cloudflare-vercel-secret" | "github-issue-labels" | "neon-migration" | "slack-topic" | "vercel-promotion">;
  readonly runnerId: string;
  readonly definitionAliases: readonly string[];
  readonly endpoints: readonly CertificationRegistryEndpoint[];
  readonly operations: typeof CERTIFICATION_RUNNER_OPERATIONS;
  readonly dispatchable: boolean;
  readonly unavailableReason: string | null;
  readonly implementationDigest: string;
}

type EntrySeed = Omit<CertificationRunnerRegistryEntry, "implementationDigest" | "operations">;
const endpoint = (endpointId: string, provider: CertificationProvider, credentialSlot: CertificationSecretSlot, direction: "read" | "write", method: "GET" | "POST" | "PUT"): CertificationRegistryEndpoint => Object.freeze({ endpointId, provider, credentialSlot, direction, method });
const seed = (value: EntrySeed): CertificationRunnerRegistryEntry => {
  const body = Object.freeze({ ...value, definitionAliases: Object.freeze([...value.definitionAliases]), endpoints: Object.freeze([...value.endpoints]), operations: CERTIFICATION_RUNNER_OPERATIONS });
  return Object.freeze({ ...body, implementationDigest: authorityDigest({ v: "reelier.certification-runner-implementation/v2", metadata: body }) });
};

const entries = Object.freeze([
  seed({ scenarioId: "cloudflare-dns", runnerId: "builtin_cloudflare_dns_v2", definitionAliases: [cloudflareDnsRecordSetAlias], endpoints: [endpoint(cloudflareDnsRecordSetReadEndpointId, "cloudflare", "cloudflareDnsCredential", "read", "GET"), endpoint(cloudflareDnsRecordSetWriteEndpointId, "cloudflare", "cloudflareDnsCredential", "write", "PUT")], dispatchable: true, unavailableReason: null }),
  seed({ scenarioId: "cloudflare-vercel-secret", runnerId: "builtin_cloudflare_vercel_secret_v2", definitionAliases: [cloudflareTokenCreateAlias, vercelProjectEnvironmentSecretSetAlias], endpoints: [endpoint(cloudflareTokenCreateReadEndpointId, "cloudflare", "cloudflareBootstrapCredential", "read", "GET"), endpoint(cloudflareTokenCreateWriteEndpointId, "cloudflare", "cloudflareBootstrapCredential", "write", "POST"), endpoint(vercelProjectEnvironmentSecretSetReadEndpointId, "vercel", "vercelCredential", "read", "GET"), endpoint(vercelProjectEnvironmentSecretSetWriteEndpointId, "vercel", "vercelCredential", "write", "POST")], dispatchable: false, unavailableReason: "Cloudflare token-create and Vercel environment-secret definitions are not registered static packs" }),
  seed({ scenarioId: "github-issue-labels", runnerId: "builtin_github_issue_labels_v2", definitionAliases: [githubIssueLabelsAlias], endpoints: [endpoint(githubIssueLabelsReadEndpointId, "github", "githubCredential", "read", "GET"), endpoint(githubIssueLabelsWriteEndpointId, "github", "githubCredential", "write", "PUT")], dispatchable: true, unavailableReason: null }),
  seed({ scenarioId: "neon-migration", runnerId: "builtin_neon_migration_v2", definitionAliases: [neonDatabaseMigrationAlias], endpoints: [endpoint(neonDatabaseMigrationReadEndpointId, "neon", "neonApiCredential", "read", "GET"), endpoint(neonDatabaseMigrationWriteEndpointId, "neon", "neonDatabaseUrl", "write", "POST")], dispatchable: true, unavailableReason: null }),
  seed({ scenarioId: "slack-topic", runnerId: "builtin_slack_topic_v2", definitionAliases: [slackChannelTopicAlias], endpoints: [endpoint(slackChannelTopicReadEndpointId, "slack", "slackCredential", "read", "GET"), endpoint(slackChannelTopicWriteEndpointId, "slack", "slackCredential", "write", "POST")], dispatchable: true, unavailableReason: null }),
  seed({ scenarioId: "vercel-promotion", runnerId: "builtin_vercel_promotion_v2", definitionAliases: [vercelDeploymentReleaseAlias], endpoints: [endpoint(vercelDeploymentReleaseReadEndpointId, "vercel", "vercelCredential", "read", "GET"), endpoint(vercelDeploymentReleaseWriteEndpointId, "vercel", "vercelCredential", "write", "POST")], dispatchable: true, unavailableReason: null }),
] as const);

export const CERTIFICATION_PROVIDER_SCENARIO_IDS = Object.freeze(entries.map(entry => entry.scenarioId));

const registry = new Map<CertificationScenarioId, CertificationRunnerRegistryEntry>(entries.map(entry => [entry.scenarioId, entry]));
export const certificationRunnerRegistryDigest = authorityDigest({ v: "reelier.certification-runner-registry/v2", entries });

export function getCertificationRunnerRegistryEntry(scenarioId: CertificationScenarioId): CertificationRunnerRegistryEntry {
  const entry = registry.get(scenarioId);
  if (!entry) throw new TypeError("certification scenario has no built-in provider runner");
  return entry;
}
