import { spawn } from "node:child_process";
import { executeJsonHttpsRead } from "../drivers/json-https.js";
import { authorityDigest } from "../wire.js";
import { createSecretResolver, type SecretResolver } from "./secret-resolver.js";
import { readFlyNetworkPolicyDigest } from "./fly-network-policy-client.js";
import type { FlyTopologyProbeOperations } from "./fly-topology.js";
import type { TopologyProbeCommandResult, TopologyProbeEgressV1, TopologyProbeSnapshotV1 } from "./topology-probe-command.js";

const APP = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const MACHINE = /^[A-Za-z0-9][A-Za-z0-9_-]{1,127}$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const PROBE_CONFIG = "/etc/reelier/topology-probe.json";

export interface FlyRemoteProbeResource {
  readonly appName: string;
  readonly authorityMachineId: string;
  readonly agentAppName: string;
  readonly agentMachineId: string;
  readonly egressAppName: string;
  readonly egressMachineId: string;
  readonly apiCredentialRef: string;
  readonly flyctlPath: string;
  readonly flyctlVersion: string;
}

export interface FlyRemoteProbeExpected {
  readonly providerEndpoints: readonly string[];
  readonly schemaDigest: string;
  readonly networkPolicyDigest: string;
  readonly runtimeImageDigest: string;
  readonly authorityImageDigest: string;
  readonly gatewayImageDigest: string;
}

export interface FlyMachineObservation { readonly state: string; readonly imageDigest: string }

export interface FlyRemoteProbeDependencies {
  readonly getMachine?: (appName: string, machineId: string) => Promise<FlyMachineObservation>;
  readonly getNetworkPolicyDigest?: (appName: string) => Promise<string>;
  readonly runProbe?: (appName: string, machineId: string, action: "snapshot" | "egress", argument: string) => Promise<TopologyProbeCommandResult>;
  readonly secrets?: SecretResolver;
}

