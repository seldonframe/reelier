import { authorityDigest } from "../authority/wire.js";

export type ObservationCoverage = "observed" | "partially_observed" | "uncovered" | "unknown";
export type ObservationEffect = "read" | "idempotent-write" | "destructive" | "unknown";
export type HostObservationCoverage = "observed" | "partially_observed" | "uncovered" | "unknown";
export type OutcomeInvocationCoverage = "supported" | "unsupported" | "unknown";
export type ExclusiveEnforcementCoverage = "declared-surface" | "not-declared" | "unknown";

export interface HostCoverageV1 {
  readonly v: "reelier.host-coverage/v1";
  readonly host: string;
  readonly observation: HostObservationCoverage;
  readonly outcomeInvocation: OutcomeInvocationCoverage;
  readonly exclusiveEnforcement: ExclusiveEnforcementCoverage;
  readonly limitations: readonly string[];
}

export type ConnectionKind = "adopted-mcp-stdio" | "adopted-mcp-http" | "composio-managed" | "native-https" | "host-private";

export interface ConnectionDescriptorV1 {
  readonly v: "reelier.connection-descriptor/v1";
  readonly connectionId: string;
  readonly kind: ConnectionKind;
  readonly provider: string;
  readonly accountIdentity: string;
  readonly toolSchemaDigests: readonly string[];
  readonly sourceEndpointIds: readonly string[];
  readonly writeEndpointIds: readonly string[];
  readonly secretOwner: "host" | "worker";
  readonly coverage: HostCoverageV1;
}

export interface InstalledPackManifestV1 {
  readonly alias: string;
  readonly toolPatterns: readonly string[];
  readonly schemaDigests?: readonly string[];
}

export interface ObservedActionV1 {
  readonly v: "reelier.observed-action/v1";
  readonly adapterId: string;
  readonly sessionId: string;
  readonly actionId: string;
  readonly tool: string;
  readonly fieldNames: readonly string[];
  readonly sourceKinds: readonly string[];
  readonly destinationKinds: readonly string[];
  readonly effect: ObservationEffect;
  readonly coverage: ObservationCoverage;
  readonly readBackTools: readonly string[];
  readonly observedAt: string;
  readonly atom?: "source-read" | "tool-action" | "artifact-preparation" | "external-commitment" | "read-back" | "approval" | "task-boundary";
  readonly predecessorActionIds?: readonly string[];
  readonly toolSchemaDigest?: string;
  readonly readBackSchemaDigests?: readonly string[];
  readonly taskId?: string;
}

export interface BoundableTaskCandidateV1 {
  readonly v: "reelier.boundable-task-candidate/v1";
  readonly candidateId: string;
  readonly shapeDigest: string;
  readonly occurrences: number;
  readonly actions: readonly ObservedActionV1[];
  readonly transitions: readonly { readonly from: string; readonly to: string; readonly effect: ObservationEffect }[];
  readonly unresolvedActions: readonly string[];
  readonly compatiblePacks: readonly string[];
  readonly coverage: ObservationCoverage;
  readonly limitations: readonly string[];
}

export interface ShadowReportV1 {
  readonly v: "reelier.shadow-report/v1";
  readonly candidateId: string;
  readonly status: "ready" | "needs_human_definition" | "unsupported";
  readonly reasonCodes: readonly string[];
  readonly proposedAliases: readonly string[];
  readonly observedCoverage: ObservationCoverage;
  readonly reportDigest: string;
}

export interface ObservationAdapterV1 {
  readonly id: string;
  readonly host: "mcp" | "codex" | "claude-code" | "cursor" | "openclaw" | "eve" | "hermes" | "herdr";
  observe(input: unknown): readonly ObservedActionV1[];
}

