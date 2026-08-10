import type { AuthorityStateReadBackendResult } from "../state.js";
import type { SourceReadPlan } from "../source.js";
import { executeJsonHttpsRead, type JsonHttpsEndpoint, type JsonHttpsSecretResolver } from "../drivers/json-https.js";

const ID = /^[A-Za-z0-9][A-Za-z0-9._~:/-]{0,255}$/;
const OPAQUE = /^(?![A-Za-z][A-Za-z0-9+.-]*:)(?!.*[\\/])[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/;
const FORBIDDEN_HEADERS = new Set(["authorization", "cookie", "host"]);

export interface SourceReadAdapter {
  readonly execute: (plans: readonly SourceReadPlan[]) => Promise<AuthorityStateReadBackendResult>;
}

export interface BoundSourceRead {
  readonly opaqueHandle: string;
  readonly endpointId: string;
  readonly accountIdentity: string;
  readonly path: string;
  readonly query: string;
  readonly headers: Readonly<Record<string, string>>;
}

export interface BoundSourceReadRequest {
  readonly endpointId: string;
  readonly accountIdentity: string;
  readonly path: string;
  readonly query: string;
  readonly headers: Readonly<Record<string, string>>;
}

export function createBoundSourceReadAdapter(input: Readonly<{
  bindings: readonly BoundSourceRead[];
  read: (input: BoundSourceReadRequest) => Promise<Uint8Array>;
}>): SourceReadAdapter {
  if (!input || !Array.isArray(input.bindings) || typeof input.read !== "function") throw new TypeError("bound source read adapter configuration is invalid");
  const byKey = new Map<string, BoundSourceRead>();
  for (const candidate of input.bindings) {
    const binding = normalizeBinding(candidate);
    const key = bindingKey(binding.endpointId, binding.opaqueHandle);
    if (byKey.has(key)) throw new TypeError("duplicate bound source read");
    byKey.set(key, binding);
  }
  return Object.freeze({
    async execute(plans: readonly SourceReadPlan[]): Promise<AuthorityStateReadBackendResult> {
      if (!Array.isArray(plans) || plans.length === 0) return { ok: false, reason: "refused" };
      const selected: BoundSourceRead[] = [];
      for (const plan of plans) {
        const binding = byKey.get(bindingKey(plan.endpointId, plan.opaqueHandle));
        if (!binding) return { ok: false, reason: "refused" };
        selected.push(binding);
      }
      try {
        const raw = await Promise.all(selected.map(binding => input.read(Object.freeze({ endpointId: binding.endpointId, accountIdentity: binding.accountIdentity, path: binding.path, query: binding.query, headers: binding.headers }))));
        return Object.freeze({ ok: true as const, observations: Object.freeze(raw.map((rawBytes, index) => Object.freeze({ planDigest: plans[index].planDigest, rawBytes: Uint8Array.from(rawBytes) }))) });
      } catch {
        return Object.freeze({ ok: false as const, reason: "unavailable" as const });
      }
    },
  });
}

export function createJsonHttpsSourceReadAdapter(input: Readonly<{
  bindings: readonly BoundSourceRead[];
  endpoints: readonly JsonHttpsEndpoint[];
  secrets: JsonHttpsSecretResolver;
  timeoutMs?: number;
  maxResponseBytes?: number;
}>): SourceReadAdapter {
  if (!input || !Array.isArray(input.endpoints) || !input.secrets) throw new TypeError("HTTPS source read adapter configuration is invalid");
  const endpoints = new Map<string, JsonHttpsEndpoint>();
  for (const endpoint of input.endpoints) {
    if (endpoints.has(endpoint.endpointId)) throw new TypeError("duplicate HTTPS source endpoint");
    endpoints.set(endpoint.endpointId, endpoint);
  }
  return createBoundSourceReadAdapter({
    bindings: input.bindings,
    async read(binding) {
      const endpoint = endpoints.get(binding.endpointId);
      if (!endpoint || endpoint.accountIdentity !== binding.accountIdentity) throw new TypeError("source read endpoint account mismatch");
      const response = await executeJsonHttpsRead({ endpointId: binding.endpointId, path: binding.path, query: binding.query, headers: binding.headers }, endpoint, input.secrets, { timeoutMs: input.timeoutMs, maxResponseBytes: input.maxResponseBytes });
      if (response.status < 200 || response.status >= 300) throw new Error("source read provider response is not successful");
      return Uint8Array.from(response.body);
    },
  });
}

function normalizeBinding(value: BoundSourceRead): BoundSourceRead {
  if (!value || typeof value !== "object" || Object.keys(value).sort().join("\0") !== ["accountIdentity", "endpointId", "headers", "opaqueHandle", "path", "query"].sort().join("\0")) throw new TypeError("bound source read is closed");
  if (!OPAQUE.test(value.opaqueHandle) || !ID.test(value.endpointId) || !ID.test(value.accountIdentity)) throw new TypeError("bound source read identity is invalid");
  if (!value.path.startsWith("/") || value.path.startsWith("//") || value.path.includes("..") || value.path.includes("\\") || /[?#\r\n]/.test(value.path)) throw new TypeError("bound source read path is invalid");
  if (typeof value.query !== "string" || value.query.length > 4096 || /[\r\n#]/.test(value.query) || value.query.startsWith("?")) throw new TypeError("bound source read query is invalid");
  if (!value.headers || typeof value.headers !== "object" || Array.isArray(value.headers)) throw new TypeError("bound source read headers are invalid");
  const headers: Record<string, string> = {};
  for (const [name, item] of Object.entries(value.headers)) {
    if (!/^[A-Za-z0-9-]{1,64}$/.test(name) || FORBIDDEN_HEADERS.has(name.toLowerCase()) || typeof item !== "string" || item.length > 512 || /[\r\n]/.test(item)) throw new TypeError("bound source read header is invalid");
    headers[name] = item;
  }
  return Object.freeze({ ...value, headers: Object.freeze(headers) });
}

function bindingKey(endpointId: string, opaqueHandle: string): string { return `${endpointId}\0${opaqueHandle}`; }

