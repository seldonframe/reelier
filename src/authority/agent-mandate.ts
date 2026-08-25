import { randomUUID } from "node:crypto";
import { types as utilTypes } from "node:util";
import { authorityDigest } from "./wire.js";

export type AgentHarnessV1 = "eve" | "codex" | "claude-code" | "cursor" | "grok-bot" | "grok-build" | "hermes";
export type AgentDestinationV1 = "github" | "npm" | "mcp-registry" | "ghcr";
/** Neutral references deliberately avoid provider enums; V1 remains byte-compatible. */
export interface AgentMandateV2 { readonly v: "reelier.agent-mandate/v2"; readonly agentId: string; readonly revision: number; readonly rolePack: string; readonly harnesses: readonly string[]; readonly bindings: readonly { readonly provider: string; readonly account: string; readonly destinations: readonly string[] }[]; readonly outcomeKinds: readonly string[]; readonly limits: { readonly maxConcurrentMissions: number; readonly maxChildFanout: number; readonly maxChangedFiles: number; readonly maxChangedBytes: number }; readonly humanConfirmation: "creation-only"; readonly exceptionBehavior: "stop-and-report"; readonly validFrom: string; readonly validUntil: string; readonly revocationGeneration: number; }
export type AgentMandate = AgentMandateV1 | AgentMandateV2;
export interface MandatedMissionV2 { readonly v: "reelier.mandated-mission/v2"; readonly agentId: string; readonly mandateDigest: string; readonly promptDigest: string; readonly outcomeKind: string; readonly harness: string; readonly binding: { readonly provider: string; readonly account: string; readonly destination: string }; readonly childFanout: number; readonly maxChangedFiles: number; readonly maxChangedBytes: number; readonly humanConfirmation: "not-required"; readonly exceptionBehavior: "stop-and-report"; readonly issuedAt: string; }
export type ReconciledOutcomeStatusV1 = "verified" | "failed" | "unchecked" | "absent";

export interface AgentMandateV1 {
  readonly v: "reelier.agent-mandate/v1";
  readonly agentId: string;
  readonly revision: number;
  readonly rolePack: string;
  readonly harnesses: readonly AgentHarnessV1[];
  readonly connectors: readonly Readonly<{ kind: string; account: string }>[];
  readonly outcomeKinds: readonly string[];
  readonly destinations: readonly AgentDestinationV1[];
  readonly limits: Readonly<{ maxConcurrentMissions: number; maxChildFanout: number; maxChangedFiles: number; maxChangedBytes: number }>;
  readonly humanConfirmation: "creation-only";
  readonly exceptionBehavior: "stop-and-report";
  readonly validFrom: string;
  readonly validUntil: string;
  readonly revocationGeneration: number;
}

export interface AgentDocumentV1 { readonly mandate: AgentMandateV1; readonly prose: string }

export interface MandateLockV1 {
  readonly v: "reelier.mandate-lock/v1";
  readonly agentId: string;
  readonly mandateDigest: string;
  readonly environmentId: string;
  readonly trustDomainDigest: string;
  readonly standingAuthorityDigest: string;
  readonly activationProofDigest: string;
  readonly validFrom: string;
  readonly validUntil: string;
  readonly revocationGeneration: number;
}

export interface VerifiedMandateLockV1 extends MandateLockV1 { readonly mandate: AgentMandateV1 }

export interface MandatedMissionV1 {
  readonly v: "reelier.mandated-mission/v1";
  readonly agentId: string;
  readonly mandateDigest: string;
  readonly missionId: string;
  readonly grantId: string;
  readonly allocationId: string;
  readonly sessionId: string;
  readonly promptDigest: string;
  readonly outcomeKind: string;
  readonly harness: AgentHarnessV1;
  readonly connector: Readonly<{ kind: string; account: string }>;
  readonly destination: AgentDestinationV1;
  readonly childFanout: number;
  readonly maxChangedFiles: number;
  readonly maxChangedBytes: number;
  readonly humanConfirmation: "not-required";
  readonly exceptionBehavior: "stop-and-report";
  readonly issuedAt: string;
}

