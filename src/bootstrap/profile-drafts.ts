import { definitionRegistrationDigest, lookupStaticPackDefinition } from "../authority/pack.js";
import { createFirstPartyPackRegistry, firstPartyPacks } from "../packs/index.js";

export interface ProfileDraftsV1 {
  readonly v: "reelier.profile-drafts/v1";
  readonly status: "not-drafted";
  readonly installedPackRegistrations: readonly Readonly<{ alias: string; packDigest: string; definitionDigest: string; registrationDigest: string }>[];
  readonly drafts: readonly [];
  readonly reason: "no-eligible-profile-candidate";
  readonly certification: "absent";
  readonly activation: "absent";
}

export function createProfileDrafts(): ProfileDraftsV1 {
  const registry = createFirstPartyPackRegistry();
  const installedPackRegistrations = firstPartyPacks.map(pack => {
    const definition = lookupStaticPackDefinition(registry, pack.definition.alias);
    if (definition === undefined) throw new TypeError("installed pack registry is incomplete");
    return Object.freeze({ alias: definition.alias, packDigest: definition.packDigest, definitionDigest: definition.definitionDigest, registrationDigest: definitionRegistrationDigest(registry, definition.alias) });
  });
  return Object.freeze({ v: "reelier.profile-drafts/v1", status: "not-drafted", installedPackRegistrations: Object.freeze(installedPackRegistrations), drafts: Object.freeze([] as const), reason: "no-eligible-profile-candidate", certification: "absent", activation: "absent" });
}
