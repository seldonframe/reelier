import { createHmac, timingSafeEqual } from "node:crypto";
import { isProxy } from "node:util/types";
import { digestToolEffectContractV1, parseToolEffectContractV1, type ToolEffectContractV1 } from "../tool-effect-contract.js";
import { authorityCanonicalBytes, authorityDigest } from "../wire.js";
import { bindCoordinatorDispatchCallDelegateV1, type CoordinatorDispatchCallV1, type DispatchAdapter, type DispatchOutcome, type DispatchRequestState } from "./dispatch.js";
import { createPreparedDispatch, preparedDispatchProjectionDigest, type PreparedDispatch } from "./prepared-dispatch.js";
import { createTrustedObservationVerifier, type TrustedObservationVerifierV1 } from "./outcome-kernel.js";

const SHA = /^sha256:[0-9a-f]{64}$/;
const AUTH_KEY = /^[0-9a-f]{64}$/;
const NAME = /^[A-Za-z0-9._:-]{1,256}$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const HTTP_METHODS = new Set(["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]);
const HOST_TEMPLATE_FIELDS = new Set(["account", "destination", "limit"]);

export interface McpEffectTransportBindingV1 { readonly v: "reelier.effect-transport-binding/v1"; readonly kind: "mcp"; readonly operation: string; readonly server: string; readonly tool: string; readonly serverSchemaDigest: string; readonly toolSchemaDigest: string; readonly readback: Readonly<{ operation: string; tool: string; toolSchemaDigest: string }> | null; }
export interface HttpEffectTransportBindingV1 { readonly v: "reelier.effect-transport-binding/v1"; readonly kind: "http"; readonly operation: string; readonly method: string; readonly origin: string; readonly pathTemplate: string; readonly requestSchemaDigest: string; readonly responseProjection: readonly string[]; readonly readback: Readonly<{ operation: string; method: string; pathTemplate: string; requestSchemaDigest: string }> | null; }
export interface CliEffectTransportBindingV1 { readonly v: "reelier.effect-transport-binding/v1"; readonly kind: "cli"; readonly operation: string; readonly executable: string; readonly argvTemplates: readonly string[]; readonly credentialEnv: string; readonly envNames: readonly string[]; readonly responseProjection: readonly string[]; readonly readback: Readonly<{ operation: string; argvTemplates: readonly string[] }> | null; }
export type EffectTransportBindingV1 = McpEffectTransportBindingV1 | HttpEffectTransportBindingV1 | CliEffectTransportBindingV1;

export interface EffectTransportHostBindingsV1 { readonly credential: string; readonly account: string; readonly destination: string; readonly limit: string; }
export interface EffectTransportProviderResponseV1 { readonly outcome: string; readonly data: unknown }
export type EffectTransportProviderEnvelopeV1 = string;
export interface EffectTransportResultSinkV1 { readonly success: (serializedJson: string) => void; readonly failure: () => void; }
export interface EffectTransportExecutorAuthorityV1 { readonly contractDigest: string; readonly bindingDigest: string; readonly reservationId: string }
export interface GovernedEffectTransportExecutorAuthorityV1 { readonly contractDigest: string; readonly bindingDigest: string; readonly reservationId: string; readonly requestId: string; readonly governedEffectDigest: string }
interface EffectTransportExecutorCallbacksV1<Authority extends EffectTransportExecutorAuthorityV1> {
  readonly mcp?: Readonly<{
    inspectSchemas(request: Readonly<{ server: string; tool: string }>, sink: EffectTransportResultSinkV1): void;
    call(request: Readonly<{ server: string; tool: string; serverSchemaDigest: string; toolSchemaDigest: string; arguments: Readonly<{ model: Readonly<Record<string, unknown>>; host: Readonly<{ account: string; destination: string; limit: string }> }>; credential: string; authority: Authority }>, sink: EffectTransportResultSinkV1): void;
  }>;
  readonly http?: Readonly<{ call(request: Readonly<{ method: string; url: string; body: Readonly<{ model: Readonly<Record<string, unknown>>; host: Readonly<{ account: string; destination: string; limit: string }> }> | null; credential: string; requestSchemaDigest: string; authority: Authority }>, sink: EffectTransportResultSinkV1): void }>;
  readonly cli?: Readonly<{ spawn(request: Readonly<{ executable: string; argv: readonly string[]; env: Readonly<Record<string, string>>; authority: Authority }>, sink: EffectTransportResultSinkV1): void }>;
}
export type TrustedEffectTransportExecutorCallbacksV1 = EffectTransportExecutorCallbacksV1<EffectTransportExecutorAuthorityV1>;
export type GovernedEffectTransportExecutorCallbacksV1 = EffectTransportExecutorCallbacksV1<GovernedEffectTransportExecutorAuthorityV1>;
type AnyEffectTransportExecutorAuthorityV1 = EffectTransportExecutorAuthorityV1 | GovernedEffectTransportExecutorAuthorityV1;
type AnyEffectTransportExecutorCallbacksV1 = EffectTransportExecutorCallbacksV1<AnyEffectTransportExecutorAuthorityV1>;
declare const trustedEffectTransportExecutorBrand: unique symbol;
export interface TrustedEffectTransportExecutorV1 { readonly [trustedEffectTransportExecutorBrand]: true; }
declare const governedEffectTransportExecutorBrand: unique symbol;
export interface GovernedEffectTransportExecutorV1 { readonly [governedEffectTransportExecutorBrand]: true; }

const trustedEffectTransportExecutors = new WeakMap<object, TrustedEffectTransportExecutorCallbacksV1>();
const governedEffectTransportExecutors = new WeakMap<object, GovernedEffectTransportExecutorCallbacksV1>();

export interface CompiledEffectTransportV1 {
  readonly effect: Readonly<{ v: "reelier.compiled-effect-input/v1"; contractDigest: string; bindingDigest: string; model: Readonly<Record<string, unknown>> }>;
  readonly evidence: Readonly<{ v: "reelier.effect-transport-evidence/v1"; contractDigest: string; bindingDigest: string; model: Readonly<Record<string, unknown>> }>;
  readonly adapter: DispatchAdapter;
  readonly verifier: TrustedObservationVerifierV1;
  readonly prepareGoverned: (state: DispatchRequestState, call: CoordinatorDispatchCallV1) => Promise<PreparedDispatch>;
}

export function parseEffectTransportBindingV1(value: unknown): EffectTransportBindingV1 {
  const head = closedRecord(value, ["v", "kind"], ["operation", "server", "tool", "serverSchemaDigest", "toolSchemaDigest", "method", "origin", "pathTemplate", "requestSchemaDigest", "responseProjection", "executable", "argvTemplates", "credentialEnv", "envNames", "readback"], "effect transport binding");
  if (head.v !== "reelier.effect-transport-binding/v1") throw new TypeError("effect transport binding version is invalid");
  if (head.kind === "mcp") return parseMcpBinding(value);
  if (head.kind === "http") return parseHttpBinding(value);
  if (head.kind === "cli") return parseCliBinding(value);
  throw new TypeError("effect transport binding kind is invalid");
}

export function digestEffectTransportBindingV1(value: unknown): string { return authorityDigest(parseEffectTransportBindingV1(value)); }

export function mintTrustedEffectTransportExecutorV1(value: TrustedEffectTransportExecutorCallbacksV1): TrustedEffectTransportExecutorV1 {
  const callbacks = parseTrustedExecutorCallbacks(value);
  const capability = Object.freeze(Object.create(null)) as TrustedEffectTransportExecutorV1;
  trustedEffectTransportExecutors.set(capability, callbacks);
  return capability;
}

export function mintGovernedEffectTransportExecutorV1(value: GovernedEffectTransportExecutorCallbacksV1): GovernedEffectTransportExecutorV1 {
  const callbacks = parseTrustedExecutorCallbacks(value) as GovernedEffectTransportExecutorCallbacksV1;
  const capability = Object.freeze(Object.create(null)) as GovernedEffectTransportExecutorV1;
  governedEffectTransportExecutors.set(capability, callbacks);
  return capability;
}

type EffectTransportCompileInputV1<Executor> = Readonly<{ contract: ToolEffectContractV1; binding: EffectTransportBindingV1; modelInput: unknown; observationAuthKey: string; resolveHostBindings: (references: ToolEffectContractV1["bindings"]) => Promise<EffectTransportHostBindingsV1>; executor: Executor; }>;

export function compileEffectTransportV1(input: EffectTransportCompileInputV1<TrustedEffectTransportExecutorV1>): CompiledEffectTransportV1 {
  return compileEffectTransport(input, trustedEffectTransportExecutors, false, "trusted");
}

export function compileGovernedEffectTransportV1(input: EffectTransportCompileInputV1<GovernedEffectTransportExecutorV1>): CompiledEffectTransportV1 {
  return compileEffectTransport(input, governedEffectTransportExecutors, true, "governed");
}

function compileEffectTransport(input: EffectTransportCompileInputV1<object>, executors: WeakMap<object, TrustedEffectTransportExecutorCallbacksV1 | GovernedEffectTransportExecutorCallbacksV1>, governed: boolean, label: string): CompiledEffectTransportV1 {
  if (!input || typeof input !== "object" || isProxy(input)) throw new TypeError("effect transport compiler input is invalid");
  const executorDescriptor = Object.getOwnPropertyDescriptor(input, "executor");
  const executor = (executorDescriptor && Object.hasOwn(executorDescriptor, "value") && executorDescriptor.enumerable && executorDescriptor.value && typeof executorDescriptor.value === "object"
    ? executors.get(executorDescriptor.value as object)
    : undefined) as AnyEffectTransportExecutorCallbacksV1 | undefined;
  if (!executor) throw new TypeError(`effect transport compiler requires a host-minted ${label} executor capability`);
  if (typeof input.resolveHostBindings !== "function") throw new TypeError("effect transport compiler input is invalid");
  const contract = parseToolEffectContractV1(input.contract), binding = parseEffectTransportBindingV1(input.binding);
  const contractDigest = digestToolEffectContractV1(contract), bindingDigest = authorityDigest(binding);
  const observationAuthKey = parseObservationAuthKey(input.observationAuthKey);
  bindContract(contract, binding, bindingDigest);
  const model = parseModelInput(input.modelInput, contract);
  validateTemplateValues(binding, model);
  const effect = deepFreeze({ v: "reelier.compiled-effect-input/v1" as const, contractDigest, bindingDigest, model });
  const evidence = deepFreeze({ v: "reelier.effect-transport-evidence/v1" as const, contractDigest, bindingDigest, model });
  const modelDigest = authorityDigest(model);
  const projectionSchemaDigest = contract.readback === null ? null : authorityDigest(contract.readback.projection);
  const provenance = (reservationId: string, projectionCommitment: string) => ({
    v: "reelier.effect-authoritative-match-provenance/v1",
    contractDigest,
    bindingDigest,
    reservationId,
    semanticIdentity: contract.semanticIdentity,
    modelDigest,
    readbackOperation: contract.readback!.operation,
    projectionSchemaDigest,
    projectionCommitment,
  });
  const matchedProjectionDigest = (reservationId: string, projectionDigest: string): string | null => {
    if (contract.readback === null || !SHA.test(projectionDigest)) return null;
    const projectionCommitment = projectionDigest.slice(7, 39);
    return `sha256:${projectionCommitment}${provenanceAuthenticator(observationAuthKey, provenance(reservationId, projectionCommitment))}`;
  };
  const hostBindings = async (): Promise<EffectTransportHostBindingsV1> => {
    try { return parseHostBindings(await input.resolveHostBindings(contract.bindings)); }
    catch { throw new Error("effect transport host binding resolution failed"); }
  };
  const adapter: DispatchAdapter = Object.freeze({
    async dispatch(state: DispatchRequestState, call?: CoordinatorDispatchCallV1): Promise<DispatchOutcome> {
      bindDispatchState(state, effect, contractDigest);
      let authority: AnyEffectTransportExecutorAuthorityV1;
      try { authority = executorAuthority(state, contractDigest, bindingDigest, governed); }
      catch { return Object.freeze({ kind: "definitive-failure", resultDigest: authorityDigest({ v: "reelier.effect-transport-dispatch-refused/v1", bindingDigest, reservationId: state.reservation.reservationId, reason: "executor-authority-unavailable" }) }); }
      if (call && !bindCoordinatorDispatchCallDelegateV1(call, authority, state)) {
        return Object.freeze({
          kind: "definitive-failure",
          resultDigest: authorityDigest({ v: "reelier.effect-transport-dispatch-refused/v1", bindingDigest, reservationId: state.reservation.reservationId, reason: "coordinator-delegate-binding-refused" }),
        });
      }
      const response = await dispatch(binding, model, await hostBindings(), executor, authority);
      return dispatchOutcome(contract, bindingDigest, response);
    },
    async reconcile(state: DispatchRequestState, prior: DispatchOutcome): Promise<DispatchOutcome> {
      bindDispatchState(state, effect, contractDigest);
      if (!contract.readback || !binding.readback) return unavailableOutcome(bindingDigest, prior);
      const response = await readback(binding, model, await hostBindings(), executor, executorAuthority(state, contractDigest, bindingDigest, governed)), category = resultCategory(contract, response.outcome);
      if (category === "success") {
        const projection = projectResponse(response.data, contract.readback.projection);
        if (projection === null) return unavailableOutcome(bindingDigest, prior);
        const normalizedProjectionDigest = matchedProjectionDigest(state.reservation.reservationId, authorityDigest(projection))!;
        return Object.freeze({ kind: "acknowledged", resultDigest: responseDigest(bindingDigest, response), reconciliationStatus: "matched", normalizedProjectionDigest });
      }
      if (category === "conflict" || category === "definitive-failure") {
        const projection = projectResponse(response.data, contract.readback.projection);
        const normalizedProjectionDigest = projection === null ? authorityDigest({ v: category === "conflict" ? "reelier.effect-conflict/v1" : "reelier.effect-not-applied/v1", bindingDigest }) : authorityDigest(projection);
        return Object.freeze({ kind: governed ? "definitive-failure" : "acknowledged", resultDigest: responseDigest(bindingDigest, response), reconciliationStatus: category === "conflict" ? "conflict" : "not-applied", normalizedProjectionDigest });
      }
      return unavailableOutcome(bindingDigest, prior);
    },
  });
  const prepareGoverned = async (state: DispatchRequestState, call: CoordinatorDispatchCallV1): Promise<PreparedDispatch> => {
    if (!state?.reservation || state.reservation.state !== "reserved") throw new TypeError("governed effect transport requires the exact reserved coordinator state");
    const authority = executorAuthority(state, contractDigest, bindingDigest, governed);
    if (!bindCoordinatorDispatchCallDelegateV1(call, authority, state)) throw new TypeError("governed effect transport coordinator authority refused before host binding");
    const host = await hostBindings(), route = state.reservation.intent.routeAuthority, allocationId = state.reservation.intent.executionContext?.allocationId;
    if (!route || !allocationId) throw new TypeError("governed effect transport requires signed route and allocation authority");
    const projection = deepFreeze({ v: "reelier.prepared-effect-projection/v1" as const, transport: binding.kind, operationDigest: bindingDigest, requestDigest: authorityDigest({ v: "reelier.governed-effect-transport-request/v1", contractDigest, bindingDigest, model, account: host.account, destination: host.destination, limit: host.limit }) });
    const materializedRequestDigest = preparedDispatchProjectionDigest(projection);
    return createPreparedDispatch({ description: { v: "reelier.prepared-dispatch-description/v1", routeDigest: route.routeDigest, materializedRequestDigest, projection, authorityGeneration: route.authorityGeneration, authorityExpiresAt: route.authorityExpiresAt, absoluteDeadlineMs: performance.now() + Math.max(1, Date.parse(route.authorityExpiresAt) - Date.now()), reservationId: state.reservation.reservationId, allocationId, behaviorDigest: authorityDigest({ v: "reelier.governed-effect-transport-behavior/v1", contractDigest, bindingDigest }) }, send: async () => { const response = await dispatch(binding, model, host, executor, authority); return dispatchOutcome(contract, bindingDigest, response); }, requireCoordinatorCommit: true });
  };
  const verifier = createTrustedObservationVerifier({ contractDigest, verify: observation => {
    if (observation.projectionDigest === null || !observation.authoritative || observation.verdict !== "matched" || observation.semanticIdentity !== contract.semanticIdentity || observation.observationId !== `observation_${authorityDigest({ reservationId: observation.reservationId, verdict: "matched", projectionDigest: observation.projectionDigest }).slice(7, 31)}`) return false;
    const packed = observation.projectionDigest.slice(7), projectionCommitment = packed.slice(0, 32), actualAuthenticator = packed.slice(32);
    if (!/^[0-9a-f]{32}$/.test(projectionCommitment) || !/^[0-9a-f]{32}$/.test(actualAuthenticator)) return false;
    const expectedAuthenticator = provenanceAuthenticator(observationAuthKey, provenance(observation.reservationId, projectionCommitment));
    return timingSafeEqual(Buffer.from(actualAuthenticator, "hex"), Buffer.from(expectedAuthenticator, "hex"));
  } });
  return Object.freeze({ effect, evidence, adapter, verifier, prepareGoverned });
}

function parseMcpBinding(value: unknown): McpEffectTransportBindingV1 {
  const raw = closedRecord(value, ["v", "kind", "operation", "server", "tool", "serverSchemaDigest", "toolSchemaDigest", "readback"], [], "MCP effect transport binding");
  if (raw.v !== "reelier.effect-transport-binding/v1" || raw.kind !== "mcp") throw new TypeError("MCP effect transport binding is invalid");
  let readback: McpEffectTransportBindingV1["readback"] = null;
  if (raw.readback !== null) { const parsed = closedRecord(raw.readback, ["operation", "tool", "toolSchemaDigest"], [], "MCP readback binding"); readback = deepFreeze({ operation: name(parsed.operation, "MCP readback operation"), tool: name(parsed.tool, "MCP readback tool"), toolSchemaDigest: digest(parsed.toolSchemaDigest, "MCP readback schema") }); }
  return deepFreeze({ v: "reelier.effect-transport-binding/v1", kind: "mcp", operation: name(raw.operation, "MCP operation"), server: name(raw.server, "MCP server"), tool: name(raw.tool, "MCP tool"), serverSchemaDigest: digest(raw.serverSchemaDigest, "MCP server schema"), toolSchemaDigest: digest(raw.toolSchemaDigest, "MCP tool schema"), readback });
}

function parseHttpBinding(value: unknown): HttpEffectTransportBindingV1 {
  const raw = closedRecord(value, ["v", "kind", "operation", "method", "origin", "pathTemplate", "requestSchemaDigest", "responseProjection", "readback"], [], "HTTP effect transport binding");
  if (raw.v !== "reelier.effect-transport-binding/v1" || raw.kind !== "http") throw new TypeError("HTTP effect transport binding is invalid");
  let readback: HttpEffectTransportBindingV1["readback"] = null;
  if (raw.readback !== null) { const parsed = closedRecord(raw.readback, ["operation", "method", "pathTemplate", "requestSchemaDigest"], [], "HTTP readback binding"); readback = deepFreeze({ operation: name(parsed.operation, "HTTP readback operation"), method: httpMethod(parsed.method), pathTemplate: pathTemplate(parsed.pathTemplate), requestSchemaDigest: digest(parsed.requestSchemaDigest, "HTTP readback schema") }); }
  return deepFreeze({ v: "reelier.effect-transport-binding/v1", kind: "http", operation: name(raw.operation, "HTTP operation"), method: httpMethod(raw.method), origin: httpOrigin(raw.origin), pathTemplate: pathTemplate(raw.pathTemplate), requestSchemaDigest: digest(raw.requestSchemaDigest, "HTTP request schema"), responseProjection: projectionList(raw.responseProjection), readback });
}

function parseCliBinding(value: unknown): CliEffectTransportBindingV1 {
  const raw = closedRecord(value, ["v", "kind", "operation", "executable", "argvTemplates", "credentialEnv", "envNames", "responseProjection", "readback"], [], "CLI effect transport binding");
  if (raw.v !== "reelier.effect-transport-binding/v1" || raw.kind !== "cli") throw new TypeError("CLI effect transport binding is invalid");
  const envNames = stringList(raw.envNames, "CLI environment names", ENV_NAME), credentialEnv = stringValue(raw.credentialEnv, "CLI credential environment name", 128);
  if (!ENV_NAME.test(credentialEnv) || !envNames.includes(credentialEnv)) throw new TypeError("CLI credential environment name is outside the allowlist");
  let readback: CliEffectTransportBindingV1["readback"] = null;
  if (raw.readback !== null) { const parsed = closedRecord(raw.readback, ["operation", "argvTemplates"], [], "CLI readback binding"); readback = deepFreeze({ operation: name(parsed.operation, "CLI readback operation"), argvTemplates: templateList(parsed.argvTemplates, "CLI readback argv") }); }
  return deepFreeze({ v: "reelier.effect-transport-binding/v1", kind: "cli", operation: name(raw.operation, "CLI operation"), executable: stringValue(raw.executable, "CLI executable", 1_024), argvTemplates: templateList(raw.argvTemplates, "CLI argv"), credentialEnv, envNames, responseProjection: projectionList(raw.responseProjection), readback });
}

function bindContract(contract: ToolEffectContractV1, binding: EffectTransportBindingV1, bindingDigest: string): void {
  if (contract.operation !== binding.operation || contract.operationDigest !== bindingDigest) throw new TypeError("effect transport binding digest does not match the signed contract");
  if (binding.kind === "mcp" && contract.schemaDigest !== binding.toolSchemaDigest) throw new TypeError("MCP tool schema digest does not match the signed contract");
  if (binding.kind === "http" && contract.schemaDigest !== binding.requestSchemaDigest) throw new TypeError("HTTP request schema digest does not match the signed contract");
  if ((contract.readback === null) !== (binding.readback === null)) throw new TypeError("effect transport readback does not match the signed contract");
  if (contract.readback && binding.readback && contract.readback.operation !== binding.readback.operation) throw new TypeError("effect transport readback operation does not match the signed contract");
  if (contract.readback && (binding.kind === "http" || binding.kind === "cli") && authorityDigest(contract.readback.projection) !== authorityDigest(binding.responseProjection)) throw new TypeError("effect transport response projection does not match the signed contract");
}

function parseModelInput(value: unknown, contract: ToolEffectContractV1): Readonly<Record<string, unknown>> {
  const raw = closedRecord(value, contract.model.fields, [], "model input"), model = snapshotJson(raw, "model input", contract.model.maxBytes);
  if (!model || typeof model !== "object" || Array.isArray(model)) throw new TypeError("model input must be a closed object");
  if (authorityCanonicalBytes(model).byteLength > contract.model.maxBytes) throw new TypeError("model input exceeds its signed byte bound");
  return model as Readonly<Record<string, unknown>>;
}

function parseHostBindings(value: unknown): EffectTransportHostBindingsV1 { const raw = closedRecord(value, ["credential", "account", "destination", "limit"], [], "host bindings"); return deepFreeze({ credential: stringValue(raw.credential, "host credential", 65_536), account: stringValue(raw.account, "host account", 4_096), destination: stringValue(raw.destination, "host destination", 4_096), limit: stringValue(raw.limit, "host limit", 4_096) }); }

function parseTrustedExecutorCallbacks(value: unknown): TrustedEffectTransportExecutorCallbacksV1 {
  const raw = closedCallbackRecord(value, [], ["mcp", "http", "cli"], "trusted executor callbacks");
  const result: { mcp?: TrustedEffectTransportExecutorCallbacksV1["mcp"]; http?: TrustedEffectTransportExecutorCallbacksV1["http"]; cli?: TrustedEffectTransportExecutorCallbacksV1["cli"] } = {};
  if (raw.mcp !== undefined) {
    const mcp = closedCallbackRecord(raw.mcp, ["inspectSchemas", "call"], [], "trusted MCP executor callbacks");
    result.mcp = Object.freeze({ inspectSchemas: callback(mcp.inspectSchemas, "trusted MCP schema callback"), call: callback(mcp.call, "trusted MCP call callback") });
  }
  if (raw.http !== undefined) {
    const http = closedCallbackRecord(raw.http, ["call"], [], "trusted HTTP executor callbacks");
    result.http = Object.freeze({ call: callback(http.call, "trusted HTTP call callback") });
  }
  if (raw.cli !== undefined) {
    const cli = closedCallbackRecord(raw.cli, ["spawn"], [], "trusted CLI executor callbacks");
    result.cli = Object.freeze({ spawn: callback(cli.spawn, "trusted CLI spawn callback") });
  }
  return Object.freeze(result);
}

function closedCallbackRecord(value: unknown, required: readonly string[], optional: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || isProxy(value)) throw new TypeError(`${label} must be a closed inert data object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${label} must be a closed inert data object`);
  const allowed = new Set([...required, ...optional]), result: Record<string, unknown> = Object.create(null);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new TypeError(`${label} contains an unknown field`);
  }
  for (const key of required) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) throw new TypeError(`${label} requires data callbacks`);
    result[key] = descriptor.value;
  }
  for (const key of optional) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) continue;
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) throw new TypeError(`${label} requires data callbacks`);
    result[key] = descriptor.value;
  }
  return result;
}

