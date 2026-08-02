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
  readonly maxFreshnessSeconds: number;
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
    if (!Number.isSafeInteger(definition.maxFreshnessSeconds) || definition.maxFreshnessSeconds < 1 || definition.maxFreshnessSeconds > 300) throw new TypeError("static pack resolver freshness must be an integer from 1 to 300");
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
  const definitions = new Map([...state.byAlias].map(([alias, definition]) => [alias, Object.freeze({ packDigest: definition.packDigest, definitionDigest: definition.definitionDigest, maxFreshnessSeconds: definition.maxFreshnessSeconds })]));
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
  [/\bprocess\.env\b/, "ambient environment"],
  [/\bfetch\s*\(/, "ambient network fetch"],
  [/\bDate\.now\s*\(/, "ambient clock"],
  [/\bnew\s+Date\s*\(\s*\)/, "ambient clock construction"],
  [/\bMath\.random\s*\(/, "ambient randomness"],
  [/\b(?:randomUUID|randomBytes|randomFill|randomFillSync|generateKeyPair|generateKeyPairSync)\s*\(/, "crypto randomness"],
  [/\bimport\s*\(/, "dynamic import"],
  [/\b(?:(?:globalThis|global)\s*(?:\.\s*process|\[\s*["']process["']\s*\])|process)\s*(?:\.\s*(?:getBuiltinModule|binding|_linkedBinding|dlopen|mainModule)\b|\[\s*["'](?:getBuiltinModule|binding|_linkedBinding|dlopen|mainModule)["']\s*\])/, "ambient process module loader"],
  [/\b(?:(?:globalThis|global)\s*(?:\.\s*module|\[\s*["']module["']\s*\])|module|Module)\s*(?:\.\s*createRequire\b|\[\s*["']createRequire["']\s*\])/, "ambient module loader"],
  [/\bcreateRequire\b/, "runtime module loader"],
  [/\brequire\s*\(/, "runtime require"],
  [/\beval\s*\(/, "eval"],
  [/\b(?:new\s+)?Function\s*\(/, "function construction"],
];

const STATIC_RUNTIME_SPECIFIER_ALLOWLIST: Readonly<Record<string, ReadonlySet<string>>> = Object.freeze({
  "src/authority/compile.ts": new Set(["node:crypto", "./types.js", "./wire.js", "./contract.js", "./source.js", "./pack.js"]),
});
const STATIC_RUNTIME_SPECIFIER = /\b(?:import|export)\s+(?!type\b)(?:(?:[^"'`;]*?\bfrom\s*)?["']([^"']+)["'])/gs;

/** Static source conformance for reviewed first-party compiler/pack sources; this is not a JavaScript sandbox. */
export function assertStaticFirstPartySourcesConform(sources: readonly Readonly<{ file: string; source: string }>[]): void {
  for (const candidate of sources) {
    for (const match of candidate.source.matchAll(STATIC_RUNTIME_SPECIFIER)) {
      const specifier = match[1];
      const explicitlyAllowed = STATIC_RUNTIME_SPECIFIER_ALLOWLIST[candidate.file]?.has(specifier) === true;
      if (!explicitlyAllowed) throw new TypeError(`static first-party purity violation in ${candidate.file}: runtime module specifier ${specifier} is not allowlisted`);
    }
    for (const [pattern, reason] of FORBIDDEN_SOURCE_PATTERNS) {
      if (pattern.test(candidate.source)) throw new TypeError(`static first-party purity violation in ${candidate.file}: ${reason}`);
    }
  }
}
