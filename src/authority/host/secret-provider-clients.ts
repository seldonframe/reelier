import { executeJsonHttpsConfidentialRequest, executeJsonHttpsEffect, executeJsonHttpsRead, type JsonHttpsConfidentialRequest, type JsonHttpsEndpoint, type JsonHttpsRead, type JsonHttpsResponse, type JsonHttpsSecretResolver } from "../drivers/json-https.js";
import { compileCloudflareTokenCreate, type CloudflareTokenCreatePolicy } from "../../packs/cloudflare-token/create.js";
import type { VercelProjectEnvironmentSecretSetPolicy } from "../../packs/vercel-environment-secret/compile.js";
import type { CloudflareTokenCreateProvider, VercelProjectEnvironmentSecretProvider } from "./secret-adapters.js";

type ExecuteEffect = (effect: Parameters<typeof executeJsonHttpsEffect>[0], endpoint: JsonHttpsEndpoint, secrets: JsonHttpsSecretResolver, options?: Parameters<typeof executeJsonHttpsEffect>[3]) => Promise<JsonHttpsResponse>;
type ExecuteRead = (read: JsonHttpsRead, endpoint: JsonHttpsEndpoint, secrets: JsonHttpsSecretResolver, options?: Parameters<typeof executeJsonHttpsRead>[3]) => Promise<JsonHttpsResponse>;
type ExecuteConfidential = (request: JsonHttpsConfidentialRequest, endpoint: JsonHttpsEndpoint, secrets: JsonHttpsSecretResolver, options?: Parameters<typeof executeJsonHttpsConfidentialRequest>[3]) => Promise<JsonHttpsResponse>;

export function createCloudflareTokenCreateHttpsProvider(input: Readonly<{
  createEndpoint: JsonHttpsEndpoint;
  listEndpoint: JsonHttpsEndpoint;
  secrets: JsonHttpsSecretResolver;
  executeEffect?: ExecuteEffect;
  executeRead?: ExecuteRead;
  timeoutMs?: number;
  maxResponseBytes?: number;
}>): CloudflareTokenCreateProvider {
  assertEndpoint(input.createEndpoint, "cloudflare.api_token.create", "POST");
  assertEndpoint(input.listEndpoint, "cloudflare.api_token.find", "GET");
  const write = input.executeEffect ?? executeJsonHttpsEffect, read = input.executeRead ?? executeJsonHttpsRead;
  const options = { timeoutMs: input.timeoutMs, maxResponseBytes: input.maxResponseBytes };
  return Object.freeze({
    async createToken(policy: CloudflareTokenCreatePolicy) {
      const response = await write(compileCloudflareTokenCreate({ policy }), input.createEndpoint, input.secrets, options);
      return Object.freeze({ status: response.status, body: response.body });
    },
    async findToken(policy: CloudflareTokenCreatePolicy) {
      for (let page = 1; page <= 20; page++) {
        const response = await read({ endpointId: input.listEndpoint.endpointId, path: `/client/v4/accounts/${policy.accountId}/tokens`, query: `include_expired=true&page=${page}&per_page=50`, headers: { Accept: "application/json" } }, input.listEndpoint, input.secrets, options);
        if (response.status < 200 || response.status >= 300) throw new Error("Cloudflare token listing failed");
        let parsed: unknown; try { parsed = JSON.parse(response.body.toString("utf8")); } finally { response.body.fill(0); }
        const root = object(parsed, "Cloudflare token list response");
        if (root.success !== true || !Array.isArray(root.result)) throw new TypeError("Cloudflare token list response is invalid");
        const matches = root.result.filter(item => item && typeof item === "object" && !Array.isArray(item) && (item as Record<string, unknown>).name === policy.tokenName);
        if (matches.length > 1) throw new Error("Cloudflare token name is ambiguous");
        if (matches.length === 1) return Object.freeze({ accountId: policy.accountId, ...(matches[0] as Record<string, unknown>) });
        const info = root.result_info && typeof root.result_info === "object" && !Array.isArray(root.result_info) ? root.result_info as Record<string, unknown> : {};
        const totalPages = typeof info.total_count === "number" ? Math.ceil(info.total_count / 50) : root.result.length < 50 ? page : page + 1;
        if (page >= totalPages) return undefined;
      }
      throw new Error("Cloudflare token listing exceeded the certification page limit");
    },
  });
}

