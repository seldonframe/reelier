import { createHash, createPublicKey, generateKeyPairSync, randomUUID, type KeyObject } from "node:crypto";
import { signAuthorityDigest, verifyAuthoritySignature } from "../crypto.js";
import type { AuthoritySignature, AuthoritySignaturePurpose } from "../types.js";
import { authorityDigest } from "../wire.js";
import { parseAuthorityKeyDescriptor, type AuthorityKeyDescriptorV1 } from "./authority.js";
import { AUTHORITY_ADAPTER_CONTRACT_V1_DIGEST } from "../adapter-contract.js";

const DIRECT_PURPOSES = ["authority-evidence", "authority-journal", "authority-receipt", "delegation-grant", "gate-event", "outcome-contract"] as const;
const ARTIFACT_PURPOSES = ["compiled-capability", "pack-manifest", "source-bundle", "transport-effect"] as const;
type DirectPurpose = (typeof DIRECT_PURPOSES)[number];
type ArtifactPurpose = (typeof ARTIFACT_PURPOSES)[number];

declare const opaqueAuthorityBrand: unique symbol;
export type CertificationLifecycleAuthorityHandle = Readonly<{ readonly [opaqueAuthorityBrand]: true }>;
type KeyMaterial = Readonly<{ descriptor: AuthorityKeyDescriptorV1; privateKey: KeyObject }>;
export type CertificationLifecycleAuthorityMaterial = Readonly<{ direct: ReadonlyMap<DirectPurpose, KeyMaterial>; artifacts: ReadonlyMap<ArtifactPurpose, KeyMaterial>; schedule: string; bindingDigest?: string }>;
type CeremonyMaterial = CertificationLifecycleAuthorityMaterial;
const handles = new WeakMap<object, CeremonyMaterial>();

export interface CertificationArtifactKeyBindingV1 {
  readonly v: "reelier.certification-artifact-key-binding/v1";
  readonly bindingId: string;
  readonly authorityCellId: string;
  readonly taskId: string;
  readonly adapterContractDigest: string;
  readonly readinessDigest: string;
  readonly parentEvidenceDescriptorDigest: string;
  readonly entries: readonly Readonly<{ artifactPurpose: ArtifactPurpose; keyId: string; publicKeySpkiBase64: string; publicKeyDigest: string }>[];
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly nonce: string;
  readonly scheduleDigest: string;
  readonly signerId: string;
  readonly signature: AuthoritySignature;
}

export interface CertificationArtifactKeyBindingCommitmentV1 {
  readonly v: "reelier.certification-artifact-key-binding-commitment/v1";
  readonly bindingDigest: string;
  readonly readinessDigest: string;
  readonly authorityCellId: string;
  readonly taskId: string;
  readonly adapterContractDigest: string;
  readonly humanSignerId: string;
  readonly signature: AuthoritySignature;
}