export interface ReconciledOutcomeV1 {
  readonly v: "reelier.reconciled-outcome/v1";
  readonly outcomeId: string;
  readonly agentId: string;
  readonly mandateDigest: string;
  readonly missionId: string;
  readonly status: ReconciledOutcomeStatusV1;
  readonly completedAt: string;
  readonly receiptGraphDigest: string | null;
  readonly exception: Readonly<{ code: string; message: string }> | null;
}

const mandateFields = ["v", "agentId", "revision", "rolePack", "harnesses", "connectors", "outcomeKinds", "destinations", "limits", "humanConfirmation", "exceptionBehavior", "validFrom", "validUntil", "revocationGeneration"] as const;
const harnesses = new Set<AgentHarnessV1>(["eve", "codex", "claude-code", "cursor", "grok-bot", "grok-build", "hermes"]);
const destinations = new Set<AgentDestinationV1>(["github", "npm", "mcp-registry", "ghcr"]);
const idPattern = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/u;
const accountPattern = /^[A-Za-z0-9](?:[A-Za-z0-9._\/-]{0,254}[A-Za-z0-9])?$/u;
const digestPattern = /^sha256:[a-f0-9]{64}$/u;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

export const AGENT_MANDATE_CONTRACT_V1 = Object.freeze({
  v: "reelier.agent-mandate-contract/v1" as const,
  document: Object.freeze({ boundary: "markdown-json-frontmatter", mandateVersion: "reelier.agent-mandate/v1", proseAuthority: "none" }),
  lock: Object.freeze({ version: "reelier.mandate-lock/v1", portability: "environment-bound", credentials: "forbidden" }),
  mission: Object.freeze({ version: "reelier.mandated-mission/v1", attenuation: "subset-only", humanConfirmation: "not-required" }),
  outcome: Object.freeze({ version: "reelier.reconciled-outcome/v1", states: Object.freeze(["verified", "failed", "unchecked", "absent"]), completeness: "nonclaim" }),
});
export const AGENT_MANDATE_CONTRACT_V1_DIGEST = authorityDigest(AGENT_MANDATE_CONTRACT_V1);

function snapshot(value: unknown, depth = 0): unknown {
  if (depth > 12) throw new TypeError("agent mandate wire value is too deeply nested");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") { if (!Number.isFinite(value)) throw new TypeError("agent mandate wire number is invalid"); return value; }
  if (typeof value !== "object" || utilTypes.isProxy(value)) throw new TypeError("agent mandate wire value must be inert plain data");
  if (Array.isArray(value)) {
    if (value.length > 64) throw new TypeError("agent mandate wire array is too large");
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.keys(descriptors).some(key => key !== "length" && !/^(0|[1-9]\d*)$/u.test(key))) throw new TypeError("agent mandate array has non-index properties");
    const result: unknown[] = [];
    for (let index = 0; index < value.length; index++) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw new TypeError("agent mandate arrays must be dense inert data");
      result.push(snapshot(descriptor.value, depth + 1));
    }
    return result;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError("agent mandate wire object has an invalid prototype");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const result: Record<string, unknown> = Object.create(null);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!("value" in descriptor) || !descriptor.enumerable) throw new TypeError("agent mandate wire object must contain enumerable data properties only");
    result[key] = snapshot(descriptor.value, depth + 1);
  }
  if (Object.getOwnPropertySymbols(value).length) throw new TypeError("agent mandate wire object cannot contain symbols");
  return result;
}

function record(value: unknown, fields: readonly string[], label: string): Record<string, unknown> {
  const item = snapshot(value);
  if (!item || typeof item !== "object" || Array.isArray(item)) throw new TypeError(`${label} must be a closed object`);
  const keys = Object.keys(item);
  if (keys.length !== fields.length || keys.some(key => !fields.includes(key))) throw new TypeError(`${label} contains missing or unknown fields`);
  return item as Record<string, unknown>;
}

function text(value: unknown, label: string, pattern = idPattern): string {
  if (typeof value !== "string" || !pattern.test(value)) throw new TypeError(`${label} is invalid`);
  return value;
}

function digest(value: unknown, label: string): string {
  if (typeof value !== "string" || !digestPattern.test(value)) throw new TypeError(`${label} must be an exact SHA-256 digest`);
  return value;
}

