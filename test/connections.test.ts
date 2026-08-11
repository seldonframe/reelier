import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import type { DownstreamConnection, McpCallResult } from "../src/mcp-client.js";
import {
  digestNormalizedMcpToolSchemas,
  inspectCallableConnection,
  inventoryConnections,
  loadConnectionInventory,
  type ConnectionInspectionCandidate,
  type ReviewedConnectionInspectionAdapter,
} from "../src/connections.js";
import { normalizeHostCoverage } from "reelier/observation";

const digestA = "sha256:" + "a".repeat(64);
const coverage = normalizeHostCoverage({
  v: "reelier.host-coverage/v1",
  host: "claude-code",
  observation: "partially_observed",
  outcomeInvocation: "supported",
  exclusiveEnforcement: "unknown",
  limitations: ["raw-write-reachability-unmeasured"],
});

function fakeConnection(result: McpCallResult): DownstreamConnection & { calls: string[]; closed: boolean } {
  const state = {
    name: "gmail-mcp",
    advertisedName: "gmail-mcp",
    tools: [
      { name: "gmail.send", inputSchema: { required: ["to"], type: "object", properties: { to: { type: "string" } } }, annotations: { destructiveHint: true } },
      { name: "gmail.get_profile", inputSchema: { type: "object", additionalProperties: false }, annotations: { readOnlyHint: true } },
    ],
    calls: [] as string[],
    closed: false,
    async call(toolName: string): Promise<McpCallResult> { state.calls.push(toolName); return result; },
    async close(): Promise<void> { state.closed = true; },
  };
  return state;
}

function candidate(overrides: Partial<ConnectionInspectionCandidate> = {}): ConnectionInspectionCandidate {
  return {
    discoveryId: "discovery_1",
    connectionId: "conn_1",
    provider: "gmail",
    kind: "adopted-mcp-stdio",
    routeStatus: "callable",
    routeId: "claude.gmail",
    routeSpec: "opaque-test-route",
    secretOwner: "host",
    coverage,
    ...overrides,
  };
}

function adapter(expectedToolSchemaDigests: readonly string[], extract = (_result: McpCallResult) => "google:user:123"): ReviewedConnectionInspectionAdapter {
  return {
    provider: "gmail",
    sourceEndpointIds: ["gmail.get_profile"],
    writeEndpointIds: ["gmail.send"],
    expectedToolSchemaDigests,
    accountProbe: { toolName: "gmail.get_profile", args: {}, reviewedReadOnly: true, extractAccountIdentity: extract },
  };
}

test("normalized MCP schema digests are stable across tool and object-key ordering", () => {
  const first = digestNormalizedMcpToolSchemas([
    { name: "b", inputSchema: { type: "object", properties: { z: { type: "string" }, a: { type: "number" } } }, annotations: { readOnlyHint: true } },
    { name: "a", inputSchema: { type: "object" } },
  ]);
  const second = digestNormalizedMcpToolSchemas([
    { name: "a", inputSchema: { type: "object" } },
    { name: "b", inputSchema: { properties: { a: { type: "number" }, z: { type: "string" } }, type: "object" }, annotations: { readOnlyHint: true } },
  ]);
  assert.deepEqual(second, first);
  assert.deepEqual(first.map(item => item.toolName), ["a", "b"]);
  assert.match(first[0]!.digest, /^sha256:[0-9a-f]{64}$/);
});

test("a reviewed account probe yields a verified usable descriptor", async () => {
  const connection = fakeConnection({ content: [{ type: "text", text: "profile" }] });
  const actualDigests = digestNormalizedMcpToolSchemas(connection.tools).map(item => item.digest);
  const entry = await inspectCallableConnection(candidate(), adapter(actualDigests), async () => connection);
  assert.equal(entry.status, "usable");
  assert.equal(entry.descriptor?.account.identity, "google:user:123");
  assert.deepEqual(connection.calls, ["gmail.get_profile"]);
  assert.equal(connection.closed, true);
});

test("account mismatch is reported without a descriptor", async () => {
  const connection = fakeConnection({ content: [] });
  const digests = digestNormalizedMcpToolSchemas(connection.tools).map(item => item.digest);
  const entry = await inspectCallableConnection(candidate({ expectedAccountIdentity: "google:user:999" }), adapter(digests), async () => connection);
  assert.equal(entry.status, "account-mismatched");
  assert.equal(entry.descriptor, undefined);
  assert.equal(entry.accountVerification.status, "mismatched");
});

test("schema drift is reported before an account probe and without a descriptor", async () => {
  const connection = fakeConnection({ content: [] });
  const entry = await inspectCallableConnection(candidate(), adapter([digestA]), async () => connection);
  assert.equal(entry.status, "schema-drifted");
  assert.equal(entry.descriptor, undefined);
  assert.deepEqual(connection.calls, []);
});

test("host-private connections remain shadow-only and are never connected", async () => {
  let connected = false;
  const [entry] = await inventoryConnections([candidate({ kind: "host-private", routeStatus: "host-private" })], [adapter([])], async () => { connected = true; return fakeConnection({ content: [] }); });
  assert.equal(entry?.status, "shadow-only");
  assert.equal(entry?.descriptor, undefined);
  assert.equal(connected, false);
});

test("absence of a reviewed identity probe never triggers an optimistic tool call", async () => {
  const connection = fakeConnection({ content: [] });
  const digests = digestNormalizedMcpToolSchemas(connection.tools).map(item => item.digest);
  const withoutProbe = { ...adapter(digests), accountProbe: undefined };
  const entry = await inspectCallableConnection(candidate(), withoutProbe, async () => connection);
  assert.equal(entry.status, "discovered-unverified");
  assert.deepEqual(connection.calls, []);
  assert.equal(entry.descriptor, undefined);
});

