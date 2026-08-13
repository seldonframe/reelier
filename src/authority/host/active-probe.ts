import type { ClaimStatus } from "../types.js";
import {
  createTopologyProbe,
  runTopologyProbe,
  type TopologyEvidenceField,
  type TopologyProbe,
  type TopologyProbeRunInput,
} from "./topology.js";

/**
 * The context passed to reference probe operations.  It intentionally contains
 * no credentials, headers, environment values, or provider payloads.  A host
 * adapter may use the nonce to correlate its own observation without handing
 * ambient secrets to the probe runner.
 */
export interface ActiveTopologyProbeContext extends TopologyProbeRunInput {
  readonly nonce: string;
  readonly mode: "hermetic" | "live";
}

export type ActiveTopologyProbeOutcome =
  | ClaimStatus
  | boolean
  | Readonly<{ status: ClaimStatus }>
  | Readonly<{ ok: boolean }>;

export type ActiveTopologyProbeOperation =
  (context: Readonly<ActiveTopologyProbeContext>) => ActiveTopologyProbeOutcome | Promise<ActiveTopologyProbeOutcome>;

/** The six active checks are deliberately explicit and closed. */
export interface ActiveTopologyProbeOperations {
  readonly credentialIsolation: ActiveTopologyProbeOperation;
  readonly providerEgress: ActiveTopologyProbeOperation;
  readonly rawWriteReachability: ActiveTopologyProbeOperation;
  readonly readCoverage: ActiveTopologyProbeOperation;
  readonly runtimeIdentity: ActiveTopologyProbeOperation;
  readonly declaredSurfaceEnforcement: ActiveTopologyProbeOperation;
}

export interface ActiveTopologyProbeOptions {
  readonly probeId?: string;
  readonly operations: ActiveTopologyProbeOperations;
  /** Live operations are disabled unless this explicit acknowledgement is true. */
  readonly mode?: "hermetic" | "live";
  readonly allowLive?: boolean;
  /** Injectable nonce source keeps tests deterministic and avoids ambient randomness. */
  readonly nonce?: string | (() => string);
}

const operationFields: readonly TopologyEvidenceField[] = [
  "credentialIsolation",
  "providerEgress",
  "rawWriteReachability",
  "readCoverage",
  "runtimeIdentity",
  "declaredSurfaceEnforcement",
];
const ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/;
const DEFAULT_PROBE_ID = "reference-active-topology";

/**
 * Build the reference active probe. The runner itself performs no I/O and
 * never reads process.env; all host-specific behavior is supplied via
 * operations. Live mode requires an explicit `allowLive: true` acknowledgement.
 */
export function createActiveTopologyProbe(options: ActiveTopologyProbeOptions): TopologyProbe {
  validateOptions(options);
  const mode = options.mode ?? "hermetic";
  if (mode === "live" && options.allowLive !== true) {
    throw new TypeError("live topology probes require allowLive: true");
  }
  const probeId = options.probeId ?? DEFAULT_PROBE_ID;
  const nonceSource = options.nonce ?? (() => "active-probe");
  const nonceByInput = new WeakMap<object, string>();
  const nonceFor = (input: Readonly<TopologyProbeRunInput>): string => {
    const key = input as object;
    const existing = nonceByInput.get(key);
    if (existing !== undefined) return existing;
    const nonce = typeof nonceSource === "function" ? nonceSource() : nonceSource;
    if (typeof nonce !== "string" || !nonce || nonce.length > 256) throw new TypeError("topology probe nonce is invalid");
    nonceByInput.set(key, nonce);
    return nonce;
  };
  const checks = Object.fromEntries(operationFields.map(field => [field, async (input: Readonly<TopologyProbeRunInput>) => {
    const context: ActiveTopologyProbeContext = Object.freeze({ ...input, nonce: nonceFor(input), mode });
    const operation = options.operations[field];
    let outcome: ActiveTopologyProbeOutcome;
    try {
      outcome = await operation(context);
    } catch {
      // A failed observation cannot establish a boundary. Preserve a closed
      // evidence result instead of allowing an exception to become a pass.
      return "failed";
    }
    return normalizeActiveOutcome(outcome, field);
  }])) as Record<TopologyEvidenceField, (input: Readonly<TopologyProbeRunInput>) => Promise<ClaimStatus>>;
  return createTopologyProbe({ probeId, checks });
}

/** Alias emphasizing that this is the host adapter's reference implementation. */
export const createReferenceTopologyProbe = createActiveTopologyProbe;

/** Construct a live probe with an explicit opt-in at the call site. */
export function createLiveTopologyProbe(options: Omit<ActiveTopologyProbeOptions, "mode"> & { readonly allowLive: true }): TopologyProbe {
  return createActiveTopologyProbe({ ...options, mode: "live", allowLive: true });
}

/** Execute an active probe while retaining the standard signed-probe result shape. */
export async function runActiveTopologyProbe(probe: TopologyProbe, input: Readonly<TopologyProbeRunInput>) {
  return runTopologyProbe(probe, input);
}

/** Convenience form for callers that do not need to retain the probe object. */
export async function runReferenceTopologyProbe(options: ActiveTopologyProbeOptions, input: Readonly<TopologyProbeRunInput>) {
  return runActiveTopologyProbe(createReferenceTopologyProbe(options), input);
}

export const createReferenceActiveTopologyProbe = createActiveTopologyProbe;
export const runReferenceActiveTopologyProbe = runReferenceTopologyProbe;

function normalizeActiveOutcome(value: ActiveTopologyProbeOutcome, field: TopologyEvidenceField): ClaimStatus {
  if (typeof value === "boolean") return value ? "verified" : "failed";
  if (typeof value === "string") {
    if (["verified", "failed", "unchecked", "absent"].includes(value)) return value;
    throw new TypeError(`active topology probe ${field} returned an invalid claim`);
  }
  if (value && typeof value === "object") {
    if ("status" in value) return normalizeActiveOutcome(value.status, field);
    if ("ok" in value) return normalizeActiveOutcome(value.ok, field);
  }
  throw new TypeError(`active topology probe ${field} returned an invalid outcome`);
}

function validateOptions(options: ActiveTopologyProbeOptions): void {
  if (!options || typeof options !== "object" || !options.operations || typeof options.operations !== "object" || Array.isArray(options.operations)) throw new TypeError("active topology probe operations are required");
  if (options.probeId !== undefined && (typeof options.probeId !== "string" || !ID.test(options.probeId))) throw new TypeError("active topology probe id is invalid");
  if (options.mode !== undefined && options.mode !== "hermetic" && options.mode !== "live") throw new TypeError("active topology probe mode is invalid");
  const keys = Object.keys(options.operations).sort();
  if (keys.join("\0") !== [...operationFields].sort().join("\0")) throw new TypeError("active topology probe operations must exactly cover the six checks");
  for (const field of operationFields) if (typeof options.operations[field] !== "function") throw new TypeError(`active topology probe operation ${field} is invalid`);
  if (options.nonce !== undefined && typeof options.nonce !== "string" && typeof options.nonce !== "function") throw new TypeError("active topology probe nonce is invalid");
}
