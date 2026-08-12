import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { authorityDigest } from "./authority/wire.js";
import type { DownstreamConnection, DownstreamTool, McpCallResult } from "./mcp-client.js";
import {
  normalizeConnectionInventoryEntry,
  normalizeConnectionInventoryReport,
  normalizeHostCoverage,
  type ConnectionDescriptorV1,
  type ConnectionInventoryEntryV1,
  type ConnectionInventoryReportV1,
  type ConnectionKind,
  type HostCoverageV1,
  normalizeConnectionDescriptor,
  normalizeConnectionAdoption,
  type ConnectionAdoptionV1,
} from "./observation/index.js";

export interface ConnectionInspectionCandidate {
  readonly discoveryId: string;
  readonly connectionId: string;
  readonly provider: string;
  readonly kind: ConnectionKind;
  readonly routeStatus: "callable" | "host-private" | "unsupported";
  readonly routeId: string;
  /** Opaque operator-selected connection configuration. Never included in reports or errors. */
  readonly routeSpec: string;
  readonly secretOwner: ConnectionDescriptorV1["secretOwner"];
  readonly coverage: HostCoverageV1;
  readonly expectedAccountIdentity?: string;
}

export interface ReviewedConnectionInspectionAdapter {
  readonly provider: string;
  readonly sourceEndpointIds: readonly string[];
  readonly writeEndpointIds: readonly string[];
  readonly expectedToolSchemaDigests: readonly string[];
  readonly accountProbe?: {
    readonly toolName: string;
    readonly args: Readonly<Record<string, unknown>>;
    readonly reviewedReadOnly: true;
    extractAccountIdentity(result: McpCallResult): string;
  };
}

export type ConnectionFactory = (routeSpec: string) => Promise<DownstreamConnection>;

export function connectionDescriptorDigest(value: ConnectionDescriptorV1): string {
  return authorityDigest(normalizeConnectionDescriptor(value));
}

export function connectionAdoptionCommitmentDigest(value: Omit<ConnectionAdoptionV1, "signedDeploymentBinding">): string {
  // The reverse deployment pointer is deliberately excluded from this
  // commitment. Supply a syntactically valid placeholder only while the
  // closed adoption parser validates the remaining authority fields.
  const normalized = normalizeConnectionAdoption({ ...value, signedDeploymentBinding: `sha256:${"0".repeat(64)}` });
  const { v: _v, signedDeploymentBinding: _binding, ...commitment } = normalized;
  return authorityDigest({ v: "reelier.connection-adoption-commitment/v1", ...commitment });
}

export interface OpaqueConnectionRouteRegistration {
  readonly sidecarRouteId: string;
  readonly descriptor: ConnectionDescriptorV1;
  readonly verifier: ReviewedConnectionInspectionAdapter;
  readonly resolve: () => Promise<DownstreamConnection>;
}

export interface OpaqueConnectionRouteRegistry {
  register(input: OpaqueConnectionRouteRegistration): void;
  resolve(descriptor: ConnectionDescriptorV1, adoption: ConnectionAdoptionV1): Promise<DownstreamConnection>;
}

