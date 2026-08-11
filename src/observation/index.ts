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
export type CallableRouteKind = "mcp-stdio" | "mcp-http" | "opaque-host";

export interface ConnectionToolSchemaV1 {
  readonly toolName: string;
  readonly digest: string;
}

export interface ConnectionDescriptorV1 {
  readonly v: "reelier.connection-descriptor/v1";
  readonly connectionId: string;
  readonly kind: ConnectionKind;
  readonly provider: { readonly id: string; readonly toolServerName: string };
  readonly callableRoute: { readonly kind: CallableRouteKind; readonly routeId: string; readonly endpointIds: readonly string[] };
  readonly account: { readonly status: "verified"; readonly identity: string };
  readonly toolSchemas: readonly ConnectionToolSchemaV1[];
  readonly secretOwner: "host" | "provider" | "worker";
  readonly coverage: HostCoverageV1;
}

export interface ConnectionAdoptionV1 {
  readonly v: "reelier.connection-adoption/v1";
  readonly adoptionId: string;
  readonly descriptorDigest: string;
  readonly selectedAccountIdentity: string;
  readonly mode: "existing" | "managed";
  readonly sidecarRouteId: string;
  readonly rawWriteReachability: "reachable" | "refused" | "unknown";
  readonly activationState: "inactive" | "active" | "refused";
  readonly signedDeploymentBinding: string | null;
}

export type ConnectionInventoryStatus = "usable" | "discovered-unverified" | "schema-drifted" | "account-mismatched" | "shadow-only" | "unsupported";
export type AccountVerificationStatus = "verified" | "unverified" | "mismatched" | "unsupported";
export type SchemaVerificationStatus = "verified" | "unverified" | "drifted" | "unsupported";

export interface ConnectionInventoryEntryV1 {
  readonly v: "reelier.connection-inventory-entry/v1";
  readonly discoveryId: string;
  readonly provider: string;
  readonly connectionKind: ConnectionKind;
  readonly status: ConnectionInventoryStatus;
  readonly routeStatus: "callable" | "host-private" | "unsupported";
  readonly accountVerification: { readonly status: AccountVerificationStatus; readonly identity?: string; readonly expectedIdentity?: string };
  readonly schemaVerification: { readonly status: SchemaVerificationStatus; readonly expectedDigests: readonly string[]; readonly observedDigests: readonly string[] };
  readonly reasonCodes: readonly string[];
  readonly descriptor?: ConnectionDescriptorV1;
}

export interface ConnectionInventoryIssueV1 {
  readonly file: string;
  readonly reasonCode: "malformed-inventory-entry";
}

