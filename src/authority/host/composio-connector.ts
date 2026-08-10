import { authorityDigest } from "../wire.js";
import type { DispatchAdapter, DispatchOutcome, DispatchRequestState } from "./dispatch.js";

export interface ComposioConnection {
  readonly call: (toolName: string, args: unknown) => Promise<Readonly<{ status?: number; body?: unknown; error?: boolean }>>;
}
export interface ComposioDispatchRoute { readonly endpointId: string; readonly toolName: string; readonly encodeArgs: (effect: unknown) => unknown; }
export interface ComposioDispatchAdapterOptions { readonly connection: ComposioConnection; readonly routes: readonly ComposioDispatchRoute[]; }

/** Optional breadth adapter. It receives an operator-owned Composio connection, never an agent token. */
export function createComposioDispatchAdapter(options: ComposioDispatchAdapterOptions): DispatchAdapter {
  if (!options?.connection || !Array.isArray(options.routes)) throw new TypeError("Composio dispatch adapter configuration is invalid");
  const routes = new Map<string, ComposioDispatchRoute>();
  for (const route of options.routes) {
    if (!route || !route.endpointId || !route.toolName || typeof route.encodeArgs !== "function" || routes.has(route.endpointId)) throw new TypeError("Composio dispatch route is invalid");
    routes.set(route.endpointId, route);
  }
  return Object.freeze({
    async dispatch(state: DispatchRequestState): Promise<DispatchOutcome> {
      const endpointId = state.effect && typeof state.effect === "object" && typeof (state.effect as Record<string, unknown>).endpointId === "string" ? String((state.effect as Record<string, unknown>).endpointId) : "";
      const route = routes.get(endpointId);
      if (!route) return Object.freeze({ kind: "definitive-failure" as const, resultDigest: authorityDigest({ v: "reelier.composio-dispatch/v1", status: "endpoint-not-configured", endpointId }) });
      try {
        const response = await options.connection.call(route.toolName, route.encodeArgs(state.effect));
        const resultDigest = authorityDigest({ v: "reelier.composio-response/v1", endpointId, status: response.status ?? null, error: response.error === true, bodyDigest: authorityDigest(response.body ?? null) });
        return Object.freeze({ kind: response.error === true || (response.status !== undefined && response.status >= 400) ? "definitive-failure" as const : "acknowledged" as const, resultDigest, providerStatus: response.status, responseDigest: resultDigest });
      } catch (error) {
        return Object.freeze({ kind: "ambiguous" as const, resultDigest: authorityDigest({ v: "reelier.composio-dispatch/v1", endpointId, status: "transport-error", error: error instanceof Error ? error.name : "Error" }) });
      }
    },
  });
}
