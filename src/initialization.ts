import { createHash, randomBytes } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { canonicalJson } from "./canonical-json.js";
import { collectClaudeCodeCoverage, collectCodexCoverage, type CodexCoverageReport, type CoverageServer, type CoverageView } from "./coverage.js";
import { loadConnectionInventory } from "./connections.js";
import { discoverOpportunities, type AgentOpportunity, type DiscoverySessionInput } from "./discovery.js";
import { detectMcpConfigs, knownMcpConfigPaths, type KnownMcpConfig } from "./init.js";
import {
  clusterObservedActionsWithManifests,
  createShadowReport,
  type ConnectionInventoryEntryV1,
  type ConnectionInventoryReportV1,
  type ObservedActionV1,
} from "./observation/index.js";
import { agentSources, scanAgentSessions } from "./scan.js";

/** Closed, ordered checkpoints for the local inspection-only initializer. */
export const INIT_CHECKPOINT_IDS = Object.freeze([
  "config-surfaces",
  "path-a-coverage",
  "path-b-candidates",
  "path-c-candidates",
  "inspection-report",
] as const);

export type InitCheckpointId = (typeof INIT_CHECKPOINT_IDS)[number];

const ARTIFACTS: Readonly<Record<InitCheckpointId, string>> = Object.freeze({
  "config-surfaces": "config-surfaces.json",
  "path-a-coverage": "path-a-coverage.json",
  "path-b-candidates": "path-b-candidates.json",
  "path-c-candidates": "path-c-candidates.json",
  "inspection-report": "inspection-report.json",
});

const STATE_FILE = "state.json";
const LOCK_FILE = ".lock";
const RECOVERY_FILE = ".recovery";
const PLAN_DIGEST = digest({ v: "reelier.init-plan/v1", checkpoints: INIT_CHECKPOINT_IDS.map(id => ({ id, artifact: ARTIFACTS[id] })) });

interface ConfigSurfaceArtifact {
  readonly v: "reelier.init-config-surfaces/v1";
  readonly harnesses: readonly string[];
  readonly configs: readonly {
    id: string;
    label: string;
    detected: boolean;
    futureMutationBackup: "prospective-reversible-backup" | "not-applicable";
  }[];
}

interface PathAHostSummary {
  readonly host: "codex" | "claude-code";
  readonly observation: "observed" | "partially-observed" | "unknown";
  readonly configLocation: "parsed" | "unreadable" | "absent" | "mixed";
  readonly servers: { readonly wrapped: number; readonly unwrapped: number; readonly unreadable: number };
  readonly pluginSurfaces: { readonly parsed: number; readonly unreadable: number; readonly absent: number };
}

interface PathAArtifact {
  readonly v: "reelier.init-path-a/v1";
  readonly hosts: readonly PathAHostSummary[];
  readonly limitations: readonly string[];
}

interface SanitizedStep {
  readonly tool: string;
  readonly fieldNames: readonly string[];
  readonly effect: "read" | "idempotent-write" | "destructive";
  readonly readBackTools: readonly string[];
}

interface PathBCandidate {
  readonly candidateId: string;
  readonly fingerprintDigest: string;
  readonly sourceAgents: readonly string[];
  readonly occurrences: number;
  readonly effectCounts: AgentOpportunity["effectCounts"];
  readonly evaluationPotential: AgentOpportunity["evaluationPotential"];
  readonly freezeStatus: "candidate";
  readonly steps: readonly SanitizedStep[];
  readonly observedAt: string;
}

interface PathBArtifact {
  readonly v: "reelier.init-path-b/v1";
  readonly candidates: readonly PathBCandidate[];
  readonly limitations: readonly string[];
}

export type PathCClassification = "boundable" | "outcome-capable" | "shadow-only" | "unsupported";

interface PathCConnectionSummary {
  readonly connectionDigest: string;
  readonly provider: string;
  readonly connectionKind: ConnectionInventoryEntryV1["connectionKind"];
  readonly status: ConnectionInventoryEntryV1["status"];
  readonly classification: PathCClassification;
  readonly observation: "observed" | "partially_observed" | "uncovered" | "unknown";
  readonly outcomeInvocation: "supported" | "unsupported" | "unknown";
  readonly exclusiveEnforcement: "declared-surface" | "not-declared" | "unknown";
  readonly reasonCodes: readonly string[];
}

interface PathCCandidateSummary {
  readonly candidateId: string;
  readonly shapeDigest: string;
  readonly classification: PathCClassification;
  readonly shadowStatus: "ready" | "needs_human_definition" | "unsupported";
  readonly observedCoverage: "observed" | "partially_observed" | "uncovered" | "unknown";
  readonly compatiblePacks: readonly string[];
  readonly reasonCodes: readonly string[];
}