function integer(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) throw new TypeError(`${label} is outside its closed bounds`);
  return value as number;
}

function timestamp(value: unknown, label: string): readonly [string, number] {
  if (typeof value !== "string" || !timestampPattern.test(value)) throw new TypeError(`${label} must be a canonical UTC timestamp`);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) throw new TypeError(`${label} must be a real canonical UTC timestamp`);
  return [value, milliseconds];
}

function uniqueTextArray(value: unknown, label: string, allowed?: ReadonlySet<string>): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 32) throw new TypeError(`${label} must be a nonempty bounded array`);
  const result = value.map(item => text(item, label));
  if (new Set(result).size !== result.length || (allowed && result.some(item => !allowed.has(item)))) throw new TypeError(`${label} contains a duplicate or unsupported value`);
  return Object.freeze(result);
}

function freeze<T extends object>(value: T): Readonly<T> {
  for (const child of Object.values(value)) if (child && typeof child === "object" && !Object.isFrozen(child)) freeze(child as object);
  return Object.freeze(value);
}

export function parseAgentMandateV1(value: unknown): AgentMandateV1 {
  const item = record(value, mandateFields, "agent mandate");
  if (item.v !== "reelier.agent-mandate/v1" || item.humanConfirmation !== "creation-only" || item.exceptionBehavior !== "stop-and-report") throw new TypeError("agent mandate version or governance mode is invalid");
  const [validFrom, from] = timestamp(item.validFrom, "agent mandate validFrom");
  const [validUntil, until] = timestamp(item.validUntil, "agent mandate validUntil");
  if (from >= until) throw new TypeError("agent mandate validity interval is empty or reversed");
  const connectors = item.connectors;
  if (!Array.isArray(connectors) || connectors.length === 0 || connectors.length > 16) throw new TypeError("agent mandate connectors must be nonempty and bounded");
  const parsedConnectors = connectors.map(value => {
    const connector = record(value, ["kind", "account"], "agent mandate connector");
    return Object.freeze({ kind: text(connector.kind, "connector kind"), account: text(connector.account, "connector account", accountPattern) });
  });
  if (new Set(parsedConnectors.map(value => `${value.kind}\0${value.account}`)).size !== parsedConnectors.length) throw new TypeError("agent mandate connectors must be unique");
  const limits = record(item.limits, ["maxConcurrentMissions", "maxChildFanout", "maxChangedFiles", "maxChangedBytes"], "agent mandate limits");
  return freeze({
    v: "reelier.agent-mandate/v1" as const,
    agentId: text(item.agentId, "agent ID"),
    revision: integer(item.revision, "agent revision", 1, 1_000_000),
    rolePack: text(item.rolePack, "agent role pack"),
    harnesses: uniqueTextArray(item.harnesses, "agent harnesses", harnesses) as readonly AgentHarnessV1[],
    connectors: Object.freeze(parsedConnectors),
    outcomeKinds: uniqueTextArray(item.outcomeKinds, "agent outcome kinds"),
    destinations: uniqueTextArray(item.destinations, "agent destinations", destinations) as readonly AgentDestinationV1[],
    limits: Object.freeze({
      maxConcurrentMissions: integer(limits.maxConcurrentMissions, "maximum concurrent missions", 1, 128),
      maxChildFanout: integer(limits.maxChildFanout, "maximum child fanout", 0, 1024),
      maxChangedFiles: integer(limits.maxChangedFiles, "maximum changed files", 0, 100_000),
      maxChangedBytes: integer(limits.maxChangedBytes, "maximum changed bytes", 0, 1_073_741_824),
    }),
    humanConfirmation: "creation-only" as const,
    exceptionBehavior: "stop-and-report" as const,
    validFrom,
    validUntil,
    revocationGeneration: integer(item.revocationGeneration, "agent revocation generation", 0, Number.MAX_SAFE_INTEGER),
  }) as AgentMandateV1;
}