export function createFlyRemoteTopologyOperations(input: Readonly<{ resource: FlyRemoteProbeResource; expected: FlyRemoteProbeExpected } & FlyRemoteProbeDependencies>): FlyTopologyProbeOperations {
  validate(input.resource, input.expected);
  const secrets = input.secrets ?? createSecretResolver();
  const getMachine = input.getMachine ?? ((app, machine) => readMachine(app, machine, input.resource.apiCredentialRef, secrets));
  const getNetworkPolicyDigest = input.getNetworkPolicyDigest ?? (app => readFlyNetworkPolicyDigest({ appName: app, credentialRef: input.resource.apiCredentialRef, secrets }));
  const runProbe = input.runProbe ?? ((app, machine, action, argument) => runFlyctlProbe(input.resource, secrets, app, machine, action, argument));
  const snapshots = new Map<string, Promise<TopologyProbeSnapshotV1>>();
  const snapshot = (role: "cell" | "agent" | "gateway", nonce: string) => {
    const key = `${role}:${nonce}`;
    let pending = snapshots.get(key);
    if (!pending) {
      const target = role === "cell" ? [input.resource.appName, input.resource.authorityMachineId] : role === "agent" ? [input.resource.agentAppName, input.resource.agentMachineId] : [input.resource.egressAppName, input.resource.egressMachineId];
      pending = runProbe(target[0], target[1], "snapshot", nonce).then(value => parseSnapshot(value, role, nonce));
      snapshots.set(key, pending);
    }
    return pending;
  };
  return Object.freeze({
    async inspectRuntimeIdentity(context) {
      const [machine, observed] = await Promise.all([getMachine(input.resource.agentAppName, input.resource.agentMachineId), snapshot("agent", context.nonce)]);
      if (machine.state !== "started") throw new Error("Fly agent Machine is not started");
      if (!DIGEST.test(machine.imageDigest)) throw new Error("Fly agent Machine image digest is invalid");
      return Object.freeze({ nonce: observed.nonce, runtimeSession: observed.runtimeSession, imageDigest: machine.imageDigest });
    },
    async inspectCredentialIsolation(context) {
      const [cell, agent, cellMachine, agentMachine, gatewayMachine] = await Promise.all([
        snapshot("cell", context.nonce),
        snapshot("agent", context.nonce),
        getMachine(input.resource.appName, input.resource.authorityMachineId),
        getMachine(input.resource.agentAppName, input.resource.agentMachineId),
        getMachine(input.resource.egressAppName, input.resource.egressMachineId),
      ]);
      if (cellMachine.state !== "started" || agentMachine.state !== "started" || gatewayMachine.state !== "started") throw new Error("Fly topology Machine is not started");
      if (cellMachine.imageDigest !== input.expected.authorityImageDigest || agentMachine.imageDigest !== input.expected.runtimeImageDigest || gatewayMachine.imageDigest !== input.expected.gatewayImageDigest) throw new Error("Fly topology Machine image does not match the signed deployment");
      return Object.freeze({ cellCredentialRefs: cell.providerCredentialRefs, agentCredentialRefs: agent.providerCredentialRefs, unexpectedCredentialRefs: Object.freeze([...new Set([...cell.unexpectedCredentialRefs, ...agent.unexpectedCredentialRefs])].sort()), complete: true });
    },
    async probeProviderEgress({ endpoint, caller, context }) {
      // This deliberately probes from the Cell itself. Merely proving that a
      // separate gateway can reach a provider would not prove the Cell has a
      // usable, enforced route through that gateway.
      const target = caller === "cell" ? [input.resource.appName, input.resource.authorityMachineId] : [input.resource.agentAppName, input.resource.agentMachineId];
      const result = parseEgress(await runProbe(target[0], target[1], "egress", endpoint), endpoint);
      return result.reachable;
    },
    async inspectRawWriteReachability(context) {
      const agent = await snapshot("agent", context.nonce);
      return Object.freeze({ routes: agent.rawWriteRouteIds, complete: true });
    },
    async inspectReadCoverage(context) {
      const agent = await snapshot("agent", context.nonce);
      return Object.freeze({ surfaces: agent.readSurfaceIds, complete: true });
    },
    async inspectDeclaredSurface(context) {
      const [cell, authorityPolicy, agentPolicy, gatewayPolicy] = await Promise.all([
        snapshot("cell", context.nonce),
        getNetworkPolicyDigest(input.resource.appName),
        getNetworkPolicyDigest(input.resource.agentAppName),
        getNetworkPolicyDigest(input.resource.egressAppName),
      ]);
      const networkPolicyDigest = digestFlyPolicyDeployment({ authority: authorityPolicy, agent: agentPolicy, gateway: gatewayPolicy });
      return Object.freeze({ networkPolicyDigest, providerEndpoints: cell.providerEndpoints, schemaDigest: cell.schemaDigest });
    },
  } as FlyTopologyProbeOperations);
}

export function digestFlyPolicyDeployment(input: Readonly<{ authority: string; agent: string; gateway: string }>): string {
  for (const value of Object.values(input)) if (!DIGEST.test(value)) throw new TypeError("Fly deployed policy digest is invalid");
  return authorityDigest({ v: "reelier.fly-policy-deployment/v1", authority: input.authority, agent: input.agent, gateway: input.gateway });
}

export async function probePinnedFlyBinary(binaryPath: string, expectedVersion: string, timeoutMs = 5_000, execute: (binaryPath: string, timeoutMs: number) => Promise<{ code: number; output: string }> = executeFlyVersion): Promise<"available" | "missing"> {
  if (typeof binaryPath !== "string" || binaryPath.length === 0 || !VERSION.test(expectedVersion) || !Number.isSafeInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 30_000) throw new TypeError("pinned flyctl probe input is invalid");
  try {
    const result = await execute(binaryPath, timeoutMs);
    return result.code === 0 && new RegExp(`(?:^|[ v])${escapeRegExp(expectedVersion)}(?:\\s|$)`).test(result.output) ? "available" : "missing";
  } catch { return "missing"; }
}