interface PathCArtifact {
  readonly v: "reelier.init-path-c/v1";
  readonly connections: readonly PathCConnectionSummary[];
  readonly candidates: readonly PathCCandidateSummary[];
  readonly inventoryIssues: readonly { fileDigest: string; reasonCode: string }[];
  readonly limitations: readonly string[];
}

export interface InitializationReportV1 {
  readonly v: "reelier.initialization-report/v1";
  readonly answer: "inspection-complete-no-deployment";
  readonly surfaces: ConfigSurfaceArtifact;
  readonly pathA: PathAArtifact;
  readonly pathB: PathBArtifact;
  readonly pathC: PathCArtifact;
  readonly exclusiveEnforcement: {
    readonly status: "declared-surface" | "not-declared" | "unknown";
    readonly limitation: "declared-surfaces-only-never-universal-completeness";
  };
  readonly actions: {
    readonly deployed: false;
    readonly gated: false;
    readonly configsModified: false;
    readonly cloudUpload: false;
  };
}

export interface InitializationDependencies {
  knownMcpConfigPaths(cwd: string, homedir: string): KnownMcpConfig[];
  detectMcpConfigs(cwd: string, homedir: string): Promise<KnownMcpConfig[]>;
  collectCodexCoverage(homedir: string): Promise<CodexCoverageReport>;
  collectClaudeCodeCoverage(cwd: string, homedir: string, env?: NodeJS.ProcessEnv): Promise<CoverageView>;
  discoveryInputs(homedir: string): Promise<DiscoverySessionInput[]>;
  discoverOpportunities: typeof discoverOpportunities;
  loadConnectionInventory(root: string): Promise<ConnectionInventoryReportV1>;
}

export interface InitializeInspectionOptions {
  readonly cwd: string;
  readonly homedir: string;
  readonly dryRun?: boolean;
  readonly authorityRoot?: string;
  readonly dependencies?: InitializationDependencies;
  readonly duringRecoveryCleanup?: () => void | Promise<void>;
  readonly afterArtifactWrite?: (id: InitCheckpointId) => void | Promise<void>;
  readonly afterCheckpoint?: (id: InitCheckpointId) => void | Promise<void>;
}

export type InitializeInspectionResult =
  | { readonly status: "complete" | "dry-run"; readonly report: InitializationReportV1; readonly resumedFrom: InitCheckpointId | null }
  | { readonly status: "busy" };

/** Compact, answer-first CLI rendering. It intentionally contains no absolute paths or raw evidence. */
export function renderInitializationReport(report: InitializationReportV1, dryRun: boolean): string[] {
  const detectedConfigs = report.surfaces.configs.filter(config => config.detected).length;
  const pathA = report.pathA.hosts.map(host => `${host.host}=${host.observation}`).join(", ");
  const classifications = [...report.pathC.connections, ...report.pathC.candidates].map(item => item.classification);
  const count = (classification: PathCClassification): number => classifications.filter(value => value === classification).length;
  return [
    "Reelier init: local inspection only; nothing deployed or gated.",
    `Detected surfaces: ${detectedConfigs}/${report.surfaces.configs.length} known config(s); ${report.surfaces.harnesses.length} harness identifiers inspected.`,
    `Path A observation: ${pathA || "no observed host evidence"}.`,
    `Path B replay/freeze candidates: ${report.pathB.candidates.length}.`,
    `Path C connections/candidates: boundable=${count("boundable")}, outcome-capable=${count("outcome-capable")}, shadow-only=${count("shadow-only")}, unsupported=${count("unsupported")}.`,
    `Exclusive enforcement: ${report.exclusiveEnforcement.status} (${report.exclusiveEnforcement.limitation}).`,
    dryRun ? "Dry run: no files written." : "Local artifacts: .reelier/init/inspection-report.json",
  ];
}

interface CheckpointState {
  readonly v: "reelier.init-state/v1";
  readonly planDigest: string;
  readonly completed: readonly { readonly id: InitCheckpointId; readonly artifact: string; readonly digest: string }[];
}

const defaultDependencies: InitializationDependencies = {
  knownMcpConfigPaths,
  detectMcpConfigs,
  collectCodexCoverage,
  collectClaudeCodeCoverage,
  discoverOpportunities,
  loadConnectionInventory,
  async discoveryInputs(homedir: string): Promise<DiscoverySessionInput[]> {
    const formats = new Map(agentSources(homedir).map(source => [source.id, source.format]));
    const sessions = await scanAgentSessions(homedir);
    const inputs: DiscoverySessionInput[] = [];
    for (const session of sessions) {
      try {
        inputs.push({
          content: await readFile(session.path, "utf8"),
          path: session.path,
          project: session.project,
          sourceId: session.sourceId,
          sourceLabel: session.sourceLabel,
          mtimeMs: session.mtimeMs,
          format: formats.get(session.sourceId),
        });
      } catch {
        // A disappearing transcript contributes no evidence; no partial content is retained.
      }
    }
    return inputs;
  },
};

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}

function canonicalFile(value: unknown): string {
  return `${canonicalJson(value)}\n`;
}

