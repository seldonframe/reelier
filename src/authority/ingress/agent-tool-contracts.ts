import { authorityDigest } from "../wire.js";
import { types as utilTypes } from "node:util";

export const AGENT_TOOL_NAMES_V1 = Object.freeze([
  "reelier_agent_status",
  "reelier_outcome_proposal",
  "reelier_outcome_request",
  "reelier_outcome_status",
] as const);
export type AgentToolNameV1 = typeof AGENT_TOOL_NAMES_V1[number];

export const CERTIFIABLE_HARNESSES_V1 = Object.freeze([
  "eve",
  "codex",
  "claude-code",
  "cursor",
  "grok",
  "hermes",
] as const);
export type CertifiableHarnessV1 = typeof CERTIFIABLE_HARNESSES_V1[number];

type JsonSchema = Readonly<Record<string, unknown>>;
type HttpMethod = "GET" | "POST";
export interface AgentToolContractV1 {
  readonly v: "reelier.agent-tool-contract/v1";
  readonly name: AgentToolNameV1;
  readonly semantic: "agent-status" | "outcome-proposal" | "outcome-request" | "outcome-status";
  readonly description: string;
  readonly inputSchema: JsonSchema;
  readonly outputSchema: JsonSchema;
  readonly http: Readonly<{ method: HttpMethod; path: string; successStatus: 200 | 202; pathParameters?: readonly string[] }>;
}

const identifier = Object.freeze({ type: "string", minLength: 1, maxLength: 256 });
const responseRequestId = Object.freeze({ type: "string", maxLength: 256 });
const opaqueOutcomeRef = Object.freeze({ type: "string", pattern: "^(?:jobref|outcomeref)_[0-9a-f]{64}$" });
const publicOutcomeFields = Object.freeze({
  requestId: responseRequestId,
  verdict: Object.freeze({ type: "string", enum: Object.freeze(["accepted", "refused"]) }),
  reasonCode: identifier,
  lifecycleState: identifier,
  receiptRef: identifier,
});
const outcomeOutput = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: Object.freeze(["requestId", "verdict", "reasonCode", "lifecycleState"]),
  properties: publicOutcomeFields,
});
const scalar = Object.freeze({ type: Object.freeze(["string", "number", "boolean", "null"]) });
const emptyInput = Object.freeze({ type: "object", additionalProperties: false, properties: Object.freeze({}) });
const proposalInput = Object.freeze({ type: "object", additionalProperties: false, required: Object.freeze(["outcomeRef"]), properties: Object.freeze({ outcomeRef: opaqueOutcomeRef }) });
const requestInput = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: Object.freeze(["outcomeRef", "requestId", "sourceRefs", "choices"]),
  properties: Object.freeze({
    outcomeRef: opaqueOutcomeRef,
    requestId: identifier,
    sourceRefs: Object.freeze({ type: "object", additionalProperties: Object.freeze({ type: "string", maxLength: 1024 }), maxProperties: 32 }),
    choices: Object.freeze({ type: "object", additionalProperties: scalar, maxProperties: 32 }),
  }),
});
const statusInput = Object.freeze({ type: "object", additionalProperties: false, required: Object.freeze(["requestId"]), properties: Object.freeze({ requestId: identifier }) });
const proposalOutput = Object.freeze({ ...outcomeOutput, properties: Object.freeze({ ...publicOutcomeFields, outcomeRef: opaqueOutcomeRef }) });
const capabilitySchema = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: Object.freeze(["v", "harnessId", "harnessVersion", "abiDigest", "protocolCompatibility", "transports", "fixtureStatus", "liveTested", "providerCertification"]),
  properties: Object.freeze({
    v: Object.freeze({ const: "reelier.harness-capability/v1" }),
    harnessId: Object.freeze({ type: Object.freeze(["string", "null"]), enum: Object.freeze([...CERTIFIABLE_HARNESSES_V1, null]) }),
    harnessVersion: Object.freeze({ type: Object.freeze(["string", "null"]) }),
    abiDigest: Object.freeze({ type: "string", pattern: "^sha256:[0-9a-f]{64}$" }),
    protocolCompatibility: Object.freeze({ const: "compatible" }),
    transports: Object.freeze({ type: "array", prefixItems: Object.freeze([{ const: "mcp" }, { const: "http" }, { const: "openapi" }]), minItems: 3, maxItems: 3 }),
    fixtureStatus: Object.freeze({ type: "string", enum: Object.freeze(["passed", "not-passed"]) }),
    liveTested: Object.freeze({ type: "boolean" }),
    providerCertification: Object.freeze({ const: "not-claimed" }),
  }),
});
const agentStatusOutput = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: Object.freeze(["requestId", "verdict", "reasonCode", "lifecycleState", "outcomeRefs", "capability"]),
  properties: Object.freeze({
    ...publicOutcomeFields,
    outcomeRefs: Object.freeze({ type: "array", maxItems: 256, uniqueItems: true, items: opaqueOutcomeRef }),
    capability: capabilitySchema,
  }),
});

