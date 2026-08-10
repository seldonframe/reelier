import { authorityDigest } from "../../authority/wire.js";
export const vercelProjectEnvironmentSecretSetAlias = "vercel_project_environment_secret_set_v1" as const;
export const vercelProjectEnvironmentSecretSetWriteEndpointId = "vercel.project.environment.secret.set" as const;
export const vercelProjectEnvironmentSecretSetReadEndpointId = "vercel.project.environment.secret.get" as const;
export const vercelProjectEnvironmentSecretSetResolverId = "vercel_project_environment_secret_source_v1" as const;
export const vercelProjectEnvironmentSecretSetProjectionSchemaId = "vercel_project_environment_secret_projection_v1" as const;
export const vercelProjectEnvironmentSecretSetPolicySchemaId = "vercel_project_environment_secret_policy_v1" as const;
export const vercelProjectEnvironmentSecretSetRiskClass = "vercel_project_environment_secret_set" as const;
export const vercelProjectEnvironmentSecretSetRecipeId = "vercel_project_environment_secret_readback_v1" as const;
export const vercelProjectEnvironmentSecretSetPackDigest = authorityDigest({ v: "reelier.outcome-pack/v1", packId: "vercel_project_environment_secret", definitions: [vercelProjectEnvironmentSecretSetAlias] });
export interface VercelProjectEnvironmentSecretSetPolicy { readonly teamId: string; readonly projectId: string; readonly environment: "production" | "preview" | "development"; readonly key: string; readonly secretDigest: string; }