function validateOptions(options: InitializeInspectionOptions): void {
  if (!path.isAbsolute(options.cwd) || !path.isAbsolute(options.homedir)) throw new TypeError("initialization plan is invalid");
  if (options.authorityRoot !== undefined && !path.isAbsolute(options.authorityRoot)) throw new TypeError("initialization plan is invalid");
  if (new Set(INIT_CHECKPOINT_IDS).size !== INIT_CHECKPOINT_IDS.length) throw new TypeError("initialization plan is invalid");
  for (const id of INIT_CHECKPOINT_IDS) {
    const artifact = ARTIFACTS[id];
    if (path.basename(artifact) !== artifact || !artifact.endsWith(".json")) throw new TypeError("initialization plan is invalid");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function parseState(raw: string): CheckpointState {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("checkpoint state refused: malformed"); }
  if (!isRecord(value) || !hasExactKeys(value, ["v", "planDigest", "completed"]) || value.v !== "reelier.init-state/v1" || value.planDigest !== PLAN_DIGEST || !Array.isArray(value.completed)) {
    throw new Error("checkpoint state refused: malformed, unknown, or stale");
  }
  const completed: Array<{ id: InitCheckpointId; artifact: string; digest: string }> = [];
  for (let index = 0; index < value.completed.length; index++) {
    const item = value.completed[index];
    if (!isRecord(item) || !hasExactKeys(item, ["id", "artifact", "digest"])) throw new Error("checkpoint state refused: malformed");
    const expectedId = INIT_CHECKPOINT_IDS[index];
    if (item.id !== expectedId || item.artifact !== ARTIFACTS[expectedId] || typeof item.digest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(item.digest)) {
      throw new Error("checkpoint state refused: malformed, unknown, or stale");
    }
    completed.push({ id: expectedId, artifact: item.artifact, digest: item.digest });
  }
  return { v: "reelier.init-state/v1", planDigest: PLAN_DIGEST, completed };
}

function validateArtifact(id: InitCheckpointId, value: unknown): void {
  const expectedVersion: Record<InitCheckpointId, string> = {
    "config-surfaces": "reelier.init-config-surfaces/v1",
    "path-a-coverage": "reelier.init-path-a/v1",
    "path-b-candidates": "reelier.init-path-b/v1",
    "path-c-candidates": "reelier.init-path-c/v1",
    "inspection-report": "reelier.initialization-report/v1",
  };
  if (!isRecord(value) || value.v !== expectedVersion[id]) throw new Error("checkpoint state refused: malformed artifact");
  const closed = (candidate: unknown, keys: readonly string[]): candidate is Record<string, unknown> => isRecord(candidate) && hasExactKeys(candidate, keys);
  const strings = (candidate: unknown, allowEmpty = false): candidate is string[] => Array.isArray(candidate) && candidate.every(item => typeof item === "string" && (allowEmpty || item.length > 0));
  const integer = (candidate: unknown, minimum = 0): candidate is number => Number.isSafeInteger(candidate) && Number(candidate) >= minimum;
  const oneOf = (candidate: unknown, values: readonly string[]): boolean => typeof candidate === "string" && values.includes(candidate);
  const isSha = (candidate: unknown): candidate is string => typeof candidate === "string" && /^sha256:[0-9a-f]{64}$/.test(candidate);
  const counts = (candidate: unknown, keys: readonly string[]): boolean => closed(candidate, keys) && keys.every(key => integer(candidate[key]));
  let valid = false;
  if (id === "config-surfaces") {
    valid = closed(value, ["v", "harnesses", "configs"]) && strings(value.harnesses) && Array.isArray(value.configs) && value.configs.every(config => closed(config, ["id", "label", "detected", "futureMutationBackup"]) && typeof config.id === "string" && /^config-[1-9][0-9]*$/.test(config.id) && typeof config.label === "string" && config.label.length > 0 && typeof config.detected === "boolean" && oneOf(config.futureMutationBackup, ["prospective-reversible-backup", "not-applicable"]) && (config.detected === (config.futureMutationBackup === "prospective-reversible-backup")));
  } else if (id === "path-a-coverage") {
    valid = closed(value, ["v", "hosts", "limitations"]) && strings(value.limitations) && Array.isArray(value.hosts) && value.hosts.every(host => closed(host, ["host", "observation", "configLocation", "servers", "pluginSurfaces"]) && oneOf(host.host, ["codex", "claude-code"]) && oneOf(host.observation, ["observed", "partially-observed", "unknown"]) && oneOf(host.configLocation, ["parsed", "unreadable", "absent", "mixed"]) && counts(host.servers, ["wrapped", "unwrapped", "unreadable"]) && counts(host.pluginSurfaces, ["parsed", "unreadable", "absent"]));
  } else if (id === "path-b-candidates") {
    valid = closed(value, ["v", "candidates", "limitations"]) && strings(value.limitations) && Array.isArray(value.candidates) && value.candidates.every(candidate => closed(candidate, ["candidateId", "fingerprintDigest", "sourceAgents", "occurrences", "effectCounts", "evaluationPotential", "freezeStatus", "steps", "observedAt"]) && typeof candidate.candidateId === "string" && candidate.candidateId.length > 0 && isSha(candidate.fingerprintDigest) && strings(candidate.sourceAgents) && integer(candidate.occurrences, 1) && counts(candidate.effectCounts, ["read", "idempotent-write", "destructive"]) && oneOf(candidate.evaluationPotential, ["strong", "partial", "none"]) && candidate.freezeStatus === "candidate" && typeof candidate.observedAt === "string" && Number.isFinite(Date.parse(candidate.observedAt)) && Array.isArray(candidate.steps) && candidate.steps.every(step => closed(step, ["tool", "fieldNames", "effect", "readBackTools"]) && typeof step.tool === "string" && step.tool.length > 0 && Array.isArray(step.fieldNames) && step.fieldNames.every(isSha) && oneOf(step.effect, ["read", "idempotent-write", "destructive"]) && strings(step.readBackTools, true)));
  } else if (id === "path-c-candidates") {
    valid = closed(value, ["v", "connections", "candidates", "inventoryIssues", "limitations"]) && strings(value.limitations) && Array.isArray(value.connections) && value.connections.every(connection => closed(connection, ["connectionDigest", "provider", "connectionKind", "status", "classification", "observation", "outcomeInvocation", "exclusiveEnforcement", "reasonCodes"]) && isSha(connection.connectionDigest) && typeof connection.provider === "string" && connection.provider.length > 0 && oneOf(connection.connectionKind, ["adopted-mcp-stdio", "adopted-mcp-http", "composio-managed", "native-https", "host-private"]) && oneOf(connection.status, ["usable", "discovered-unverified", "schema-drifted", "account-mismatched", "shadow-only", "unsupported"]) && oneOf(connection.classification, ["boundable", "outcome-capable", "shadow-only", "unsupported"]) && oneOf(connection.observation, ["observed", "partially_observed", "uncovered", "unknown"]) && oneOf(connection.outcomeInvocation, ["supported", "unsupported", "unknown"]) && oneOf(connection.exclusiveEnforcement, ["declared-surface", "not-declared", "unknown"]) && strings(connection.reasonCodes, true)) && Array.isArray(value.candidates) && value.candidates.every(candidate => closed(candidate, ["candidateId", "shapeDigest", "classification", "shadowStatus", "observedCoverage", "compatiblePacks", "reasonCodes"]) && typeof candidate.candidateId === "string" && candidate.candidateId.length > 0 && isSha(candidate.shapeDigest) && oneOf(candidate.classification, ["outcome-capable", "shadow-only", "unsupported"]) && oneOf(candidate.shadowStatus, ["ready", "needs_human_definition", "unsupported"]) && ((candidate.shadowStatus === "ready") === (candidate.classification === "outcome-capable")) && oneOf(candidate.observedCoverage, ["observed", "partially_observed", "uncovered", "unknown"]) && strings(candidate.compatiblePacks, true) && strings(candidate.reasonCodes, true)) && Array.isArray(value.inventoryIssues) && value.inventoryIssues.every(issue => closed(issue, ["fileDigest", "reasonCode"]) && isSha(issue.fileDigest) && issue.reasonCode === "malformed-inventory-entry");
  } else {
    valid = closed(value, ["v", "answer", "surfaces", "pathA", "pathB", "pathC", "exclusiveEnforcement", "actions"]) && value.answer === "inspection-complete-no-deployment" && closed(value.exclusiveEnforcement, ["status", "limitation"]) && oneOf(value.exclusiveEnforcement.status, ["declared-surface", "not-declared", "unknown"]) && value.exclusiveEnforcement.limitation === "declared-surfaces-only-never-universal-completeness" && closed(value.actions, ["deployed", "gated", "configsModified", "cloudUpload"]) && Object.values(value.actions).every(action => action === false);
    if (valid) {
      validateArtifact("config-surfaces", value.surfaces);
      validateArtifact("path-a-coverage", value.pathA);
      validateArtifact("path-b-candidates", value.pathB);
      validateArtifact("path-c-candidates", value.pathC);
      const connections = (value.pathC as Record<string, unknown>).connections as Array<Record<string, unknown>>;
      const expectedExclusive = connections.some(connection => connection.exclusiveEnforcement === "not-declared")
        ? "not-declared"
        : connections.length > 0 && connections.every(connection => connection.exclusiveEnforcement === "declared-surface")
          ? "declared-surface"
          : "unknown";
      valid = (value.exclusiveEnforcement as Record<string, unknown>).status === expectedExclusive;
    }
  }
  if (!valid) throw new Error("checkpoint state refused: malformed artifact");
}

async function inspectExistingState(initDir: string, lockOwned = false, allowOrphans = false): Promise<{ state: CheckpointState; artifacts: Map<InitCheckpointId, unknown>; lockPresent: boolean }> {
  let names: string[];
  try { names = await readdir(initDir); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { state: { v: "reelier.init-state/v1", planDigest: PLAN_DIGEST, completed: [] }, artifacts: new Map(), lockPresent: false };
    throw new Error("checkpoint state refused: unreadable");
  }
  if (names.includes(LOCK_FILE) && !lockOwned) {
    return { state: { v: "reelier.init-state/v1", planDigest: PLAN_DIGEST, completed: [] }, artifacts: new Map(), lockPresent: true };
  }
  const allowed = new Set([STATE_FILE, LOCK_FILE, ...Object.values(ARTIFACTS)]);
  if (names.some(name => !allowed.has(name))) throw new Error("checkpoint state refused: unknown artifact");
  let stateRaw: string | undefined;
  try { stateRaw = await readFile(path.join(initDir, STATE_FILE), "utf8"); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("checkpoint state refused: unreadable");
  }
  const plannedArtifacts = names.filter(name => Object.values(ARTIFACTS).includes(name));
  if (stateRaw === undefined && plannedArtifacts.length > 0 && !allowOrphans) throw new Error("checkpoint state refused: stale artifacts");
  const state = stateRaw === undefined ? { v: "reelier.init-state/v1" as const, planDigest: PLAN_DIGEST, completed: [] } : parseState(stateRaw);
  const artifacts = new Map<InitCheckpointId, unknown>();
  for (const completed of state.completed) {
    let raw: string;
    try { raw = await readFile(path.join(initDir, completed.artifact), "utf8"); } catch { throw new Error("checkpoint state refused: missing artifact"); }
    let parsed: unknown;
    try { parsed = JSON.parse(raw) as unknown; } catch { throw new Error("checkpoint state refused: malformed artifact"); }
    if (digest(parsed) !== completed.digest) throw new Error("checkpoint state refused: stale artifact");
    validateArtifact(completed.id, parsed);
    artifacts.set(completed.id, parsed);
  }
  return { state, artifacts, lockPresent: names.includes(LOCK_FILE) };
}

async function writeDurableAtomic(filePath: string, content: string): Promise<void> {
  const temporary = `${filePath}.tmp-${randomBytes(6).toString("hex")}`;
  let handle;
  try {
    handle = await open(temporary, "wx");
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, filePath);
    try {
      const directory = await open(path.dirname(filePath), "r");
      try { await directory.sync(); } finally { await directory.close(); }
    } catch {
      // Windows may refuse directory handles; the file itself was fsynced before rename.
    }
  } finally {
    if (handle) await handle.close().catch(() => {});
    await unlink(temporary).catch(() => {});
  }
}

