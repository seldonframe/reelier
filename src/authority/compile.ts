import { createHash } from "node:crypto";
import type { TransportEffect } from "./types.js";
import { authorityCanonicalBytes, authorityDigest, parseAuthorityWire } from "./wire.js";
import type { ValidatedContract } from "./contract.js";
import { assertValidatedContract } from "./contract.js";
import type { ValidatedSourceBundle } from "./source.js";
import { assertValidatedSourceBundle } from "./source.js";
import type { StaticPackRegistry } from "./pack.js";
import { lookupStaticPackDefinition } from "./pack.js";

export interface SemanticOutcomeFields {
  readonly tenant: string;
  readonly contractDigest: string;
  readonly definitionAlias: string;
  readonly sourceIdentity: string;
  readonly triggerIdentity: string;
}

export interface CompiledOutcome {
  readonly effect: TransportEffect;
  readonly effectCanonicalBase64: string;
  readonly effectDigest: string;
  readonly outcomeKey: string;
  readonly capabilityCommitment: Readonly<{
    tenant: string;
    contractDigest: string;
    definitionAlias: string;
    packDigest: string;
    definitionDigest: string;
    sourceBundleDigest: string;
    sourceIdentity: string;
    triggerIdentity: string;
    connectorId: string;
    accountId: string;
    policyDigest: string;
    validationInstant: string;
    activationSnapshotDigest: string;
    authorityStateDigest: string;
    sourceSnapshotDigest: string;
    limits: Readonly<{ maxEffectsPerWindow:number;windowSeconds:number;maxEffectsPerSourceTrigger:number;maxBodyBytes:number }>;
    limitsDigest: string;
    effectDigest: string;
    outcomeKey: string;
  }>;
}

export function compileOutcome(registry: StaticPackRegistry, input: Readonly<{ contract: ValidatedContract; source: ValidatedSourceBundle; choices: unknown; now: Date }>): CompiledOutcome {
  assertValidatedContract(input.contract);
  assertValidatedSourceBundle(input.source);
  const validationInstant = input.now.toISOString();
  if (input.contract.validationInstant !== validationInstant || input.source.validationInstant !== validationInstant) throw new TypeError("compile requires the same validation instant and context");
  const contract = input.contract.contract;
  const source = input.source.bundle;
  const now = input.now.getTime();
  if (now < Date.parse(contract.validFrom)) throw new TypeError("contract is not yet valid at compilation instant");
  if (now >= Date.parse(contract.validUntil)) throw new TypeError("contract is expired at compilation instant");
  if (Date.parse(source.observedAt) > now || now >= Date.parse(source.freshUntil)) throw new TypeError("source is stale or not observed at compilation instant");
  const expectedSourceSnapshot = authorityDigest({ v: "reelier.source-snapshot/internal-v1", bundleDigest: input.source.digest, sourceRefsDigest: source.sourceRefsDigest, readSetDigest: source.readSetDigest, resolverId: source.provenance.resolverId, observations: source.provenance.observations });
  if (input.source.sourceSnapshotDigest !== expectedSourceSnapshot) throw new TypeError("source snapshot context mismatch");
  const definition = lookupStaticPackDefinition(registry, contract.alias);
  if (!definition || definition.definitionDigest !== contract.definitionDigest || definition.packDigest !== contract.packDigest) throw new TypeError("unknown or drifted static definition");
  if (definition.resolverId !== contract.sourceAuthority.resolverId || definition.projectionSchemaId !== contract.sourceAuthority.projectionSchemaId) throw new TypeError("static definition source authority mismatch");
  if (contract.sourceAuthority.allowedReadEndpointIds.some(endpoint => !definition.readEndpointIds.includes(endpoint))) throw new TypeError("contract names unknown definition read endpoint");
  if (source.tenant !== contract.tenant || source.definitionDigest !== contract.definitionDigest || source.projectionSchemaId !== contract.sourceAuthority.projectionSchemaId || source.provenance.resolverId !== definition.resolverId) throw new TypeError("validated source does not fit contract definition");
  if (source.provenance.observations.some(observation => !definition.readEndpointIds.includes(observation.endpointId) || !contract.sourceAuthority.allowedReadEndpointIds.includes(observation.endpointId))) throw new TypeError("validated source uses unknown or unauthorized read endpoint");
  const authorizedPointers = new Set(contract.sourceAuthority.authorizedProjectionPointers);
  for (const claims of [source.claims.grounded, source.claims.authored, source.claims.unresolved]) for (const claim of claims) if (!authorizedPointers.has(claim.projectionPointer)) throw new TypeError("validated source projection exceeds contract authority");
  for (const pointer of projectionLeafPointers(source.projection)) if (!authorizedPointers.has(pointer)) throw new TypeError("validated source projection exceeds contract authority");
  if (definition.policySchemaId !== contract.policyCommitment.schemaId) throw new TypeError("policy schema drift");
  if (definition.requiredGroundedPointers.some(pointer => !source.claims.grounded.some(claim => claim.projectionPointer === pointer))) throw new TypeError("definition required field is not grounded");
  const choices = definition.validateChoices(validateChoiceBoundary(input.choices));
  const policyBytes = Buffer.from(contract.policyCommitment.jcsBase64, "base64");
  const policy = definition.parsePolicy(JSON.parse(policyBytes.toString("utf8")) as unknown);
  const emitted = definition.compile({ contract, source, choices: deepFreeze(choices), policy: deepFreeze(policy), now: new Date(input.now.getTime()), connectorAccount: Object.freeze({ connectorId: contract.connectorId, accountId: contract.accountId }) });
  const effect = deepFreeze(parseAuthorityWire("transport-effect", emitted));
  if (!definition.writeEndpointIds.includes(effect.endpointId)) throw new TypeError("pack emitted unknown write endpoint");
  if (!definition.riskClasses.includes(effect.riskClass) || !contract.riskClasses.includes(effect.riskClass)) throw new TypeError("pack emitted unknown or unauthorized risk class");
  if (Buffer.from(effect.bodyBase64, "base64").length > contract.limits.maxBodyBytes) throw new TypeError("pack effect body exceeds contract limit");
  const effectCanonicalBase64 = authorityCanonicalBytes(effect).toString("base64");
  const effectDigest = authorityDigest(effect);
  const outcomeKey = deriveSemanticOutcomeKey({ tenant: contract.tenant, contractDigest: input.contract.digest, definitionAlias: contract.alias, sourceIdentity: source.sourceIdentity, triggerIdentity: source.triggerIdentity });
  const limitsDigest = authorityDigest({ v: "reelier.capability-limits/internal-v1", contractDigest: input.contract.digest, limits: contract.limits });
  const capabilityCommitment = deepFreeze({ tenant: contract.tenant, contractDigest: input.contract.digest, definitionAlias: contract.alias, packDigest: contract.packDigest, definitionDigest: contract.definitionDigest, sourceBundleDigest: input.source.digest, sourceIdentity: source.sourceIdentity, triggerIdentity: source.triggerIdentity, connectorId: contract.connectorId, accountId: contract.accountId, policyDigest: contract.policyCommitment.digest, validationInstant, activationSnapshotDigest: input.contract.activationSnapshotDigest, authorityStateDigest: input.contract.activationSnapshotDigest, sourceSnapshotDigest: input.source.sourceSnapshotDigest, limits: contract.limits, limitsDigest, effectDigest, outcomeKey });
  return Object.freeze({ effect, effectCanonicalBase64, effectDigest, outcomeKey, capabilityCommitment });
}