export interface ConnectionInventoryReportV1 {
  readonly v: "reelier.connection-inventory/v1";
  readonly root: string;
  readonly entries: readonly ConnectionInventoryEntryV1[];
  readonly issues: readonly ConnectionInventoryIssueV1[];
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
  const keys = new Set(["v", "connectionId", "kind", "provider", "callableRoute", "account", "toolSchemas", "secretOwner", "coverage"]);
  if (Object.keys(raw).some(key => !keys.has(key)) || raw.v !== "reelier.connection-descriptor/v1" || !nonEmpty(raw.connectionId) || !isConnectionKind(raw.kind) || !["host", "provider", "worker"].includes(String(raw.secretOwner))) throw new TypeError("invalid connection descriptor");
  const provider = closedRecord(raw.provider, ["id", "toolServerName"], "connection provider");
  if (!nonEmpty(provider.id) || !nonEmpty(provider.toolServerName)) throw new TypeError("invalid connection provider");
  const route = closedRecord(raw.callableRoute, ["kind", "routeId", "endpointIds"], "callable route");
  if (!["mcp-stdio", "mcp-http", "opaque-host"].includes(String(route.kind)) || !nonEmpty(route.routeId)) throw new TypeError("invalid callable route");
  const account = closedRecord(raw.account, ["status", "identity"], "connection account");
  if (account.status !== "verified" || !nonEmpty(account.identity)) throw new TypeError("connection account must be verified");
  if (!Array.isArray(raw.toolSchemas) || raw.toolSchemas.length === 0) throw new TypeError("toolSchemas must be a non-empty array");
  const toolSchemas = raw.toolSchemas.map(item => {
    const schema = closedRecord(item, ["toolName", "digest"], "connection tool schema");
    if (!nonEmpty(schema.toolName) || !isDigest(schema.digest)) throw new TypeError("invalid connection tool schema");
    return Object.freeze({ toolName: schema.toolName, digest: schema.digest });
  }).sort((a, b) => a.toolName.localeCompare(b.toolName));
  if (new Set(toolSchemas.map(item => item.toolName)).size !== toolSchemas.length) throw new TypeError("connection tool schema names must be unique");
  if (!raw.coverage || typeof raw.coverage !== "object") throw new TypeError("connection coverage is required");
  return Object.freeze({ v: raw.v, connectionId: raw.connectionId as string, kind: raw.kind, provider: Object.freeze({ id: provider.id, toolServerName: provider.toolServerName }), callableRoute: Object.freeze({ kind: route.kind as CallableRouteKind, routeId: route.routeId as string, endpointIds: stringArray(route.endpointIds, "endpointIds") }), account: Object.freeze({ status: "verified", identity: account.identity as string }), toolSchemas: Object.freeze(toolSchemas), secretOwner: raw.secretOwner as ConnectionDescriptorV1["secretOwner"], coverage: normalizeHostCoverage(raw.coverage) });
}

export function normalizeConnectionAdoption(value: unknown): ConnectionAdoptionV1 {
  const raw = closedRecord(value, ["v", "adoptionId", "descriptorDigest", "selectedAccountIdentity", "mode", "sidecarRouteId", "rawWriteReachability", "activationState", "signedDeploymentBinding"], "connection adoption");
  if (raw.v !== "reelier.connection-adoption/v1" || !nonEmpty(raw.adoptionId) || !isDigest(raw.descriptorDigest) || !nonEmpty(raw.selectedAccountIdentity) || !["existing", "managed"].includes(String(raw.mode)) || !nonEmpty(raw.sidecarRouteId) || !["reachable", "refused", "unknown"].includes(String(raw.rawWriteReachability)) || !["inactive", "active", "refused"].includes(String(raw.activationState)) || (raw.signedDeploymentBinding !== null && !isDigest(raw.signedDeploymentBinding))) throw new TypeError("invalid connection adoption");
  return Object.freeze({ ...raw }) as unknown as ConnectionAdoptionV1;
}

export function normalizeConnectionInventoryEntry(value: unknown): ConnectionInventoryEntryV1 {
  const raw = closedRecord(value, ["v", "discoveryId", "provider", "connectionKind", "status", "routeStatus", "accountVerification", "schemaVerification", "reasonCodes", "descriptor"], "connection inventory entry");
  if (raw.v !== "reelier.connection-inventory-entry/v1" || !nonEmpty(raw.discoveryId) || !nonEmpty(raw.provider) || !isConnectionKind(raw.connectionKind) || !["usable", "discovered-unverified", "schema-drifted", "account-mismatched", "shadow-only", "unsupported"].includes(String(raw.status)) || !["callable", "host-private", "unsupported"].includes(String(raw.routeStatus))) throw new TypeError("invalid connection inventory entry");
  const account = closedRecord(raw.accountVerification, ["status", "identity", "expectedIdentity"], "account verification");
  if (!["verified", "unverified", "mismatched", "unsupported"].includes(String(account.status)) || (account.identity !== undefined && !nonEmpty(account.identity)) || (account.expectedIdentity !== undefined && !nonEmpty(account.expectedIdentity))) throw new TypeError("invalid account verification");
  if (account.status === "verified" && !nonEmpty(account.identity)) throw new TypeError("verified account identity is required");
  if (account.status === "mismatched" && (!nonEmpty(account.identity) || !nonEmpty(account.expectedIdentity))) throw new TypeError("mismatched account identities are required");
  const schema = closedRecord(raw.schemaVerification, ["status", "expectedDigests", "observedDigests"], "schema verification");
  if (!["verified", "unverified", "drifted", "unsupported"].includes(String(schema.status))) throw new TypeError("invalid schema verification");
  const expectedDigests = digestArray(schema.expectedDigests, "expectedDigests");
  const observedDigests = digestArray(schema.observedDigests, "observedDigests");
  const descriptor = raw.descriptor === undefined ? undefined : normalizeConnectionDescriptor(raw.descriptor);
  if ((raw.status === "usable") !== (descriptor !== undefined)) throw new TypeError("usable inventory entries require a descriptor and non-usable entries prohibit one");
  return Object.freeze({ v: raw.v, discoveryId: raw.discoveryId, provider: raw.provider, connectionKind: raw.connectionKind, status: raw.status, routeStatus: raw.routeStatus, accountVerification: Object.freeze({ status: account.status, ...(account.identity === undefined ? {} : { identity: account.identity }), ...(account.expectedIdentity === undefined ? {} : { expectedIdentity: account.expectedIdentity }) }), schemaVerification: Object.freeze({ status: schema.status, expectedDigests, observedDigests }), reasonCodes: stringArray(raw.reasonCodes, "reasonCodes"), ...(descriptor === undefined ? {} : { descriptor }) }) as ConnectionInventoryEntryV1;
}

