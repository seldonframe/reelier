import {
  createContinuityRuntimeAdapter,
  FsContinuityLedger,
  type OutcomeRequesterV1,
} from "reelier/continuity";
import { identifyAuthenticatedWorkload, type ManagedContext } from "./binding.js";
import { ContinuityConfigurationError } from "./faults.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new ContinuityConfigurationError(`${name} is required`);
  return value;
}

function portUrl(): URL {
  const url = new URL(required("REELIER_PATH_C_PORT_URL"));
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.username || url.password) {
    throw new ContinuityConfigurationError("REELIER_PATH_C_PORT_URL must be an unauthenticated 127.0.0.1 HTTP URL");
  }
  return url;
}

type OutcomeRequest = Parameters<OutcomeRequesterV1>[1];
type AuthorityIngressOutcome = Awaited<ReturnType<OutcomeRequesterV1>>;

export async function readAuthorityIngressOutcome(response: Response): Promise<AuthorityIngressOutcome> {
  if (!response.ok) throw new Error(`Path C port refused request with HTTP ${response.status}`);
  const output = inertRecord(await response.json());
  const keys = Reflect.ownKeys(output);
  const allowed = new Set(["requestId", "verdict", "reasonCode", "lifecycleState", "receiptRef"]);
  if (keys.length < 4 || keys.length > 5 || keys.some(key => typeof key !== "string" || !allowed.has(key))) {
    throw new TypeError("Path C outcome response must be closed");
  }
  if (
    typeof output.requestId !== "string"
    || (output.verdict !== "accepted" && output.verdict !== "refused")
    || typeof output.reasonCode !== "string"
    || typeof output.lifecycleState !== "string"
    || ("receiptRef" in output && typeof output.receiptRef !== "string")
  ) {
    throw new TypeError("Path C outcome response is invalid");
  }
  const receiptRef = output.receiptRef as string | undefined;
  return Object.freeze({
    requestId: output.requestId,
    verdict: output.verdict,
    reasonCode: output.reasonCode,
    lifecycleState: output.lifecycleState,
    ...(receiptRef === undefined ? {} : { receiptRef }),
  });
}

function inertRecord(value: unknown): Record<string, unknown> {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Reflect.ownKeys(value).some(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return typeof key !== "string" || !descriptor || descriptor.get !== undefined || descriptor.set !== undefined;
    })
  ) {
    throw new TypeError("Path C outcome response must be an inert plain object");
  }
  return value as Record<string, unknown>;
}

export async function requestOutcomeFromPort(
  baseUrl: URL,
  token: string,
  input: OutcomeRequest,
): Promise<AuthorityIngressOutcome> {
  return readAuthorityIngressOutcome(await fetch(new URL("/outcomes", baseUrl), {
    method: "POST",
    redirect: "error",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ choices: input.choices, requestId: input.requestId, sourceRefs: input.sourceRefs }),
  }));
}

export async function statusOutcomeFromPort(
  baseUrl: URL,
  token: string,
  requestId: string,
): Promise<AuthorityIngressOutcome> {
  return readAuthorityIngressOutcome(await fetch(new URL(`/outcomes/${encodeURIComponent(requestId)}`, baseUrl), {
    method: "GET",
    redirect: "error",
    headers: { authorization: `Bearer ${token}` },
  }));
}

export function continuityRuntime(ctx: ManagedContext) {
  const root = required("REELIER_CONTINUITY_ROOT");
  const baseUrl = portUrl();
  const token = required("REELIER_PATH_C_PORT_TOKEN");
  return createContinuityRuntimeAdapter({
    ledger: new FsContinuityLedger(root),
    identify: async () => identifyAuthenticatedWorkload(ctx),
    requestOutcome: async (_actor, input: OutcomeRequest) => requestOutcomeFromPort(baseUrl, token, input),
    statusOutcome: async (_actor, input) => statusOutcomeFromPort(baseUrl, token, input.requestId),
  });
}

export function checkpointProtocolVersion(): "reelier.continuity-checkpoint/v1" {
  const version = required("REELIER_CONTINUITY_PROTOCOL_V");
  if (version !== "reelier.continuity-checkpoint/v1") {
    throw new ContinuityConfigurationError("unsupported continuity checkpoint protocol version");
  }
  return version;
}

export function checkpointDigests(): Readonly<{ jobCardDigest: string; authoritySnapshotDigest: string }> {
  return {
    jobCardDigest: required("REELIER_JOB_CARD_DIGEST"),
    authoritySnapshotDigest: required("REELIER_AUTHORITY_SNAPSHOT_DIGEST"),
  };
}
