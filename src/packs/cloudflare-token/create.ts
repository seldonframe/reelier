import { authorityCanonicalBytes, authorityDigest } from "../../authority/wire.js";
import type { TransportEffect } from "../../authority/types.js";

export const cloudflareTokenCreateAlias = "cloudflare_api_token_create_v1" as const;
export const cloudflareTokenCreateWriteEndpointId = "cloudflare.api_token.create" as const;
export const cloudflareTokenCreateReadEndpointId = "cloudflare.api_token.find" as const;
export const cloudflareTokenCreateResolverId = "cloudflare_api_token_create_source_v1" as const;
export const cloudflareTokenCreateProjectionSchemaId = "cloudflare_api_token_create_projection_v1" as const;
export const cloudflareTokenCreatePolicySchemaId = "cloudflare_api_token_create_policy_v1" as const;
export const cloudflareTokenCreateRiskClass = "cloudflare_api_token_create" as const;
export const cloudflareTokenCreateRecipeId = "cloudflare_api_token_create_readback_v1" as const;

export interface CloudflareTokenCreatePolicy {
  readonly accountId: string;
  readonly tokenName: string;
  readonly scopes: readonly string[];
  readonly resources: readonly string[];
  readonly secretDigest: string;
}

function id(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) throw new TypeError(`Cloudflare token ${label} is invalid`);
  return value;
}
function list(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 128 || value.some(item => typeof item !== "string" || item.length === 0 || item.length > 256)) throw new TypeError(`Cloudflare token ${label} is invalid`);
  const result = [...value] as string[];
  if (new Set(result).size !== result.length) throw new TypeError(`Cloudflare token ${label} must be unique`);
  return Object.freeze(result.sort(compareText));
}
function digest(value: unknown): string {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/.test(value)) throw new TypeError("Cloudflare token secretDigest is invalid");
  return value;
}
export function parseCloudflareTokenCreatePolicy(value: unknown): CloudflareTokenCreatePolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Cloudflare token create policy must be an object");
  const raw = value as Record<string, unknown>;
  const keys = ["accountId", "tokenName", "scopes", "resources", "secretDigest"];
  if (Object.keys(raw).length !== keys.length || Object.keys(raw).some(key => !keys.includes(key))) throw new TypeError("Cloudflare token create policy is closed");
  return Object.freeze({ accountId: id(raw.accountId, "accountId"), tokenName: id(raw.tokenName, "tokenName"), scopes: list(raw.scopes, "scopes"), resources: list(raw.resources, "resources"), secretDigest: digest(raw.secretDigest) });
}
export function compileCloudflareTokenCreate(input: Readonly<{ policy: CloudflareTokenCreatePolicy | Omit<CloudflareTokenCreatePolicy, "secretDigest">; secret?: Readonly<{ digest: string }> }>): TransportEffect {
  const raw = input.policy as CloudflareTokenCreatePolicy;
  const policy = raw.secretDigest ? parseCloudflareTokenCreatePolicy(raw) : parseCloudflareTokenCreatePolicy({ ...raw, secretDigest: input.secret?.digest });
  const body = authorityCanonicalBytes({ accountId: policy.accountId, name: policy.tokenName, scopes: policy.scopes, resources: policy.resources, secretDigest: policy.secretDigest });
  return Object.freeze({ v: "reelier.transport-effect/v1", endpointId: cloudflareTokenCreateWriteEndpointId, method: "POST", path: `/client/v4/accounts/${policy.accountId}/tokens`, query: "", headers: { "Content-Type": "application/json" }, bodyBase64: body.toString("base64"), riskClass: cloudflareTokenCreateRiskClass, idempotency: "reconcile-only", preconditions: [{ kind: "cloudflare-token-create-policy", digest: authorityDigest({ v: "reelier.cloudflare-token-create-policy/v1", ...policy }) }], reconciliation: { recipeId: cloudflareTokenCreateRecipeId } });
}
export function parseCloudflareTokenCreateEffect(effect: unknown): CloudflareTokenCreatePolicy {
  if (!effect || typeof effect !== "object") throw new TypeError("Cloudflare token create effect is invalid");
  const raw = effect as Record<string, unknown>;
  if (raw.endpointId !== cloudflareTokenCreateWriteEndpointId || typeof raw.bodyBase64 !== "string") throw new TypeError("Cloudflare token create effect is invalid");
  let body: unknown; try { body = JSON.parse(Buffer.from(raw.bodyBase64, "base64").toString("utf8")); } catch { throw new TypeError("Cloudflare token create effect body is invalid"); }
  const record = body as Record<string, unknown>;
  return parseCloudflareTokenCreatePolicy({ accountId: record.accountId, tokenName: record.name, scopes: record.scopes, resources: record.resources, secretDigest: record.secretDigest });
}
function compareText(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
