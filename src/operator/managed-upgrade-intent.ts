import { createHash, timingSafeEqual } from "node:crypto";
import { types as utilTypes } from "node:util";
import canonicalize from "canonicalize";

export type ReviewedConsequentialOperationV1 =
  | "github_release_candidate_publish_v1"
  | "github_release_pr_ensure_v1"
  | "github_release_pr_merge_v1"
  | "linear_evidence_comment_v1"
  | "linear_status_transition_v1"
  | "linear_only_evidence_comment_v1"
  | "linear_only_status_transition_v1";

export type ManagedUpgradeIntentV1 = Readonly<{
  version: "reelier.managed-upgrade-intent/v1";
  missionRef: string;
  localEvidenceDigest: string;
  requestedOperations: readonly ReviewedConsequentialOperationV1[];
  targetSummaryDigest: string;
  returnChannelRef: string;
  issuedAt: string;
  expiresAt: string;
  nonce: string;
  signature: string;
}>;

type UnsignedManagedUpgradeIntentV1 = Omit<ManagedUpgradeIntentV1, "signature">;
const KEYS = Object.freeze(["version", "missionRef", "localEvidenceDigest", "requestedOperations", "targetSummaryDigest", "returnChannelRef", "issuedAt", "expiresAt", "nonce", "signature"] as const);
const KEY_SET = new Set<string>(KEYS);
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const OPERATIONS = new Set<ReviewedConsequentialOperationV1>([
  "github_release_candidate_publish_v1",
  "github_release_pr_ensure_v1",
  "github_release_pr_merge_v1",
  "linear_evidence_comment_v1",
  "linear_status_transition_v1",
  "linear_only_evidence_comment_v1",
  "linear_only_status_transition_v1",
]);

function inertRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || utilTypes.isProxy(value)) throw new TypeError("managed upgrade intent must be an inert record");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError("managed upgrade intent shape is invalid");
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== KEYS.length || ownKeys.some((key) => typeof key !== "string" || !KEY_SET.has(key))) throw new TypeError("managed upgrade intent shape is not closed");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const result: Record<string, unknown> = {};
  for (const key of KEYS) {
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw new TypeError("managed upgrade intent must contain inert enumerable fields");
    result[key] = descriptor.value;
  }
  return result;
}

function boundedIdentifier(value: unknown, name: string): string {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) throw new TypeError(`managed upgrade intent ${name} is invalid`);
  return value;
}

function digestValue(value: unknown, name: string): string {
  if (typeof value !== "string" || !DIGEST.test(value)) throw new TypeError(`managed upgrade intent ${name} is invalid`);
  return value;
}

function parseOperations(value: unknown): readonly ReviewedConsequentialOperationV1[] {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length === 0 || value.length > 7) throw new TypeError("managed upgrade intent operations are invalid");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const expected = new Set([...Array.from({ length: value.length }, (_, index) => String(index)), "length"]);
  if (Reflect.ownKeys(descriptors).length !== expected.size || Reflect.ownKeys(descriptors).some((key) => typeof key !== "string" || !expected.has(key))) throw new TypeError("managed upgrade intent operations shape is invalid");
  const operations: ReviewedConsequentialOperationV1[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable || typeof descriptor.value !== "string" || !OPERATIONS.has(descriptor.value as ReviewedConsequentialOperationV1)) throw new TypeError("managed upgrade intent operation is not reviewed");
    operations.push(descriptor.value as ReviewedConsequentialOperationV1);
  }
  if (new Set(operations).size !== operations.length) throw new TypeError("managed upgrade intent operations contain duplicates");
  return Object.freeze(operations);
}

function timestamp(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length > 64 || Number.isNaN(Date.parse(value))) throw new TypeError(`managed upgrade intent ${name} is invalid`);
  return value;
}

function unsigned(intent: ManagedUpgradeIntentV1): UnsignedManagedUpgradeIntentV1 {
  return Object.freeze({
    version: intent.version,
    missionRef: intent.missionRef,
    localEvidenceDigest: intent.localEvidenceDigest,
    requestedOperations: intent.requestedOperations,
    targetSummaryDigest: intent.targetSummaryDigest,
    returnChannelRef: intent.returnChannelRef,
    issuedAt: intent.issuedAt,
    expiresAt: intent.expiresAt,
    nonce: intent.nonce,
  });
}

function payloadDigest(value: UnsignedManagedUpgradeIntentV1): string {
  const bytes = canonicalize(value);
  if (bytes === undefined) throw new TypeError("managed upgrade intent is not canonicalizable");
  return `sha256:${createHash("sha256").update(bytes, "utf8").digest("hex")}`;
}