export function normalizeObservedAction(value: unknown): ObservedActionV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("observed action must be an object");
  const raw = value as Record<string, unknown>;
  const allowed = new Set(["v", "adapterId", "sessionId", "actionId", "tool", "fieldNames", "sourceKinds", "destinationKinds", "effect", "coverage", "readBackTools", "observedAt", "atom", "predecessorActionIds", "toolSchemaDigest", "readBackSchemaDigests", "taskId"]);
  if (Object.keys(raw).some(key => !allowed.has(key))) throw new TypeError("observed action must be a closed object");
  const strings = (name: string): readonly string[] => {
    const v = raw[name];
    if (!Array.isArray(v) || v.some(item => typeof item !== "string")) throw new TypeError(`${name} must be a string array`);
    return Object.freeze([...new Set(v)].sort());
  };
  const coverage = raw.coverage;
  const effect = raw.effect;
  if (raw.v !== "reelier.observed-action/v1" || typeof raw.adapterId !== "string" || typeof raw.sessionId !== "string" || typeof raw.actionId !== "string" || typeof raw.tool !== "string" || typeof raw.observedAt !== "string") throw new TypeError("observed action fields are invalid");
  if (!["observed", "partially_observed", "uncovered", "unknown"].includes(String(coverage))) throw new TypeError("invalid observation coverage");
  if (!["read", "idempotent-write", "destructive", "unknown"].includes(String(effect))) throw new TypeError("invalid observation effect");
  const atom = raw.atom;
  if (atom !== undefined && !["source-read", "tool-action", "artifact-preparation", "external-commitment", "read-back", "approval", "task-boundary"].includes(String(atom))) throw new TypeError("invalid observation atom");
  const optionalStrings = (name: string): readonly string[] | undefined => raw[name] === undefined ? undefined : strings(name);
  if (raw.toolSchemaDigest !== undefined && !isDigest(raw.toolSchemaDigest)) throw new TypeError("invalid tool schema digest");
  if (raw.taskId !== undefined && (typeof raw.taskId !== "string" || !raw.taskId)) throw new TypeError("invalid task id");
  return Object.freeze({ v: raw.v, adapterId: raw.adapterId, sessionId: raw.sessionId, actionId: raw.actionId, tool: raw.tool, fieldNames: strings("fieldNames"), sourceKinds: strings("sourceKinds"), destinationKinds: strings("destinationKinds"), effect: effect as ObservationEffect, coverage: coverage as ObservationCoverage, readBackTools: strings("readBackTools"), observedAt: raw.observedAt, ...(atom === undefined ? {} : { atom: atom as ObservedActionV1["atom"] }), ...(optionalStrings("predecessorActionIds") === undefined ? {} : { predecessorActionIds: optionalStrings("predecessorActionIds") }), ...(raw.toolSchemaDigest === undefined ? {} : { toolSchemaDigest: raw.toolSchemaDigest }), ...(optionalStrings("readBackSchemaDigests") === undefined ? {} : { readBackSchemaDigests: optionalStrings("readBackSchemaDigests") }), ...(raw.taskId === undefined ? {} : { taskId: raw.taskId }) });
}

export function normalizeHostCoverage(value: unknown): HostCoverageV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("host coverage must be an object");
  const raw = value as Record<string, unknown>;
  const keys = new Set(["v", "host", "observation", "outcomeInvocation", "exclusiveEnforcement", "limitations"]);
  if (Object.keys(raw).some(key => !keys.has(key)) || raw.v !== "reelier.host-coverage/v1" || typeof raw.host !== "string" || !raw.host || !["observed", "partially_observed", "uncovered", "unknown"].includes(String(raw.observation)) || !["supported", "unsupported", "unknown"].includes(String(raw.outcomeInvocation)) || !["declared-surface", "not-declared", "unknown"].includes(String(raw.exclusiveEnforcement))) throw new TypeError("invalid host coverage");
  const limitations = raw.limitations;
  if (!Array.isArray(limitations) || limitations.some(item => typeof item !== "string")) throw new TypeError("host coverage limitations must be strings");
  return Object.freeze({ v: raw.v, host: raw.host, observation: raw.observation as HostObservationCoverage, outcomeInvocation: raw.outcomeInvocation as OutcomeInvocationCoverage, exclusiveEnforcement: raw.exclusiveEnforcement as ExclusiveEnforcementCoverage, limitations: Object.freeze([...new Set(limitations)].sort()) });
}

export function normalizeConnectionDescriptor(value: unknown): ConnectionDescriptorV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("connection descriptor must be an object");
  const raw = value as Record<string, unknown>;
  const keys = new Set(["v", "connectionId", "kind", "provider", "accountIdentity", "toolSchemaDigests", "sourceEndpointIds", "writeEndpointIds", "secretOwner", "coverage"]);
  if (Object.keys(raw).some(key => !keys.has(key)) || raw.v !== "reelier.connection-descriptor/v1" || typeof raw.connectionId !== "string" || !raw.connectionId || typeof raw.provider !== "string" || !raw.provider || typeof raw.accountIdentity !== "string" || !raw.accountIdentity || !["adopted-mcp-stdio", "adopted-mcp-http", "composio-managed", "native-https", "host-private"].includes(String(raw.kind)) || !["host", "worker"].includes(String(raw.secretOwner))) throw new TypeError("invalid connection descriptor");
  const strings = (name: string): readonly string[] => { const list = raw[name]; if (!Array.isArray(list) || list.some(item => typeof item !== "string" || !item)) throw new TypeError(`${name} must be a string array`); return Object.freeze([...new Set(list)].sort()); };
  if (!raw.coverage || typeof raw.coverage !== "object") throw new TypeError("connection coverage is required");
  return Object.freeze({ v: raw.v, connectionId: raw.connectionId, kind: raw.kind as ConnectionKind, provider: raw.provider, accountIdentity: raw.accountIdentity, toolSchemaDigests: strings("toolSchemaDigests"), sourceEndpointIds: strings("sourceEndpointIds"), writeEndpointIds: strings("writeEndpointIds"), secretOwner: raw.secretOwner as "host" | "worker", coverage: normalizeHostCoverage(raw.coverage) });
}

