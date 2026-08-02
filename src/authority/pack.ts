import type { OutcomeContract, SourceBundle, TransportEffect } from "./types.js";
import type { RegisteredDefinitionDigests } from "./contract.js";

export interface StaticPackCompileInput {
  readonly contract: OutcomeContract;
  readonly source: SourceBundle;
  readonly choices: unknown;
  readonly policy: unknown;
  readonly now: Date;
  readonly connectorAccount: Readonly<{ connectorId: string; accountId: string }>;
}

export interface StaticPackDefinition {
  readonly alias: string;
  readonly packDigest: string;
  readonly definitionDigest: string;
  readonly resolverId: string;
  readonly projectionSchemaId: string;
  readonly readEndpointIds: readonly string[];
  readonly writeEndpointIds: readonly string[];
  readonly riskClasses: readonly string[];
  readonly policySchemaId: string;
  readonly requiredGroundedPointers: readonly string[];
  readonly validateChoices: (value: unknown) => unknown;
  readonly parsePolicy: (value: unknown) => unknown;
  readonly compile: (input: StaticPackCompileInput) => unknown;
}

declare const staticPackRegistryBrand: unique symbol;
export interface StaticPackRegistry { readonly [staticPackRegistryBrand]: true }

interface StaticPackRegistryState {
  readonly byAlias: ReadonlyMap<string, StaticPackDefinition>;
  readonly byDefinitionDigest: ReadonlyMap<string, StaticPackDefinition>;
}

const staticPackRegistryStates = new WeakMap<object, StaticPackRegistryState>();

export function createStaticPackRegistry(definitions: readonly StaticPackDefinition[]): StaticPackRegistry {
  const byAlias = new Map<string, StaticPackDefinition>();
  const byDefinitionDigest = new Map<string, StaticPackDefinition>();
  for (const definition of definitions) {
    if (byAlias.has(definition.alias)) throw new TypeError("static pack alias collision");
    if (byDefinitionDigest.has(definition.definitionDigest)) throw new TypeError("static pack definition digest collision");
    const frozen = freezeDefinition(definition);
    byAlias.set(definition.alias, frozen);
    byDefinitionDigest.set(definition.definitionDigest, frozen);
  }
  const registry = Object.freeze(Object.create(null)) as StaticPackRegistry;
  staticPackRegistryStates.set(registry, { byAlias, byDefinitionDigest });
  return registry;
}

export function registeredDefinitionDigests(registry: StaticPackRegistry): RegisteredDefinitionDigests {
  const state = requireRegistryState(registry);
  const definitions = new Map([...state.byAlias].map(([alias, definition]) => [alias, Object.freeze({ packDigest: definition.packDigest, definitionDigest: definition.definitionDigest })]));
  return Object.freeze({ get: (alias: string) => definitions.get(alias) });
}

export function lookupStaticPackDefinition(registry: StaticPackRegistry, alias: string): StaticPackDefinition | undefined {
  return requireRegistryState(registry).byAlias.get(alias);
}

function requireRegistryState(registry: StaticPackRegistry): StaticPackRegistryState {
  const state = staticPackRegistryStates.get(registry);
  if (!state) throw new TypeError("unrecognized static first-party pack registry");
  return state;
}

function freezeDefinition(definition: StaticPackDefinition): StaticPackDefinition {
  return Object.freeze({
    ...definition,
    readEndpointIds: Object.freeze([...definition.readEndpointIds]),
    writeEndpointIds: Object.freeze([...definition.writeEndpointIds]),
    riskClasses: Object.freeze([...definition.riskClasses]),
    requiredGroundedPointers: Object.freeze([...definition.requiredGroundedPointers]),
  });
}

const FORBIDDEN_SOURCE_PATTERNS: readonly [RegExp, string][] = [
  [/\b(?:from\s*|import\s*)["']node:(?:fs|fs\/promises|http|https|net|tls|dns|dgram|child_process|worker_threads)["']/, "Node I/O import"],
  [/\bprocess\.env\b/, "ambient environment"],
  [/\bfetch\s*\(/, "ambient network fetch"],
  [/\bDate\.now\s*\(/, "ambient clock"],
  [/\bnew\s+Date\s*\(\s*\)/, "ambient clock construction"],
  [/\bMath\.random\s*\(/, "ambient randomness"],
  [/\b(?:randomUUID|randomBytes|randomFill|randomFillSync|generateKeyPair|generateKeyPairSync)\s*\(/, "crypto randomness"],
  [/\bimport\s*\(/, "dynamic import"],
  [/\brequire\s*\(/, "runtime require"],
  [/\beval\s*\(/, "eval"],
  [/\b(?:new\s+)?Function\s*\(/, "function construction"],
];

/** Static source conformance for reviewed first-party compiler/pack sources; this is not a JavaScript sandbox. */
export function assertStaticFirstPartySourcesConform(sources: readonly Readonly<{ file: string; source: string }>[]): void {
  for (const candidate of sources) for (const [pattern, reason] of FORBIDDEN_SOURCE_PATTERNS) {
    if (pattern.test(candidate.source)) throw new TypeError(`static first-party purity violation in ${candidate.file}: ${reason}`);
  }
}