export function normalizeConnectionInventoryReport(value: unknown): ConnectionInventoryReportV1 {
  const raw = closedRecord(value, ["v", "root", "entries", "issues"], "connection inventory report");
  if (raw.v !== "reelier.connection-inventory/v1" || typeof raw.root !== "string" || !Array.isArray(raw.entries) || !Array.isArray(raw.issues)) throw new TypeError("invalid connection inventory report");
  const entries = raw.entries.map(normalizeConnectionInventoryEntry);
  const issues = raw.issues.map(value => {
    const issue = closedRecord(value, ["file", "reasonCode"], "connection inventory issue");
    if (!nonEmpty(issue.file) || issue.reasonCode !== "malformed-inventory-entry") throw new TypeError("invalid connection inventory issue");
    return Object.freeze({ file: issue.file as string, reasonCode: issue.reasonCode });
  });
  return Object.freeze({ v: raw.v, root: raw.root, entries: Object.freeze(entries), issues: Object.freeze(issues) });
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
function nonEmpty(value: unknown): value is string { return typeof value === "string" && value.length > 0; }
function isConnectionKind(value: unknown): value is ConnectionKind { return ["adopted-mcp-stdio", "adopted-mcp-http", "composio-managed", "native-https", "host-private"].includes(String(value)); }
function closedRecord(value: unknown, keys: readonly string[], name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
  const raw = value as Record<string, unknown>;
  const allowed = new Set(keys);
  if (Object.keys(raw).some(key => !allowed.has(key))) throw new TypeError(`${name} must be a closed object`);
  return raw;
}
function stringArray(value: unknown, name: string): readonly string[] {
  if (!Array.isArray(value) || value.some(item => !nonEmpty(item))) throw new TypeError(`${name} must be a string array`);
  return Object.freeze([...new Set(value as string[])].sort());
}
function digestArray(value: unknown, name: string): readonly string[] {
  if (!Array.isArray(value) || value.some(item => !isDigest(item))) throw new TypeError(`${name} must be a digest array`);
  return Object.freeze([...new Set(value as string[])].sort());
}

export type { ObservationHost, ObservationEnvelopeV1, ObservationService } from "./live.js";
export { createObservationAdapter, createObservationService, matchInstalledPacks, parseObservationEnvelope } from "./live.js";
export {
  digestNormalizedMcpToolSchemas,
  inspectCallableConnection,
  inventoryConnections,
  loadConnectionInventory,
  verifyConnectionAccount,
  type ConnectionInspectionCandidate,
  type ReviewedConnectionInspectionAdapter,
} from "../connections.js";
