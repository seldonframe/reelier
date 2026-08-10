import { authorityDigest } from "../../authority/wire.js";

export const vercelDeploymentReleaseAlias = "vercel_deployment_release_v1" as const;
export const vercelDeploymentReleaseResolverId = "vercel_deployment_release_source_v1" as const;
export const vercelDeploymentReleaseProjectionSchemaId = "vercel_deployment_release_projection_v1" as const;
export const vercelDeploymentReleasePolicySchemaId = "vercel_deployment_release_policy_v1" as const;
export const vercelDeploymentReleaseRiskClass = "vercel_deployment_release" as const;
export const vercelDeploymentReleaseReadEndpointId = "vercel.deployment.get" as const;
export const vercelDeploymentReleaseWriteEndpointId = "vercel.deployment.promote" as const;
export const vercelDeploymentReleaseRecipeId = "vercel_deployment_release_readback_v1" as const;

const definitionShape = Object.freeze({
  v: "reelier.outcome-pack-definition/v1",
  alias: vercelDeploymentReleaseAlias,
  resolverId: vercelDeploymentReleaseResolverId,
  projectionSchemaId: vercelDeploymentReleaseProjectionSchemaId,
  policySchemaId: vercelDeploymentReleasePolicySchemaId,
  readEndpointIds: [vercelDeploymentReleaseReadEndpointId],
  writeEndpointIds: [vercelDeploymentReleaseWriteEndpointId],
  riskClasses: [vercelDeploymentReleaseRiskClass],
  requiredGroundedPointers: ["/teamId", "/projectId", "/deploymentId", "/deploymentUrl", "/commitSha", "/checks", "/domains", "/currentProductionDeploymentId"],
  maxFreshnessSeconds: 60,
});

export const vercelDeploymentReleasePackDigest = authorityDigest({ v: "reelier.outcome-pack/v1", packId: "vercel_deployment", definitions: [definitionShape] });
export const vercelDeploymentReleaseDefinitionDigest = authorityDigest({ ...definitionShape, packDigest: vercelDeploymentReleasePackDigest });
export const vercelDeploymentReleaseManifest = Object.freeze({
  v: "reelier.outcome-pack-manifest/v1" as const,
  packId: "vercel_deployment",
  packDigest: vercelDeploymentReleasePackDigest,
  definitions: [vercelDeploymentReleaseAlias],
});

export interface VercelDeploymentCheck { readonly name: string; readonly status: "passed" | "failed" | "pending" | "skipped" }
export interface VercelDeploymentReleaseProjection extends Record<string, unknown> {
  readonly teamId: string;
  readonly projectId: string;
  readonly deploymentId: string;
  readonly deploymentUrl: string;
  readonly commitSha: string;
  readonly checks: readonly VercelDeploymentCheck[];
  readonly domains: readonly string[];
  readonly currentProductionDeploymentId: string;
}