export function createVercelProjectEnvironmentSecretHttpsProvider(input: Readonly<{
  writeEndpoint: JsonHttpsEndpoint;
  readEndpoint: JsonHttpsEndpoint;
  secrets: JsonHttpsSecretResolver;
  executeConfidential?: ExecuteConfidential;
  executeRead?: ExecuteRead;
  timeoutMs?: number;
  maxResponseBytes?: number;
}>): VercelProjectEnvironmentSecretProvider {
  assertEndpoint(input.writeEndpoint, "vercel.project.environment.secret.set", "POST");
  assertEndpoint(input.readEndpoint, "vercel.project.environment.secret.get", "GET");
  const write = input.executeConfidential ?? executeJsonHttpsConfidentialRequest, read = input.executeRead ?? executeJsonHttpsRead;
  const options = { timeoutMs: input.timeoutMs, maxResponseBytes: input.maxResponseBytes, maxRequestBytes: 64 * 1024 };
  return Object.freeze({
    async setEnvironmentSecret(value: Readonly<VercelProjectEnvironmentSecretSetPolicy & { readonly secret: Uint8Array }>) {
      if (!/^[A-Za-z0-9_-]{40,80}$/.test(Buffer.from(value.secret).toString("ascii"))) throw new TypeError("Vercel secret handoff is not a Cloudflare token value");
      const prefix = Buffer.from(`[{"key":${JSON.stringify(value.key)},"target":[${JSON.stringify(value.environment)}],"type":"sensitive","value":"`, "utf8");
      const suffix = Buffer.from('"}]', "utf8");
      const body = Buffer.concat([prefix, Buffer.from(value.secret), suffix]);
      let response: JsonHttpsResponse | undefined;
      try {
        response = await write({ endpointId: input.writeEndpoint.endpointId, method: "POST", path: `/v10/projects/${value.projectId}/env`, query: `teamId=${encodeURIComponent(value.teamId)}`, headers: { "Content-Type": "application/json" }, body }, input.writeEndpoint, input.secrets, options);
        if (response.status < 200 || response.status >= 300) throw new Error("Vercel sensitive environment write failed");
        const parsed = JSON.parse(response.body.toString("utf8"));
        const found = findVercelEnvironmentRecord(parsed, value);
        if (!found) throw new Error("Vercel sensitive environment response is invalid");
        return Object.freeze({ teamId: value.teamId, projectId: value.projectId, environment: value.environment, key: value.key, type: "sensitive", status: "active", ...(typeof found.id === "string" ? { id: found.id } : {}) });
      } finally { body.fill(0); if (response) response.body.fill(0); }
    },
    async readEnvironmentSecretMetadata(policy: VercelProjectEnvironmentSecretSetPolicy) {
      const response = await read({ endpointId: input.readEndpoint.endpointId, path: `/v10/projects/${policy.projectId}/env`, query: `teamId=${encodeURIComponent(policy.teamId)}`, headers: { Accept: "application/json" } }, input.readEndpoint, input.secrets, options);
      try {
        if (response.status === 404) return undefined;
        if (response.status < 200 || response.status >= 300) throw new Error("Vercel environment read-back failed");
        const found = findVercelEnvironmentRecord(JSON.parse(response.body.toString("utf8")), policy, true);
        if (!found) return undefined;
        return Object.freeze({ teamId: policy.teamId, projectId: policy.projectId, environment: policy.environment, key: policy.key, type: "sensitive", status: "active", ...(typeof found.id === "string" ? { id: found.id } : {}) });
      } finally { response.body.fill(0); }
    },
  });
}

function findVercelEnvironmentRecord(value: unknown, expected: Pick<VercelProjectEnvironmentSecretSetPolicy, "key" | "environment">, allowMissing = false): Record<string, unknown> | undefined {
  const root = Array.isArray(value) ? value : value && typeof value === "object" && Array.isArray((value as Record<string, unknown>).envs) ? (value as Record<string, unknown>).envs as unknown[] : value && typeof value === "object" ? [value] : [];
  const matches = root.filter(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const record = item as Record<string, unknown>;
    const targets = Array.isArray(record.target) ? record.target : [];
    return record.key === expected.key && record.type === "sensitive" && targets.includes(expected.environment);
  }) as Record<string, unknown>[];
  if (matches.length === 0 && allowMissing) return undefined;
  if (matches.length !== 1) throw new Error(matches.length ? "Vercel sensitive environment variable is ambiguous" : "Vercel sensitive environment response is invalid");
  return matches[0];
}

function assertEndpoint(endpoint: JsonHttpsEndpoint, id: string, method: "GET" | "POST"): void { if (!endpoint || endpoint.endpointId !== id || !endpoint.allowedMethods.includes(method)) throw new TypeError(`${id} endpoint is invalid`); }
function object(value: unknown, label: string): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} is invalid`); return value as Record<string, unknown>; }