async function acquireLock(initDir: string): Promise<(() => Promise<void>) | undefined> {
  const lockPath = path.join(initDir, LOCK_FILE);
  let handle;
  try {
    handle = await open(lockPath, "wx");
    await handle.writeFile(`${canonicalJson({ v: "reelier.init-lock/v1", pid: process.pid })}\n`, "utf8");
    await handle.sync();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return undefined;
    throw error;
  }
  return async () => {
    await handle.close().catch(() => {});
    await unlink(lockPath).catch(() => {});
  };
}

async function lockOwnerStatus(filePath: string): Promise<"absent" | "active" | "dead"> {
  let raw: string;
  try { raw = await readFile(filePath, "utf8"); } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? "absent" : "active";
  }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return "active"; }
  if (!isRecord(parsed) || !hasExactKeys(parsed, ["v", "pid"]) || parsed.v !== "reelier.init-lock/v1" || !Number.isSafeInteger(parsed.pid) || Number(parsed.pid) < 1) return "active";
  try {
    process.kill(Number(parsed.pid), 0);
    return "active";
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH" ? "dead" : "active";
  }
}

async function recoverDeadLock(initDir: string, duringCleanup?: () => void | Promise<void>): Promise<"absent" | "active" | "recovered"> {
  const lockPath = path.join(initDir, LOCK_FILE);
  const recoveryPath = path.join(initDir, RECOVERY_FILE);
  const recoveryStatus = await lockOwnerStatus(recoveryPath);
  if (recoveryStatus === "active") return "active";
  if (recoveryStatus === "dead") await unlink(recoveryPath).catch(() => {});
  const lockStatus = await lockOwnerStatus(lockPath);
  if (lockStatus !== "dead") return lockStatus;

  let recoveryHandle;
  try {
    recoveryHandle = await open(recoveryPath, "wx");
    await recoveryHandle.writeFile(`${canonicalJson({ v: "reelier.init-lock/v1", pid: process.pid })}\n`, "utf8");
    await recoveryHandle.sync();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return "active";
    throw error;
  } finally {
    if (recoveryHandle) await recoveryHandle.close().catch(() => {});
  }
  try {
    if (await lockOwnerStatus(lockPath) !== "dead") return "active";
    await duringCleanup?.();
    let names: string[] = [];
    try { names = await readdir(initDir); } catch { /* the next state inspection reports unreadable state */ }
    const owned = new Set([STATE_FILE, ...Object.values(ARTIFACTS)]);
    for (const name of names) {
      const match = /^(.*)\.tmp-[0-9a-f]{12}$/.exec(name);
      if (match && owned.has(match[1])) await unlink(path.join(initDir, name)).catch(() => {});
    }
    await unlink(lockPath);
    return "recovered";
  } finally {
    await unlink(recoveryPath).catch(() => {});
  }
}