function validateChoiceBoundary(value: unknown): Readonly<Record<string, string | number | boolean | null>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("invalid bounded choices");
  const choices = value as Record<string, unknown>;
  const keys = Object.keys(choices);
  if (keys.length > 16) throw new TypeError("invalid bounded choices");
  const forbidden = new Set(["tenant", "provideraccount", "account", "connector", "pack", "endpoint", "recipient", "template", "body", "url", "providerargs", "providerarguments", "credentials"]);
  for (const key of keys) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key) || forbidden.has(key.toLowerCase())) throw new TypeError("invalid bounded choices");
    const item = choices[key];
    if (item !== null && !["string", "number", "boolean"].includes(typeof item)) throw new TypeError("invalid bounded choices");
    if (typeof item === "string" && item.length > 256) throw new TypeError("invalid bounded choices");
    if (typeof item === "number" && (!Number.isFinite(item) || item < -1_000_000 || item > 1_000_000)) throw new TypeError("invalid bounded choices");
  }
  return Object.freeze({ ...choices }) as Readonly<Record<string, string | number | boolean | null>>;
}

export function deriveSemanticOutcomeKey(fields: SemanticOutcomeFields): string {
  const parts: Buffer[] = [Buffer.from("reelier-authority-semantic-outcome-key/v1\0", "utf8")];
  for (const [name, value] of [
    ["tenant", fields.tenant], ["contractDigest", fields.contractDigest], ["definitionAlias", fields.definitionAlias],
    ["sourceIdentity", fields.sourceIdentity], ["triggerIdentity", fields.triggerIdentity],
  ] as const) {
    parts.push(lengthPrefix(name), lengthPrefix(value));
  }
  return `sha256:${createHash("sha256").update(Buffer.concat(parts)).digest("hex")}`;
}

function lengthPrefix(value: string): Buffer {
  const bytes = Buffer.from(value, "utf8");
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(bytes.length);
  return Buffer.concat([length, bytes]);
}

function projectionLeafPointers(value: unknown, prefix = ""): string[] {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > 0) return entries.flatMap(([key, child]) => projectionLeafPointers(child, `${prefix}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`));
  }
  return [prefix];
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
