import { authorityDigest } from "../../authority/wire.js";

export const cloudflareTokenRollAlias = "cloudflare_api_token_roll_v1" as const;
export const cloudflareTokenRollResolverId = "cloudflare_api_token_source_v1" as const;
export const cloudflareTokenRollProjectionSchemaId = "cloudflare_api_token_projection_v1" as const;
export const cloudflareTokenRollPolicySchemaId = "cloudflare_api_token_policy_v1" as const;
export const cloudflareTokenRollRiskClass = "cloudflare_api_token_roll" as const;
export const cloudflareTokenRollReadEndpointId = "cloudflare.api_token.get" as const;
export const cloudflareTokenRollWriteEndpointId = "cloudflare.api_token.roll" as const;
export const cloudflareTokenRollRecipeId = "cloudflare_api_token_roll_readback_v1" as const;
const definitionShape = Object.freeze({ v: "reelier.outcome-pack-definition/v1", alias: cloudflareTokenRollAlias, resolverId: cloudflareTokenRollResolverId, projectionSchemaId: cloudflareTokenRollProjectionSchemaId, policySchemaId: cloudflareTokenRollPolicySchemaId, readEndpointIds: [cloudflareTokenRollReadEndpointId], writeEndpointIds: [cloudflareTokenRollWriteEndpointId], riskClasses: [cloudflareTokenRollRiskClass], requiredGroundedPointers: ["/accountId", "/tokenId", "/tokenName", "/scopes", "/resources", "/expiresAt", "/status"], maxFreshnessSeconds: 60 });
export const cloudflareTokenRollPackDigest = authorityDigest({ v: "reelier.outcome-pack/v1", packId: "cloudflare_api_token", definitions: [definitionShape] });
export const cloudflareTokenRollDefinitionDigest = authorityDigest({ ...definitionShape, packDigest: cloudflareTokenRollPackDigest });
export const cloudflareTokenRollManifest = Object.freeze({ v: "reelier.outcome-pack-manifest/v1" as const, packId: "cloudflare_api_token", packDigest: cloudflareTokenRollPackDigest, definitions: [cloudflareTokenRollAlias] });
export interface CloudflareTokenProjection extends Record<string, unknown> { readonly accountId: string; readonly tokenId: string; readonly tokenName: string; readonly scopes: readonly string[]; readonly resources: readonly string[]; readonly expiresAt: string; readonly status: "active" | "disabled" | "revoked"; }