export const AGENT_TOOL_CONTRACTS_V1: readonly AgentToolContractV1[] = Object.freeze([
  Object.freeze({ v: "reelier.agent-tool-contract/v1", name: "reelier_agent_status", semantic: "agent-status", description: "Read the authenticated agent's governed Outcome capability and opaque available references.", inputSchema: emptyInput, outputSchema: agentStatusOutput, http: Object.freeze({ method: "GET", path: "/v1/agent/status", successStatus: 200 }) }),
  Object.freeze({ v: "reelier.agent-tool-contract/v1", name: "reelier_outcome_proposal", semantic: "outcome-proposal", description: "Resolve one authenticated opaque Outcome reference without dispatching it.", inputSchema: proposalInput, outputSchema: proposalOutput, http: Object.freeze({ method: "POST", path: "/v1/outcome-proposals", successStatus: 200 }) }),
  Object.freeze({ v: "reelier.agent-tool-contract/v1", name: "reelier_outcome_request", semantic: "outcome-request", description: "Request one already-authorized Outcome through its authenticated opaque reference.", inputSchema: requestInput, outputSchema: outcomeOutput, http: Object.freeze({ method: "POST", path: "/v1/outcome-requests", successStatus: 202 }) }),
  Object.freeze({ v: "reelier.agent-tool-contract/v1", name: "reelier_outcome_status", semantic: "outcome-status", description: "Inspect the redacted lifecycle of one Outcome request.", inputSchema: statusInput, outputSchema: outcomeOutput, http: Object.freeze({ method: "GET", path: "/v1/outcome-status/{requestId}", successStatus: 200, pathParameters: Object.freeze(["requestId"]) }) }),
]);

export const AGENT_TOOL_ABI_DIGEST_V1 = authorityDigest({
  v: "reelier.agent-tool-abi/v1",
  contracts: AGENT_TOOL_CONTRACTS_V1,
});

export interface HarnessCapabilityDescriptorV1 {
  readonly v: "reelier.harness-capability/v1";
  readonly harnessId: CertifiableHarnessV1 | null;
  readonly harnessVersion: string | null;
  readonly abiDigest: string;
  readonly protocolCompatibility: "compatible";
  readonly transports: readonly ["mcp", "http", "openapi"];
  readonly fixtureStatus: "passed" | "not-passed";
  readonly liveTested: boolean;
  readonly providerCertification: "not-claimed";
}

export function createHarnessCapabilityDescriptorV1(input: Readonly<{ harnessId: CertifiableHarnessV1; harnessVersion: string; fixturePassed: boolean }>): HarnessCapabilityDescriptorV1 {
  if (!CERTIFIABLE_HARNESSES_V1.includes(input.harnessId) || typeof input.harnessVersion !== "string" || input.harnessVersion.length < 1 || input.harnessVersion.length > 64 || typeof input.fixturePassed !== "boolean") throw new TypeError("harness capability descriptor is invalid");
  return Object.freeze({
    v: "reelier.harness-capability/v1",
    harnessId: null,
    harnessVersion: null,
    abiDigest: AGENT_TOOL_ABI_DIGEST_V1,
    protocolCompatibility: "compatible",
    transports: Object.freeze(["mcp", "http", "openapi"] as const),
    fixtureStatus: "not-passed",
    liveTested: false,
    providerCertification: "not-claimed",
  });
}

export function agentToolMcpDefinitionsV1(): readonly Readonly<{ name: AgentToolNameV1; description: string; inputSchema: JsonSchema; outputSchema: JsonSchema }>[] {
  return Object.freeze(AGENT_TOOL_CONTRACTS_V1.map(contract => Object.freeze({ name: contract.name, description: contract.description, inputSchema: contract.inputSchema, outputSchema: contract.outputSchema })));
}

