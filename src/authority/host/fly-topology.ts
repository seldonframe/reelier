import type { TopologyProbe, TopologyProbeRunInput } from "./topology.js";
import { createLiveTopologyProbe, runActiveTopologyProbe, type ActiveTopologyProbeContext, type ActiveTopologyProbeOperation } from "./active-probe.js";

export interface FlyDeclaredTopologySurface {
  readonly providerEndpoints: readonly string[];
  readonly rawWriteRouteIds: readonly string[];
  readonly schemaDigest: string;
  readonly networkPolicyDigest: string;
  readonly runtimeImageDigest: string;
}

export interface FlyRuntimeIdentityObservation {
  readonly nonce: string;
  readonly runtimeSession: string;
  readonly imageDigest: string;
}

export interface FlyCredentialIsolationObservation {
  readonly cellCredentialRefs: readonly string[];
  readonly agentCredentialRefs: readonly string[];
  readonly unexpectedCredentialRefs?: readonly string[];
  readonly complete: boolean;
}

export interface FlyRawWriteReachabilityObservation {
  readonly routes: readonly string[];
  readonly complete: boolean;
}

export interface FlyReadCoverageObservation {
  readonly surfaces: readonly string[];
  readonly complete: boolean;
}

export interface FlyDeclaredSurfaceObservation {
  readonly networkPolicyDigest: string;
  readonly providerEndpoints: readonly string[];
  readonly schemaDigest: string;
}

export interface FlyTopologyProbeOperations {
  readonly inspectRuntimeIdentity: (context: Readonly<ActiveTopologyProbeContext>) => FlyRuntimeIdentityObservation | Promise<FlyRuntimeIdentityObservation>;
  readonly inspectCredentialIsolation: (context: Readonly<ActiveTopologyProbeContext>) => FlyCredentialIsolationObservation | Promise<FlyCredentialIsolationObservation>;
  readonly probeProviderEgress: (input: Readonly<{ endpoint: string; caller: "cell" | "agent"; context: ActiveTopologyProbeContext }>) => boolean | Promise<boolean>;
  readonly inspectRawWriteReachability: (context: Readonly<ActiveTopologyProbeContext>) => FlyRawWriteReachabilityObservation | Promise<FlyRawWriteReachabilityObservation>;
  readonly inspectReadCoverage: (context: Readonly<ActiveTopologyProbeContext>) => FlyReadCoverageObservation | Promise<FlyReadCoverageObservation>;
  readonly inspectDeclaredSurface: (context: Readonly<ActiveTopologyProbeContext>) => FlyDeclaredSurfaceObservation | Promise<FlyDeclaredSurfaceObservation>;
}

export interface FlyTopologyProbeOptions {
  readonly declaredSurface: FlyDeclaredTopologySurface;
  readonly operations: FlyTopologyProbeOperations;
  readonly allowLive?: boolean;
  readonly nonce?: string | (() => string);
  readonly probeId?: string;
}

export function createFlyTopologyProbe(options: FlyTopologyProbeOptions): TopologyProbe {
  validateOptions(options);
  const declared = options.declaredSurface;
  const operations = options.operations;
  const wrapped: Parameters<typeof createLiveTopologyProbe>[0]["operations"] = {
    credentialIsolation: async context => {
      const observation = await operations.inspectCredentialIsolation(context);
      return observation.complete && observation.cellCredentialRefs.length > 0 && observation.agentCredentialRefs.length === 0 && (observation.unexpectedCredentialRefs?.length ?? 0) === 0;
    },
    providerEgress: async context => {
      for (const endpoint of declared.providerEndpoints) {
        const cell = await operations.probeProviderEgress({ endpoint, caller: "cell", context });
        const agent = await operations.probeProviderEgress({ endpoint, caller: "agent", context });
        if (!cell || agent) return false;
      }
      return true;
    },
    rawWriteReachability: async context => {
      const observation = await operations.inspectRawWriteReachability(context);
      return observation.complete && observation.routes.length === 0;
    },
    readCoverage: async context => {
      const observation = await operations.inspectReadCoverage(context);
      return observation.complete && observation.surfaces.every(surface => typeof surface === "string" && surface.length > 0);
    },
    runtimeIdentity: async context => {
      const observation = await operations.inspectRuntimeIdentity(context);
      return observation.nonce === context.nonce && observation.runtimeSession.length > 0 && observation.imageDigest === declared.runtimeImageDigest;
    },
    declaredSurfaceEnforcement: async context => {
      const observation = await operations.inspectDeclaredSurface(context);
      return observation.networkPolicyDigest === declared.networkPolicyDigest
        && observation.schemaDigest === declared.schemaDigest
        && sameList(observation.providerEndpoints, declared.providerEndpoints);
    },
  };
  return createLiveTopologyProbe({ probeId: options.probeId, operations: wrapped, nonce: options.nonce, allowLive: true });
}

export async function runFlyTopologyProbe(probe: TopologyProbe, input: Readonly<TopologyProbeRunInput>) {
  return runActiveTopologyProbe(probe, input);
}

function sameList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validateOptions(options: FlyTopologyProbeOptions): void {
  if (!options || typeof options !== "object" || options.allowLive !== true) throw new TypeError("Fly topology probes require allowLive: true");
  if (!options.declaredSurface || !Array.isArray(options.declaredSurface.providerEndpoints) || !Array.isArray(options.declaredSurface.rawWriteRouteIds)) throw new TypeError("Fly topology declared surface is invalid");
  const digest = /^sha256:[0-9a-f]{64}$/;
  for (const value of [options.declaredSurface.schemaDigest, options.declaredSurface.networkPolicyDigest, options.declaredSurface.runtimeImageDigest]) if (!digest.test(value)) throw new TypeError("Fly topology declared digest is invalid");
  if (!options.operations || typeof options.operations !== "object") throw new TypeError("Fly topology operations are required");
  const required: readonly (keyof FlyTopologyProbeOperations)[] = ["inspectRuntimeIdentity", "inspectCredentialIsolation", "probeProviderEgress", "inspectRawWriteReachability", "inspectReadCoverage", "inspectDeclaredSurface"];
  for (const key of required) if (typeof options.operations[key] !== "function") throw new TypeError(`Fly topology operation ${key} is required`);
}
