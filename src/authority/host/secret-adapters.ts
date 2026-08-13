import { authorityDigest } from "../wire.js";
import type { DispatchAdapter, DispatchOutcome, DispatchRequestState } from "./dispatch.js";
import { parseCloudflareTokenCreateEffect, type CloudflareTokenCreatePolicy } from "../../packs/cloudflare-token/create.js";
import { parseVercelProjectEnvironmentSecretSetEffect, type VercelProjectEnvironmentSecretSetPolicy } from "../../packs/vercel-environment-secret/compile.js";
import type { ConfidentialTransferStore } from "./confidential-transfer.js";

export interface CloudflareTokenCreateResponse { readonly status: number; readonly body: Uint8Array }
export interface CloudflareTokenCreateProvider {
  /** The response body is transferred to the adapter and will be zeroed after extraction. */
  createToken(input: Readonly<CloudflareTokenCreatePolicy>): Promise<CloudflareTokenCreateResponse>;
  findToken(input: Readonly<CloudflareTokenCreatePolicy>): Promise<unknown | undefined>;
}
export interface VercelProjectEnvironmentSecretProvider {
  setEnvironmentSecret(input: Readonly<VercelProjectEnvironmentSecretSetPolicy & { readonly secret: Uint8Array }>): Promise<Readonly<{ metadata: unknown; requestBytesDigest: string }>>;
  readEnvironmentSecretMetadata(input: Readonly<VercelProjectEnvironmentSecretSetPolicy>): Promise<unknown | undefined>;
}

export interface CloudflareConfidentialTransferTarget {
  readonly transferId: string;
  readonly destinationOutcome: string;
  readonly destination: string;
  readonly secretSlot: string;
  readonly expiresAt: string;
}

export function createCloudflareTokenCreateDispatchAdapter(input: Readonly<{ transfer: CloudflareConfidentialTransferTarget; transfers: ConfidentialTransferStore; provider: CloudflareTokenCreateProvider }>): DispatchAdapter {
  if (!input?.transfer || !input.transfers || !input.provider) throw new TypeError("Cloudflare token create adapter configuration is invalid");
  let policy: CloudflareTokenCreatePolicy | undefined;
  return Object.freeze({
    async dispatch(state: DispatchRequestState): Promise<DispatchOutcome> {
      let ownedResponse: Uint8Array | undefined;
      try {
        policy = parseCloudflareTokenCreateEffect(state.effect);
        const response = await input.provider.createToken(policy);
        ownedResponse = response.body;
        if (!Number.isSafeInteger(response.status) || response.status < 200 || response.status >= 300) return Object.freeze({ kind: "definitive-failure" as const, providerStatus: response.status, resultDigest: authorityDigest({ v: "reelier.cloudflare-token-create-result/v1", reservationId: state.reservation.reservationId, status: response.status, bodyDigest: digestBytes(response.body) }) });
        const extracted = extractCloudflareCreatedToken(response.body, policy);
        try {
          const transfer = await input.transfers.capture({ transferId: input.transfer.transferId, sourceOutcome: state.reservation.reservationId, destinationOutcome: input.transfer.destinationOutcome, destination: input.transfer.destination, secretSlot: input.transfer.secretSlot, expiresAt: input.transfer.expiresAt, value: extracted.value });
          return Object.freeze({ kind: "acknowledged" as const, providerStatus: response.status, resultDigest: authorityDigest({ v: "reelier.cloudflare-token-create-result/v1", reservationId: state.reservation.reservationId, metadata: extracted.metadata, rawResponseDigest: extracted.rawResponseDigest, transferCommitmentDigest: transfer.commitmentDigest }), providerResultDigest: extracted.rawResponseDigest });
        } finally { extracted.value.fill(0); }
      } catch (error) {
        return Object.freeze({ kind: "ambiguous" as const, resultDigest: authorityDigest({ v: "reelier.cloudflare-token-create-result/v1", reservationId: state.reservation.reservationId, status: "ambiguous", error: error instanceof Error ? error.name : "Error" }) });
      } finally { if (ownedResponse) ownedResponse.fill(0); }
    },
    async reconcile(state: DispatchRequestState, outcome: DispatchOutcome): Promise<DispatchOutcome> {
      const expected = policy ?? parseCloudflareTokenCreateEffect(state.effect);
      try {
        const found = await input.provider.findToken(expected);
        if (!found) return Object.freeze({ ...outcome, kind: "definitive-failure", reconciliationStatus: "not-applied" as const, normalizedProjectionDigest: null });
        const metadata = normalizeCloudflareMetadata(found);
        const matched = metadataMatchesCloudflare(metadata, expected);
        return Object.freeze({ ...outcome, kind: matched ? "acknowledged" as const : "definitive-failure" as const, reconciliationStatus: matched ? "matched" as const : "conflict" as const, normalizedProjectionDigest: authorityDigest({ v: "reelier.cloudflare-token-create-metadata/v1", metadata }) });
      } catch { return Object.freeze({ ...outcome, kind: "ambiguous" as const, reconciliationStatus: "unavailable" as const, normalizedProjectionDigest: null }); }
    },
  });
}

