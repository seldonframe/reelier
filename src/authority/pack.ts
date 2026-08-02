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

export interface StaticPackRegistry {
  readonly byAlias: ReadonlyMap<string, StaticPackDefinition>;
  readonly byDefinitionDigest: ReadonlyMap<string, StaticPackDefinition>;
}

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
  return Object.freeze({ byAlias, byDefinitionDigest });
}

export function registeredDefinitionDigests(registry: StaticPackRegistry): RegisteredDefinitionDigests {
  return new Map([...registry.byAlias].map(([alias, definition]) => [alias, Object.freeze({ packDigest: definition.packDigest, definitionDigest: definition.definitionDigest })]));
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
