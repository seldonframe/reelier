import { authorityDigest } from "../wire.js";
import { executeJsonHttpsEffect, type JsonHttpsEndpoint, type JsonHttpsSecretResolver } from "../drivers/json-https.js";
import { createJsonHttpsRouteRegistry, lookupJsonHttpsRoute, type JsonHttpsRouteRegistry, type JsonHttpsRouteV1 } from "./json-https-route.js";
import type { DispatchAdapter, DispatchOutcome, DispatchRequestState } from "./dispatch.js";

export interface JsonHttpsDispatchAdapterOptions {
  readonly endpoints: readonly JsonHttpsEndpoint[];
  /** Canonical native routes are joined separately from legacy secretRef endpoints. */
  readonly routes?: JsonHttpsRouteRegistry | readonly JsonHttpsRouteV1[];
  readonly secrets: JsonHttpsSecretResolver;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
}

/** Dispatches only to the operator-pinned HTTPS endpoint named by the sealed effect. */
export function createJsonHttpsDispatchAdapter(options: JsonHttpsDispatchAdapterOptions): DispatchAdapter {
  if (!options || !Array.isArray(options.endpoints) || !options.secrets) throw new TypeError("HTTPS dispatch adapter configuration is invalid");
  const endpoints = new Map(options.endpoints.map(endpoint => [endpoint.endpointId, endpoint]));
  if (endpoints.size !== options.endpoints.length) throw new TypeError("duplicate HTTPS endpoint identity");
  const routes: JsonHttpsRouteRegistry | undefined = options.routes === undefined ? undefined : Array.isArray(options.routes) ? createJsonHttpsRouteRegistry(options.routes as readonly JsonHttpsRouteV1[]) : (options.routes as JsonHttpsRouteRegistry);
  return Object.freeze({
    async dispatch(state: DispatchRequestState): Promise<DispatchOutcome> {
      const endpointId = state.effect && typeof state.effect === "object" && typeof (state.effect as Record<string, unknown>).endpointId === "string" ? String((state.effect as Record<string, unknown>).endpointId) : "";
      const route = routes ? lookupJsonHttpsRoute(routes, endpointId) : undefined;
      const endpoint = route ?? endpoints.get(endpointId);
      if (!endpoint) return Object.freeze({ kind: "definitive-failure" as const, resultDigest: authorityDigest({ v: "reelier.https-dispatch/v1", status: "endpoint-not-configured", endpointId }) });
      try {
        const response = await executeJsonHttpsEffect(state.effect as never, endpoint, options.secrets, { timeoutMs: options.timeoutMs, maxResponseBytes: options.maxResponseBytes });
        const resultDigest = authorityDigest({ v: "reelier.https-response/v1", endpointId, status: response.status, headers: response.headers, bodyDigest: authorityDigest(response.body.toString("base64")) });
        return Object.freeze({ kind: response.status >= 200 && response.status < 300 ? "acknowledged" as const : "definitive-failure" as const, resultDigest, providerStatus: response.status, responseDigest: resultDigest });
      } catch (error) {
        return Object.freeze({ kind: "ambiguous" as const, resultDigest: authorityDigest({ v: "reelier.https-dispatch/v1", endpointId, status: "transport-error", error: error instanceof Error ? error.name : "Error" }) });
      }
    },
  });
}
