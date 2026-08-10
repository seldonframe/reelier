import { authorityCanonicalBytes } from "../wire.js";
import { executeJsonHttpsEffect, executeJsonHttpsRead, type JsonHttpsEndpoint, type JsonHttpsSecretResolver } from "../drivers/json-https.js";
import type { TransportEffect } from "../types.js";
import { createSecretResolver } from "./secret-resolver.js";
import { digestFlyNetworkPolicies, parseFlyNetworkPolicies, type FlyNetworkPolicyV1 } from "./fly-network-policy.js";

const APP = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export interface FlyNetworkPolicyApiRequest {
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly body: unknown;
}

export interface FlyNetworkPolicyApiResponse {
  readonly status: number;
  readonly body: unknown;
}

export interface FlyNetworkPolicyClientInput {
  readonly appName: string;
  readonly credentialRef: string;
  readonly secrets?: JsonHttpsSecretResolver;
  readonly request?: (input: Readonly<FlyNetworkPolicyApiRequest>) => Promise<FlyNetworkPolicyApiResponse>;
}

export interface ProvisionFlyNetworkPolicyInput extends FlyNetworkPolicyClientInput {
  readonly allowLive?: boolean;
  readonly policy: FlyNetworkPolicyV1 | unknown;
}

export async function readFlyNetworkPolicyDigest(input: FlyNetworkPolicyClientInput): Promise<string> {
  validateClient(input);
  const request = input.request ?? createRequest(input);
  const path = `/v1/apps/${input.appName}/network_policies`;
  return digestFlyNetworkPolicies((await readProviderPolicies(request, path)).map(entry => entry.policy));
}

export async function provisionFlyNetworkPolicy(input: ProvisionFlyNetworkPolicyInput): Promise<Readonly<{ status: "verified"; digest: string }>> {
  if (input.allowLive !== true) throw new TypeError("Fly network policy provisioning requires allowLive: true");
  validateClient(input);
  const policy = parseFlyNetworkPolicies([input.policy])[0];
  const expectedDigest = digestFlyNetworkPolicies([policy]);
  const request = input.request ?? createRequest(input);
  const path = `/v1/apps/${input.appName}/network_policies`;
  const existing = (await readProviderPolicies(request, path)).find(entry => entry.policy.name === policy.name);
  if (!existing || digestFlyNetworkPolicies([existing.policy]) !== expectedDigest) {
    const body = existing ? { id: existing.id, ...policy } : policy;
    const written = await request({ method: "POST", path, body });
    if (written.status < 200 || written.status >= 300) throw new Error("Fly network policy write failed");
  }
  const actualDigest = await readFlyNetworkPolicyDigest({ ...input, request });
  if (actualDigest !== expectedDigest) throw new Error("Fly network policy read-back does not match the intended policy");
  return Object.freeze({ status: "verified", digest: actualDigest });
}

function createRequest(input: FlyNetworkPolicyClientInput): (request: Readonly<FlyNetworkPolicyApiRequest>) => Promise<FlyNetworkPolicyApiResponse> {
  const secrets = input.secrets ?? createSecretResolver();
  const endpoint = (method: "GET" | "POST"): JsonHttpsEndpoint => Object.freeze({
    endpointId: method === "GET" ? "fly.network-policies.read" : "fly.network-policies.write",
    baseUrl: "https://api.machines.dev",
    allowedMethods: [method],
    allowedPathPrefixes: [`/v1/apps/${input.appName}/network_policies`],
    secretRef: input.credentialRef,
    accountIdentity: input.appName,
  });
  return async request => {
    const configured = endpoint(request.method);
    const result = request.method === "GET"
      ? await executeJsonHttpsRead({ endpointId: configured.endpointId, path: request.path, query: "", headers: { Accept: "application/json" } }, configured, secrets)
      : await executeJsonHttpsEffect({
        v: "reelier.transport-effect/v1",
        endpointId: configured.endpointId,
        method: "POST",
        path: request.path,
        query: "",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        bodyBase64: authorityCanonicalBytes(request.body).toString("base64"),
        riskClass: "fly_network_policy",
        idempotency: "reconcile-only",
        preconditions: [],
        reconciliation: { recipeId: "fly_network_policy_readback_v1" },
      } satisfies TransportEffect, configured, secrets);
    let body: unknown;
    try { body = result.body.length ? JSON.parse(result.body.toString("utf8")) : null; } catch { throw new Error("Fly network policy response is not JSON"); }
    return Object.freeze({ status: result.status, body });
  };
}

function normalizeProviderPolicies(value: unknown): readonly unknown[] {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError("Fly network policy read-back is empty or invalid");
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new TypeError(`Fly network policy read-back ${index} is invalid`);
    const raw = item as Record<string, unknown>;
    return { name: raw.name, selector: raw.netpolSelector ?? raw.selector, rules: raw.rules };
  });
}

async function readProviderPolicies(request: (input: Readonly<FlyNetworkPolicyApiRequest>) => Promise<FlyNetworkPolicyApiResponse>, path: string): Promise<readonly Readonly<{ id: string; policy: FlyNetworkPolicyV1 }>[]> {
  const response = await request({ method: "GET", path, body: null });
  if (response.status < 200 || response.status >= 300) throw new Error("Fly network policy read failed");
  const body = response.body;
  if (!Array.isArray(body)) throw new TypeError("Fly network policy read-back is invalid");
  if (body.length === 0) return Object.freeze([]);
  const normalized = normalizeProviderPolicies(body);
  const policies = parseFlyNetworkPolicies(normalized);
  return Object.freeze(policies.map((policy, index) => {
    const raw = body[index] as Record<string, unknown>;
    if (typeof raw.id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(raw.id)) throw new TypeError(`Fly network policy read-back ${index} has an invalid id`);
    return Object.freeze({ id: raw.id, policy });
  }));
}

function validateClient(input: FlyNetworkPolicyClientInput): void {
  if (!input || typeof input !== "object" || !APP.test(input.appName)) throw new TypeError("Fly app name is invalid");
  if (typeof input.credentialRef !== "string" || !/^(?:env:[A-Za-z_][A-Za-z0-9_]{0,127}|file:.+)$/.test(input.credentialRef)) throw new TypeError("Fly credential reference is invalid");
  if (input.request !== undefined && typeof input.request !== "function") throw new TypeError("Fly network policy request adapter is invalid");
}
