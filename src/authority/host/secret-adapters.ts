import { authorityDigest } from "../wire.js";
import type { SecretHandle } from "./secret-handle.js";
import type { DispatchAdapter, DispatchOutcome, DispatchRequestState } from "./dispatch.js";
import { parseCloudflareTokenCreateEffect, type CloudflareTokenCreatePolicy } from "../../packs/cloudflare-token/create.js";
import { parseVercelProjectEnvironmentSecretSetEffect, type VercelProjectEnvironmentSecretSetPolicy } from "../../packs/vercel-environment-secret/compile.js";

export interface CloudflareTokenCreateProvider {
  createToken(input: Readonly<CloudflareTokenCreatePolicy & { readonly secret: Uint8Array }>): Promise<unknown>;
  findToken(input: Readonly<CloudflareTokenCreatePolicy>): Promise<unknown | undefined>;
}
export interface VercelProjectEnvironmentSecretProvider {
  setEnvironmentSecret(input: Readonly<VercelProjectEnvironmentSecretSetPolicy & { readonly secret: Uint8Array }>): Promise<unknown>;
  readEnvironmentSecretMetadata(input: Readonly<VercelProjectEnvironmentSecretSetPolicy>): Promise<unknown | undefined>;
}

export function createCloudflareTokenCreateDispatchAdapter(input: Readonly<{ secret: SecretHandle; provider: CloudflareTokenCreateProvider }>): DispatchAdapter {
  if (!input?.secret || !input.provider) throw new TypeError("Cloudflare token create adapter configuration is invalid");
  let policy: CloudflareTokenCreatePolicy | undefined;
  return Object.freeze({
    async dispatch(state: DispatchRequestState): Promise<DispatchOutcome> {
      try {
        policy = parseCloudflareTokenCreateEffect(state.effect);
        if (input.secret.digest !== policy.secretDigest) throw new Error("secret handle digest does not match approved effect");
        const secret = input.secret.readOnce();
        try {
          const result = await input.provider.createToken({ ...policy, secret });
          return Object.freeze({ kind: "acknowledged" as const, resultDigest: authorityDigest({ v: "reelier.cloudflare-token-create-result/v1", reservationId: state.reservation.reservationId, metadata: redactProviderResult(result) }), providerResultDigest: authorityDigest({ v: "reelier.cloudflare-token-create-provider-result/v1", metadata: redactProviderResult(result) }) });
        } finally { /* the handle has already consumed and released its backing buffer */ }
      } catch (error) {
        return Object.freeze({ kind: "ambiguous" as const, resultDigest: authorityDigest({ v: "reelier.cloudflare-token-create-result/v1", reservationId: state.reservation.reservationId, status: "ambiguous", error: error instanceof Error ? error.name : "Error" }) });
      }
    },
    async reconcile(state: DispatchRequestState, outcome: DispatchOutcome): Promise<DispatchOutcome> {
      const expected = policy ?? parseCloudflareTokenCreateEffect(state.effect);
      try {
        const found = await input.provider.findToken(expected);
        if (!found) return Object.freeze({ ...outcome, kind: "definitive-failure", reconciliationStatus: "not-applied" as const, normalizedProjectionDigest: null });
        const metadata = redactProviderResult(found);
        const matched = metadataMatchesCloudflare(metadata, expected);
        return Object.freeze({ ...outcome, kind: matched ? "acknowledged" as const : "definitive-failure" as const, reconciliationStatus: matched ? "matched" as const : "conflict" as const, normalizedProjectionDigest: authorityDigest({ v: "reelier.cloudflare-token-create-metadata/v1", metadata }) });
      } catch { return Object.freeze({ ...outcome, kind: "ambiguous" as const, reconciliationStatus: "unavailable" as const, normalizedProjectionDigest: null }); }
    },
  });
}

export function createVercelProjectEnvironmentSecretDispatchAdapter(input: Readonly<{ secret: SecretHandle; provider: VercelProjectEnvironmentSecretProvider }>): DispatchAdapter {
  if (!input?.secret || !input.provider) throw new TypeError("Vercel environment secret adapter configuration is invalid");
  let policy: VercelProjectEnvironmentSecretSetPolicy | undefined;
  return Object.freeze({
    async dispatch(state: DispatchRequestState): Promise<DispatchOutcome> {
      try {
        policy = parseVercelProjectEnvironmentSecretSetEffect(state.effect);
        if (input.secret.digest !== policy.secretDigest) throw new Error("secret handle digest does not match approved effect");
        const secret = input.secret.readOnce();
        try {
          const result = await input.provider.setEnvironmentSecret({ ...policy, secret });
          return Object.freeze({ kind: "acknowledged" as const, resultDigest: authorityDigest({ v: "reelier.vercel-environment-secret-result/v1", reservationId: state.reservation.reservationId, metadata: redactProviderResult(result) }) });
        } finally { /* the handle has already consumed and released its backing buffer */ }
      } catch (error) { return Object.freeze({ kind: "ambiguous" as const, resultDigest: authorityDigest({ v: "reelier.vercel-environment-secret-result/v1", reservationId: state.reservation.reservationId, status: "ambiguous", error: error instanceof Error ? error.name : "Error" }) }); }
    },
    async reconcile(state: DispatchRequestState, outcome: DispatchOutcome): Promise<DispatchOutcome> {
      const expected = policy ?? parseVercelProjectEnvironmentSecretSetEffect(state.effect);
      try { const found = await input.provider.readEnvironmentSecretMetadata(expected); if (!found) return Object.freeze({ ...outcome, kind: "definitive-failure", reconciliationStatus: "not-applied" as const, normalizedProjectionDigest: null }); const metadata = redactProviderResult(found); const matched = metadataMatchesVercel(metadata, expected); return Object.freeze({ ...outcome, kind: matched ? "acknowledged" as const : "definitive-failure" as const, reconciliationStatus: matched ? "matched" as const : "conflict" as const, normalizedProjectionDigest: authorityDigest({ v: "reelier.vercel-environment-secret-metadata/v1", metadata }) }); } catch { return Object.freeze({ ...outcome, kind: "ambiguous" as const, reconciliationStatus: "unavailable" as const, normalizedProjectionDigest: null }); }
    },
  });
}

/** Short aliases for host integrations that do not use the DispatchAdapter suffix. */
export const createCloudflareTokenCreateAdapter = createCloudflareTokenCreateDispatchAdapter;
export const createVercelProjectEnvironmentSecretAdapter = createVercelProjectEnvironmentSecretDispatchAdapter;

function redactProviderResult(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (/secret|token|value|bearer|authorization|password/i.test(key)) continue;
    out[key] = Array.isArray(item) ? [...item] : item;
  }
  return out;
}
function metadataMatchesCloudflare(actual: Record<string, unknown>, expected: CloudflareTokenCreatePolicy): boolean { return actual.accountId === expected.accountId && actual.name === expected.tokenName && actual.status === "active" && sameList(actual.scopes, expected.scopes) && sameList(actual.resources, expected.resources); }
function metadataMatchesVercel(actual: Record<string, unknown>, expected: VercelProjectEnvironmentSecretSetPolicy): boolean { return actual.teamId === expected.teamId && actual.projectId === expected.projectId && actual.environment === expected.environment && actual.key === expected.key && actual.status === "active"; }
function sameList(actual: unknown, expected: readonly string[]): boolean { return Array.isArray(actual) && actual.length === expected.length && [...actual].every((item, index) => item === expected[index]); }
