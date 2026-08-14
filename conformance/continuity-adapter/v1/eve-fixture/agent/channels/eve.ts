import { createHash } from "node:crypto";
import { eveChannel } from "eve/channels/eve";
import { extractBearerToken, type AuthFn } from "eve/channels/auth";
import { ContinuityConfigurationError } from "../lib/faults.js";

type RegistryEntry = Readonly<{ principalId: string; taskId: string; workloadId: string }>;

function registry(): Readonly<Record<string, RegistryEntry>> {
  const encoded = process.env.REELIER_EVE_AUTH_REGISTRY_JSON;
  if (!encoded) throw new ContinuityConfigurationError("REELIER_EVE_AUTH_REGISTRY_JSON is required");
  const value: unknown = JSON.parse(encoded);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ContinuityConfigurationError("REELIER_EVE_AUTH_REGISTRY_JSON must be an object");
  }
  return value as Readonly<Record<string, RegistryEntry>>;
}

const bearerRegistryAuth: AuthFn<Request> = async (request) => {
  const token = extractBearerToken(request.headers.get("authorization"));
  if (!token) return null;
  const entry = registry()[createHash("sha256").update(token).digest("hex")];
  if (!entry || typeof entry.principalId !== "string" || typeof entry.taskId !== "string" || typeof entry.workloadId !== "string") {
    return null;
  }
  return {
    authenticator: "reelier-eve-conformance",
    principalId: entry.principalId,
    principalType: "user",
    attributes: { taskId: entry.taskId, workloadId: entry.workloadId },
  };
};

export default eveChannel({ auth: bearerRegistryAuth, turnPolicy: "queue" });