test("inspection failures never disclose provider response secrets", async () => {
  const providerSecret = "provider-secret-value";
  const connection = fakeConnection({ content: [{ type: "text", text: providerSecret }] });
  const digests = digestNormalizedMcpToolSchemas(connection.tools).map(item => item.digest);
  const throwingAdapter = adapter(digests, result => { throw new Error(JSON.stringify(result)); });
  const entry = await inspectCallableConnection(candidate(), throwingAdapter, async () => connection);
  assert.equal(entry.status, "discovered-unverified");
  assert.doesNotMatch(JSON.stringify(entry), new RegExp(providerSecret));
});

test("opaque fallback connection names are never copied into descriptors", async () => {
  const routeSecret = "npx gmail-mcp --token route-secret-value";
  const connection = fakeConnection({ content: [] });
  connection.name = routeSecret;
  connection.advertisedName = undefined;
  const digests = digestNormalizedMcpToolSchemas(connection.tools).map(item => item.digest);
  const inspected = await inspectCallableConnection(candidate({ routeSpec: routeSecret }), adapter(digests), async () => connection);
  assert.equal(inspected.status, "discovered-unverified");
  assert.equal(inspected.descriptor, undefined);
  assert.doesNotMatch(JSON.stringify(inspected), /route-secret-value/);
});

test("MCP error account-probe responses cannot produce usable descriptors", async () => {
  const connection = fakeConnection({ content: [{ type: "text", text: "google:user:123" }], isError: true });
  const digests = digestNormalizedMcpToolSchemas(connection.tools).map(item => item.digest);
  const inspected = await inspectCallableConnection(candidate(), adapter(digests), async () => connection);
  assert.equal(inspected.status, "discovered-unverified");
  assert.equal(inspected.descriptor, undefined);
});

test("declared endpoints must exist before account verification", async () => {
  const connection = fakeConnection({ content: [] });
  const digests = digestNormalizedMcpToolSchemas(connection.tools).map(item => item.digest);
  const missingEndpoint = { ...adapter(digests), writeEndpointIds: ["gmail.missing"] };
  const inspected = await inspectCallableConnection(candidate(), missingEndpoint, async () => connection);
  assert.equal(inspected.status, "schema-drifted");
  assert.deepEqual(connection.calls, []);
  assert.equal(inspected.descriptor, undefined);
});

test("observed schemas without a reviewed pin remain unverified", async () => {
  const connection = fakeConnection({ content: [] });
  const inspected = await inspectCallableConnection(candidate(), adapter([]), async () => connection);
  assert.equal(inspected.status, "discovered-unverified");
  assert.equal(inspected.schemaVerification.status, "unverified");
});

test("legacy connector intents load as unsupported instead of malformed", async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
  const os = await import("node:os");
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-connector-intent-"));
  try {
    await mkdir(path.join(root, "connectors"));
    await writeFile(path.join(root, "connectors", "gmail.json"), JSON.stringify({ v: "reelier.connector-intent/v1", provider: "gmail", status: "oauth-required", createdAt: "2026-08-11T00:00:00.000Z" }));
    const report = await loadConnectionInventory(root);
    assert.deepEqual(report.issues, []);
    assert.equal(report.entries[0]?.status, "unsupported");
    assert.equal(report.entries[0]?.descriptor, undefined);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("connection ABI schemas accept closed contracts and refuse unknown keys", async () => {
  const Ajv2020 = createRequire(import.meta.url)("ajv/dist/2020").default;
  const ajv = new Ajv2020({ strict: true });
  const load = async (name: string) => JSON.parse(await readFile(path.join(process.cwd(), "contract", "authority", "v1", name), "utf8"));
  const descriptorSchema = await load("connection-descriptor.schema.json");
  const adoptionSchema = await load("connection-adoption.schema.json");
  const inventorySchema = await load("connection-inventory.schema.json");
  const connection = fakeConnection({ content: [] });
  const digests = digestNormalizedMcpToolSchemas(connection.tools).map(item => item.digest);
  const usable = await inspectCallableConnection(candidate(), adapter(digests), async () => connection);
  assert.equal(ajv.validate(descriptorSchema, usable.descriptor), true, JSON.stringify(ajv.errors));
  const adoption = { v: "reelier.connection-adoption/v1", adoptionId: "adoption_1", descriptorDigest: digestA, selectedAccountIdentity: "google:user:123", mode: "existing", sidecarRouteId: "sidecar.gmail", rawWriteReachability: "unknown", activationState: "inactive", signedDeploymentBinding: null, secureConnectionCommitment: null };
  assert.equal(ajv.validate(adoptionSchema, adoption), true, JSON.stringify(ajv.errors));
  const report = { v: "reelier.connection-inventory/v1", root: "authority", entries: [usable], issues: [] };
  assert.equal(ajv.validate(inventorySchema, report), true, JSON.stringify(ajv.errors));
  assert.equal(ajv.validate(inventorySchema, { ...report, credential: "forbidden" }), false);
  assert.equal(ajv.validate(inventorySchema, { ...report, entries: [{ ...usable, routeStatus: "unsupported" }] }), false);
  assert.equal(ajv.validate(adoptionSchema, { ...adoption, mode: "managed", activationState: "active", rawWriteReachability: "reachable" }), false);
  assert.equal(ajv.validate(adoptionSchema, { ...adoption, activationState: "active", signedDeploymentBinding: null }), false);
  assert.equal(ajv.validate(inventorySchema, { ...report, entries: [{ ...usable, descriptor: { ...usable.descriptor, callableRoute: { ...usable.descriptor?.callableRoute, kind: "mcp-http" } } }] }), false);
});
