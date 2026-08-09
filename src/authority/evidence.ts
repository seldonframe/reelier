import type {
  AuthorityEvidence,
  AuthorityReceipt,
  AuthorityReceiptBundle,
  AuthoritySignature,
  AuthorityKind,
  SignedAuthorityArtifact,
} from "./types.js";
import { authorityCanonicalBytes, authorityDigest, parseAuthorityWire } from "./wire.js";

const SHA = /^sha256:(?!0{64}$)[0-9a-f]{64}$/;
const ID = /^[A-Za-z0-9._~-]{1,128}$/;

export interface AuthorityEvidenceInput extends Omit<AuthorityEvidence, "v"> {}

/** Builds the immutable evidence commitment emitted alongside a receipt. */
export function createAuthorityEvidence(input: AuthorityEvidenceInput): AuthorityEvidence {
  return parseAuthorityWire("authority-evidence", {
    ...input,
    v: "reelier.authority-evidence/v1",
  }) as AuthorityEvidence;
}

export interface AuthorityReceiptInput extends Omit<AuthorityReceipt, "v" | "evidenceDigest" | "priorReceiptDigest"> {
  readonly evidence?: AuthorityEvidence;
  readonly evidenceDigest?: string;
  readonly priorReceiptDigest?: string|null;
}

/** Builds a receipt and binds it to evidence. `completeness` is never auto-promoted. */
export function createAuthorityReceipt(input: AuthorityReceiptInput): AuthorityReceipt {
  const evidenceDigest = input.evidence ? authorityDigest(parseAuthorityWire("authority-evidence", input.evidence)) : input.evidenceDigest;
  if (!evidenceDigest || !SHA.test(evidenceDigest)) throw new TypeError("authority receipt requires an evidence digest");
  if (input.claims.completeness === "verified") throw new TypeError("completeness cannot be verified by an authority receipt");
  const { evidence: _evidence, ...receiptInput } = input;
  const receipt = parseAuthorityWire("authority-receipt", {
    ...receiptInput,
    v: "reelier.authority-receipt/v1",
    ...(input.evidence ? { evidenceDigest } : {}),
    priorReceiptDigest: input.priorReceiptDigest ?? null,
  }) as AuthorityReceipt;
  if (input.evidence) {
    const evidence = parseAuthorityWire("authority-evidence", input.evidence) as AuthorityEvidence;
    if (evidence.receiptId !== receipt.receiptId) throw new TypeError("evidence receipt id mismatch");
    if (evidence.decisionContextDigest !== receipt.decisionContextDigest) throw new TypeError("evidence decision context mismatch");
  }
  return receipt;
}

function parseSignedArtifact<K extends AuthorityKind>(kind: K, input: unknown): SignedAuthorityArtifact<K> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("signed authority artifact must be an object");
  const value = input as Record<string, unknown>;
  const expected = ["kind", "signerId", "digest", "value", "signature"];
  if (Object.keys(value).length !== expected.length || expected.some(key => !Object.prototype.hasOwnProperty.call(value, key))) throw new TypeError("signed authority artifact is not closed");
  if (value.kind !== kind || typeof value.signerId !== "string" || !ID.test(value.signerId) || typeof value.digest !== "string" || !SHA.test(value.digest)) throw new TypeError("signed authority artifact metadata is invalid");
  const parsed = parseAuthorityWire(kind, value.value);
  if (authorityDigest(parsed) !== value.digest) throw new TypeError(`signed ${kind} digest mismatch`);
  const signature = parseSignature(value.signature);
  return Object.freeze({ kind, signerId: value.signerId, digest: value.digest, value: parsed, signature }) as SignedAuthorityArtifact<K>;
}

function parseSignature(value: unknown): AuthoritySignature {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 2) throw new TypeError("authority signature must be closed");
  const signature = value as Record<string, unknown>;
  if (signature.alg !== "ed25519" || typeof signature.sig !== "string") throw new TypeError("authority signature is invalid");
  const bytes = Buffer.from(signature.sig, "base64");
  if (bytes.length !== 64 || bytes.toString("base64") !== signature.sig) throw new TypeError("authority signature must contain canonical 64-byte Base64");
  return Object.freeze({ alg: "ed25519", sig: signature.sig });
}

