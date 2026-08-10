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
  readonly permissionGroupIds: readonly string[];
  readonly resources: Readonly<Record<string, string>>;
  readonly notBefore: string;
  readonly expiresAt: string;
  readonly requestIpIn: readonly string[];
  readonly requestIpNotIn: readonly string[];
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
function id(value: unknown, label: string): string { if (typeof value !== "string" || !ID.test(value)) throw new TypeError(`Cloudflare token ${label} is invalid`); return value; }
function list(value: unknown, label: string, allowEmpty = false): readonly string[] { if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.length > 128 || value.some(item => typeof item !== "string" || item.length === 0 || item.length > 256 || /[\0\r\n]/.test(item))) throw new TypeError(`Cloudflare token ${label} is invalid`); const result = [...value] as string[]; if (new Set(result).size !== result.length) throw new TypeError(`Cloudflare token ${label} must be unique`); return Object.freeze(result.sort(compareText)); }
function timestamp(value: unknown, label: string): string { if (typeof value !== "string") throw new TypeError(`Cloudflare token ${label} is invalid`); const parsed = Date.parse(value); if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) throw new TypeError(`Cloudflare token ${label} is invalid`); return value; }
function resources(value: unknown): Readonly<Record<string, string>> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Cloudflare token resources are invalid"); const raw = value as Record<string, unknown>; const keys = Object.keys(raw).sort(compareText); if (keys.length === 0 || keys.length > 128 || keys.some(key => key.length === 0 || key.length > 512 || /[\0\r\n]/.test(key) || typeof raw[key] !== "string" || !(raw[key] as string).length || (raw[key] as string).length > 512 || /[\0\r\n]/.test(raw[key] as string))) throw new TypeError("Cloudflare token resources are invalid"); return Object.freeze(Object.fromEntries(keys.map(key => [key, raw[key] as string]))); }

export function parseCloudflareTokenCreatePolicy(value: unknown): CloudflareTokenCreatePolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Cloudflare token create policy must be an object");
  const raw = value as Record<string, unknown>;
  const keys = ["accountId", "tokenName", "permissionGroupIds", "resources", "notBefore", "expiresAt", "requestIpIn", "requestIpNotIn"];
  if (Object.keys(raw).length !== keys.length || Object.keys(raw).some(key => !keys.includes(key))) throw new TypeError("Cloudflare token create policy is closed");
  const notBefore = timestamp(raw.notBefore, "notBefore"), expiresAt = timestamp(raw.expiresAt, "expiresAt");
  if (Date.parse(expiresAt) <= Date.parse(notBefore)) throw new TypeError("Cloudflare token expiry must follow notBefore");
  return Object.freeze({ accountId: id(raw.accountId, "accountId"), tokenName: id(raw.tokenName, "tokenName"), permissionGroupIds: list(raw.permissionGroupIds, "permissionGroupIds"), resources: resources(raw.resources), notBefore, expiresAt, requestIpIn: list(raw.requestIpIn, "requestIpIn", true), requestIpNotIn: list(raw.requestIpNotIn, "requestIpNotIn", true) });
}

export function compileCloudflareTokenCreate(input: Readonly<{ policy: CloudflareTokenCreatePolicy }>): TransportEffect {
  const policy = parseCloudflareTokenCreatePolicy(input.policy);
  const condition = policy.requestIpIn.length || policy.requestIpNotIn.length ? { request_ip: { in: policy.requestIpIn, not_in: policy.requestIpNotIn } } : undefined;
  const body = authorityCanonicalBytes({ name: policy.tokenName, policies: [{ effect: "allow", permission_groups: policy.permissionGroupIds.map(id => ({ id })), resources: policy.resources }], not_before: policy.notBefore, expires_on: policy.expiresAt, ...(condition ? { condition } : {}) });
  return Object.freeze({ v: "reelier.transport-effect/v1", endpointId: cloudflareTokenCreateWriteEndpointId, method: "POST", path: `/client/v4/accounts/${policy.accountId}/tokens`, query: "", headers: { "Content-Type": "application/json" }, bodyBase64: body.toString("base64"), riskClass: cloudflareTokenCreateRiskClass, idempotency: "reconcile-only", preconditions: [{ kind: "cloudflare-token-create-policy", digest: authorityDigest({ v: "reelier.cloudflare-token-create-policy/v1", ...policy }) }], reconciliation: { recipeId: cloudflareTokenCreateRecipeId } });
}

export function parseCloudflareTokenCreateEffect(effect: unknown): CloudflareTokenCreatePolicy {
  if (!effect || typeof effect !== "object") throw new TypeError("Cloudflare token create effect is invalid");
  const raw = effect as Record<string, unknown>;
  if (raw.endpointId !== cloudflareTokenCreateWriteEndpointId || typeof raw.bodyBase64 !== "string" || typeof raw.path !== "string") throw new TypeError("Cloudflare token create effect is invalid");
  const accountMatch = /^\/client\/v4\/accounts\/([^/]+)\/tokens$/.exec(raw.path);
  if (!accountMatch) throw new TypeError("Cloudflare token create effect path is invalid");
  let body: unknown; try { body = JSON.parse(Buffer.from(raw.bodyBase64, "base64").toString("utf8")); } catch { throw new TypeError("Cloudflare token create effect body is invalid"); }
  const record = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const policies = Array.isArray(record.policies) ? record.policies : [];
  const first = policies.length === 1 && policies[0] && typeof policies[0] === "object" && !Array.isArray(policies[0]) ? policies[0] as Record<string, unknown> : {};
  if (first.effect !== "allow" || !Array.isArray(first.permission_groups)) throw new TypeError("Cloudflare token create effect policy is invalid");
  const permissionGroupIds = first.permission_groups.map(item => item && typeof item === "object" && !Array.isArray(item) ? (item as Record<string, unknown>).id : undefined);
  const condition = record.condition && typeof record.condition === "object" && !Array.isArray(record.condition) ? record.condition as Record<string, unknown> : {};
  const requestIp = condition.request_ip && typeof condition.request_ip === "object" && !Array.isArray(condition.request_ip) ? condition.request_ip as Record<string, unknown> : {};
  return parseCloudflareTokenCreatePolicy({ accountId: accountMatch[1], tokenName: record.name, permissionGroupIds, resources: first.resources, notBefore: record.not_before, expiresAt: record.expires_on, requestIpIn: requestIp.in ?? [], requestIpNotIn: requestIp.not_in ?? [] });
}

function compareText(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
