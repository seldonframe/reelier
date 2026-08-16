export interface RouteCoverageV1 {
  readonly v: "reelier.route-coverage/v1";
  readonly routeId: string;
  readonly hostId: string;
  readonly discoverySource: "host-config" | "plugin-manifest" | "composio" | "native-config" | "openapi" | "host-private" | "direct-http" | "writable-browser" | "unknown";
  readonly transport: "mcp-stdio" | "mcp-http" | "https" | "opaque-host" | "browser" | "unknown";
  readonly observation: "observed" | "partially-observed" | "uncovered" | "unknown";
  readonly replay: "available" | "candidate" | "unavailable" | "unknown";
  readonly outcome: "activated" | "outcome-capable" | "shadow-only" | "unsupported" | "unknown";
  readonly enforcement: "verified" | "failed" | "unchecked" | "absent";
  readonly observedAt: string;
  readonly freshUntil: string;
  readonly evidenceDigest: string;
  readonly topologyEvidenceDigest: string | null;
  readonly evidenceRefs: readonly string[];
  readonly reasonCodes: readonly string[];
}
