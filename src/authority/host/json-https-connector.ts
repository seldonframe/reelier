import { authorityDigest } from "../wire.js";
import { executeJsonHttpsEffect, prepareJsonHttpsEffect, type JsonHttpsEndpoint, type JsonHttpsSecretResolver } from "../drivers/json-https.js";
import { classifyHttpResponse, createHttpResponseSemanticsProfileRegistry, httpResponseSemanticsProfileDigest, lookupHttpResponseSemanticsProfile, type HttpResponseSemanticsProfileRegistry, type HttpResponseSemanticsProfileV1 } from "./http-response-semantics.js";
import { createJsonHttpsRouteRegistry, lookupJsonHttpsRoute, type JsonHttpsRouteRegistry, type JsonHttpsRouteV1 } from "./json-https-route.js";
import type { DispatchAdapter, DispatchOutcome, DispatchRequestState } from "./dispatch.js";
import type { AuthorityLatencyRecorder } from "./latency.js";

const DIGEST = /^sha256:(?!0{64}$)[0-9a-f]{64}$/;

export interface JsonHttpsDispatchAdapterOptions {
  readonly endpoints: readonly JsonHttpsEndpoint[];
  /** Canonical native routes are joined separately from legacy secretRef endpoints. */
  readonly routes?: JsonHttpsRouteRegistry | readonly JsonHttpsRouteV1[];
  readonly secrets: JsonHttpsSecretResolver;
  readonly responseSemanticsProfiles?: HttpResponseSemanticsProfileRegistry | readonly HttpResponseSemanticsProfileV1[];
  readonly operatorConfigurationDigest?: string;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly monotonicNow?: () => number;
  readonly latencyRecorder?: AuthorityLatencyRecorder;
}

