import { validateReelierPluginV1, type ReelierPluginV1 } from "./plugin.js";
import type { AgentOpportunity } from "./discovery.js";

export interface LocalDiscoveryResponse {
  schemaVersion: "ReelierRecommendationV1";
  plugin: ReelierPluginV1;
  opportunities: AgentOpportunity[];
}

function localBridgeBaseUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    throw new Error("local discovery bridge requires an http localhost URL");
  }
  if (url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
    throw new Error("local discovery bridge URL must be a bare loopback origin");
  }
  return url.origin;
}

export async function discoverLocalPlugin(
  plugin: ReelierPluginV1,
  baseUrl = "http://127.0.0.1:4777",
  fetchImpl: typeof fetch = fetch,
): Promise<LocalDiscoveryResponse> {
  const validation = validateReelierPluginV1(plugin);
  if (!validation.ok) throw new Error(`invalid ReelierPluginV1 manifest: ${validation.errors.join("; ")}`);
  const origin = localBridgeBaseUrl(baseUrl);
  const capabilitiesResponse = await fetchImpl(`${origin}/v1/capabilities`);
  if (!capabilitiesResponse.ok) throw new Error(`local discovery bridge capabilities failed (HTTP ${capabilitiesResponse.status})`);
  const capabilities = await capabilitiesResponse.json() as { nonce?: unknown };
  if (typeof capabilities.nonce !== "string") throw new Error("local discovery bridge returned no handshake nonce");
  const response = await fetchImpl(`${origin}/v1/recommend`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-reelier-nonce": capabilities.nonce },
    body: JSON.stringify(plugin),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`local discovery bridge failed (HTTP ${response.status}): ${text}`);
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error("local discovery bridge returned invalid JSON"); }
  if (typeof parsed !== "object" || parsed === null || (parsed as { schemaVersion?: unknown }).schemaVersion !== "ReelierRecommendationV1") {
    throw new Error("local discovery bridge returned an invalid response");
  }
  const result = parsed as LocalDiscoveryResponse;
  const pluginResult = validateReelierPluginV1(result.plugin);
  if (!pluginResult.ok || !Array.isArray(result.opportunities)) throw new Error("local discovery bridge returned an invalid response");
  return { ...result, plugin: pluginResult.value };
}