/** Strictly parses a portable, detached-signature receipt bundle without trusting it. */
export function parseAuthorityReceiptBundle(value: unknown): AuthorityReceiptBundle {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("authority receipt bundle must be an object");
  const raw = value as Record<string, unknown>;
  const required = ["v", "contract", "delegation", "sourceBundle", "capability", "transportEffect", "gateEvent", "evidence", "receipt", "packManifest", "signatures"];
  if (Object.keys(raw).length !== required.length || required.some(key => !Object.prototype.hasOwnProperty.call(raw, key))) throw new TypeError("authority receipt bundle is not closed");
  if (raw.v !== "reelier.authority-receipt-bundle/v1" || !Array.isArray(raw.delegation) || raw.delegation.length === 0 || !Array.isArray(raw.signatures)) throw new TypeError("authority receipt bundle envelope is invalid");
  const bundle = {
    v: raw.v,
    contract: parseSignedArtifact("outcome-contract", raw.contract),
    delegation: Object.freeze(raw.delegation.map(item => parseSignedArtifact("delegation-grant", item))),
    sourceBundle: parseSignedArtifact("source-bundle", raw.sourceBundle),
    capability: parseSignedArtifact("compiled-capability", raw.capability),
    transportEffect: parseSignedArtifact("transport-effect", raw.transportEffect),
    gateEvent: parseSignedArtifact("gate-event", raw.gateEvent),
    evidence: parseSignedArtifact("authority-evidence", raw.evidence),
    receipt: parseSignedArtifact("authority-receipt", raw.receipt),
    packManifest: parseSignedArtifact("pack-manifest", raw.packManifest),
    signatures: Object.freeze(raw.signatures.map(parseDetachedSignature)),
  } as AuthorityReceiptBundle;
  assertBundleEdges(bundle);
  const artifacts = [bundle.contract, ...bundle.delegation, bundle.sourceBundle, bundle.capability, bundle.transportEffect, bundle.gateEvent, bundle.evidence, bundle.receipt, bundle.packManifest];
  if (bundle.signatures.length !== artifacts.length || bundle.signatures.some((signature, index) => signature.kind !== artifacts[index].kind || signature.digest !== artifacts[index].digest || signature.signerId !== artifacts[index].signerId)) throw new TypeError("receipt bundle detached signatures are not in canonical artifact order");
  return deepFreeze(bundle);
}

export function createAuthorityReceiptBundle(input: Omit<AuthorityReceiptBundle, "signatures"> & { readonly signatures?: readonly AuthorityReceiptBundle["signatures"][number][] }): AuthorityReceiptBundle {
  const artifacts = [input.contract, ...input.delegation, input.sourceBundle, input.capability, input.transportEffect, input.gateEvent, input.evidence, input.receipt, input.packManifest];
  const signatures = input.signatures ?? artifacts.map(item => ({ kind: item.kind, digest: item.digest, signerId: item.signerId, signature: item.signature }));
  return parseAuthorityReceiptBundle({ ...input, signatures });
}

function parseDetachedSignature(value: unknown): AuthorityReceiptBundle["signatures"][number] {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("detached authority signature is invalid");
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).length !== 4 || typeof raw.kind !== "string" || typeof raw.signerId !== "string" || !ID.test(raw.signerId) || typeof raw.digest !== "string" || !SHA.test(raw.digest)) throw new TypeError("detached authority signature is invalid");
  if (!(raw.kind as string) || !Object.prototype.hasOwnProperty.call({ principal: true, "delegation-grant": true, "source-bundle": true, "outcome-contract": true, "outcome-request": true, "transport-effect": true, "compiled-capability": true, "decision-context": true, "gate-event": true, "authority-evidence": true, "authority-receipt": true, "pack-manifest": true }, raw.kind)) throw new TypeError("detached authority signature purpose is invalid");
  return Object.freeze({ kind: raw.kind as AuthorityKind, digest: raw.digest, signerId: raw.signerId as string, signature: parseSignature(raw.signature) });
}

function assertBundleEdges(bundle: AuthorityReceiptBundle): void {
  const context = bundle.receipt.value.decisionContext;
  if (bundle.receipt.digest !== authorityDigest(bundle.receipt.value)) throw new TypeError("receipt artifact digest mismatch");
  if (bundle.evidence.value.receiptId !== bundle.receipt.value.receiptId) throw new TypeError("receipt/evidence id mismatch");
  if (bundle.receipt.value.evidenceDigest !== bundle.evidence.digest) throw new TypeError("receipt evidence digest mismatch");
  if (bundle.evidence.value.decisionContextDigest !== bundle.receipt.value.decisionContextDigest || bundle.receipt.value.decisionContextDigest !== authorityDigest(context)) throw new TypeError("receipt decision context edge mismatch");
  if (bundle.gateEvent.value.decisionContextDigest !== bundle.receipt.value.decisionContextDigest || bundle.receipt.value.gateEventDigest !== bundle.gateEvent.digest) throw new TypeError("receipt gate event edge mismatch");
  if (context.effectDigest !== bundle.transportEffect.digest || bundle.evidence.value.effectDigest !== bundle.transportEffect.digest) throw new TypeError("transport effect edge mismatch");
  if (context.capabilityDigest !== bundle.capability.digest || context.snapshots.sourceBundleDigest !== bundle.sourceBundle.digest) throw new TypeError("compiled artifact edge mismatch");
  if (bundle.contract.digest !== context.contractDigest) throw new TypeError("contract edge mismatch");
  if (bundle.packManifest.value.definitions.indexOf(context.definitionAlias) < 0) throw new TypeError("pack manifest does not contain definition");
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export function digestAuthorityReceiptBundle(value: unknown): string {
  return authorityDigest(parseAuthorityReceiptBundle(value));
}

export function authorityEvidenceCanonicalBytes(value: AuthorityEvidence): Buffer {
  return authorityCanonicalBytes(parseAuthorityWire("authority-evidence", value));
}