export function parseAgentDocumentV1(value: unknown): AgentDocumentV1 {
  if (typeof value !== "string") throw new TypeError("AGENT.md must be UTF-8 text");
  const withoutBom = value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
  if (/\r(?!\n)/u.test(withoutBom)) throw new TypeError("AGENT.md contains unsupported lone carriage returns");
  const document = withoutBom.replaceAll("\r\n", "\n");
  if (!document.startsWith("---\n")) throw new TypeError("AGENT.md must start with a mandate frontmatter boundary");
  const close = document.indexOf("\n---\n", 4);
  if (close < 0) throw new TypeError("AGENT.md must contain one closed frontmatter block");
  const prose = document.slice(close + 5);
  if (!prose.trim()) throw new TypeError("AGENT.md must contain nonempty agent instructions");
  const frontmatter = document.slice(4, close);
  let wire: unknown;
  try { wire = JSON.parse(frontmatter); } catch { throw new TypeError("AGENT.md mandate frontmatter must be one JSON object"); }
  if (JSON.stringify(wire) !== frontmatter) throw new TypeError("AGENT.md mandate frontmatter must be unambiguous compact JSON");
  return Object.freeze({ mandate: parseAgentMandateV1(wire), prose });
}

export function digestAgentMandateV1(value: unknown): string { return authorityDigest(parseAgentMandateV1(value)); }

export function parseAgentMandateV2(value: unknown): AgentMandateV2 {
  const item = record(value, ["v", "agentId", "revision", "rolePack", "harnesses", "bindings", "outcomeKinds", "limits", "humanConfirmation", "exceptionBehavior", "validFrom", "validUntil", "revocationGeneration"], "agent mandate V2");
  if (item.v !== "reelier.agent-mandate/v2" || item.humanConfirmation !== "creation-only" || item.exceptionBehavior !== "stop-and-report") throw new TypeError("agent mandate V2 version or governance mode is invalid");
  const [validFrom, from] = timestamp(item.validFrom, "agent mandate V2 validFrom"); const [validUntil, until] = timestamp(item.validUntil, "agent mandate V2 validUntil"); if (from >= until) throw new TypeError("agent mandate V2 validity interval is empty or reversed");
  const harnessesV2 = uniqueTextArray(item.harnesses, "agent mandate V2 harnesses"); const outcomeKinds = uniqueTextArray(item.outcomeKinds, "agent mandate V2 outcome kinds");
  if (!Array.isArray(item.bindings) || item.bindings.length === 0 || item.bindings.length > 16) throw new TypeError("agent mandate V2 bindings must be nonempty and bounded");
  const bindings = item.bindings.map(value => { const binding = record(value, ["provider", "account", "destinations"], "agent mandate V2 binding"); return freeze({ provider: text(binding.provider, "binding provider"), account: text(binding.account, "binding account", accountPattern), destinations: uniqueTextArray(binding.destinations, "binding destinations") }); });
  if (new Set(bindings.map(binding => `${binding.provider}\0${binding.account}`)).size !== bindings.length) throw new TypeError("agent mandate V2 bindings must be unique");
  const limits = record(item.limits, ["maxConcurrentMissions", "maxChildFanout", "maxChangedFiles", "maxChangedBytes"], "agent mandate V2 limits");
  return freeze({ v: "reelier.agent-mandate/v2" as const, agentId: text(item.agentId, "agent V2 ID"), revision: integer(item.revision, "agent V2 revision", 1, 1_000_000), rolePack: text(item.rolePack, "agent V2 role pack"), harnesses: harnessesV2, bindings: Object.freeze(bindings), outcomeKinds, limits: freeze({ maxConcurrentMissions: integer(limits.maxConcurrentMissions, "maximum concurrent missions", 1, 128), maxChildFanout: integer(limits.maxChildFanout, "maximum child fanout", 0, 1024), maxChangedFiles: integer(limits.maxChangedFiles, "maximum changed files", 0, 100_000), maxChangedBytes: integer(limits.maxChangedBytes, "maximum changed bytes", 0, 1_073_741_824) }), humanConfirmation: "creation-only" as const, exceptionBehavior: "stop-and-report" as const, validFrom, validUntil, revocationGeneration: integer(item.revocationGeneration, "agent V2 revocation generation", 0, Number.MAX_SAFE_INTEGER) });
}
export function digestAgentMandateV2(value: unknown): string { return authorityDigest(parseAgentMandateV2(value)); }
export function parseAgentMandate(value: unknown): AgentMandate { if (!value || typeof value !== "object" || Array.isArray(value) || utilTypes.isProxy(value)) throw new TypeError("agent mandate version is invalid"); const descriptor = Object.getOwnPropertyDescriptor(value, "v"); if (!descriptor || !Object.hasOwn(descriptor, "value")) throw new TypeError("agent mandate version is invalid"); return descriptor.value === "reelier.agent-mandate/v1" ? parseAgentMandateV1(value) : parseAgentMandateV2(value); }