async function readMachine(appName: string, machineId: string, credentialRef: string, secrets: SecretResolver): Promise<FlyMachineObservation> {
  const endpoint = { endpointId: "fly.machine.read", baseUrl: "https://api.machines.dev", allowedMethods: ["GET" as const], allowedPathPrefixes: [`/v1/apps/${appName}/machines`], secretRef: credentialRef, accountIdentity: appName };
  const response = await executeJsonHttpsRead({ endpointId: endpoint.endpointId, path: `/v1/apps/${appName}/machines/${machineId}`, query: "", headers: { Accept: "application/json" } }, endpoint, secrets);
  if (response.status < 200 || response.status >= 300) throw new Error("Fly Machine read failed");
  let raw: unknown;
  try { raw = JSON.parse(response.body.toString("utf8")); } catch { throw new Error("Fly Machine read is not JSON"); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Fly Machine read is invalid");
  const machine = raw as Record<string, unknown>;
  const image = machine.image_ref as Record<string, unknown> | undefined;
  if (typeof machine.state !== "string" || !image || typeof image.digest !== "string" || !DIGEST.test(image.digest)) throw new Error("Fly Machine identity is invalid");
  return Object.freeze({ state: machine.state, imageDigest: image.digest });
}

async function runFlyctlProbe(resource: FlyRemoteProbeResource, secrets: SecretResolver, appName: string, machineId: string, action: "snapshot" | "egress", argument: string): Promise<TopologyProbeCommandResult> {
  const token = await secrets.resolve(resource.apiCredentialRef);
  const command = `node /app/dist/cli.js authority topology-probe ${action} ${argument} --config ${PROBE_CONFIG}`;
  const result = await executeProcess(resource.flyctlPath, ["ssh", "console", "--app", appName, "--machine", machineId, "--quiet", "--command", command], { ...process.env, FLY_API_TOKEN: token }, 15_000);
  if (result.code !== 0) throw new Error("Fly remote topology probe failed");
  try { return JSON.parse(result.output.trim()) as TopologyProbeCommandResult; } catch { throw new Error("Fly remote topology probe did not return JSON"); }
}

async function executeFlyVersion(binaryPath: string, timeoutMs: number) { return executeProcess(binaryPath, ["version"], process.env, timeoutMs); }

function executeProcess(binaryPath: string, args: readonly string[], env: NodeJS.ProcessEnv, timeoutMs: number): Promise<{ code: number; output: string }> {
  return new Promise((resolve, reject) => {
    let output = ""; let settled = false;
    const child = spawn(binaryPath, [...args], { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env });
    const finish = (error?: Error, code = 1) => { if (settled) return; settled = true; clearTimeout(timer); if (error) reject(error); else resolve({ code, output }); };
    const collect = (chunk: Buffer) => { if (output.length + chunk.length <= 64 * 1024) output += chunk.toString("utf8"); };
    child.stdout.on("data", collect); child.stderr.on("data", collect);
    child.once("error", error => finish(error)); child.once("close", code => finish(undefined, code ?? 1));
    const timer = setTimeout(() => { child.kill(); finish(new Error("Fly command timed out")); }, timeoutMs); timer.unref();
  });
}

function parseSnapshot(value: TopologyProbeCommandResult, role: TopologyProbeSnapshotV1["role"], nonce: string): TopologyProbeSnapshotV1 {
  if (!value || value.v !== "reelier.topology-probe-snapshot/v1" || value.role !== role || value.nonce !== nonce) throw new Error("Fly topology snapshot identity mismatch");
  return value;
}
function parseEgress(value: TopologyProbeCommandResult, endpoint: string): TopologyProbeEgressV1 {
  if (!value || value.v !== "reelier.topology-probe-egress/v1" || value.endpoint !== endpoint || typeof value.reachable !== "boolean") throw new Error("Fly topology egress result mismatch");
  return value;
}
function validate(resource: FlyRemoteProbeResource, expected: FlyRemoteProbeExpected): void {
  for (const app of [resource.appName, resource.agentAppName, resource.egressAppName]) if (!APP.test(app)) throw new TypeError("Fly remote probe app is invalid");
  for (const machine of [resource.authorityMachineId, resource.agentMachineId, resource.egressMachineId]) if (!MACHINE.test(machine)) throw new TypeError("Fly remote probe Machine is invalid");
  if (!VERSION.test(resource.flyctlVersion) || typeof resource.flyctlPath !== "string" || !resource.flyctlPath.length) throw new TypeError("Fly remote probe binary is invalid");
  if (!/^(?:env:[A-Za-z_][A-Za-z0-9_]{0,127}|file:.+)$/.test(resource.apiCredentialRef)) throw new TypeError("Fly remote probe credential reference is invalid");
  if (!expected.providerEndpoints.length || [expected.schemaDigest, expected.networkPolicyDigest, expected.runtimeImageDigest, expected.authorityImageDigest, expected.gatewayImageDigest].some(value => !DIGEST.test(value))) throw new TypeError("Fly remote probe expected surface is invalid");
}
function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
