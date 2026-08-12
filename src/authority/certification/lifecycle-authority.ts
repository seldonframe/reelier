import { createHash, createPublicKey, generateKeyPairSync, randomUUID, type KeyObject } from "node:crypto";
import { signAuthorityDigest, verifyAuthoritySignature } from "../crypto.js";
import type { AuthoritySignature, AuthoritySignaturePurpose } from "../types.js";
import { authorityDigest } from "../wire.js";
import { parseAuthorityKeyDescriptor, type AuthorityKeyDescriptorV1 } from "./authority.js";

const DIRECT_PURPOSES = ["authority-evidence", "authority-journal", "authority-receipt", "delegation-grant", "gate-event", "outcome-contract"] as const;
const ARTIFACT_PURPOSES = ["compiled-capability", "pack-manifest", "source-bundle", "transport-effect"] as const;
type DirectPurpose = (typeof DIRECT_PURPOSES)[number];
type ArtifactPurpose = (typeof ARTIFACT_PURPOSES)[number];

declare const opaqueAuthorityBrand: unique symbol;
export type CertificationLifecycleAuthorityHandle = Readonly<{ readonly [opaqueAuthorityBrand]: true }>;
type KeyMaterial = Readonly<{ descriptor: AuthorityKeyDescriptorV1; privateKey: KeyObject }>;
type CeremonyMaterial = Readonly<{ direct: ReadonlyMap<DirectPurpose, KeyMaterial>; artifacts: ReadonlyMap<ArtifactPurpose, KeyMaterial>; bindingDigest?: string }>;
const handles = new WeakMap<object, CeremonyMaterial>();

export interface CertificationArtifactKeyBindingV1 {
  readonly v: "reelier.certification-artifact-key-binding/v1";
  readonly bindingId: string;
  readonly authorityCellId: string;
  readonly taskId: string;
  readonly readinessDigest: string;
  readonly parentEvidenceDescriptorDigest: string;
  readonly entries: readonly Readonly<{ artifactPurpose: ArtifactPurpose; keyId: string; publicKeySpkiBase64: string; publicKeyDigest: string }>[];
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly nonce: string;
  readonly signerId: string;
  readonly signature: AuthoritySignature;
}

export interface CertificationArtifactKeyBindingCommitmentV1 {
  readonly v: "reelier.certification-artifact-key-binding-commitment/v1";
  readonly bindingDigest: string;
  readonly readinessDigest: string;
  readonly authorityCellId: string;
  readonly taskId: string;
  readonly humanSignerId: string;
  readonly signature: AuthoritySignature;
}

export function createCertificationLifecycleAuthorityCeremony(): Readonly<{ publicDescriptors: readonly AuthorityKeyDescriptorV1[]; opaqueHandle: CertificationLifecycleAuthorityHandle }> {
  const direct = new Map<DirectPurpose, KeyMaterial>();
  for (const purpose of DIRECT_PURPOSES) direct.set(purpose, keyFor(purpose));
  const artifacts = new Map<ArtifactPurpose, KeyMaterial>();
  for (const purpose of ARTIFACT_PURPOSES) artifacts.set(purpose, artifactKeyFor(purpose));
  const target = Object.freeze(Object.create(null));
  const handle = Object.freeze(new Proxy(target, {})) as CertificationLifecycleAuthorityHandle;
  handles.set(handle, Object.freeze({ direct, artifacts }));
  return Object.freeze({ publicDescriptors: Object.freeze(DIRECT_PURPOSES.map(purpose => direct.get(purpose)!.descriptor)), opaqueHandle: handle });
}