const missionRequestV2Fields = ["mandate", "promptDigest", "outcomeKind", "harness", "binding", "requestedChildFanout", "requestedChangedFiles", "requestedChangedBytes", "now"] as const;
function snapshotMissionRequestV2(value: unknown): Record<(typeof missionRequestV2Fields)[number], unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || utilTypes.isProxy(value)) throw new TypeError("mission request V2 must be inert plain data");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError("mission request V2 has an invalid prototype");
  if (Object.getOwnPropertySymbols(value).length) throw new TypeError("mission request V2 cannot contain symbols");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Object.keys(descriptors);
  if (keys.length !== missionRequestV2Fields.length || keys.some(key => !missionRequestV2Fields.includes(key as (typeof missionRequestV2Fields)[number]))) throw new TypeError("mission request V2 contains missing or unknown fields");
  const result = Object.create(null) as Record<(typeof missionRequestV2Fields)[number], unknown>;
  for (const field of missionRequestV2Fields) {
    const descriptor = descriptors[field];
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) throw new TypeError("mission request V2 must contain enumerable data properties only");
    result[field] = descriptor.value;
  }
  return result;
}

export function deriveMandatedMissionV2(input: Readonly<{ mandate: unknown; promptDigest: string; outcomeKind: string; harness: string; binding: Readonly<{ provider: string; account: string; destination: string }>; requestedChildFanout: number; requestedChangedFiles: number; requestedChangedBytes: number; now: Date }>): MandatedMissionV2 {
  const request = snapshotMissionRequestV2(input);
  const mandate = parseAgentMandateV2(request.mandate);
  const now = Date.prototype.getTime.call(request.now);
  const promptDigest = digest(request.promptDigest, "mission prompt digest");
  const outcomeKind = text(request.outcomeKind, "mission outcome kind");
  const harness = text(request.harness, "mission harness");
  const binding = record(request.binding, ["provider", "account", "destination"], "mission binding");
  const parsedBinding = freeze({ provider: text(binding.provider, "mission provider"), account: text(binding.account, "mission account", accountPattern), destination: text(binding.destination, "mission destination") });
  const childFanout = integer(request.requestedChildFanout, "mission child fanout", 0, mandate.limits.maxChildFanout);
  const maxChangedFiles = integer(request.requestedChangedFiles, "mission changed files", 0, mandate.limits.maxChangedFiles);
  const maxChangedBytes = integer(request.requestedChangedBytes, "mission changed bytes", 0, mandate.limits.maxChangedBytes);
  if (!Number.isFinite(now) || now < Date.parse(mandate.validFrom) || now >= Date.parse(mandate.validUntil)) throw new TypeError("agent mandate V2 is expired or not yet valid");
  if (!mandate.harnesses.includes(harness) || !mandate.outcomeKinds.includes(outcomeKind) || !mandate.bindings.some(item => item.provider === parsedBinding.provider && item.account === parsedBinding.account && item.destinations.includes(parsedBinding.destination))) throw new TypeError("mission request is outside the active agent mandate V2");
  return freeze({ v: "reelier.mandated-mission/v2" as const, agentId: mandate.agentId, mandateDigest: digestAgentMandateV2(mandate), promptDigest, outcomeKind, harness, binding: parsedBinding, childFanout, maxChangedFiles, maxChangedBytes, humanConfirmation: "not-required" as const, exceptionBehavior: "stop-and-report" as const, issuedAt: new Date(now).toISOString() });
}