function callback<T extends (...args: never[]) => void>(value: unknown, label: string): T {
  if (typeof value !== "function" || isProxy(value)) throw new TypeError(`${label} must be an inert function returning void`);
  return value as T;
}

async function dispatch(binding: EffectTransportBindingV1, model: Readonly<Record<string, unknown>>, host: EffectTransportHostBindingsV1, executor: AnyEffectTransportExecutorCallbacksV1, authority: AnyEffectTransportExecutorAuthorityV1): Promise<EffectTransportProviderResponseV1> {
  const publicHost = deepFreeze({ account: host.account, destination: host.destination, limit: host.limit });
  if (binding.kind === "mcp") { if (!executor.mcp) throw new Error("MCP effect transport executor is unavailable"); await assertMcpSchemas(executor.mcp, binding.server, binding.tool, binding.serverSchemaDigest, binding.toolSchemaDigest); return providerBoundary("MCP", sink => executor.mcp!.call(deepFreeze({ server: binding.server, tool: binding.tool, serverSchemaDigest: binding.serverSchemaDigest, toolSchemaDigest: binding.toolSchemaDigest, arguments: { model, host: publicHost }, credential: host.credential, authority }), sink)); }
  if (binding.kind === "http") { if (!executor.http) throw new Error("HTTP effect transport executor is unavailable"); const url = joinUrl(binding.origin, renderTemplate(binding.pathTemplate, model, publicHost, true)); return providerBoundary("HTTP", sink => executor.http!.call(deepFreeze({ method: binding.method, url, body: { model, host: publicHost }, credential: host.credential, requestSchemaDigest: binding.requestSchemaDigest, authority }), sink)); }
  if (!executor.cli) throw new Error("CLI effect transport executor is unavailable");
  return providerBoundary("CLI", sink => executor.cli!.spawn(deepFreeze({ executable: binding.executable, argv: binding.argvTemplates.map(item => renderTemplate(item, model, publicHost, false)), env: { [binding.credentialEnv]: host.credential }, authority }), sink));
}