/** Dispatches only to the operator-pinned HTTPS endpoint named by the sealed effect. */
export function createJsonHttpsDispatchAdapter(options: JsonHttpsDispatchAdapterOptions): DispatchAdapter {
  if (!options || !Array.isArray(options.endpoints) || !options.secrets) throw new TypeError("HTTPS dispatch adapter configuration is invalid");
  const endpoints = new Map(options.endpoints.map(endpoint => [endpoint.endpointId, endpoint]));
  if (endpoints.size !== options.endpoints.length) throw new TypeError("duplicate HTTPS endpoint identity");
  if (options.operatorConfigurationDigest !== undefined && !DIGEST.test(options.operatorConfigurationDigest)) throw new TypeError("operator configuration digest is invalid");
  const routes: JsonHttpsRouteRegistry | undefined = options.routes === undefined ? undefined : Array.isArray(options.routes) ? createJsonHttpsRouteRegistry(options.routes as readonly JsonHttpsRouteV1[]) : (options.routes as JsonHttpsRouteRegistry);
  const profiles: HttpResponseSemanticsProfileRegistry = options.responseSemanticsProfiles === undefined ? createHttpResponseSemanticsProfileRegistry([
    { v: "reelier.http-response-semantics/v1", profileId: "github.labels.v1", acknowledgedStatuses: [200, 201, 202, 203, 204, 205, 206, 207, 208, 226] },
    { v: "reelier.http-response-semantics/v1", profileId: "github.issue-labels.v1", acknowledgedStatuses: [200, 201, 202, 203, 204, 205, 206, 207, 208, 226] },
  ]) : Array.isArray(options.responseSemanticsProfiles) ? createHttpResponseSemanticsProfileRegistry(options.responseSemanticsProfiles as readonly HttpResponseSemanticsProfileV1[]) : options.responseSemanticsProfiles as HttpResponseSemanticsProfileRegistry;
  if (routes && options.endpoints.some(endpoint => lookupJsonHttpsRoute(routes, endpoint.endpointId))) throw new TypeError("legacy and canonical HTTPS endpoint identities must not overlap");
  return Object.freeze({
    async dispatch(state: DispatchRequestState): Promise<DispatchOutcome> {
      const endpointId = state.effect && typeof state.effect === "object" && typeof (state.effect as Record<string, unknown>).endpointId === "string" ? String((state.effect as Record<string, unknown>).endpointId) : "";
      const route = routes ? lookupJsonHttpsRoute(routes, endpointId) : undefined;
      const endpoint = route ?? endpoints.get(endpointId);
      if (!endpoint) return Object.freeze({ kind: "definitive-failure" as const, resultDigest: authorityDigest({ v: "reelier.https-dispatch/v1", status: "endpoint-not-configured", endpointId }) });
      if (route) {
        const profile = lookupHttpResponseSemanticsProfile(profiles, route.responseSemanticsProfileId);
        if (!profile) return Object.freeze({ kind: "definitive-failure" as const, resultDigest: authorityDigest({ v: "reelier.https-dispatch/v1", status: "response-semantics-profile-not-configured", endpointId, profileId: route.responseSemanticsProfileId }) });
        const routeAuthority = state.reservation.intent.routeAuthority as unknown as Record<string, unknown> | undefined;
        if (options.operatorConfigurationDigest && routeAuthority?.operatorConfigurationDigest !== options.operatorConfigurationDigest) return Object.freeze({ kind: "definitive-failure" as const, resultDigest: authorityDigest({ v: "reelier.https-dispatch/v1", status: "operator-configuration-digest-mismatch", endpointId }) });
        if (routeAuthority?.routeDigest && routeAuthority.routeDigest !== authorityDigest(route)) return Object.freeze({ kind: "definitive-failure" as const, resultDigest: authorityDigest({ v: "reelier.https-dispatch/v1", status: "route-authority-digest-mismatch", endpointId }) });
      }
      try {
        const response = await executeJsonHttpsEffect(state.effect as never, endpoint, options.secrets, { timeoutMs: options.timeoutMs, maxResponseBytes: options.maxResponseBytes, latencyRecorder: options.latencyRecorder });
        const profile = route ? lookupHttpResponseSemanticsProfile(profiles, route.responseSemanticsProfileId)! : { v: "reelier.http-response-semantics/v1" as const, profileId: "legacy.2xx", acknowledgedStatuses: [200, 201, 202, 203, 204, 205, 206, 207, 208, 226] };
        const resultDigest = authorityDigest({ v: "reelier.https-response/v1", endpointId, status: response.status, headers: response.headers, bodyDigest: authorityDigest(response.body.toString("base64")), ...(route ? { responseSemanticsProfileDigest: httpResponseSemanticsProfileDigest(profile) } : {}) });
        const kind = malformedJsonResponse(response) ? "ambiguous" as const : classifyHttpResponse(profile, { kind: "response", status: response.status });
        return Object.freeze({ kind, resultDigest, providerStatus: response.status, responseDigest: resultDigest, ...(response.materializedRequestDigest ? { materializedRequestDigest: response.materializedRequestDigest } : {}) });
      } catch (error) {
        return Object.freeze({ kind: "ambiguous" as const, resultDigest: authorityDigest({ v: "reelier.https-dispatch/v1", endpointId, status: "transport-error", error: error instanceof Error ? error.name : "Error" }) });
      }
    },
    async prepare(state: DispatchRequestState) {
      const endpointId = state.effect && typeof state.effect === "object" && typeof (state.effect as Record<string, unknown>).endpointId === "string" ? String((state.effect as Record<string, unknown>).endpointId) : "";
      const route = routes ? lookupJsonHttpsRoute(routes, endpointId) : undefined;
      const endpoint = route ?? endpoints.get(endpointId);
      if (!endpoint) throw new Error("endpoint-not-configured");
      const context = state.reservation.intent.executionContext;
      const routeAuthority = state.reservation.intent.routeAuthority;
      const expiresAt = typeof (state.reservation.intent as Record<string, unknown>).expiresAt === "string" ? String((state.reservation.intent as Record<string, unknown>).expiresAt) : new Date(Date.now() + (options.timeoutMs ?? 15_000)).toISOString();
      const authorityGeneration = typeof (state.reservation.intent as Record<string, unknown>).authorityStateDigest === "string" ? String((state.reservation.intent as Record<string, unknown>).authorityStateDigest) : "legacy";
      return prepareJsonHttpsEffect(state.effect as never, endpoint, options.secrets, { timeoutMs: options.timeoutMs, maxResponseBytes: options.maxResponseBytes, monotonicNow: options.monotonicNow, latencyRecorder: options.latencyRecorder, responseSemanticsProfiles: profiles, ...(options.operatorConfigurationDigest ? { operatorConfigurationDigest: options.operatorConfigurationDigest } : {}), ...(routeAuthority ? { routeAuthority } : {}), reservationId: state.reservation.reservationId, allocationId: context?.allocationId ?? "unbound", authorityGeneration, authorityExpiresAt: expiresAt });
    },
  });
}

export function malformedJsonResponse(response: Readonly<{ headers: Readonly<Record<string, string>>; body: Buffer }>): boolean {
  const contentType = Object.entries(response.headers).find(([name]) => name.toLowerCase() === "content-type")?.[1]?.toLowerCase() ?? "";
  if (!contentType.includes("json") || response.body.length === 0) return false;
  try { JSON.parse(response.body.toString("utf8")); return false; } catch { return true; }
}