/** Host-owned route handles. Private factories and route specifications never enter deployment wire data. */
export function createOpaqueConnectionRouteRegistry(): OpaqueConnectionRouteRegistry {
  const entries = new Map<string, Readonly<{ descriptorDigest: string; account: string; descriptor: ConnectionDescriptorV1; verifier: ReviewedConnectionInspectionAdapter; resolve: () => Promise<DownstreamConnection> }>>();
  return Object.freeze({
    register(input: OpaqueConnectionRouteRegistration): void {
      const descriptor = normalizeConnectionDescriptor(input.descriptor);
      const verifierDigests = [...input.verifier.expectedToolSchemaDigests].sort();
      const descriptorDigests = descriptor.toolSchemas.map(item => item.digest).sort();
      const verifierEndpoints = [...input.verifier.sourceEndpointIds, ...input.verifier.writeEndpointIds].sort();
      if (input.sidecarRouteId !== descriptor.callableRoute.routeId || entries.has(input.sidecarRouteId) || input.verifier.provider !== descriptor.provider.id || !sameStringArrays(verifierDigests, descriptorDigests) || !sameStringArrays(verifierEndpoints, descriptor.callableRoute.endpointIds)) throw new TypeError("opaque route registration mismatch or duplicate");
      entries.set(input.sidecarRouteId, Object.freeze({ descriptorDigest: connectionDescriptorDigest(descriptor), account: descriptor.account.identity, descriptor, verifier: input.verifier, resolve: input.resolve }));
    },
    async resolve(descriptorInput: ConnectionDescriptorV1, adoptionInput: ConnectionAdoptionV1): Promise<DownstreamConnection> {
      const descriptor = normalizeConnectionDescriptor(descriptorInput);
      const adoption = normalizeConnectionAdoption(adoptionInput);
      const entry = entries.get(adoption.sidecarRouteId);
      if (!entry) throw new TypeError("opaque route is missing");
      const digest = connectionDescriptorDigest(descriptor);
      if (adoption.activationState !== "active" || adoption.descriptorDigest !== digest || entry.descriptorDigest !== digest || adoption.selectedAccountIdentity !== descriptor.account.identity || entry.account !== descriptor.account.identity || adoption.sidecarRouteId !== descriptor.callableRoute.routeId) throw new TypeError("opaque route descriptor or account mismatch");
      let connection: DownstreamConnection | undefined;
      try {
        connection = await entry.resolve();
        const serverIdentity = connection.advertisedName ?? connection.name;
        if (serverIdentity !== descriptor.provider.toolServerName) throw new TypeError("opaque route server identity mismatch");
        const observedSchemas = digestNormalizedMcpToolSchemas(connection.tools);
        if (!sameStringArrays(observedSchemas.map(item => item.digest), descriptor.toolSchemas.map(item => item.digest))) throw new TypeError("opaque route schema mismatch");
        const tools = new Set(connection.tools.map(tool => tool.name));
        if (descriptor.callableRoute.endpointIds.some(endpoint => !tools.has(endpoint))) throw new TypeError("opaque route endpoint mismatch");
        const account = await verifyConnectionAccount(connection, entry.verifier, descriptor.account.identity);
        if (account !== descriptor.account.identity) throw new TypeError("opaque route account mismatch");
        return connection;
      } catch {
        await connection?.close().catch(() => undefined);
        throw new TypeError("opaque route verification failed");
      }
    },
  });
}

export interface DigestedMcpToolSchema {
  readonly toolName: string;
  readonly digest: string;
}

export function digestNormalizedMcpToolSchemas(tools: readonly DownstreamTool[]): readonly DigestedMcpToolSchema[] {
  const names = new Set<string>();
  const digests = tools.map(tool => {
    if (!tool || typeof tool.name !== "string" || !tool.name || names.has(tool.name)) throw new TypeError("downstream tool names must be unique non-empty strings");
    names.add(tool.name);
    const annotations = tool.annotations === undefined ? undefined : {
      ...(typeof tool.annotations.readOnlyHint === "boolean" ? { readOnlyHint: tool.annotations.readOnlyHint } : {}),
      ...(typeof tool.annotations.destructiveHint === "boolean" ? { destructiveHint: tool.annotations.destructiveHint } : {}),
      ...(typeof tool.annotations.idempotentHint === "boolean" ? { idempotentHint: tool.annotations.idempotentHint } : {}),
    };
    const normalized = { name: tool.name, inputSchema: tool.inputSchema, ...(annotations === undefined ? {} : { annotations }) };
    return Object.freeze({ toolName: tool.name, digest: authorityDigest(normalized) });
  });
  return Object.freeze(digests.sort((a, b) => a.toolName.localeCompare(b.toolName)));
}

class ReviewedProbeAbsentError extends Error {}
class AccountMismatchError extends Error {
  constructor(readonly identity: string, readonly expectedIdentity: string) { super("connection account mismatch"); }
}

export async function verifyConnectionAccount(connection: DownstreamConnection, adapter: ReviewedConnectionInspectionAdapter, expectedIdentity?: string): Promise<string> {
  const probe = adapter.accountProbe;
  if (!probe || probe.reviewedReadOnly !== true || !connection.tools.some(tool => tool.name === probe.toolName)) throw new ReviewedProbeAbsentError("reviewed account probe unavailable");
  let result: McpCallResult;
  try {
    result = await connection.call(probe.toolName, probe.args);
  } catch {
    throw new Error("reviewed account probe failed");
  }
  if (result.isError === true) throw new Error("reviewed account probe failed");
  let identity: string;
  try {
    identity = probe.extractAccountIdentity(result);
  } catch {
    throw new Error("reviewed account probe response was invalid");
  }
  if (typeof identity !== "string" || !identity) throw new Error("reviewed account probe response was invalid");
  if (expectedIdentity !== undefined && identity !== expectedIdentity) throw new AccountMismatchError(identity, expectedIdentity);
  return identity;
}

