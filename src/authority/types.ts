export const authorityKinds = [
  "principal",
  "delegation-grant",
  "source-bundle",
  "outcome-contract",
  "outcome-request",
  "transport-effect",
  "compiled-capability",
  "gate-event",
  "authority-receipt",
  "pack-manifest",
] as const;

export type AuthorityKind = (typeof authorityKinds)[number];
export type AuthorityWire = Readonly<Record<string, unknown>>;
export type AuthoritySignature = Readonly<{ alg: "ed25519"; sig: string }>;