export function createVercelProjectEnvironmentSecretDispatchAdapter(input: Readonly<{ transferId: string; transfers: ConfidentialTransferStore; provider: VercelProjectEnvironmentSecretProvider }>): DispatchAdapter {
  if (!input?.transferId || !input.transfers || !input.provider) throw new TypeError("Vercel environment secret adapter configuration is invalid");
  let policy: VercelProjectEnvironmentSecretSetPolicy | undefined;
  return Object.freeze({
    async dispatch(state: DispatchRequestState): Promise<DispatchOutcome> {
      let secret: Uint8Array | undefined;
      try {
        policy = parseVercelProjectEnvironmentSecretSetEffect(state.effect);
        const transfer = await input.transfers.take(input.transferId);
        if (transfer.handle.digest !== policy.secretDigest || transfer.commitment.valueDigest !== policy.secretDigest) throw new Error("confidential transfer digest does not match approved effect");
        secret = transfer.handle.readOnce();
        const result = await input.provider.setEnvironmentSecret({ ...policy, secret });
        if (!/^sha256:[0-9a-f]{64}$/.test(result.requestBytesDigest)) throw new TypeError("Vercel confidential request digest is invalid");
        const effect = transportEnvelope(state.effect);
        const materializedRequestDigest = authorityDigest({ v: "reelier.materialized-provider-request/v1", endpointId: effect.endpointId, method: effect.method, path: effect.path, query: effect.query, headers: effect.headers, bodyDigest: result.requestBytesDigest });
        return Object.freeze({ kind: "acknowledged" as const, resultDigest: authorityDigest({ v: "reelier.vercel-environment-secret-result/v1", reservationId: state.reservation.reservationId, metadata: redactProviderResult(result.metadata), transferCommitmentDigest: transfer.commitmentDigest }), materializedRequestDigest });
      } catch (error) { return Object.freeze({ kind: "ambiguous" as const, resultDigest: authorityDigest({ v: "reelier.vercel-environment-secret-result/v1", reservationId: state.reservation.reservationId, status: "ambiguous", error: error instanceof Error ? error.name : "Error" }) }); }
      finally { if (secret) secret.fill(0); }
    },
    async reconcile(state: DispatchRequestState, outcome: DispatchOutcome): Promise<DispatchOutcome> {
      const expected = policy ?? parseVercelProjectEnvironmentSecretSetEffect(state.effect);
      try {
        const found = await input.provider.readEnvironmentSecretMetadata(expected);
        if (!found) return Object.freeze({ ...outcome, kind: "definitive-failure", reconciliationStatus: "not-applied" as const, normalizedProjectionDigest: null });
        const metadata = redactProviderResult(found);
        const matched = metadataMatchesVercel(metadata, expected);
        return Object.freeze({ ...outcome, kind: matched ? "acknowledged" as const : "definitive-failure" as const, reconciliationStatus: matched ? "matched" as const : "conflict" as const, normalizedProjectionDigest: authorityDigest({ v: "reelier.vercel-environment-secret-metadata/v1", metadata }) });
      } catch { return Object.freeze({ ...outcome, kind: "ambiguous" as const, reconciliationStatus: "unavailable" as const, normalizedProjectionDigest: null }); }
    },
  });
}

export const createCloudflareTokenCreateAdapter = createCloudflareTokenCreateDispatchAdapter;
export const createVercelProjectEnvironmentSecretAdapter = createVercelProjectEnvironmentSecretDispatchAdapter;