export function parseMandateLockV1(value: unknown): MandateLockV1 {
  const item = record(value, ["v", "agentId", "mandateDigest", "environmentId", "trustDomainDigest", "standingAuthorityDigest", "activationProofDigest", "validFrom", "validUntil", "revocationGeneration"], "mandate lock");
  if (item.v !== "reelier.mandate-lock/v1") throw new TypeError("mandate lock version is invalid");
  const [validFrom, from] = timestamp(item.validFrom, "mandate lock validFrom");
  const [validUntil, until] = timestamp(item.validUntil, "mandate lock validUntil");
  if (from >= until) throw new TypeError("mandate lock validity interval is empty or reversed");
  return Object.freeze({ v: "reelier.mandate-lock/v1", agentId: text(item.agentId, "lock agent ID"), mandateDigest: digest(item.mandateDigest, "lock mandate digest"), environmentId: text(item.environmentId, "lock environment ID"), trustDomainDigest: digest(item.trustDomainDigest, "lock trust-domain digest"), standingAuthorityDigest: digest(item.standingAuthorityDigest, "lock standing-authority digest"), activationProofDigest: digest(item.activationProofDigest, "lock activation-proof digest"), validFrom, validUntil, revocationGeneration: integer(item.revocationGeneration, "lock revocation generation", 0, Number.MAX_SAFE_INTEGER) });
}

export function createMandateLockV1(input: Readonly<{ mandate: unknown; environmentId: string; trustDomainDigest: string; standingAuthorityDigest: string; activationProofDigest: string; validFrom: string; validUntil: string; revocationGeneration: number }>): MandateLockV1 {
  const mandate = parseAgentMandateV1(input.mandate);
  if (input.revocationGeneration !== mandate.revocationGeneration) throw new TypeError("mandate lock revocation generation does not match the mandate");
  const lock = parseMandateLockV1({ v: "reelier.mandate-lock/v1", agentId: mandate.agentId, mandateDigest: digestAgentMandateV1(mandate), environmentId: input.environmentId, trustDomainDigest: input.trustDomainDigest, standingAuthorityDigest: input.standingAuthorityDigest, activationProofDigest: input.activationProofDigest, validFrom: input.validFrom, validUntil: input.validUntil, revocationGeneration: input.revocationGeneration });
  if (Date.parse(lock.validFrom) < Date.parse(mandate.validFrom) || Date.parse(lock.validUntil) > Date.parse(mandate.validUntil)) throw new TypeError("mandate lock widens the mandate validity interval");
  return lock;
}

export function verifyMandateLockV1(input: Readonly<{ mandate: unknown; lock: unknown; environmentId: string; trustDomainDigest: string; standingAuthorityDigest: string; revocationGeneration: number; now: Date; verifyActivationProof: (digest: string) => boolean }>): VerifiedMandateLockV1 {
  const mandate = parseAgentMandateV1(input.mandate);
  const lock = parseMandateLockV1(input.lock);
  const now = Date.prototype.getTime.call(input.now);
  const mandateFrom = Date.parse(mandate.validFrom), mandateUntil = Date.parse(mandate.validUntil), lockFrom = Date.parse(lock.validFrom), lockUntil = Date.parse(lock.validUntil);
  if (!Number.isFinite(now) || now < mandateFrom || now >= mandateUntil || now < lockFrom || now >= lockUntil) throw new TypeError("mandate lock is expired or not yet valid");
  if (lock.agentId !== mandate.agentId || lock.mandateDigest !== digestAgentMandateV1(mandate) || lock.environmentId !== input.environmentId || lock.trustDomainDigest !== input.trustDomainDigest || lock.standingAuthorityDigest !== input.standingAuthorityDigest || lock.revocationGeneration !== mandate.revocationGeneration || lock.revocationGeneration !== input.revocationGeneration) throw new TypeError("mandate lock identity or authority binding mismatch");
  if (lockFrom < mandateFrom || lockUntil > mandateUntil) throw new TypeError("mandate lock widens the mandate validity interval");
  if (typeof input.verifyActivationProof !== "function" || input.verifyActivationProof(lock.activationProofDigest) !== true) throw new TypeError("mandate activation proof is unverified");
  return Object.freeze({ ...lock, mandate });
}