async function readback(binding: EffectTransportBindingV1, model: Readonly<Record<string, unknown>>, host: EffectTransportHostBindingsV1, executor: AnyEffectTransportExecutorCallbacksV1, authority: AnyEffectTransportExecutorAuthorityV1): Promise<EffectTransportProviderResponseV1> {
  const publicHost = deepFreeze({ account: host.account, destination: host.destination, limit: host.limit });
  if (binding.kind === "mcp" && binding.readback) { if (!executor.mcp) throw new Error("MCP effect transport executor is unavailable"); await assertMcpSchemas(executor.mcp, binding.server, binding.readback.tool, binding.serverSchemaDigest, binding.readback.toolSchemaDigest); return providerBoundary("MCP readback", sink => executor.mcp!.call(deepFreeze({ server: binding.server, tool: binding.readback!.tool, serverSchemaDigest: binding.serverSchemaDigest, toolSchemaDigest: binding.readback!.toolSchemaDigest, arguments: { model, host: publicHost }, credential: host.credential, authority }), sink)); }
  if (binding.kind === "http" && binding.readback) { if (!executor.http) throw new Error("HTTP effect transport executor is unavailable"); const url = joinUrl(binding.origin, renderTemplate(binding.readback.pathTemplate, model, publicHost, true)); return providerBoundary("HTTP readback", sink => executor.http!.call(deepFreeze({ method: binding.readback!.method, url, body: null, credential: host.credential, requestSchemaDigest: binding.readback!.requestSchemaDigest, authority }), sink)); }
  if (binding.kind === "cli" && binding.readback) { if (!executor.cli) throw new Error("CLI effect transport executor is unavailable"); return providerBoundary("CLI readback", sink => executor.cli!.spawn(deepFreeze({ executable: binding.executable, argv: binding.readback!.argvTemplates.map(item => renderTemplate(item, model, publicHost, false)), env: { [binding.credentialEnv]: host.credential }, authority }), sink)); }
  throw new Error("effect transport readback is unavailable");
}