function summarizeServers(servers: readonly CoverageServer[]): { wrapped: number; unwrapped: number; unreadable: number } {
  return {
    wrapped: servers.filter(server => server.location === "parsed" && server.routing === "wrapped").length,
    unwrapped: servers.filter(server => server.location === "parsed" && server.routing === "unwrapped").length,
    unreadable: servers.filter(server => server.location === "unreadable" || server.routing === undefined).length,
  };
}

function observationFor(counts: { wrapped: number; unwrapped: number; unreadable: number }): PathAHostSummary["observation"] {
  const total = counts.wrapped + counts.unwrapped + counts.unreadable;
  if (total === 0) return "unknown";
  if (counts.wrapped === total) return "observed";
  return "partially-observed";
}

function pluginLocations(locations: readonly { location: "parsed" | "unreadable" | "absent" }[]): PathAHostSummary["pluginSurfaces"] {
  return {
    parsed: locations.filter(item => item.location === "parsed").length,
    unreadable: locations.filter(item => item.location === "unreadable").length,
    absent: locations.filter(item => item.location === "absent").length,
  };
}

function summarizeCodex(report: CodexCoverageReport): PathAHostSummary {
  const servers = [...report.config.servers, ...report.plugins.flatMap(plugin => plugin.servers)];
  const counts = summarizeServers(servers);
  return { host: "codex", observation: observationFor(counts), configLocation: report.config.location, servers: counts, pluginSurfaces: pluginLocations(report.plugins) };
}

