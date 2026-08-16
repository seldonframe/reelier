import type { OutcomeContract, SourceBundle, TransportEffect } from "./types.js";
import type { RegisteredDefinitionDigests } from "./contract.js";
import { authorityDigest } from "./wire.js";

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
const DEFINITION_FIELDS=new Set(["alias","packDigest","definitionDigest","resolverId","projectionSchemaId","maxFreshnessSeconds","readEndpointIds","writeEndpointIds","riskClasses","policySchemaId","requiredGroundedPointers","validateChoices","parsePolicy","compile"]);
const SHA=/^sha256:[0-9a-f]{64}$/;const ZERO_SHA=`sha256:${"0".repeat(64)}`;

export function createStaticPackRegistry(definitions: readonly StaticPackDefinition[]): StaticPackRegistry {
  const byAlias = new Map<string, StaticPackDefinition>();
  const byDefinitionDigest = new Map<string, StaticPackDefinition>();
  for (const definition of definitions) {
    if(!definition||typeof definition!=="object"||Object.keys(definition).length!==DEFINITION_FIELDS.size||Object.keys(definition).some(field=>!DEFINITION_FIELDS.has(field)))throw new TypeError("static pack definition must be a closed registration");
    if(!SHA.test(definition.packDigest)||definition.packDigest===ZERO_SHA||!SHA.test(definition.definitionDigest)||definition.definitionDigest===ZERO_SHA)throw new TypeError("static pack digests must be non-zero lowercase sha256");
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

export function definitionRegistrationDigest(registry:StaticPackRegistry,alias:string):string {
  const definition=requireRegistryState(registry).byAlias.get(alias);if(!definition)throw new TypeError("missing static definition registration");
  return authorityDigest({v:"reelier.definition-registration/internal-v1",alias:definition.alias,packDigest:definition.packDigest,definitionDigest:definition.definitionDigest,resolverId:definition.resolverId,projectionSchemaId:definition.projectionSchemaId,readEndpointIds:definition.readEndpointIds,writeEndpointIds:definition.writeEndpointIds,riskClasses:definition.riskClasses,policySchemaId:definition.policySchemaId,requiredGroundedPointers:definition.requiredGroundedPointers,maxFreshnessSeconds:definition.maxFreshnessSeconds});
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
  const readEndpointIds=canonicalList("definition read endpoint",definition.readEndpointIds);
  const writeEndpointIds=canonicalList("definition write endpoint",definition.writeEndpointIds);
  const riskClasses=canonicalList("definition risk class",definition.riskClasses);
  const requiredGroundedPointers=canonicalList("definition grounded pointer",definition.requiredGroundedPointers);
  return Object.freeze({
    ...definition,
    readEndpointIds,writeEndpointIds,riskClasses,requiredGroundedPointers,
  });
}

function canonicalList(label:string,items:readonly string[]):readonly string[]{if(!Array.isArray(items)||items.some(item=>typeof item!=="string"||item.length===0)||new Set(items).size!==items.length)throw new TypeError(`${label} list must contain unique strings`);return Object.freeze([...items].sort(compareText));}
function compareText(left:string,right:string):number{return left<right?-1:left>right?1:0;}

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
  "src/authority/compile.ts": new Set(["node:crypto", "./types.js", "./wire.js", "./contract.js", "./source.js", "./pack.js", "./errors.js"]),
  "src/packs/github/manifest.ts": new Set(["../../authority/wire.js"]),
  "src/packs/github/source.ts": new Set(["../../authority/source.js", "../../authority/wire.js", "./manifest.js"]),
  "src/packs/github/compile.ts": new Set(["../../authority/wire.js", "./manifest.js"]),
  "src/packs/github/reconcile.ts": new Set(["../../authority/wire.js", "./manifest.js", "../types.js"]),
  "src/packs/slack-topic/manifest.ts": new Set(["../../authority/wire.js"]),
  "src/packs/slack-topic/source.ts": new Set(["../../authority/source.js", "../../authority/wire.js", "./manifest.js"]),
  "src/packs/slack-topic/compile.ts": new Set(["../../authority/wire.js", "./manifest.js"]),
  "src/packs/slack-topic/reconcile.ts": new Set(["../../authority/wire.js", "./manifest.js", "../types.js"]),
  "src/packs/gmail/index.ts": new Set(["../../authority/wire.js"]),
  "src/packs/stripe/index.ts": new Set(["../../authority/wire.js"]),
  "src/packs/vercel/manifest.ts": new Set(["../../authority/wire.js"]),
  "src/packs/vercel/source.ts": new Set(["../../authority/source.js", "../../authority/wire.js", "./manifest.js"]),
  "src/packs/vercel/compile.ts": new Set(["../../authority/wire.js", "./manifest.js"]),
  "src/packs/vercel/reconcile.ts": new Set(["../../authority/wire.js", "./manifest.js", "../types.js"]),
  "src/packs/vercel/index.ts": new Set(["./manifest.js", "./source.js", "./compile.js", "./reconcile.js"]),
  "src/packs/cloudflare/manifest.ts": new Set(["../../authority/wire.js"]),
  "src/packs/cloudflare/source.ts": new Set(["../../authority/source.js", "../../authority/wire.js", "./manifest.js"]),
  "src/packs/cloudflare/compile.ts": new Set(["../../authority/wire.js", "./manifest.js"]),
  "src/packs/cloudflare/reconcile.ts": new Set(["../../authority/wire.js", "./manifest.js", "../types.js"]),
  "src/packs/cloudflare/index.ts": new Set(["./manifest.js", "./source.js", "./compile.js", "./reconcile.js"]),
  "src/packs/neon/manifest.ts": new Set(["../../authority/wire.js"]),
  "src/packs/neon/source.ts": new Set(["../../authority/source.js", "../../authority/wire.js", "./manifest.js"]),
  "src/packs/neon/compile.ts": new Set(["../../authority/wire.js", "./manifest.js"]),
  "src/packs/neon/reconcile.ts": new Set(["../../authority/wire.js", "./manifest.js", "./compile.js", "../types.js"]),
  "src/packs/neon/index.ts": new Set(["./manifest.js", "./source.js", "./compile.js", "./reconcile.js"]),
  "src/packs/cloudflare-token/manifest.ts": new Set(["../../authority/wire.js"]),
  "src/packs/cloudflare-token/source.ts": new Set(["../../authority/source.js", "../../authority/wire.js", "./manifest.js"]),
  "src/packs/cloudflare-token/compile.ts": new Set(["../../authority/wire.js", "./manifest.js"]),
  "src/packs/cloudflare-token/reconcile.ts": new Set(["../../authority/wire.js", "./manifest.js", "./compile.js", "../types.js"]),
  "src/packs/cloudflare-token/index.ts": new Set(["./manifest.js", "./source.js", "./compile.js", "./reconcile.js", "./create.js"]),
  "src/packs/cloudflare-token/create.ts": new Set(["../../authority/wire.js", "../../authority/types.js"]),
  "src/packs/vercel-environment-secret/manifest.ts": new Set(["../../authority/wire.js"]),
  "src/packs/vercel-environment-secret/compile.ts": new Set(["../../authority/wire.js", "../../authority/types.js", "./manifest.js"]),
  "src/packs/vercel-environment-secret/index.ts": new Set(["./manifest.js", "./compile.js"]),
  "src/packs/information-flow/manifest.ts": new Set(["../../authority/wire.js"]),
  "src/packs/information-flow/source.ts": new Set(["../../authority/source.js", "../../authority/wire.js", "./manifest.js"]),
  "src/packs/information-flow/compile.ts": new Set(["../../authority/wire.js", "./manifest.js"]),
  "src/packs/information-flow/reconcile.ts": new Set(["../../authority/wire.js", "./manifest.js", "./compile.js", "../types.js"]),
  "src/packs/information-flow/index.ts": new Set(["./manifest.js", "./source.js", "./compile.js", "./reconcile.js"]),
  "src/packs/index.ts": new Set(["../authority/pack.js", "../authority/source.js", "./github/compile.js", "./github/manifest.js", "./github/source.js", "./github/reconcile.js", "./github/index.js", "./slack-topic/compile.js", "./slack-topic/manifest.js", "./slack-topic/source.js", "./slack-topic/reconcile.js", "./slack-topic/index.js", "./gmail/index.js", "./stripe/index.js", "./vercel/index.js", "./cloudflare/index.js", "./neon/index.js", "./cloudflare-token/index.js", "./cloudflare-token/create.js", "./vercel-environment-secret/index.js", "./information-flow/index.js"]),
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