export function deriveMandatedMissionV1(input: Readonly<{ mandate: unknown; promptDigest: string; outcomeKind: string; harness: AgentHarnessV1; connector: Readonly<{ kind: string; account: string }>; destination: AgentDestinationV1; requestedChildFanout: number; requestedChangedFiles: number; requestedChangedBytes: number; now: Date }>): MandatedMissionV1 {
  const mandate = parseAgentMandateV1(input.mandate);
  const now = Date.prototype.getTime.call(input.now);
  if (!Number.isFinite(now) || now < Date.parse(mandate.validFrom) || now >= Date.parse(mandate.validUntil)) throw new TypeError("agent mandate is expired or not yet valid");
  digest(input.promptDigest, "mission prompt digest");
  const connector = record(input.connector, ["kind", "account"], "mission connector");
  const parsedConnector = Object.freeze({ kind: text(connector.kind, "mission connector kind"), account: text(connector.account, "mission connector account", accountPattern) });
  if (!mandate.outcomeKinds.includes(input.outcomeKind) || !mandate.harnesses.includes(input.harness) || !mandate.destinations.includes(input.destination) || !mandate.connectors.some(value => value.kind === parsedConnector.kind && value.account === parsedConnector.account)) throw new TypeError("mission request is outside the active agent mandate");
  const childFanout = integer(input.requestedChildFanout, "mission child fanout", 0, mandate.limits.maxChildFanout);
  const maxChangedFiles = integer(input.requestedChangedFiles, "mission changed files", 0, mandate.limits.maxChangedFiles);
  const maxChangedBytes = integer(input.requestedChangedBytes, "mission changed bytes", 0, mandate.limits.maxChangedBytes);
  const missionId = `mission-${randomUUID()}`;
  return Object.freeze({ v: "reelier.mandated-mission/v1", agentId: mandate.agentId, mandateDigest: digestAgentMandateV1(mandate), missionId, grantId: `grant-${randomUUID()}`, allocationId: `allocation-${randomUUID()}`, sessionId: `session-${randomUUID()}`, promptDigest: input.promptDigest, outcomeKind: input.outcomeKind, harness: input.harness, connector: parsedConnector, destination: input.destination, childFanout, maxChangedFiles, maxChangedBytes, humanConfirmation: "not-required", exceptionBehavior: "stop-and-report", issuedAt: new Date(now).toISOString() });
}

export function parseReconciledOutcomeV1(value: unknown): ReconciledOutcomeV1 {
  const item = record(value, ["v", "outcomeId", "agentId", "mandateDigest", "missionId", "status", "completedAt", "receiptGraphDigest", "exception"], "reconciled outcome");
  if (item.v !== "reelier.reconciled-outcome/v1" || !["verified", "failed", "unchecked", "absent"].includes(item.status as string)) throw new TypeError("reconciled outcome version or status is invalid");
  const status = item.status as ReconciledOutcomeStatusV1;
  const receiptGraphDigest = item.receiptGraphDigest === null ? null : digest(item.receiptGraphDigest, "outcome receipt graph digest");
  let exception: ReconciledOutcomeV1["exception"] = null;
  if (item.exception !== null) {
    const parsed = record(item.exception, ["code", "message"], "outcome exception");
    exception = Object.freeze({ code: text(parsed.code, "outcome exception code"), message: text(parsed.message, "outcome exception message", /^.{1,512}$/u) });
  }
  if ((status === "verified") !== (receiptGraphDigest !== null) || (status === "failed") !== (exception !== null)) throw new TypeError("reconciled outcome evidence or exception contradicts its status");
  const [completedAt] = timestamp(item.completedAt, "outcome completedAt");
  return Object.freeze({ v: "reelier.reconciled-outcome/v1", outcomeId: text(item.outcomeId, "outcome ID"), agentId: text(item.agentId, "outcome agent ID"), mandateDigest: digest(item.mandateDigest, "outcome mandate digest"), missionId: text(item.missionId, "outcome mission ID"), status, completedAt, receiptGraphDigest, exception });
}