function extractCloudflareCreatedToken(body: Uint8Array, expected: CloudflareTokenCreatePolicy): Readonly<{ value: Uint8Array; metadata: Record<string, unknown>; rawResponseDigest: string }> {
  const rawResponseDigest = digestBytes(body);
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.from(body).toString("utf8")); } catch { throw new TypeError("Cloudflare token create response is not JSON"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new TypeError("Cloudflare token create response is invalid");
  const root = parsed as Record<string, unknown>;
  if (root.success !== true || !root.result || typeof root.result !== "object" || Array.isArray(root.result)) throw new TypeError("Cloudflare token create response was not successful");
  const result = root.result as Record<string, unknown>;
  const value = result.value;
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{40,80}$/.test(value)) throw new TypeError("Cloudflare token create response omitted the one-time value");
  const bytes = new TextEncoder().encode(value);
  result.value = "";
  const metadata = normalizeCloudflareMetadata({ accountId: expected.accountId, ...result });
  if (!metadataMatchesCloudflare(metadata, expected)) { bytes.fill(0); throw new TypeError("Cloudflare created token metadata drifted from the approved policy"); }
  return Object.freeze({ value: bytes, metadata, rawResponseDigest });
}

function normalizeCloudflareMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Cloudflare token metadata is invalid");
  const raw = value as Record<string, unknown>;
  const policies = Array.isArray(raw.policies) ? raw.policies : [];
  const permissionGroupIds = policies.flatMap(policy => policy && typeof policy === "object" && !Array.isArray(policy) && Array.isArray((policy as Record<string, unknown>).permission_groups) ? ((policy as Record<string, unknown>).permission_groups as unknown[]).map(item => item && typeof item === "object" && !Array.isArray(item) ? (item as Record<string, unknown>).id : undefined) : []).filter((item): item is string => typeof item === "string").sort(compareText);
  const resources = policies.length === 1 && policies[0] && typeof policies[0] === "object" && !Array.isArray(policies[0]) && (policies[0] as Record<string, unknown>).resources && typeof (policies[0] as Record<string, unknown>).resources === "object" ? (policies[0] as Record<string, unknown>).resources : raw.resources;
  return Object.freeze({ id: raw.id, accountId: raw.accountId, name: raw.name, permissionGroupIds: raw.permissionGroupIds ?? permissionGroupIds, resources, expiresAt: raw.expiresAt ?? raw.expires_on, notBefore: raw.notBefore ?? raw.not_before, status: raw.status });
}

function redactProviderResult(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) return {}; const out: Record<string, unknown> = {}; for (const [key, item] of Object.entries(value as Record<string, unknown>)) { if (/secret|token|value|bearer|authorization|password/i.test(key)) continue; out[key] = Array.isArray(item) ? [...item] : item; } return out; }
function metadataMatchesCloudflare(actual: Record<string, unknown>, expected: CloudflareTokenCreatePolicy): boolean { return actual.accountId === expected.accountId && actual.name === expected.tokenName && actual.status === "active" && actual.expiresAt === expected.expiresAt && actual.notBefore === expected.notBefore && sameList(actual.permissionGroupIds, expected.permissionGroupIds) && sameRecord(actual.resources, expected.resources); }
function metadataMatchesVercel(actual: Record<string, unknown>, expected: VercelProjectEnvironmentSecretSetPolicy): boolean { return actual.teamId === expected.teamId && actual.projectId === expected.projectId && actual.environment === expected.environment && actual.key === expected.key && actual.type === "sensitive" && actual.status === "active"; }
function sameList(actual: unknown, expected: readonly string[]): boolean { return Array.isArray(actual) && actual.length === expected.length && [...actual].every((item, index) => item === expected[index]); }
function sameRecord(actual: unknown, expected: Readonly<Record<string, string>>): boolean { if (!actual || typeof actual !== "object" || Array.isArray(actual)) return false; const left = actual as Record<string, unknown>, keys = Object.keys(expected); return Object.keys(left).length === keys.length && keys.every(key => left[key] === expected[key]); }
function digestBytes(value: Uint8Array): string { return authorityDigest(Buffer.from(value).toString("base64")); }
function compareText(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function transportEnvelope(value: unknown): Readonly<{ endpointId: string; method: string; path: string; query: string; headers: Record<string, string> }> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("confidential transport effect is invalid"); const raw = value as Record<string, unknown>; if (typeof raw.endpointId !== "string" || typeof raw.method !== "string" || typeof raw.path !== "string" || typeof raw.query !== "string" || !raw.headers || typeof raw.headers !== "object" || Array.isArray(raw.headers)) throw new TypeError("confidential transport effect is invalid"); return { endpointId: raw.endpointId, method: raw.method, path: raw.path, query: raw.query, headers: raw.headers as Record<string, string> }; }
