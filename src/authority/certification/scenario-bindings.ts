import { authorityDigest } from "../wire.js";
import type { CertificationOperatorConfigV3 } from "./config.js";
import type { CertificationScenarioId } from "./scenarios.js";

export function certificationEndpointCommitments(config: CertificationOperatorConfigV3, scenario: CertificationScenarioId): Readonly<Record<string, Readonly<{ accountCommitment: string; resourceCommitment: string }>>> {
  const raw = config.resources[scenario] as Record<string, any>;
  const bind = (provider: string, account: unknown, resource: unknown) => Object.freeze({ accountCommitment: authorityDigest({ v: "reelier.certification-provider-account/v1", provider, account }), resourceCommitment: authorityDigest({ v: "reelier.certification-provider-resource/v1", provider, resource }) });
  switch (scenario) {
    case "github-issue-labels": return { github: bind("github", raw.owner, { owner: raw.owner, repository: raw.repository, issueNumber: raw.issueNumber }) };
    case "cloudflare-dns": return { cloudflare: bind("cloudflare", raw.accountId, { accountId: raw.accountId, zoneId: raw.zoneId, recordId: raw.recordId, recordName: raw.recordName }) };
    case "slack-topic": return { slack: bind("slack", raw.teamId, { teamId: raw.teamId, channelId: raw.channelId }) };
    case "cloudflare-vercel-secret": return { cloudflare: bind("cloudflare", raw.cloudflareAccountId, { accountId: raw.cloudflareAccountId, tokenName: raw.tokenName }), vercel: bind("vercel", raw.vercelAccountId, { accountId: raw.vercelAccountId, projectId: raw.projectId }) };
    case "vercel-promotion": return { vercel: bind("vercel", raw.accountId, { accountId: raw.accountId, projectId: raw.projectId, deploymentId: raw.deploymentId, domains: raw.domains }) };
    case "neon-migration": return { neon: bind("neon", raw.accountId, { accountId: raw.accountId, projectId: raw.projectId, branchId: raw.branchId, database: raw.database, role: raw.role }) };
    default: throw new TypeError("certification scenario has no provider bindings");
  }
}

export function certificationScenarioPlanBindings(config: CertificationOperatorConfigV3, scenario: CertificationScenarioId) {
  const endpoints = certificationEndpointCommitments(config, scenario);
  const providers = Object.keys(endpoints).sort();
  return Object.freeze({
    sourceRefs: Object.freeze(Object.fromEntries(providers.map(provider => [provider, endpoints[provider]!.resourceCommitment]))),
    resourceDigest: authorityDigest(config.resources[scenario]),
    accountCommitments: Object.freeze(providers.map(provider => Object.freeze({ provider, digest: endpoints[provider]!.accountCommitment }))),
    desiredStateDigest: authorityDigest(config.desiredState[scenario] ?? null),
    cleanupRecipeIds: config.cleanup[scenario],
  });
}