function executorAuthority(state: DispatchRequestState, contractDigest: string, bindingDigest: string, governed: boolean): AnyEffectTransportExecutorAuthorityV1 {
  if (!governed) return deepFreeze({ contractDigest, bindingDigest, reservationId: state.reservation.reservationId });
  const requestId = state.reservation.intent.requestId;
  if (typeof requestId !== "string" || requestId.length === 0) throw new TypeError("governed effect transport requires an authenticated durable request ID");
  return deepFreeze({ contractDigest, bindingDigest, reservationId: state.reservation.reservationId, requestId, governedEffectDigest: state.effectDigest });
}

function providerBoundary(label: string, invoke: (sink: EffectTransportResultSinkV1) => void): Promise<EffectTransportProviderResponseV1> { return serializedBoundary(label, invoke, parseProviderResponse); }
async function assertMcpSchemas(executor: NonNullable<AnyEffectTransportExecutorCallbacksV1["mcp"]>, server: string, tool: string, serverSchemaDigest: string, toolSchemaDigest: string): Promise<void> {
  const actual = await serializedBoundary("MCP schema inspection", sink => executor.inspectSchemas(deepFreeze({ server, tool }), sink), parseMcpSchemas);
  if (actual.serverSchemaDigest !== serverSchemaDigest || actual.toolSchemaDigest !== toolSchemaDigest) throw new Error("MCP schema drift refused consequential call");
}
function serializedBoundary<T>(label: string, invoke: (sink: EffectTransportResultSinkV1) => void, parse: (value: unknown) => T): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false, invoking = true;
    const synchronous = { pending: null as (() => void) | null };
    const settle = (action: () => void): void => { if (settled || synchronous.pending) return; if (invoking) { synchronous.pending = action; return; } settled = true; action(); };
    const failure = (): void => settle(() => reject(new Error(`${label} effect transport boundary failed`)));
    const success = (serializedJson: string): void => settle(() => { try { resolve(parse(serializedJson)); } catch { reject(new Error(`${label} effect transport boundary failed`)); } });
    const sink = Object.freeze(Object.assign(Object.create(null) as Record<string, unknown>, { success, failure })) as EffectTransportResultSinkV1;
    try {
      const returned = invoke(sink);
      invoking = false;
      if (returned !== undefined) { synchronous.pending = null; failure(); }
      else { const first = synchronous.pending; synchronous.pending = null; if (first) { settled = true; first(); } }
    } catch { invoking = false; synchronous.pending = null; failure(); }
  });
}
function parseObservationAuthKey(value: unknown): string { if (typeof value !== "string" || !AUTH_KEY.test(value)) throw new TypeError("effect transport observation authentication key must be exactly 256 bits"); return value; }
function provenanceAuthenticator(key: string, value: unknown): string { return createHmac("sha256", Buffer.from(key, "hex")).update(authorityCanonicalBytes(value)).digest("hex").slice(0, 32); }
function parseMcpSchemas(value: unknown): Readonly<{ serverSchemaDigest: string; toolSchemaDigest: string }> { const raw = closedRecord(parseSerializedJson(value, "MCP schema envelope", 4_096), ["serverSchemaDigest", "toolSchemaDigest"], [], "MCP schema envelope"); return deepFreeze({ serverSchemaDigest: digest(raw.serverSchemaDigest, "MCP runtime server schema"), toolSchemaDigest: digest(raw.toolSchemaDigest, "MCP runtime tool schema") }); }
function parseProviderResponse(value: unknown): EffectTransportProviderResponseV1 { const detached = snapshotJson(parseSerializedJson(value, "provider response envelope", 1_048_576), "provider response", 1_048_576), raw = closedRecord(detached, ["outcome", "data"], [], "provider response"); return deepFreeze({ outcome: stringValue(raw.outcome, "provider outcome", 256), data: raw.data }); }
function parseSerializedJson(value: unknown, label: string, maxBytes: number): unknown { if (typeof value !== "string" || Buffer.byteLength(value) > maxBytes) throw new TypeError(`${label} must be bounded serialized JSON`); try { return JSON.parse(value) as unknown; } catch { throw new TypeError(`${label} is invalid`); } }
function dispatchOutcome(contract: ToolEffectContractV1, bindingDigest: string, response: EffectTransportProviderResponseV1): DispatchOutcome { const category = resultCategory(contract, response.outcome), resultDigest = responseDigest(bindingDigest, response); if (category === "success") return Object.freeze({ kind: "acknowledged", resultDigest, reconciliationStatus: contract.readback ? "not-attempted" : "unavailable", normalizedProjectionDigest: null }); if (category === "definitive-failure" || category === "conflict") return Object.freeze({ kind: "definitive-failure", resultDigest }); return Object.freeze({ kind: "ambiguous", resultDigest, reconciliationStatus: "not-attempted", normalizedProjectionDigest: null }); }
function resultCategory(contract: ToolEffectContractV1, outcome: string): "success" | "conflict" | "definitive-failure" | "ambiguity" { if (contract.result.success.includes(outcome)) return "success"; if (contract.result.conflict.includes(outcome)) return "conflict"; if (contract.result.definitiveFailure.includes(outcome)) return "definitive-failure"; return "ambiguity"; }
function unavailableOutcome(bindingDigest: string, prior: DispatchOutcome): DispatchOutcome { return Object.freeze({ kind: prior.kind, resultDigest: authorityDigest({ v: "reelier.effect-readback-unavailable/v1", bindingDigest, priorResultDigest: prior.resultDigest }), reconciliationStatus: "unavailable", normalizedProjectionDigest: null }); }
function responseDigest(bindingDigest: string, response: EffectTransportProviderResponseV1): string { return authorityDigest({ v: "reelier.effect-transport-result/v1", bindingDigest, outcome: response.outcome, data: response.data }); }
function bindDispatchState(state: DispatchRequestState, effect: CompiledEffectTransportV1["effect"], contractDigest: string): void { if (!state || state.effectDigest !== contractDigest || authorityDigest(state.effect) !== authorityDigest(effect)) throw new TypeError("dispatch state does not bind the compiled effect contract and model input"); }