export function parseManagedUpgradeIntentV1(value: unknown): ManagedUpgradeIntentV1 {
  const record = inertRecord(value);
  if (record.version !== "reelier.managed-upgrade-intent/v1") throw new TypeError("managed upgrade intent version is invalid");
  const intent: ManagedUpgradeIntentV1 = Object.freeze({
    version: "reelier.managed-upgrade-intent/v1",
    missionRef: boundedIdentifier(record.missionRef, "mission reference"),
    localEvidenceDigest: digestValue(record.localEvidenceDigest, "local evidence digest"),
    requestedOperations: parseOperations(record.requestedOperations),
    targetSummaryDigest: digestValue(record.targetSummaryDigest, "target summary digest"),
    returnChannelRef: boundedIdentifier(record.returnChannelRef, "return channel reference"),
    issuedAt: timestamp(record.issuedAt, "issuedAt"),
    expiresAt: timestamp(record.expiresAt, "expiresAt"),
    nonce: boundedIdentifier(record.nonce, "nonce"),
    signature: boundedIdentifier(record.signature, "signature"),
  });
  if (Date.parse(intent.expiresAt) <= Date.parse(intent.issuedAt) || Date.parse(intent.expiresAt) - Date.parse(intent.issuedAt) > 15 * 60_000) throw new TypeError("managed upgrade intent validity window is invalid");
  return intent;
}

export function createManagedUpgradeIntentV1(input: Omit<UnsignedManagedUpgradeIntentV1, "version"> & Readonly<{ sign: (payloadDigest: string) => string }>): ManagedUpgradeIntentV1 {
  const candidate = parseManagedUpgradeIntentV1({
    version: "reelier.managed-upgrade-intent/v1",
    missionRef: input.missionRef,
    localEvidenceDigest: input.localEvidenceDigest,
    requestedOperations: input.requestedOperations,
    targetSummaryDigest: input.targetSummaryDigest,
    returnChannelRef: input.returnChannelRef,
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
    nonce: input.nonce,
    signature: "placeholder",
  });
  const signature = input.sign(payloadDigest(unsigned(candidate)));
  return parseManagedUpgradeIntentV1({ ...unsigned(candidate), signature });
}

export function createManagedUpgradeIntentConsumerV1(input: Readonly<{
  intent: ManagedUpgradeIntentV1;
  verify: (payloadDigest: string, signature: string) => boolean;
  now?: () => string;
}>): Readonly<{ consume(): ManagedUpgradeIntentV1 }> {
  const intent = parseManagedUpgradeIntentV1(input.intent);
  let consumed = false;
  return Object.freeze({
    consume(): ManagedUpgradeIntentV1 {
      if (consumed) throw new Error("managed upgrade intent was already consumed");
      const now = Date.parse((input.now ?? (() => new Date().toISOString()))());
      if (!Number.isFinite(now) || now >= Date.parse(intent.expiresAt) || now < Date.parse(intent.issuedAt)) throw new Error("managed upgrade intent expired or is not active");
      const expectedDigest = payloadDigest(unsigned(intent));
      if (!input.verify(expectedDigest, intent.signature)) throw new Error("managed upgrade intent signature is invalid");
      consumed = true;
      return intent;
    },
  });
}

const LABELS: Readonly<Record<ReviewedConsequentialOperationV1, string>> = Object.freeze({
  github_release_candidate_publish_v1: "publish",
  github_release_pr_ensure_v1: "create the pull request",
  github_release_pr_merge_v1: "merge",
  linear_evidence_comment_v1: "comment in Linear",
  linear_status_transition_v1: "update Linear",
  linear_only_evidence_comment_v1: "comment in Linear",
  linear_only_status_transition_v1: "update Linear",
});

export function recordConsequentialBoundaryV1(input: Readonly<{ missionRef: string; operation: string; seen: Set<string> }>): string | null {
  if (!IDENTIFIER.test(input.missionRef) || !(input.seen instanceof Set)) throw new TypeError("consequential boundary input is invalid");
  if (!OPERATIONS.has(input.operation as ReviewedConsequentialOperationV1)) return null;
  const key = `${input.missionRef}\u0000${input.operation}`;
  if (input.seen.has(key)) return null;
  input.seen.add(key);
  const action = LABELS[input.operation as ReviewedConsequentialOperationV1];
  return `Ready to ${action}. Continue natively, or let Reelier execute and verify it with bounded authority: reelier operator autopilot ${input.missionRef}`;
}

export function constantTimeSignatureEqualsV1(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}
