import { createHash, randomUUID } from "node:crypto";

export type OperatorCellModeV1 = "local-cell" | "managed-cell" | "customer-hosted-cell";

export interface OperatorManagedHandoffV1 {
  readonly v: "reelier.operator-handoff/v1";
  readonly handoffId: string;
  readonly mode: Exclude<OperatorCellModeV1, "local-cell">;
  readonly providerAccountRef: string;
  readonly authorityDigest: string;
  readonly contractDigest: string;
  readonly expiresAt: string;
  readonly signature: string;
}

type HandoffPayload = Omit<OperatorManagedHandoffV1, "signature">;
const KEYS = new Set(["v", "handoffId", "mode", "providerAccountRef", "authorityDigest", "contractDigest", "expiresAt", "signature"]);

function bounded(value: unknown, name: string, max = 512): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max) throw new TypeError(`invalid handoff ${name}`);
  return value;
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex")}`;
}

function payloadOf(value: OperatorManagedHandoffV1): HandoffPayload {
  return { v: value.v, handoffId: value.handoffId, mode: value.mode, providerAccountRef: value.providerAccountRef, authorityDigest: value.authorityDigest, contractDigest: value.contractDigest, expiresAt: value.expiresAt };
}

export function parseOperatorManagedHandoffV1(value: unknown): OperatorManagedHandoffV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("managed handoff is not a record");
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== KEYS.size || keys.some((key) => !KEYS.has(key))) throw new TypeError("managed handoff shape is not closed");
  if (record.v !== "reelier.operator-handoff/v1") throw new TypeError("managed handoff version is invalid");
  const mode = record.mode;
  if (mode !== "managed-cell" && mode !== "customer-hosted-cell") throw new TypeError("managed handoff mode is invalid");
  const handoff: OperatorManagedHandoffV1 = Object.freeze({
    v: "reelier.operator-handoff/v1",
    handoffId: bounded(record.handoffId, "handoffId", 128),
    mode,
    providerAccountRef: bounded(record.providerAccountRef, "providerAccountRef", 512),
    authorityDigest: bounded(record.authorityDigest, "authorityDigest", 256),
    contractDigest: bounded(record.contractDigest, "contractDigest", 256),
    expiresAt: bounded(record.expiresAt, "expiresAt", 64),
    signature: bounded(record.signature, "signature", 4096),
  });
  if (Number.isNaN(Date.parse(handoff.expiresAt))) throw new TypeError("managed handoff expiry is invalid");
  return handoff;
}

export function createOperatorManagedHandoffV1(input: {
  readonly mode: Exclude<OperatorCellModeV1, "local-cell">;
  readonly providerAccountRef: string;
  readonly authorityDigest: string;
  readonly contractDigest: string;
  readonly expiresAt: string;
  readonly sign: (payloadDigest: string) => string;
  readonly handoffId?: string;
}): OperatorManagedHandoffV1 {
  const payload: HandoffPayload = {
    v: "reelier.operator-handoff/v1",
    handoffId: input.handoffId ?? randomUUID(),
    mode: input.mode,
    providerAccountRef: bounded(input.providerAccountRef, "providerAccountRef"),
    authorityDigest: bounded(input.authorityDigest, "authorityDigest", 256),
    contractDigest: bounded(input.contractDigest, "contractDigest", 256),
    expiresAt: bounded(input.expiresAt, "expiresAt", 64),
  };
  if (Number.isNaN(Date.parse(payload.expiresAt))) throw new TypeError("managed handoff expiry is invalid");
  const signature = bounded(input.sign(digest(payload)), "signature", 4096);
  return parseOperatorManagedHandoffV1({ ...payload, signature });
}

export function createOperatorManagedHandoffConsumerV1(input: {
  readonly handoff: OperatorManagedHandoffV1;
  readonly verify: (payloadDigest: string, signature: string) => boolean;
  readonly now?: () => string;
}): { consume(): OperatorManagedHandoffV1 } {
  const handoff = parseOperatorManagedHandoffV1(input.handoff);
  let consumed = false;
  return Object.freeze({
    consume(): OperatorManagedHandoffV1 {
      if (consumed) throw new Error("managed handoff was already consumed");
      consumed = true;
      const now = input.now ?? (() => new Date().toISOString());
      if (Date.parse(now()) >= Date.parse(handoff.expiresAt)) throw new Error("managed handoff expired");
      if (!input.verify(digest(payloadOf(handoff)), handoff.signature)) throw new Error("managed handoff signature is invalid");
      return handoff;
    },
  });
}
