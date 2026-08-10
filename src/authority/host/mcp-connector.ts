import { authorityDigest } from "../wire.js";
import type { DispatchAdapter, DispatchOutcome, DispatchRequestState } from "./dispatch.js";
import type { DownstreamConnection } from "../../mcp-client.js";

export interface McpDispatchRoute {
  readonly endpointId: string;
  readonly toolName: string;
  readonly encodeArgs: (effect: unknown) => unknown;
}

export interface McpDispatchAdapterOptions {
  readonly connection: Pick<DownstreamConnection, "call">;
  readonly routes: readonly McpDispatchRoute[];
}

/**
 * Dispatches a sealed TransportEffect through an already-adopted MCP connection.
 * The route table is host-owned and reviewed; no tool name or provider argument
 * can be selected by the agent at invocation time.
 */
export function createMcpDispatchAdapter(options: McpDispatchAdapterOptions): DispatchAdapter {
  if (!options || !options.connection || !Array.isArray(options.routes)) throw new TypeError("MCP dispatch adapter configuration is invalid");
  const routes = new Map<string, McpDispatchRoute>();
  for (const route of options.routes) {
    if (!route || typeof route.endpointId !== "string" || !route.endpointId || typeof route.toolName !== "string" || !route.toolName || typeof route.encodeArgs !== "function" || routes.has(route.endpointId)) throw new TypeError("MCP dispatch route is invalid");
    routes.set(route.endpointId, Object.freeze({ ...route }));
  }
  return Object.freeze({
    async dispatch(state: DispatchRequestState): Promise<DispatchOutcome> {
      const endpointId = state.effect && typeof state.effect === "object" && !Array.isArray(state.effect) ? String((state.effect as Record<string, unknown>).endpointId ?? "") : "";
      const route = routes.get(endpointId);
      if (!route) return failure(state, "mcp-route-missing");
      let args: unknown;
      try { args = route.encodeArgs(state.effect); } catch { return failure(state, "mcp-argument-compilation-failed"); }
      try {
        const result = await options.connection.call(route.toolName, args);
        const resultDigest = authorityDigest({ v: "reelier.mcp-provider-result/v1", reservationId: state.reservation.reservationId, endpointId, toolName: route.toolName, result });
        if (result.isError) return Object.freeze({ kind: "definitive-failure", resultDigest, providerResultDigest: resultDigest });
        return Object.freeze({ kind: "acknowledged", resultDigest, providerResultDigest: resultDigest });
      } catch {
        return Object.freeze({ kind: "ambiguous", resultDigest: authorityDigest({ v: "reelier.mcp-dispatch-result/v1", reservationId: state.reservation.reservationId, endpointId, status: "ambiguous" }) });
      }
    },
  });
}

function failure(state: DispatchRequestState, reason: string): DispatchOutcome {
  const resultDigest = authorityDigest({ v: "reelier.mcp-dispatch-result/v1", reservationId: state.reservation.reservationId, status: "refused", reason });
  return Object.freeze({ kind: "definitive-failure", resultDigest });
}