function summarizeClaude(report: CoverageView): PathAHostSummary {
  const servers = [...report.sources.flatMap(source => source.servers), ...report.plugins.flatMap(plugin => plugin.servers)];
  const counts = summarizeServers(servers);
  const locations = new Set(report.sources.map(source => source.location));
  const configLocation: PathAHostSummary["configLocation"] = locations.size === 0 ? "absent" : locations.size === 1 ? [...locations][0]! : "mixed";
  return { host: "claude-code", observation: observationFor(counts), configLocation, servers: counts, pluginSurfaces: pluginLocations(report.plugins) };
}

function buildSurfaces(known: readonly KnownMcpConfig[], detected: readonly KnownMcpConfig[]): ConfigSurfaceArtifact {
  const detectedLabels = new Set(detected.map(config => config.label));
  return {
    v: "reelier.init-config-surfaces/v1",
    harnesses: Object.freeze(["claude-code", "codex", "cursor", "eve", "herdr", "hermes", "mcp", "openclaw", "plugin", "supported-cli"]),
    configs: Object.freeze(known.map((config, index) => {
      const present = detectedLabels.has(config.label);
      return Object.freeze({ id: `config-${index + 1}`, label: config.label, detected: present, futureMutationBackup: present ? "prospective-reversible-backup" as const : "not-applicable" as const });
    })),
  };
}

function normalizeFingerprintDigest(value: string): string {
  return /^sha256:[0-9a-f]{64}$/.test(value) ? value : `sha256:${value}`;
}

function buildPathB(opportunities: readonly AgentOpportunity[]): PathBArtifact {
  const candidates = opportunities.map(opportunity => {
    const readBack = new Map<number, string[]>();
    for (const edge of opportunity.fingerprint.dataflow) {
      const tool = opportunity.fingerprint.steps[edge.toStep]?.tool;
      if (tool) readBack.set(edge.fromStep, [...(readBack.get(edge.fromStep) ?? []), tool]);
    }
    return Object.freeze({
      candidateId: `freeze-${normalizeFingerprintDigest(opportunity.fingerprint.digest).slice(7, 23)}`,
      fingerprintDigest: normalizeFingerprintDigest(opportunity.fingerprint.digest),
      sourceAgents: Object.freeze([...new Set(opportunity.sourceAgents)].sort()),
      occurrences: opportunity.observedCount,
      effectCounts: Object.freeze({ ...opportunity.effectCounts }),
      evaluationPotential: opportunity.evaluationPotential,
      freezeStatus: "candidate" as const,
      steps: Object.freeze(opportunity.fingerprint.steps.map((step, index) => Object.freeze({ tool: step.tool, fieldNames: Object.freeze([...step.argKeys].map(field => digest({ field })).sort()), effect: step.effect, readBackTools: Object.freeze([...(readBack.get(index) ?? [])].sort()) }))),
      observedAt: opportunity.lastUsedAt,
    });
  });
  return { v: "reelier.init-path-b/v1", candidates: Object.freeze(candidates), limitations: Object.freeze(["workflow-shapes-only-no-shell-or-file-edit-inference", "candidate-is-not-deployed-or-gated"]) };
}

