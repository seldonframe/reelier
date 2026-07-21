// Adapts MCP downstream tools into the runner's Tool registry, so
// `reelier run <skill> --wrap "<command>"` can replay steps whose action
// names a tool that only exists behind an MCP server. Builtin http.* tools
// keep working unchanged (they're just merged in alongside these).

import type { Observation } from "./assert.js";
import type { Effect } from "./skill.js";
import type { Tool, ToolContext } from "./tools.js";
import { buildToolRoutes, type DownstreamConnection, type DownstreamTool, type McpCallResult } from "./mcp-client.js";
import { classifyEffect } from "./effect-verbs.js";

/**
 * MCP result -> Observation mapping:
 *  - status: 200 if the call succeeded (isError falsy), 500 if isError is true.
 *  - headers: always {} — MCP has no header concept.
 *  - body: every text-content item's `.text`, concatenated with "\n". When a
 *    tool returns a single JSON-shaped text block (the common case), `body`
 *    IS that JSON text, so `json.<dotpath>` asserts/binds parse it directly
 *    via the existing JSON.parse(obs.body) path in assert.ts. If a tool
 *    returns multiple text blocks, only `body contains`/`body match` asserts
 *    are reliable — `json.*` asserts will fail to parse the concatenation
 *    (documented limitation, not silently papered over).
 */
export function mcpResultToObservation(result: McpCallResult): Observation {
  const texts: string[] = [];
  for (const item of result.content ?? []) {
    if (item.type === "text" && typeof item.text === "string") {
      texts.push(item.text);
    }
  }
  return {
    status: result.isError ? 500 : 200,
    headers: {},
    body: texts.join("\n"),
  };
}

/**
 * Effect classification for a downstream tool: the ONE shared trust ladder
 * (effect-verbs.ts's classifyEffect — destructiveHint, then the verb lists
 * which no annotation may downgrade, then readOnlyHint/idempotentHint
 * refining unrecognized verbs, then destructive-by-default). Note: as of
 * this writing the runner only consults `step.effect` (required on every
 * step in a skill file), not `Tool.effect`, so this mainly documents intent
 * for future use.
 */
export function effectFromAnnotations(tool: DownstreamTool): Effect {
  return classifyEffect(tool.name, tool.annotations).effect;
}

function mcpTool(downstream: DownstreamConnection, realName: string, effect: Effect): Tool {
  return {
    effect,
    async run(args: unknown, _ctx: ToolContext): Promise<Observation> {
      const result = await downstream.call(realName, args);
      return mcpResultToObservation(result);
    },
  };
}

/**
 * Build a runner Tool registry entry per downstream tool, using the same
 * exposedName collision rules as the proxy (buildToolRoutes) so a name
 * recorded by `reelier mcp` replays under the identical name here.
 */
export function buildMcpTools(downstreams: DownstreamConnection[]): Record<string, Tool> {
  const routes = buildToolRoutes(downstreams);
  const tools: Record<string, Tool> = {};
  for (const route of routes.values()) {
    tools[route.exposedName] = mcpTool(route.downstream, route.realName, effectFromAnnotations(route.tool));
  }
  return tools;
}