export function clusterObservedActions(actions: readonly ObservedActionV1[], candidateId: string, occurrences = 1, compatiblePacks: readonly string[] = []): BoundableTaskCandidateV1 {
  if (!candidateId || !Number.isSafeInteger(occurrences) || occurrences < 1) throw new TypeError("candidate identity is invalid");
  const normalized = actions.map(normalizeObservedAction).sort((a, b) => a.tool.localeCompare(b.tool) || a.actionId.localeCompare(b.actionId));
  const shape = normalized.map(a => ({ tool: a.tool, fieldNames: a.fieldNames, sourceKinds: a.sourceKinds, destinationKinds: a.destinationKinds, effect: a.effect, readBackTools: a.readBackTools }));
  const unresolved = normalized.filter(a => a.effect === "unknown" || a.coverage !== "observed").map(a => a.tool);
  const compatible = [...new Set(compatiblePacks)].sort();
  const coverage: ObservationCoverage = normalized.some(a => a.coverage === "uncovered" || a.coverage === "unknown") ? "unknown" : normalized.some(a => a.coverage === "partially_observed") ? "partially_observed" : "observed";
  return Object.freeze({ v: "reelier.boundable-task-candidate/v1", candidateId, shapeDigest: authorityDigest({ v: "reelier.observation-shape/v1", shape }), occurrences, actions: Object.freeze(normalized), transitions: Object.freeze(normalized.map(a => Object.freeze({ from: a.sourceKinds[0] ?? "unknown", to: a.destinationKinds[0] ?? "unknown", effect: a.effect }))), unresolvedActions: Object.freeze([...new Set(unresolved)]), compatiblePacks: Object.freeze(compatible), coverage, limitations: Object.freeze(unresolved.length ? ["unresolved-actions"] : []) });
}

/** Clusters a task while deriving pack compatibility only from installed manifests. */
export function clusterObservedActionsWithManifests(actions: readonly ObservedActionV1[], candidateId: string, occurrences: number, manifests: readonly InstalledPackManifestV1[]): BoundableTaskCandidateV1 {
  const normalized = actions.map(normalizeObservedAction);
  const compatible = matchPackManifests(normalized, manifests);
  return clusterObservedActions(normalized, candidateId, occurrences, compatible);
}

export function matchPackManifests(actions: readonly ObservedActionV1[], manifests: readonly InstalledPackManifestV1[]): readonly string[] {
  const tools = new Set(actions.map(action => action.tool));
  const matched = manifests.filter(manifest => typeof manifest.alias === "string" && manifest.alias && Array.isArray(manifest.toolPatterns) && manifest.toolPatterns.length > 0 && manifest.toolPatterns.every(pattern => tools.has(pattern))).map(manifest => manifest.alias);
  return Object.freeze([...new Set(matched)].sort());
}

export function createShadowReport(candidate: BoundableTaskCandidateV1, proposedAliases: readonly string[] = []): ShadowReportV1 {
  const status: ShadowReportV1["status"] = candidate.coverage === "unknown" || candidate.unresolvedActions.length > 0 ? (candidate.compatiblePacks.length ? "needs_human_definition" : "unsupported") : candidate.compatiblePacks.length ? "ready" : "unsupported";
  const base = { v: "reelier.shadow-report/v1" as const, candidateId: candidate.candidateId, status, reasonCodes: candidate.unresolvedActions.length ? ["unresolved-actions"] : candidate.compatiblePacks.length ? [] : ["no-reviewed-pack"], proposedAliases: Object.freeze([...proposedAliases]), observedCoverage: candidate.coverage };
  return Object.freeze({ ...base, reportDigest: authorityDigest(base) });
}

function isDigest(value: unknown): value is string { return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value); }

export type { ObservationHost, ObservationEnvelopeV1, ObservationService } from "./live.js";
export { createObservationAdapter, createObservationService, matchInstalledPacks, parseObservationEnvelope } from "./live.js";