export function createCertificationArtifactKeyBinding(handle: CertificationLifecycleAuthorityHandle, input: Readonly<{ authorityCellId: string; taskId: string; readinessDigest: string; humanDescriptor: AuthorityKeyDescriptorV1; humanPrivateKey: KeyObject; issuedAt: string; expiresAt: string }>): Readonly<{ binding: CertificationArtifactKeyBindingV1; humanCommitment: CertificationArtifactKeyBindingCommitmentV1 }> {
  const material = requireMaterial(handle);
  if (material.bindingDigest) throw new TypeError("certification lifecycle authority binding already exists");
  const human = parseAuthorityKeyDescriptor(input.humanDescriptor);
  if (human.role !== "human-sponsor" || human.purpose !== "certification-readiness") throw new TypeError("artifact key binding requires the readiness human signer");
  const issuedAt = canonicalTime(input.issuedAt), expiresAt = canonicalTime(input.expiresAt);
  if (Date.parse(expiresAt) <= Date.parse(issuedAt)) throw new TypeError("artifact key binding validity is invalid");
  digest(input.readinessDigest, "readiness digest");
  id(input.authorityCellId, "Cell id"); id(input.taskId, "task id");
  const evidence = material.direct.get("authority-evidence")!;
  const entries = Object.freeze(ARTIFACT_PURPOSES.map(artifactPurpose => {
    const key = material.artifacts.get(artifactPurpose)!;
    return Object.freeze({ artifactPurpose, keyId: key.descriptor.keyId, publicKeySpkiBase64: key.descriptor.publicKeySpkiBase64, publicKeyDigest: publicKeyDigest(key.descriptor.publicKeySpkiBase64) });
  }));
  const body = Object.freeze({ v: "reelier.certification-artifact-key-binding/v1" as const, bindingId: `binding_${randomUUID().replaceAll("-", "")}`, authorityCellId: input.authorityCellId, taskId: input.taskId, readinessDigest: input.readinessDigest, parentEvidenceDescriptorDigest: authorityDigest(evidence.descriptor), entries, issuedAt, expiresAt, nonce: randomUUID().replaceAll("-", ""), signerId: evidence.descriptor.keyId });
  const bindingDigest = authorityDigest(body);
  const signature = signDomain(evidence.privateKey, "authority-evidence", "reelier.certification-artifact-key-binding/v1\0", bindingDigest);
  const binding = Object.freeze({ ...body, signature });
  const commitmentBody = Object.freeze({ v: "reelier.certification-artifact-key-binding-commitment/v1" as const, bindingDigest: authorityDigest(binding), readinessDigest: input.readinessDigest, authorityCellId: input.authorityCellId, taskId: input.taskId, humanSignerId: human.keyId });
  const commitmentSignature = signDomain(input.humanPrivateKey, "certification-readiness", "reelier.certification-artifact-key-binding-commitment/v1\0", authorityDigest(commitmentBody));
  const humanPublic = publicKey(input.humanPrivateKey);
  if (humanPublic !== human.publicKeySpkiBase64 || !verifyDomain(human, "certification-readiness", "reelier.certification-artifact-key-binding-commitment/v1\0", authorityDigest(commitmentBody), commitmentSignature)) throw new TypeError("human private key does not match readiness descriptor");
  handles.set(handle as object, Object.freeze({ ...material, bindingDigest: authorityDigest(binding) }));
  return Object.freeze({ binding, humanCommitment: Object.freeze({ ...commitmentBody, signature: commitmentSignature }) });
}

export function certificationLifecycleAuthorityMaterial(handle: CertificationLifecycleAuthorityHandle): CeremonyMaterial { return requireMaterial(handle); }

function requireMaterial(handle: CertificationLifecycleAuthorityHandle): CeremonyMaterial { const material = handles.get(handle as object); if (!material) throw new TypeError("genuine opaque certification lifecycle authority handle required"); return material; }
function keyFor(purpose: DirectPurpose): KeyMaterial { const pair = generateKeyPairSync("ed25519"); const descriptor = parseAuthorityKeyDescriptor({ v: "reelier.authority-key-descriptor/v1", keyId: `cell_${purpose.replaceAll("-", "_")}_${randomUUID().slice(0, 8)}`, role: "authority-cell", purpose, algorithm: "ed25519", publicKeySpkiBase64: pair.publicKey.export({ type: "spki", format: "der" }).toString("base64") }); return Object.freeze({ descriptor, privateKey: pair.privateKey }); }
function artifactKeyFor(purpose: ArtifactPurpose): KeyMaterial { const pair = generateKeyPairSync("ed25519"); const publicKeySpkiBase64 = pair.publicKey.export({ type: "spki", format: "der" }).toString("base64"); return Object.freeze({ descriptor: Object.freeze({ v: "reelier.authority-key-descriptor/v1", keyId: `cell_${purpose.replaceAll("-", "_")}_${randomUUID().slice(0, 8)}`, role: "authority-cell", purpose, algorithm: "ed25519", publicKeySpkiBase64 }) as unknown as AuthorityKeyDescriptorV1, privateKey: pair.privateKey }); }
function signDomain(key: KeyObject, purpose: AuthoritySignaturePurpose, domain: string, digestValue: string): AuthoritySignature { return signAuthorityDigest(key, purpose, authorityDigest({ domain, digest: digestValue })); }
function verifyDomain(descriptor: AuthorityKeyDescriptorV1, purpose: AuthoritySignaturePurpose, domain: string, digestValue: string, signature: AuthoritySignature): boolean { const key = requirePublicKey(descriptor.publicKeySpkiBase64); return verifyAuthoritySignature(key, purpose, authorityDigest({ domain, digest: digestValue }), signature); }
function requirePublicKey(value: string): KeyObject { return createPublicKey({ key: Buffer.from(value, "base64"), type: "spki", format: "der" }); }
function publicKey(privateKey: KeyObject): string { return createPublicKey(privateKey).export({ type: "spki", format: "der" }).toString("base64"); }
function publicKeyDigest(value: string): string { return `sha256:${createHash("sha256").update(Buffer.from(value, "base64")).digest("hex")}`; }
function canonicalTime(value: string): string { const at = new Date(value); if (!Number.isFinite(at.getTime()) || at.toISOString() !== value) throw new TypeError("artifact key binding time must be canonical"); return value; }
function digest(value: string, label: string): string { if (!/^sha256:[0-9a-f]{64}$/.test(value) || /^sha256:0{64}$/.test(value)) throw new TypeError(`${label} is invalid`); return value; }
function id(value: string, label: string): string { if (!/^[A-Za-z][A-Za-z0-9_-]{2,127}$/.test(value)) throw new TypeError(`${label} is invalid`); return value; }