export function agentToolHttpRoutesV1(): readonly Readonly<{ operationId: AgentToolNameV1; method: HttpMethod; path: string; inputSchema: JsonSchema; outputSchema: JsonSchema }>[] {
  return Object.freeze(AGENT_TOOL_CONTRACTS_V1.map(contract => Object.freeze({ operationId: contract.name, method: contract.http.method, path: contract.http.path, inputSchema: contract.inputSchema, outputSchema: contract.outputSchema })));
}

export function buildAgentToolOpenApiV1(): Readonly<{ openapi: "3.1.0"; info: Readonly<{ title: string; version: "1" }>; paths: Readonly<Record<string, unknown>> }> {
  const paths: Record<string, unknown> = {};
  for (const contract of AGENT_TOOL_CONTRACTS_V1) {
    paths[contract.http.path] = Object.freeze({
      [contract.http.method.toLowerCase()]: Object.freeze({
        operationId: contract.name,
        description: contract.description,
        ...(contract.http.method === "POST" ? { requestBody: Object.freeze({ required: true, content: Object.freeze({ "application/json": Object.freeze({ schema: contract.inputSchema }) }) }) } : {}),
        ...(contract.http.pathParameters ? { parameters: Object.freeze(contract.http.pathParameters.map(name => Object.freeze({ name, in: "path", required: true, schema: identifier }))) } : {}),
        responses: Object.freeze({ [String(contract.http.successStatus)]: Object.freeze({ description: "Closed Reelier agent-tool response", content: Object.freeze({ "application/json": Object.freeze({ schema: contract.outputSchema }) }) }) }),
      }),
    });
  }
  return Object.freeze({ openapi: "3.1.0", info: Object.freeze({ title: "Reelier Agent Tool ABI", version: "1" }), paths: Object.freeze(paths) });
}

export function parseAgentToolInputV1(name: AgentToolNameV1, value: unknown): Readonly<Record<string, unknown>> {
  const raw = inertRecord(value, "agent tool input");
  if (name === "reelier_agent_status") return closedRecord(raw, [], {});
  if (name === "reelier_outcome_proposal") return closedRecord(raw, ["outcomeRef"], { outcomeRef: opaqueRef(raw.outcomeRef) });
  if (name === "reelier_outcome_status") return closedRecord(raw, ["requestId"], { requestId: boundedString(raw.requestId, "requestId", 256) });
  if (name === "reelier_outcome_request") return closedRecord(raw, ["outcomeRef", "requestId", "sourceRefs", "choices"], {
    outcomeRef: opaqueRef(raw.outcomeRef),
    requestId: boundedString(raw.requestId, "requestId", 256),
    sourceRefs: scalarRecord(raw.sourceRefs, "sourceRefs", 32, true),
    choices: scalarRecord(raw.choices, "choices", 32, false),
  });
  throw new TypeError("agent tool name is invalid");
}

export function parseAgentToolOutputV1(name: AgentToolNameV1, value: unknown): Readonly<Record<string, unknown>> {
  const raw = inertRecord(value, "agent tool output");
  const extra = name === "reelier_agent_status" ? ["outcomeRefs", "capability"] : name === "reelier_outcome_proposal" ? ["outcomeRef"] : [];
  const allowed = ["requestId", "verdict", "reasonCode", "lifecycleState", "receiptRef", ...extra];
  if (Reflect.ownKeys(raw).some(key => typeof key !== "string" || !allowed.includes(key))) throw new TypeError("agent tool output contains a field outside the closed contract");
  const result: Record<string, unknown> = {
    requestId: boundedString(raw.requestId, "requestId", 256, true),
    verdict: raw.verdict === "accepted" || raw.verdict === "refused" ? raw.verdict : invalid("verdict"),
    reasonCode: boundedString(raw.reasonCode, "reasonCode", 256),
    lifecycleState: boundedString(raw.lifecycleState, "lifecycleState", 256),
  };
  if (raw.receiptRef !== undefined) result.receiptRef = boundedString(raw.receiptRef, "receiptRef", 512);
  if (name === "reelier_outcome_proposal" && raw.outcomeRef !== undefined) result.outcomeRef = opaqueRef(raw.outcomeRef);
  if (name === "reelier_agent_status") {
    if (!Array.isArray(raw.outcomeRefs) || utilTypes.isProxy(raw.outcomeRefs) || raw.outcomeRefs.length > 256) throw new TypeError("outcomeRefs is invalid");
    result.outcomeRefs = Object.freeze(raw.outcomeRefs.map(opaqueRef));
    result.capability = parseCapability(raw.capability);
  }
  return Object.freeze(result);
}