export function createCertificationLifecycleAuthorityCeremony(options: Readonly<{ testSchedule: string }> = { testSchedule: "normal" }): Readonly<{ publicDescriptors: readonly AuthorityKeyDescriptorV1[]; opaqueHandle: CertificationLifecycleAuthorityHandle }> {
  const schedules = ["normal", "source-drift", "effect-drift", "provider-503", "accessor-response", "cut-after-budget", "cut-after-dispatched", "cut-after-send-intent", "cut-after-apply", "cut-after-cleanup-publication", "cut-after-conflict-publication", "cut-after-conflict-receipt-before-extension", "pause-after-dispatched"];
  if (Object.keys(options).length !== 1 || !schedules.includes(options.testSchedule)) throw new TypeError("certification lifecycle test schedule is closed and invalid");
  const direct = new Map<DirectPurpose, KeyMaterial>();
  for (const purpose of DIRECT_PURPOSES) direct.set(purpose, keyFor(purpose));
  const artifacts = new Map<ArtifactPurpose, KeyMaterial>();
  for (const purpose of ARTIFACT_PURPOSES) artifacts.set(purpose, artifactKeyFor(purpose));
  const target = Object.freeze(Object.create(null));
  const handle = Object.freeze(new Proxy(target, {})) as CertificationLifecycleAuthorityHandle;
  handles.set(handle, Object.freeze({ direct, artifacts, schedule: options.testSchedule }) as CeremonyMaterial);
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
  const body = Object.freeze({ v: "reelier.certification-artifact-key-binding/v1" as const, bindingId: `binding_${randomUUID().replaceAll("-", "")}`, authorityCellId: input.authorityCellId, taskId: input.taskId, adapterContractDigest: AUTHORITY_ADAPTER_CONTRACT_V1_DIGEST, readinessDigest: input.readinessDigest, parentEvidenceDescriptorDigest: authorityDigest(evidence.descriptor), entries, issuedAt, expiresAt, nonce: randomUUID().replaceAll("-", ""), scheduleDigest: authorityDigest({ v: "reelier.certification-hermetic-schedule/v1", schedule: (material as any).schedule }), signerId: evidence.descriptor.keyId });
  const bindingDigest = authorityDigest(body);
  const signature = signDomain(evidence.privateKey, "authority-evidence", "reelier.certification-artifact-key-binding/v1\0", bindingDigest);
  const binding = Object.freeze({ ...body, signature });
  const commitmentBody = Object.freeze({ v: "reelier.certification-artifact-key-binding-commitment/v1" as const, bindingDigest: authorityDigest(binding), readinessDigest: input.readinessDigest, authorityCellId: input.authorityCellId, taskId: input.taskId, adapterContractDigest: AUTHORITY_ADAPTER_CONTRACT_V1_DIGEST, humanSignerId: human.keyId });
  const commitmentSignature = signDomain(input.humanPrivateKey, "certification-readiness", "reelier.certification-artifact-key-binding-commitment/v1\0", authorityDigest(commitmentBody));
  const humanPublic = publicKey(input.humanPrivateKey);
  if (humanPublic !== human.publicKeySpkiBase64 || !verifyDomain(human, "certification-readiness", "reelier.certification-artifact-key-binding-commitment/v1\0", authorityDigest(commitmentBody), commitmentSignature)) throw new TypeError("human private key does not match readiness descriptor");
  handles.set(handle as object, Object.freeze({ ...material, bindingDigest: authorityDigest(binding) }));
  return Object.freeze({ binding, humanCommitment: Object.freeze({ ...commitmentBody, signature: commitmentSignature }) });
}

