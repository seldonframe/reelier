import canonicalize from "canonicalize";
import { createHash } from "node:crypto";

export type AuthorityAdapterContractV1 = Readonly<{ v: "reelier.adapter-contract/v1"; domain: "reelier.adapter-contract/v1\\0"; members: readonly Readonly<{ path: string; digest: string }>[]; goldenVectorsDigest: string; digest: string }>;

export const AUTHORITY_ADAPTER_CONTRACT_V1: AuthorityAdapterContractV1 = freezeAdapterContract(null as never);
export const AUTHORITY_ADAPTER_CONTRACT_V1_DIGEST = AUTHORITY_ADAPTER_CONTRACT_V1.digest;

function freezeAdapterContract(value: { v: "reelier.adapter-contract/v1"; domain: "reelier.adapter-contract/v1\\0"; members: readonly { path: string; digest: string }[]; goldenVectorsDigest: string; digest: string }): AuthorityAdapterContractV1 {
  return Object.freeze({ ...value, members: Object.freeze(value.members.map(member => Object.freeze({ ...member }))) });
}

/** Verifies only the frozen authority adapter manifest against caller-supplied normalized bytes. */
export function verifyAuthorityAdapterContractV1(value: unknown, files: ReadonlyMap<string, Uint8Array>): AuthorityAdapterContractV1 {
  if (!value || typeof value !== "object") throw new TypeError("invalid adapter contract: descriptor must be an object");
  const descriptor = value as { v?: unknown; domain?: unknown; members?: unknown; goldenVectorsDigest?: unknown; digest?: unknown };
  if (descriptor.v !== "reelier.adapter-contract/v1" || descriptor.domain !== "reelier.adapter-contract/v1\\0") throw new TypeError("invalid adapter contract: version or domain");
  if (!Array.isArray(descriptor.members) || typeof descriptor.goldenVectorsDigest !== "string" || typeof descriptor.digest !== "string") throw new TypeError("invalid adapter contract: shape");
  const members = descriptor.members.map(member => {
    if (!member || typeof member !== "object" || typeof (member as { path?: unknown }).path !== "string" || typeof (member as { digest?: unknown }).digest !== "string") throw new TypeError("invalid adapter contract: member shape");
    return member as { path: string; digest: string };
  });
  const paths = members.map(member => member.path);
  if (paths.join("\0") !== [...paths].sort().join("\0") || new Set(paths).size !== paths.length || paths.some(path => path.includes("/") || path.includes("\\") || path === "adapter-contract-v1.json" || path === "." || path === "..")) throw new TypeError("invalid adapter contract: member paths");
  if (paths.join("\0") !== AUTHORITY_ADAPTER_CONTRACT_V1.members.map(member => member.path).join("\0")) throw new TypeError("invalid adapter contract: closed membership");
  for (const member of members) {
    const bytes = files.get(member.path);
    if (!bytes || `sha256:${createHash("sha256").update(normalizeContractBytes(bytes)).digest("hex")}` !== member.digest) throw new TypeError(`invalid adapter contract: member digest ${member.path}`);
  }
  const goldenVectors = members.find(member => member.path === "golden-vectors.json");
  if (!goldenVectors || goldenVectors.digest !== descriptor.goldenVectorsDigest) throw new TypeError("invalid adapter contract: golden vectors digest");
  const unsigned = { v: descriptor.v, domain: descriptor.domain, members: members.map(member => ({ path: member.path, digest: member.digest })), goldenVectorsDigest: descriptor.goldenVectorsDigest };
  const canonical = canonicalize(unsigned);
  if (canonical === undefined) throw new TypeError("invalid adapter contract: canonicalization");
  const expected = `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
  if (descriptor.digest !== expected || /^sha256:0{64}$/.test(descriptor.digest)) throw new TypeError("invalid adapter contract: aggregate digest");
  return freezeAdapterContract({ ...unsigned, digest: descriptor.digest } as AuthorityAdapterContractV1);
}

function normalizeContractBytes(bytes: Uint8Array): Buffer {
  return Buffer.from(Buffer.from(bytes).toString("utf8").replace(/\r\n/g, "\n"), "utf8");
}
