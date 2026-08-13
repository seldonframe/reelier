import type { AuthoritySignature } from "./types.js";
import type { KeyObject } from "node:crypto";
import { signAuthorityDigest, verifyAuthoritySignature } from "./crypto.js";
import { authorityDigest } from "./wire.js";

export type OutcomeSemanticClass = "communication_commit_v1" | "record_state_set_v1" | "artifact_deliver_v1" | "schedule_commit_v1" | "money_refund_v1" | "commerce_purchase_commit_v1" | "deployment_release_v1" | "infrastructure_resource_set_v1" | "database_migration_apply_v1" | "secret_lifecycle_commit_v1" | "information_flow_commit_v1";

export interface SignedJobCardV1 {
  readonly v: "reelier.signed-job-card/v1";
  readonly signerId: string;
  readonly signature: AuthoritySignature;
  readonly jobId: string;
  readonly title: string;
  readonly taskShapeDigest: string;
  readonly semanticClasses: readonly OutcomeSemanticClass[];
  readonly definitionAliases: readonly string[];
  readonly connectorIds: readonly string[];
  readonly accountIdentities: readonly string[];
  readonly connectionDescriptorDigests: readonly string[];
  readonly adoptionCommitmentDigests: readonly string[];
  readonly sourceRefs: readonly string[];
  readonly audiences: readonly string[];
  readonly limitsDigest: string;
  readonly instructionsDigest: string;
  readonly packDigests: readonly string[];
  readonly exceptionPolicy: readonly string[];
  readonly coverage: "declared-surface" | "not-declared" | "unknown";
  readonly pathBSkillDigest?: string;
}

export type UnsignedJobCardV1 = Omit<SignedJobCardV1, "signerId" | "signature">;

/** Canonical commitment signed when a human deploys a reviewed job card. */
export function signedJobCardDigest(value: UnsignedJobCardV1 | SignedJobCardV1): string {
  const { v: _v, ...candidateFields } = value;
  const { signerId: _signerId, signature: _signature, ...fields } = candidateFields as typeof candidateFields & { signerId?: string; signature?: AuthoritySignature };
  return authorityDigest({ v: "reelier.signed-job-card-signing/v1", ...fields });
}

export function signJobCard(value: UnsignedJobCardV1, signerId: string, privateKey: KeyObject): SignedJobCardV1 {
  const card = { ...value, signerId, signature: signAuthorityDigest(privateKey, "signed-job-card", signedJobCardDigest(value)) };
  return normalizeSignedJobCard(card);
}

export function verifySignedJobCard(value: SignedJobCardV1, publicKey: KeyObject): boolean {
  const { signerId: _signerId, signature: _signature, ...unsigned } = value;
  return verifyAuthoritySignature(publicKey, "signed-job-card", signedJobCardDigest(unsigned), value.signature);
}

export function normalizeSignedJobCard(value: unknown): SignedJobCardV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("job card must be an object");
  const raw = value as Record<string, unknown>;
  const allowed = new Set(["v", "signerId", "signature", "jobId", "title", "taskShapeDigest", "semanticClasses", "definitionAliases", "connectorIds", "accountIdentities", "connectionDescriptorDigests", "adoptionCommitmentDigests", "sourceRefs", "audiences", "limitsDigest", "instructionsDigest", "packDigests", "exceptionPolicy", "coverage", "pathBSkillDigest"]);
  if (Object.keys(raw).some(key => !allowed.has(key)) || raw.v !== "reelier.signed-job-card/v1" || typeof raw.signerId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._~:-]{0,127}$/.test(raw.signerId) || typeof raw.jobId !== "string" || !raw.jobId || typeof raw.title !== "string" || !raw.title || !digest(raw.taskShapeDigest) || !digest(raw.limitsDigest) || !digest(raw.instructionsDigest) || !["declared-surface", "not-declared", "unknown"].includes(String(raw.coverage))) throw new TypeError("invalid signed job card");
  const signature = raw.signature;
  if (!signature || typeof signature !== "object" || Array.isArray(signature) || Object.keys(signature).length !== 2 || (signature as Record<string, unknown>).alg !== "ed25519" || typeof (signature as Record<string, unknown>).sig !== "string") throw new TypeError("invalid signed job card signature");
  const signatureBytes = Buffer.from((signature as Record<string, unknown>).sig as string, "base64");
  if (signatureBytes.length !== 64 || signatureBytes.toString("base64") !== (signature as Record<string, unknown>).sig) throw new TypeError("invalid signed job card signature");
  const list = (name: string): readonly string[] => { const value = raw[name]; if (!Array.isArray(value) || value.length === 0 || value.some(item => typeof item !== "string" || !item) || new Set(value).size !== value.length) throw new TypeError(`${name} must be a non-empty unique string array`); return Object.freeze([...value].sort()); };
  const classes = raw.semanticClasses;
  if (!Array.isArray(classes) || classes.length === 0 || classes.some(item => !["communication_commit_v1", "record_state_set_v1", "artifact_deliver_v1", "schedule_commit_v1", "money_refund_v1", "commerce_purchase_commit_v1", "deployment_release_v1", "infrastructure_resource_set_v1", "database_migration_apply_v1", "secret_lifecycle_commit_v1", "information_flow_commit_v1"].includes(String(item)))) throw new TypeError("invalid semantic classes");
  if (raw.pathBSkillDigest !== undefined && !digest(raw.pathBSkillDigest)) throw new TypeError("invalid Path B skill digest");
  const connectionDescriptorDigests = list("connectionDescriptorDigests");
  if (connectionDescriptorDigests.some(value => !digest(value))) throw new TypeError("connectionDescriptorDigests must contain digests");
  const adoptionCommitmentDigests = list("adoptionCommitmentDigests");
  if (adoptionCommitmentDigests.some(value => !digest(value))) throw new TypeError("adoptionCommitmentDigests must contain digests");
  return Object.freeze({ v: raw.v, signerId: raw.signerId, signature: Object.freeze({ alg: "ed25519" as const, sig: (signature as Record<string, unknown>).sig as string }), jobId: raw.jobId, title: raw.title, taskShapeDigest: raw.taskShapeDigest, semanticClasses: Object.freeze([...new Set(classes)] as OutcomeSemanticClass[]), definitionAliases: list("definitionAliases"), connectorIds: list("connectorIds"), accountIdentities: list("accountIdentities"), connectionDescriptorDigests, adoptionCommitmentDigests, sourceRefs: list("sourceRefs"), audiences: list("audiences"), limitsDigest: raw.limitsDigest, instructionsDigest: raw.instructionsDigest, packDigests: list("packDigests"), exceptionPolicy: list("exceptionPolicy"), coverage: raw.coverage as SignedJobCardV1["coverage"], ...(raw.pathBSkillDigest === undefined ? {} : { pathBSkillDigest: raw.pathBSkillDigest }) });
}

function digest(value: unknown): value is string { return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value); }
