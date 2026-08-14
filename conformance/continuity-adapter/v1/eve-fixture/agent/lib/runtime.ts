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

async function responseJson(response: Response): Promise<AuthorityIngressOutcome> {
  const output = await response.json() as AuthorityIngressOutcome;
  if (!response.ok) throw new Error(`Path C port refused request with HTTP ${response.status}`);
  return output;
}

export function continuityRuntime(ctx: ManagedContext) {
  const root = required("REELIER_CONTINUITY_ROOT");
  const baseUrl = portUrl();
  const token = required("REELIER_PATH_C_PORT_TOKEN");
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  return createContinuityRuntimeAdapter({
    ledger: new FsContinuityLedger(root),
    identify: async () => identifyAuthenticatedWorkload(ctx),
    requestOutcome: async (_actor, input: OutcomeRequest) => responseJson(await fetch(new URL("/outcomes", baseUrl), {
      method: "POST",
      headers,
      body: JSON.stringify({ choices: input.choices, requestId: input.requestId, sourceRefs: input.sourceRefs }),
    })),
    statusOutcome: async (_actor, input) => responseJson(await fetch(new URL(`/outcomes/${encodeURIComponent(input.requestId)}`, baseUrl), {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
    })),
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