function inertRecord(value: unknown, what: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || utilTypes.isProxy(value) || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(`${what} must be an inert plain record and not a proxy`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = descriptors[key as keyof typeof descriptors];
    if (typeof key !== "string" || !descriptor || !("value" in descriptor) || descriptor.get || descriptor.set || !descriptor.enumerable) throw new TypeError(`${what} must contain enumerable data fields`);
  }
  return value as Record<string, unknown>;
}

function closedRecord(raw: Record<string, unknown>, allowed: readonly string[], projected: Record<string, unknown>): Readonly<Record<string, unknown>> {
  if (Reflect.ownKeys(raw).some(key => typeof key !== "string" || !allowed.includes(key))) throw new TypeError("agent tool input contains a field outside the closed contract");
  return Object.freeze(projected);
}

function boundedString(value: unknown, what: string, max: number, empty = false): string {
  if (typeof value !== "string" || (!empty && value.length < 1) || value.length > max) throw new TypeError(`${what} is invalid or exceeds its bounded length`);
  return value;
}

function invalid(what: string): never { throw new TypeError(`${what} is invalid`); }

function parseCapability(value: unknown): HarnessCapabilityDescriptorV1 {
  const raw = inertRecord(value, "harness capability");
  const keys = ["v", "harnessId", "harnessVersion", "abiDigest", "protocolCompatibility", "transports", "fixtureStatus", "liveTested", "providerCertification"];
  if (Reflect.ownKeys(raw).length !== keys.length || Reflect.ownKeys(raw).some(key => typeof key !== "string" || !keys.includes(key))) throw new TypeError("harness capability is not closed");
  if (raw.v !== "reelier.harness-capability/v1" || raw.harnessId !== null || raw.harnessVersion !== null || raw.abiDigest !== AGENT_TOOL_ABI_DIGEST_V1 || raw.protocolCompatibility !== "compatible" || raw.fixtureStatus !== "not-passed" || raw.liveTested !== false || raw.providerCertification !== "not-claimed") throw new TypeError("harness capability overclaims evidence");
  if (!Array.isArray(raw.transports) || utilTypes.isProxy(raw.transports) || raw.transports.length !== 3 || raw.transports[0] !== "mcp" || raw.transports[1] !== "http" || raw.transports[2] !== "openapi") throw new TypeError("harness capability transports are invalid");
  return Object.freeze({ v: "reelier.harness-capability/v1", harnessId: null, harnessVersion: null, abiDigest: AGENT_TOOL_ABI_DIGEST_V1, protocolCompatibility: "compatible", transports: Object.freeze(["mcp", "http", "openapi"] as const), fixtureStatus: "not-passed", liveTested: false, providerCertification: "not-claimed" });
}

function opaqueRef(value: unknown): string {
  const ref = boundedString(value, "outcomeRef", 128);
  if (!/^(?:jobref|outcomeref)_[0-9a-f]{64}$/.test(ref)) throw new TypeError("outcomeRef is not an authenticated opaque reference");
  return ref;
}

function scalarRecord(value: unknown, what: string, maxProperties: number, stringsOnly: boolean): Readonly<Record<string, string | number | boolean | null>> {
  const raw = inertRecord(value, what);
  const keys = Reflect.ownKeys(raw);
  if (keys.length > maxProperties) throw new TypeError(`${what} exceeds its bounded property count`);
  const output: Record<string, string | number | boolean | null> = {};
  for (const key of keys) {
    if (typeof key !== "string" || key.length < 1 || key.length > 128 || key === "__proto__" || key === "constructor" || key === "prototype") throw new TypeError(`${what} contains an invalid field`);
    const item = raw[key];
    if (stringsOnly ? typeof item !== "string" : !(item === null || typeof item === "string" || typeof item === "number" && Number.isFinite(item) || typeof item === "boolean")) throw new TypeError(`${what} contains a non-scalar value`);
    if (typeof item === "string" && item.length > 1024) throw new TypeError(`${what} contains an overlong value`);
    output[key] = item as string | number | boolean | null;
  }
  return Object.freeze(output);
}