function connectionClassification(entry: ConnectionInventoryEntryV1): PathCClassification {
  if (entry.status === "unsupported") return "unsupported";
  if (entry.status === "shadow-only" || entry.routeStatus === "host-private") return "shadow-only";
  if (entry.status === "usable" && entry.descriptor?.coverage.outcomeInvocation === "supported") return "outcome-capable";
  return "shadow-only";
}

function summarizeConnection(entry: ConnectionInventoryEntryV1): PathCConnectionSummary {
  const coverage = entry.descriptor?.coverage;
  return {
    connectionDigest: digest({ discoveryId: entry.discoveryId, provider: entry.provider, kind: entry.connectionKind }),
    provider: entry.provider,
    connectionKind: entry.connectionKind,
    status: entry.status,
    classification: connectionClassification(entry),
    observation: coverage?.observation ?? "unknown",
    outcomeInvocation: coverage?.outcomeInvocation ?? (entry.status === "unsupported" ? "unsupported" : "unknown"),
    exclusiveEnforcement: coverage?.exclusiveEnforcement ?? "unknown",
    reasonCodes: Object.freeze([...entry.reasonCodes].sort()),
  };
}

function buildPathC(pathB: PathBArtifact, inventory: ConnectionInventoryReportV1): PathCArtifact {
  const candidates: PathCCandidateSummary[] = [];
  for (const workflow of pathB.candidates.filter(candidate => candidate.steps.some(step => step.effect !== "read"))) {
    const actions: ObservedActionV1[] = workflow.steps.map((step, index) => ({
      v: "reelier.observed-action/v1",
      adapterId: workflow.sourceAgents.join("+") || "unknown-local-adapter",
      sessionId: workflow.fingerprintDigest,
      actionId: `${workflow.candidateId}-${index + 1}`,
      tool: step.tool,
      fieldNames: step.fieldNames,
      sourceKinds: ["unknown"],
      destinationKinds: ["unknown"],
      effect: step.effect,
      coverage: "observed",
      readBackTools: step.readBackTools,
      observedAt: workflow.observedAt,
      atom: step.effect === "read" ? "read-back" : "external-commitment",
    }));
    // No installed manifest inventory exists in this slice. An empty list is an explicit
    // absence of compatibility evidence, never a fabricated pack match.
    const candidate = clusterObservedActionsWithManifests(actions, workflow.candidateId, workflow.occurrences, []);
    const shadow = createShadowReport(candidate);
    const classification: PathCClassification = shadow.status === "ready" ? "outcome-capable" : shadow.status === "needs_human_definition" ? "shadow-only" : "unsupported";
    candidates.push(Object.freeze({ candidateId: candidate.candidateId, shapeDigest: candidate.shapeDigest, classification, shadowStatus: shadow.status, observedCoverage: shadow.observedCoverage, compatiblePacks: candidate.compatiblePacks, reasonCodes: shadow.reasonCodes }));
  }
  return {
    v: "reelier.init-path-c/v1",
    connections: Object.freeze(inventory.entries.map(summarizeConnection)),
    candidates: Object.freeze(candidates),
    inventoryIssues: Object.freeze(inventory.issues.map(issue => Object.freeze({ fileDigest: digest({ file: issue.file }), reasonCode: issue.reasonCode }))),
    limitations: Object.freeze(["host-private-connections-remain-shadow-only", "no-reviewed-pack-compatibility-is-inferred", "init-does-not-sign-reserve-dispatch-deploy-or-gate"]),
  };
}

function exclusiveStatus(pathC: PathCArtifact): InitializationReportV1["exclusiveEnforcement"]["status"] {
  if (pathC.connections.some(connection => connection.exclusiveEnforcement === "not-declared")) return "not-declared";
  if (pathC.connections.length > 0 && pathC.connections.every(connection => connection.exclusiveEnforcement === "declared-surface")) return "declared-surface";
  return "unknown";
}

function buildReport(surfaces: ConfigSurfaceArtifact, pathA: PathAArtifact, pathB: PathBArtifact, pathC: PathCArtifact): InitializationReportV1 {
  return {
    v: "reelier.initialization-report/v1",
    answer: "inspection-complete-no-deployment",
    surfaces,
    pathA,
    pathB,
    pathC,
    exclusiveEnforcement: { status: exclusiveStatus(pathC), limitation: "declared-surfaces-only-never-universal-completeness" },
    actions: { deployed: false, gated: false, configsModified: false, cloudUpload: false },
  };
}