export function consumeCertificationLifecycleAuthority(handle: CertificationLifecycleAuthorityHandle, binding: CertificationArtifactKeyBindingV1, commitment: CertificationArtifactKeyBindingCommitmentV1, input: Readonly<{ authorityCellId: string; taskId: string; readinessDigest: string; descriptors: readonly AuthorityKeyDescriptorV1[]; humanDescriptor: AuthorityKeyDescriptorV1; now: Date }>): CeremonyMaterial {
  const material = requireMaterial(handle);
  if (material.bindingDigest !== authorityDigest(binding)) throw new TypeError("artifact key binding does not belong to opaque authority handle");
  if (binding.authorityCellId !== input.authorityCellId || binding.taskId !== input.taskId || binding.adapterContractDigest !== AUTHORITY_ADAPTER_CONTRACT_V1_DIGEST || binding.readinessDigest !== input.readinessDigest || commitment.bindingDigest !== authorityDigest(binding) || commitment.readinessDigest !== input.readinessDigest || commitment.authorityCellId !== input.authorityCellId || commitment.taskId !== input.taskId || commitment.adapterContractDigest !== AUTHORITY_ADAPTER_CONTRACT_V1_DIGEST) throw new TypeError("artifact key binding identity, Adapter Contract, or readiness commitment mismatch");
  if (Date.parse(binding.issuedAt) > input.now.getTime() || Date.parse(binding.expiresAt) <= input.now.getTime()) throw new TypeError("artifact key binding is expired or not active");
  const evidence = material.direct.get("authority-evidence")!;
  if (binding.parentEvidenceDescriptorDigest !== authorityDigest(evidence.descriptor) || !input.descriptors.some(item => authorityDigest(item) === binding.parentEvidenceDescriptorDigest)) throw new TypeError("artifact key binding parent evidence authority is not activated");
  const { signature, ...bindingBody } = binding;
  if (binding.signerId !== evidence.descriptor.keyId || !verifyDomain(evidence.descriptor, "authority-evidence", "reelier.certification-artifact-key-binding/v1\0", authorityDigest(bindingBody), signature)) throw new TypeError("artifact key binding signature is invalid");
  const human = parseAuthorityKeyDescriptor(input.humanDescriptor), { signature: humanSignature, ...commitmentBody } = commitment;
  if (commitment.humanSignerId !== human.keyId || !verifyDomain(human, "certification-readiness", "reelier.certification-artifact-key-binding-commitment/v1\0", authorityDigest(commitmentBody), humanSignature)) throw new TypeError("artifact key binding human commitment is invalid");
  if (authorityDigest(binding.entries.map(item => item.artifactPurpose)) !== authorityDigest(ARTIFACT_PURPOSES) || binding.entries.some(item => { const expected = material.artifacts.get(item.artifactPurpose); return !expected || item.keyId !== expected.descriptor.keyId || item.publicKeySpkiBase64 !== expected.descriptor.publicKeySpkiBase64 || item.publicKeyDigest !== publicKeyDigest(item.publicKeySpkiBase64); })) throw new TypeError("artifact key binding subkeys are substituted or incomplete");
  handles.delete(handle as object);
  return material;
}

export function verifyCertificationArtifactKeyBinding(binding: CertificationArtifactKeyBindingV1, commitment: CertificationArtifactKeyBindingCommitmentV1, input: Readonly<{ descriptors: readonly AuthorityKeyDescriptorV1[]; signedReadiness: unknown; now?: Date }>): void {
  const readinessDigest = authorityDigest(input.signedReadiness), evidence = input.descriptors.find(item => authorityDigest(item) === binding.parentEvidenceDescriptorDigest), human = input.descriptors.find(item => item.role === "human-sponsor" && item.keyId === commitment.humanSignerId);
  if (!evidence || evidence.purpose !== "authority-evidence" || !human || human.purpose !== "certification-readiness" || binding.adapterContractDigest !== AUTHORITY_ADAPTER_CONTRACT_V1_DIGEST || commitment.adapterContractDigest !== AUTHORITY_ADAPTER_CONTRACT_V1_DIGEST || binding.readinessDigest !== readinessDigest || commitment.readinessDigest !== readinessDigest || commitment.bindingDigest !== authorityDigest(binding)) throw new TypeError("artifact key binding trust, Adapter Contract, or readiness link is invalid");
  const { signature, ...body } = binding, { signature: humanSignature, ...humanBody } = commitment;
  if (!verifyDomain(evidence, "authority-evidence", "reelier.certification-artifact-key-binding/v1\0", authorityDigest(body), signature) || !verifyDomain(human, "certification-readiness", "reelier.certification-artifact-key-binding-commitment/v1\0", authorityDigest(humanBody), humanSignature)) throw new TypeError("artifact key binding signature is invalid");
  if (binding.entries.length !== 4 || authorityDigest(binding.entries.map(item => item.artifactPurpose)) !== authorityDigest(ARTIFACT_PURPOSES) || new Set(binding.entries.map(item => item.keyId)).size !== 4 || binding.entries.some(item => item.publicKeyDigest !== publicKeyDigest(item.publicKeySpkiBase64))) throw new TypeError("artifact key binding entries are invalid");
  const now = (input.now ?? new Date(binding.issuedAt)).getTime(); if (Date.parse(binding.issuedAt) > now || Date.parse(binding.expiresAt) <= now) throw new TypeError("artifact key binding validity is invalid");
}

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