function sameStringArrays(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export async function inspectCallableConnection(candidate: ConnectionInspectionCandidate, adapter: ReviewedConnectionInspectionAdapter, connect: ConnectionFactory): Promise<ConnectionInventoryEntryV1> {
  if (candidate.provider !== adapter.provider) return unsupportedEntry(candidate, "provider-adapter-mismatch");
  if (candidate.routeStatus !== "callable") return candidate.routeStatus === "host-private" ? shadowEntry(candidate) : unsupportedEntry(candidate, "connection-route-unsupported");
  let connection: DownstreamConnection | undefined;
  try {
    connection = await connect(candidate.routeSpec);
    const schemas = digestNormalizedMcpToolSchemas(connection.tools);
    const observedDigests = schemas.map(item => item.digest).sort();
    const expectedDigests = normalizedDigests(adapter.expectedToolSchemaDigests);
    if (expectedDigests.length === 0) return unverifiedEntry(candidate, expectedDigests, observedDigests, "schema-pin-absent", false);
    if (!sameStrings(expectedDigests, observedDigests)) {
      return entry(candidate, {
        status: "schema-drifted",
        accountVerification: { status: "unverified" },
        schemaVerification: { status: "drifted", expectedDigests, observedDigests },
        reasonCodes: ["tool-schema-drift"],
      });
    }
    const declaredEndpointIds = [...new Set([...adapter.sourceEndpointIds, ...adapter.writeEndpointIds])].sort();
    const toolNames = new Set(connection.tools.map(tool => tool.name));
    if (declaredEndpointIds.some(endpointId => !toolNames.has(endpointId))) {
      return entry(candidate, {
        status: "schema-drifted",
        accountVerification: { status: "unverified" },
        schemaVerification: { status: "drifted", expectedDigests, observedDigests },
        reasonCodes: ["declared-endpoint-missing"],
      });
    }
    if (typeof connection.advertisedName !== "string" || !connection.advertisedName) return unverifiedEntry(candidate, expectedDigests, observedDigests, "server-identity-unverified", true);
    let identity: string;
    try {
      identity = await verifyConnectionAccount(connection, adapter, candidate.expectedAccountIdentity);
    } catch (error) {
      if (error instanceof AccountMismatchError) {
        return entry(candidate, {
          status: "account-mismatched",
          accountVerification: { status: "mismatched", identity: error.identity, expectedIdentity: error.expectedIdentity },
          schemaVerification: { status: "verified", expectedDigests, observedDigests },
          reasonCodes: ["account-identity-mismatch"],
        });
      }
      return unverifiedEntry(candidate, expectedDigests, observedDigests, error instanceof ReviewedProbeAbsentError ? "reviewed-account-probe-absent" : "account-verification-failed", true);
    }
    const descriptor = {
      v: "reelier.connection-descriptor/v1" as const,
      connectionId: candidate.connectionId,
      kind: candidate.kind,
      provider: { id: candidate.provider, toolServerName: connection.advertisedName },
      callableRoute: { kind: routeKind(candidate.kind), routeId: candidate.routeId, endpointIds: declaredEndpointIds },
      account: { status: "verified" as const, identity },
      toolSchemas: schemas,
      secretOwner: candidate.secretOwner,
      coverage: normalizeHostCoverage(candidate.coverage),
    };
    return entry(candidate, {
      status: "usable",
      accountVerification: { status: "verified", identity, ...(candidate.expectedAccountIdentity === undefined ? {} : { expectedIdentity: candidate.expectedAccountIdentity }) },
      schemaVerification: { status: "verified", expectedDigests, observedDigests },
      reasonCodes: [],
      descriptor,
    });
  } catch {
    return unverifiedEntry(candidate, normalizedDigests(adapter.expectedToolSchemaDigests), [], "connection-inspection-failed", false);
  } finally {
    if (connection) {
      try { await connection.close(); } catch { /* inspection result remains non-usable if close itself is the only failure */ }
    }
  }
}

export async function inventoryConnections(candidates: readonly ConnectionInspectionCandidate[], adapters: readonly ReviewedConnectionInspectionAdapter[], connect: ConnectionFactory): Promise<readonly ConnectionInventoryEntryV1[]> {
  const byProvider = new Map(adapters.map(adapter => [adapter.provider, adapter]));
  const entries: ConnectionInventoryEntryV1[] = [];
  for (const candidate of [...candidates].sort((a, b) => a.discoveryId.localeCompare(b.discoveryId))) {
    if (candidate.routeStatus === "host-private") entries.push(shadowEntry(candidate));
    else if (candidate.routeStatus === "unsupported") entries.push(unsupportedEntry(candidate, "connection-route-unsupported"));
    else {
      const adapter = byProvider.get(candidate.provider);
      entries.push(adapter ? await inspectCallableConnection(candidate, adapter, connect) : unsupportedEntry(candidate, "reviewed-provider-adapter-absent"));
    }
  }
  return Object.freeze(entries);
}

export async function loadConnectionInventory(root: string): Promise<ConnectionInventoryReportV1> {
  const resolvedRoot = path.resolve(root);
  const connectorDirectory = path.join(resolvedRoot, "connectors");
  let names: string[];
  try {
    names = (await readdir(connectorDirectory)).filter(name => name.endsWith(".json")).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return normalizeConnectionInventoryReport({ v: "reelier.connection-inventory/v1", root: resolvedRoot, entries: [], issues: [] });
    throw new Error("connection inventory directory could not be read");
  }
  const entries: ConnectionInventoryEntryV1[] = [];
  const issues: Array<{ file: string; reasonCode: "malformed-inventory-entry" }> = [];
  for (const name of names) {
    try {
      const parsed = JSON.parse(await readFile(path.join(connectorDirectory, name), "utf8"));
      entries.push(isLegacyConnectorIntent(parsed) ? legacyConnectorIntentEntry(name, parsed) : normalizeConnectionInventoryEntry(parsed));
    } catch {
      issues.push({ file: name, reasonCode: "malformed-inventory-entry" });
    }
  }
  return normalizeConnectionInventoryReport({ v: "reelier.connection-inventory/v1", root: resolvedRoot, entries, issues });
}

function entry(candidate: ConnectionInspectionCandidate, values: Omit<ConnectionInventoryEntryV1, "v" | "discoveryId" | "provider" | "connectionKind" | "routeStatus">): ConnectionInventoryEntryV1 {
  return normalizeConnectionInventoryEntry({ v: "reelier.connection-inventory-entry/v1", discoveryId: candidate.discoveryId, provider: candidate.provider, connectionKind: candidate.kind, routeStatus: candidate.routeStatus, ...values });
}

function unverifiedEntry(candidate: ConnectionInspectionCandidate, expectedDigests: readonly string[], observedDigests: readonly string[], reasonCode: string, schemaVerified: boolean): ConnectionInventoryEntryV1 {
  return entry(candidate, { status: "discovered-unverified", accountVerification: { status: "unverified" }, schemaVerification: { status: schemaVerified ? "verified" : "unverified", expectedDigests, observedDigests }, reasonCodes: [reasonCode] });
}

function shadowEntry(candidate: ConnectionInspectionCandidate): ConnectionInventoryEntryV1 {
  return entry(candidate, { status: "shadow-only", accountVerification: { status: "unverified" }, schemaVerification: { status: "unverified", expectedDigests: [], observedDigests: [] }, reasonCodes: ["host-private-route"] });
}

function unsupportedEntry(candidate: ConnectionInspectionCandidate, reasonCode: string): ConnectionInventoryEntryV1 {
  return entry(candidate, { status: "unsupported", accountVerification: { status: "unsupported" }, schemaVerification: { status: "unsupported", expectedDigests: [], observedDigests: [] }, reasonCodes: [reasonCode] });
}

function isLegacyConnectorIntent(value: unknown): value is { v: "reelier.connector-intent/v1"; provider: string; status: "oauth-required"; createdAt: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const raw = value as Record<string, unknown>;
  return Object.keys(raw).every(key => ["v", "provider", "status", "createdAt"].includes(key)) && raw.v === "reelier.connector-intent/v1" && typeof raw.provider === "string" && raw.provider.length > 0 && raw.status === "oauth-required" && typeof raw.createdAt === "string" && raw.createdAt.length > 0;
}

function legacyConnectorIntentEntry(file: string, intent: { provider: string }): ConnectionInventoryEntryV1 {
  return normalizeConnectionInventoryEntry({
    v: "reelier.connection-inventory-entry/v1",
    discoveryId: `connector-intent:${path.basename(file, ".json")}`,
    provider: intent.provider,
    connectionKind: "native-https",
    status: "unsupported",
    routeStatus: "unsupported",
    accountVerification: { status: "unverified" },
    schemaVerification: { status: "unverified", expectedDigests: [], observedDigests: [] },
    reasonCodes: ["connection-authorization-required"],
  });
}

function normalizedDigests(values: readonly string[]): readonly string[] {
  if (values.some(value => !/^sha256:[0-9a-f]{64}$/.test(value))) throw new TypeError("expected tool schema digests are invalid");
  return Object.freeze([...new Set(values)].sort());
}

function sameStrings(a: readonly string[], b: readonly string[]): boolean { return a.length === b.length && a.every((value, index) => value === b[index]); }
function routeKind(kind: ConnectionKind): "mcp-stdio" | "mcp-http" | "opaque-host" {
  if (kind === "adopted-mcp-stdio") return "mcp-stdio";
  if (kind === "adopted-mcp-http") return "mcp-http";
  return "opaque-host";
}