async function runCheckpoint(
  id: InitCheckpointId,
  dependencies: InitializationDependencies,
  options: InitializeInspectionOptions,
  artifacts: Map<InitCheckpointId, unknown>,
): Promise<unknown> {
  if (id === "config-surfaces") {
    return buildSurfaces(dependencies.knownMcpConfigPaths(options.cwd, options.homedir), await dependencies.detectMcpConfigs(options.cwd, options.homedir));
  }
  if (id === "path-a-coverage") {
    const [codex, claude] = await Promise.all([
      dependencies.collectCodexCoverage(options.homedir),
      // Empty environment prevents init from reading credential/env values or host-specific overrides.
      dependencies.collectClaudeCodeCoverage(options.cwd, options.homedir, {}),
    ]);
    return { v: "reelier.init-path-a/v1", hosts: Object.freeze([summarizeCodex(codex), summarizeClaude(claude)]), limitations: Object.freeze(["observed-config-and-plugin-surfaces-only", "not-a-universal-completeness-claim"]) } satisfies PathAArtifact;
  }
  if (id === "path-b-candidates") {
    const inputs = await dependencies.discoveryInputs(options.homedir);
    return buildPathB(dependencies.discoverOpportunities(inputs));
  }
  if (id === "path-c-candidates") {
    const pathB = artifacts.get("path-b-candidates") as PathBArtifact;
    return buildPathC(pathB, await dependencies.loadConnectionInventory(options.authorityRoot ?? path.join(options.cwd, "authority")));
  }
  return buildReport(
    artifacts.get("config-surfaces") as ConfigSurfaceArtifact,
    artifacts.get("path-a-coverage") as PathAArtifact,
    artifacts.get("path-b-candidates") as PathBArtifact,
    artifacts.get("path-c-candidates") as PathCArtifact,
  );
}

async function runDry(options: InitializeInspectionOptions, dependencies: InitializationDependencies): Promise<InitializeInspectionResult> {
  const artifacts = new Map<InitCheckpointId, unknown>();
  for (const id of INIT_CHECKPOINT_IDS) artifacts.set(id, await runCheckpoint(id, dependencies, options, artifacts));
  return { status: "dry-run", report: artifacts.get("inspection-report") as InitializationReportV1, resumedFrom: INIT_CHECKPOINT_IDS[0] };
}

/** Inspect all three Reelier paths locally. This function never deploys, gates, uploads, dispatches, or rewrites host configuration. */
export async function initializeInspection(options: InitializeInspectionOptions): Promise<InitializeInspectionResult> {
  validateOptions(options);
  const dependencies = options.dependencies ?? defaultDependencies;
  const initDir = path.join(options.cwd, ".reelier", "init");
  if (options.dryRun) {
    const dryState = await inspectExistingState(initDir);
    if (dryState.lockPresent) return { status: "busy" };
    return runDry(options, dependencies);
  }
  const recovery = await recoverDeadLock(initDir, options.duringRecoveryCleanup);
  if (recovery === "active") return { status: "busy" };
  const initial = await inspectExistingState(initDir, false, recovery === "recovered");

  if (initial.state.completed.length === INIT_CHECKPOINT_IDS.length) {
    return { status: "complete", report: initial.artifacts.get("inspection-report") as InitializationReportV1, resumedFrom: null };
  }

  await mkdir(initDir, { recursive: true });
  const release = await acquireLock(initDir);
  if (!release) return { status: "busy" };
  try {
    const { state: checkedState, artifacts } = await inspectExistingState(initDir, true, recovery === "recovered");
    if (checkedState.completed.length === INIT_CHECKPOINT_IDS.length) {
      return { status: "complete", report: artifacts.get("inspection-report") as InitializationReportV1, resumedFrom: null };
    }
    const resumedFrom = INIT_CHECKPOINT_IDS[checkedState.completed.length];
    let state = checkedState;
    for (let index = state.completed.length; index < INIT_CHECKPOINT_IDS.length; index++) {
      const id = INIT_CHECKPOINT_IDS[index];
      const artifact = await runCheckpoint(id, dependencies, options, artifacts);
      validateArtifact(id, artifact);
      const artifactContent = canonicalFile(artifact);
      await writeDurableAtomic(path.join(initDir, ARTIFACTS[id]), artifactContent);
      await options.afterArtifactWrite?.(id);
      artifacts.set(id, artifact);
      state = {
        v: "reelier.init-state/v1",
        planDigest: PLAN_DIGEST,
        completed: Object.freeze([...state.completed, Object.freeze({ id, artifact: ARTIFACTS[id], digest: digest(artifact) })]),
      };
      await writeDurableAtomic(path.join(initDir, STATE_FILE), canonicalFile(state));
      await options.afterCheckpoint?.(id);
    }
    return { status: "complete", report: artifacts.get("inspection-report") as InitializationReportV1, resumedFrom };
  } finally {
    await release();
  }
}
