import { authorityDigest } from "../../authority/wire.js";

export const cloudflareDnsRecordSetAlias = "cloudflare_dns_record_set_v1" as const;
export const cloudflareDnsRecordSetResolverId = "cloudflare_dns_record_source_v1" as const;
export const cloudflareDnsRecordSetProjectionSchemaId = "cloudflare_dns_record_projection_v1" as const;
export const cloudflareDnsRecordSetPolicySchemaId = "cloudflare_dns_record_policy_v1" as const;
export const cloudflareDnsRecordSetRiskClass = "cloudflare_dns_record_set" as const;
export const cloudflareDnsRecordSetReadEndpointId = "cloudflare.dns.record.get" as const;
export const cloudflareDnsRecordSetWriteEndpointId = "cloudflare.dns.record.set" as const;
export const cloudflareDnsRecordSetRecipeId = "cloudflare_dns_record_set_readback_v1" as const;
const definitionShape = Object.freeze({ v: "reelier.outcome-pack-definition/v1", alias: cloudflareDnsRecordSetAlias, resolverId: cloudflareDnsRecordSetResolverId, projectionSchemaId: cloudflareDnsRecordSetProjectionSchemaId, policySchemaId: cloudflareDnsRecordSetPolicySchemaId, readEndpointIds: [cloudflareDnsRecordSetReadEndpointId], writeEndpointIds: [cloudflareDnsRecordSetWriteEndpointId], riskClasses: [cloudflareDnsRecordSetRiskClass], requiredGroundedPointers: ["/accountId", "/zoneId", "/recordId", "/name", "/type", "/content", "/ttl", "/proxied"], maxFreshnessSeconds: 60 });
export const cloudflareDnsRecordSetPackDigest = authorityDigest({ v: "reelier.outcome-pack/v1", packId: "cloudflare_dns", definitions: [definitionShape] });
export const cloudflareDnsRecordSetDefinitionDigest = authorityDigest({ ...definitionShape, packDigest: cloudflareDnsRecordSetPackDigest });
export const cloudflareDnsRecordSetManifest = Object.freeze({ v: "reelier.outcome-pack-manifest/v1" as const, packId: "cloudflare_dns", packDigest: cloudflareDnsRecordSetPackDigest, definitions: [cloudflareDnsRecordSetAlias] });
export type CloudflareDnsRecordType = "A" | "AAAA" | "CNAME" | "TXT";
export interface CloudflareDnsRecordProjection extends Record<string, unknown> { readonly accountId: string; readonly zoneId: string; readonly recordId: string; readonly name: string; readonly type: CloudflareDnsRecordType; readonly content: string; readonly ttl: number; readonly proxied: boolean; }