function projectResponse(data: unknown, projections: readonly string[]): Readonly<Record<string, unknown>> | null {
  const result: Record<string, unknown> = {};
  for (const pointer of projections) { let current: unknown = data; for (const encoded of pointer.slice(1).split("/")) { const segment = encoded.replace(/~1/gu, "/").replace(/~0/gu, "~"); if (!current || typeof current !== "object" || Array.isArray(current) && !/^(?:0|[1-9][0-9]*)$/u.test(segment)) return null; const descriptor = Object.getOwnPropertyDescriptor(current, segment); if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) return null; current = descriptor.value; } result[pointer] = current; }
  return deepFreeze(result);
}

function renderTemplate(template: string, model: Readonly<Record<string, unknown>>, host: Readonly<{ account: string; destination: string; limit: string }>, urlEncode: boolean): string { return template.replace(/\{(model|host)\.([A-Za-z0-9._:-]+)\}/gu, (_match, scope: string, field: string) => { const value = scope === "model" ? model[field] : host[field as keyof typeof host]; if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") throw new TypeError("transport template field must be a scalar"); return urlEncode ? encodeURIComponent(String(value)) : String(value); }); }
function joinUrl(origin: string, path: string): string {
  validateHttpPath(path);
  const result = new URL(path, origin);
  if (result.origin !== origin || result.search || result.hash || result.pathname !== path) throw new TypeError("HTTP resolved path does not exactly match the reviewed path");
  return `${origin}${path}`;
}

function validateTemplateValues(binding: EffectTransportBindingV1, model: Readonly<Record<string, unknown>>): void {
  const templates = binding.kind === "http"
    ? [binding.pathTemplate, ...(binding.readback ? [binding.readback.pathTemplate] : [])]
    : binding.kind === "cli"
      ? [...binding.argvTemplates, ...(binding.readback?.argvTemplates ?? [])]
      : [];
  for (const template of templates) {
    for (const match of template.matchAll(/\{model\.([A-Za-z0-9._:-]+)\}/gu)) {
      const value = model[match[1]!];
      if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") throw new TypeError("transport template model field must be a scalar");
    }
  }
}

function closedRecord(value: unknown, required: readonly string[], optional: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || isProxy(value)) throw new TypeError(`${label} must be an inert closed object`);
  const prototype = Object.getPrototypeOf(value); if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${label} has an unsupported prototype`);
  const allowed = new Set([...required, ...optional]), keys = Reflect.ownKeys(value); if (keys.length > 64 || keys.some(key => typeof key !== "string" || !allowed.has(key))) throw new TypeError(`${label} has an unknown field or is too large`);
  const result: Record<string, unknown> = {};
  for (const key of required) { const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) throw new TypeError(`${label} has a missing, hidden, or accessor field`); result[key] = descriptor.value; }
  for (const key of optional) { const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!descriptor) continue; if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) throw new TypeError(`${label} has a hidden or accessor field`); result[key] = descriptor.value; }
  return result;
}

function snapshotJson(value: unknown, label: string, maxBytes: number, depth = 0, seen = new WeakSet<object>(), budget = { nodes: 0, bytes: 0 }): unknown {
  if (depth > 24 || ++budget.nodes > 4_096) throw new TypeError(`${label} is not bounded`);
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") { budget.bytes += Buffer.byteLength(value); if (budget.bytes > maxBytes) throw new TypeError(`${label} is too large`); return value; }
  if (typeof value === "number") { if (!Number.isFinite(value)) throw new TypeError(`${label} contains a non-finite number`); return value; }
  if (!value || typeof value !== "object" || isProxy(value)) throw new TypeError(`${label} contains a proxy, callable, or non-JSON value`);
  if (seen.has(value)) throw new TypeError(`${label} contains cyclic or shared identity`); seen.add(value);
  const prototype = Object.getPrototypeOf(value), array = Array.isArray(value); if (prototype !== Object.prototype && prototype !== null && prototype !== Array.prototype) throw new TypeError(`${label} has an unsupported prototype`);
  const keys = Reflect.ownKeys(value); if (keys.length > 256) throw new TypeError(`${label} is too large`);
  if (array) { if (value.length > 256 || keys.some(key => key === "length" ? false : typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(key) || Number(key) >= value.length)) throw new TypeError(`${label} contains a sparse or named array property`); const result: unknown[] = []; for (let index = 0; index < value.length; index++) { const descriptor = Object.getOwnPropertyDescriptor(value, String(index)); if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) throw new TypeError(`${label} contains an accessor or sparse array`); result.push(snapshotJson(descriptor.value, label, maxBytes, depth + 1, seen, budget)); } return Object.freeze(result); }
  const result: Record<string, unknown> = {};
  for (const key of keys) { if (typeof key !== "string") throw new TypeError(`${label} contains a symbol property`); const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) throw new TypeError(`${label} contains a hidden or accessor property`); budget.bytes += Buffer.byteLength(key); if (budget.bytes > maxBytes) throw new TypeError(`${label} is too large`); result[key] = snapshotJson(descriptor.value, label, maxBytes, depth + 1, seen, budget); }
  return deepFreeze(result);
}

function templateList(value: unknown, label: string): readonly string[] { const items = stringList(value, label, /^.{1,4096}$/u); for (const item of items) validateTemplate(item, label); return items; }
function validateTemplate(value: string, label: string): void { for (const match of value.matchAll(/\{([^{}]+)\}/gu)) { const [scope, field] = match[1]!.split("."); if (scope === "host" && HOST_TEMPLATE_FIELDS.has(field ?? "")) continue; if (scope === "model" && field && NAME.test(field)) continue; throw new TypeError(`${label} contains an invalid or secret template field`); } }
function projectionList(value: unknown): readonly string[] { const values = stringList(value, "response projection", /^\/(?:[^~/]|~[01])+(?:\/(?:[^~/]|~[01])+)*$/u); if (values.length === 0) throw new TypeError("response projection cannot be empty"); return values; }
function stringList(value: unknown, label: string, pattern: RegExp): readonly string[] { if (!Array.isArray(value) || isProxy(value) || value.length > 64) throw new TypeError(`${label} must be a bounded argv-style array`); const result: string[] = []; for (let index = 0; index < value.length; index++) { const descriptor = Object.getOwnPropertyDescriptor(value, String(index)); if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value") || typeof descriptor.value !== "string" || !pattern.test(descriptor.value)) throw new TypeError(`${label} contains an invalid or accessor entry`); result.push(descriptor.value); } if (new Set(result).size !== result.length) throw new TypeError(`${label} must be unique`); return Object.freeze(result); }
function pathTemplate(value: unknown): string { const result = stringValue(value, "HTTP path template", 4_096); validateHttpPath(result); validateTemplate(result, "HTTP path template"); return result; }
function validateHttpPath(value: string): void {
  if (!value.startsWith("/")) throw new TypeError("HTTP path must be absolute");
  let decoded = value;
  for (let depth = 0; depth < 8; depth++) {
    if (/[?#\\\u2044\u2215\u2216\u29f8\uff0f\uff3c]/u.test(decoded) || /%(?:2f|5c)/iu.test(decoded) || decoded.split("/").some(segment => segment === "." || segment === "..")) throw new TypeError("HTTP path contains a forbidden separator, query, fragment, or dot segment");
    let next: string;
    try { next = decodeURIComponent(decoded); } catch { throw new TypeError("HTTP path contains invalid encoding"); }
    if (next === decoded) return;
    decoded = next;
  }
  throw new TypeError("HTTP path encoding is too deeply nested");
}
function httpMethod(value: unknown): string { if (typeof value !== "string" || !HTTP_METHODS.has(value)) throw new TypeError("HTTP method is invalid"); return value; }
function httpOrigin(value: unknown): string { const result = stringValue(value, "HTTP origin", 2_048); let parsed: URL; try { parsed = new URL(result); } catch { throw new TypeError("HTTP origin is invalid"); } if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.origin !== result) throw new TypeError("HTTP origin must be an exact HTTP origin without credentials"); return result; }
function name(value: unknown, label: string): string { if (typeof value !== "string" || !NAME.test(value)) throw new TypeError(`${label} is invalid`); return value; }
function digest(value: unknown, label: string): string { if (typeof value !== "string" || !SHA.test(value)) throw new TypeError(`${label} must be an exact digest`); return value; }
function stringValue(value: unknown, label: string, max: number): string { if (typeof value !== "string" || value.length === 0 || Buffer.byteLength(value) > max) throw new TypeError(`${label} is invalid or too large`); return value; }
function deepFreeze<T>(value: T): T { if (value && typeof value === "object" && !Object.isFrozen(value)) { for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]); Object.freeze(value); } return value; }
