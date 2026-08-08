import { createHash } from "node:crypto";
import type { OutcomeRequest } from "./types.js";
import { authorityCanonicalBytes, authorityDigest, parseAuthorityWire } from "./wire.js";

const SHA = /^sha256:[0-9a-f]{64}$/;
const ZERO_SHA = `sha256:${"0".repeat(64)}`;
const authenticatedRequestBrand = Symbol("AuthenticatedOutcomeRequest");

export interface AuthenticatedOutcomeRequest { readonly [authenticatedRequestBrand]: true }

export interface AuthenticatedOutcomeRequestState {
  readonly tenant: string;
  readonly requester: string;
  readonly definitionAlias: string;
  readonly request: OutcomeRequest;
  readonly canonicalRequestBase64: string;
  readonly requestDigest: string;
  readonly requestKey: string;
}

const authenticatedStates = new WeakMap<object, AuthenticatedOutcomeRequestState>();

export function digestOutcomeRequest(request: unknown): string {
  return authorityDigest(parseAuthorityWire("outcome-request", request));
}

export function deriveAuthorityRequestKey(input: Readonly<{ tenant:string;requester:string;requestId:string }>): string {
  assertFields(input, ["tenant", "requester", "requestId"]);
  return lengthPrefixedDigest("reelier-authority-request-key/v1\0", [
    ["tenant", input.tenant], ["requester", input.requester], ["requestId", input.requestId],
  ]);
}

export function authenticateOutcomeRequest(input: Readonly<{ tenant:string;requester:string;definitionAlias:string;request:unknown }>): AuthenticatedOutcomeRequest {
  assertFields(input, ["tenant", "requester", "definitionAlias"]);
  const request = deepFreeze(parseAuthorityWire("outcome-request", input.request));
  const canonicalRequestBytes = authorityCanonicalBytes(request);
  const state = deepFreeze({
    tenant: input.tenant,
    requester: input.requester,
    definitionAlias: input.definitionAlias,
    request,
    canonicalRequestBase64: canonicalRequestBytes.toString("base64"),
    requestDigest: authorityDigest(request),
    requestKey: deriveAuthorityRequestKey({ tenant: input.tenant, requester: input.requester, requestId: request.requestId }),
  });
  const branded = Object.freeze(Object.create(null)) as AuthenticatedOutcomeRequest;
  authenticatedStates.set(branded, state);
  return branded;
}

export function authenticatedOutcomeRequestState(value: AuthenticatedOutcomeRequest): AuthenticatedOutcomeRequestState {
  const state = authenticatedStates.get(value as object);
  if (!state) throw new TypeError("unrecognized authenticated request");
  return state;
}

export function deriveContractWindowLimitKey(input: Readonly<{ tenant:string;contractDigest:string;issuedAt:string;windowSeconds:number }>): Readonly<{key:string;windowStartEpochMs:number;windowEndEpochMs:number}> {
  assertFields(input, ["tenant", "contractDigest", "issuedAt"]);
  if (!SHA.test(input.contractDigest) || input.contractDigest === ZERO_SHA) throw new TypeError("contract digest must be non-zero lowercase sha256");
  if (!Number.isInteger(input.windowSeconds) || input.windowSeconds < 1 || input.windowSeconds > 31_536_000) throw new TypeError("window seconds out of range");
  const issuedAtEpochMs = Date.parse(input.issuedAt);
  if (!Number.isSafeInteger(issuedAtEpochMs) || issuedAtEpochMs < 0) throw new TypeError("issuedAt must be a valid nonnegative instant");
  const windowDurationMs = input.windowSeconds * 1_000;
  if (!Number.isSafeInteger(windowDurationMs)) throw new TypeError("window duration is unsafe");
  const windowStartEpochMs = Math.floor(issuedAtEpochMs / windowDurationMs) * windowDurationMs;
  const windowEndEpochMs = windowStartEpochMs + windowDurationMs;
  if (!Number.isSafeInteger(windowStartEpochMs) || !Number.isSafeInteger(windowEndEpochMs)) throw new TypeError("window boundary is unsafe");
  const key = lengthPrefixedDigest("reelier-authority-contract-window-limit-key/v1\0", [
    ["tenant", input.tenant], ["contractDigest", input.contractDigest],
    ["windowStartEpochMs", canonicalUnsigned(windowStartEpochMs)], ["windowDurationMs", canonicalUnsigned(windowDurationMs)],
  ]);
  return Object.freeze({ key, windowStartEpochMs, windowEndEpochMs });
}

export function deriveProviderSourceTriggerLimitKey(input: Readonly<{tenant:string;connectorId:string;providerAccountIdentity:string;resolverId:string;sourceIdentity:string;triggerIdentity:string}>): string {
  const fields = ["tenant", "connectorId", "providerAccountIdentity", "resolverId", "sourceIdentity", "triggerIdentity"] as const;
  assertFields(input, fields);
  return lengthPrefixedDigest("reelier-authority-provider-source-trigger-limit-key/v1\0", fields.map(field => [field, input[field]]));
}

function lengthPrefixedDigest(domain: string, fields: readonly (readonly [string,string])[]): string {
  const hash = createHash("sha256").update(Buffer.from(domain, "utf8"));
  for (const [name, value] of fields) {
    for (const item of [name, value]) {
      const bytes = Buffer.from(item, "utf8");
      if (bytes.length > 0xffff_ffff) throw new TypeError("authority key field is too long");
      const length = Buffer.allocUnsafe(4); length.writeUInt32BE(bytes.length);
      hash.update(length).update(bytes);
    }
  }
  const result = `sha256:${hash.digest("hex")}`;
  if (result === ZERO_SHA) throw new TypeError("authority key digest may not be zero");
  return result;
}

function assertFields<T extends object, K extends keyof T>(input: T, fields: readonly K[]): void {
  for (const field of fields) if (typeof input[field] !== "string" || (input[field] as string).length === 0) throw new TypeError(`${String(field)} must be a non-empty string`);
}

function canonicalUnsigned(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError("integer must be unsigned and safe");
  return String(value);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
