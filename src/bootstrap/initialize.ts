import { createHash, randomBytes } from "node:crypto";
import { access, link, lstat, mkdir, open, readFile, realpath, rename, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { AUTHORITY_ADAPTER_CONTRACT_V1_DIGEST } from "../authority/adapter-contract.js";
import { OUTCOME_PROFILE_CONTRACT_V1_DIGEST } from "../authority/outcome-profile-contract.js";
import { authorityDigest } from "../authority/wire.js";
import { initializeInspection, type InitializationDependencies } from "../initialization.js";
import { writeFileAtomic } from "../writeback.js";
import { BOOTSTRAP_CONTRACT_V1_DIGEST } from "./contract.js";
import { createProfileDrafts } from "./profile-drafts.js";
import { digestAgentProjectV1, parseAgentProjectV1 } from "./project.js";
import { parseRuntimeDescriptorV1 } from "../runtime/manifest.js";
import { parseBootstrapReportV1 } from "./normalize.js";
import { loadProfileGovernanceFromOperatorTrust } from "../authority/host/profile-governance-loader.js";
import { admittedProfileGovernanceState } from "../authority/host/profile-governance.js";
import { computeInstalledBuildDigest } from "./build-identity.js";
import type { BootstrapReportV1 } from "./types.js";
import { claimWorkloadAgentName, prepareWorkloadRegistration } from "./workload-registration.js";
import { applyBootstrapInstall, planBootstrapInstall } from "./install.js";
import { restoreFromBackup } from "../wrap.js";

export const BOOTSTRAP_CHECKPOINT_IDS = Object.freeze(["inspection-link", "runtime-descriptor", "route-coverage", "workload-registration-request", "profile-drafts", "imported-governance", "configuration-plan", "installation-canary", "project", "report"] as const);
type BootstrapCheckpointId = (typeof BOOTSTRAP_CHECKPOINT_IDS)[number];
const CHECKPOINT_ARTIFACT_NAMES: Readonly<Record<BootstrapCheckpointId, string>> = Object.freeze({ "inspection-link": "inspection-link.json", "runtime-descriptor": "runtime-descriptor.json", "route-coverage": "route-coverage-link.json", "workload-registration-request": "workload-registration-request.json", "profile-drafts": "profile-drafts.json", "imported-governance": "imported-governance.json", "configuration-plan": "configuration-plan.json", "installation-canary": "installation-canary.json", project: "project.json", report: "report.json" });
export interface InitializeAgentProjectOptions { readonly cwd: string; readonly homedir: string; readonly agentName: string; readonly yes?: boolean; readonly exactVersion: string; readonly dependencies?: InitializationDependencies; readonly governance?: Readonly<{ tenant: string; governanceRef: string; expectedManifestDigest: string; expectedTrustHeadDigest: string; verificationTime: Date }>; readonly failAfterInstall?: boolean; }
export type BootstrapPreparationReport = BootstrapReportV1 & Readonly<{ actions: { profileDrafted: boolean; profileCertified: boolean; authorityActivated: boolean }; pathC: "unavailable-no-activation"; }>;
interface BootstrapCompleted { id: BootstrapCheckpointId; artifact: string; digest: string; }
interface BootstrapState { v: "reelier.bootstrap-state/v1"; planDigest: string; completed: readonly BootstrapCompleted[]; }
interface BootstrapFileSnapshot { path: string; kind: "absent" | "file" | "other"; content?: string; }
const BOOTSTRAP_PROCESS_STARTED_AT = Math.floor(Date.now() - process.uptime() * 1_000);

export async function initializeAgentProject(options: InitializeAgentProjectOptions): Promise<BootstrapPreparationReport> {
  if (!path.isAbsolute(options.cwd) || !path.isAbsolute(options.homedir) || !/^[A-Za-z0-9._~-]{1,128}$/.test(options.agentName) || options.agentName === "." || options.agentName === ".." || !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/.test(options.exactVersion)) throw new TypeError("named bootstrap options are invalid");
  const homeInfo = await lstat(options.homedir);
  if (!homeInfo.isDirectory() || homeInfo.isSymbolicLink() || await realpath(options.homedir) !== path.resolve(options.homedir)) throw new TypeError("named bootstrap home directory is unsafe or linked");
  const cwdInfo = await lstat(options.cwd);
  if (!cwdInfo.isDirectory() || cwdInfo.isSymbolicLink()) throw new TypeError("named bootstrap project directory is unsafe or linked");
  const projectRoot = await realpath(options.cwd);
  await claimWorkloadAgentName(options.homedir, options.agentName);
  const planDigest = digest({ v: "reelier.bootstrap-plan/v1", checkpoints: BOOTSTRAP_CHECKPOINT_IDS, agentName: options.agentName, exactVersion: options.exactVersion, cwd: projectRoot, yes: options.yes === true, governance: options.governance === undefined ? null : { tenant: options.governance.tenant, governanceRef: options.governance.governanceRef, expectedManifestDigest: options.governance.expectedManifestDigest, expectedTrustHeadDigest: options.governance.expectedTrustHeadDigest, verificationTime: options.governance.verificationTime.toISOString() } });
  const reelierDir = path.join(projectRoot, ".reelier");
  await ensureRealDirectory(reelierDir, "project Reelier directory");
  const bootstrapParent = path.join(reelierDir, "bootstrap");
  await ensureRealDirectory(bootstrapParent, "named bootstrap directory");
  const release = await acquireBootstrapLock(path.join(bootstrapParent, ".lock"));
  try {
  const bootstrapDir = path.join(projectRoot, ".reelier", "bootstrap");
  const info = await lstat(bootstrapDir);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new TypeError("named bootstrap directory is unsafe");
  const statePath = path.join(bootstrapDir, "state.json");
  const existing = await readState(statePath, planDigest);
  if (existing !== undefined) await validateCompletedArtifacts(bootstrapDir, existing);
  const importedGovernance = await loadImportedGovernance(options);
  if (existing !== undefined && existing.completed.length === BOOTSTRAP_CHECKPOINT_IDS.length) {
    const report = parseBootstrapReportV1(await readJson(bootstrapDir, "report.json"));
    return Object.freeze({ ...report, actions: Object.freeze({ profileDrafted: true, profileCertified: false, authorityActivated: false }), pathC: "unavailable-no-activation" });
  }
  const snapshots = await snapshotBootstrapFiles(bootstrapDir, statePath);
  const configPath = path.join(projectRoot, ".mcp.json");
  let installation = { changed: false, backupPath: undefined as string | undefined };
  let removeInstalledConfigOnRollback = false;
  let phase: "preparation" | "installation" | "checkpoints" = "preparation";
  try {
  const discoverRouteCoverage = existing === undefined || existing.completed.length <= BOOTSTRAP_CHECKPOINT_IDS.indexOf("route-coverage");
  const inspection = await initializeInspection({ cwd: projectRoot, homedir: options.homedir, ...(options.dependencies === undefined ? {} : { dependencies: options.dependencies }), ...(discoverRouteCoverage ? { namedBootstrapRouteDiscovery: { agentName: options.agentName, now: new Date(), contractIdentityDigest: BOOTSTRAP_CONTRACT_V1_DIGEST, findings: [] } } : {}) });
  if (inspection.status === "busy") throw new Error("named bootstrap is busy");
  const registration = await prepareWorkloadRegistration(options.homedir, options.agentName, projectRoot);
  const drafts = createProfileDrafts();
  const runtimeDescriptor = { v: "reelier.runtime-descriptor/v1", adapterId: "externally-managed", adapterVersion: "1.0.0", adapterDigest: digest({ adapter: "externally-managed" }), launchMode: "externally-managed", command: null, args: [], cwd: null, connectionRef: "managed-cell", environmentAllowlist: [], authenticatedBinding: "host-private", shutdown: "external" } as const;
  const routeCoverage = await readFile(path.join(bootstrapDir, "route-coverage.json"), "utf8");
  phase = "installation";
    const plan = await planBootstrapInstall(configPath, options.exactVersion, projectRoot);
    if (plan.changed && options.yes) { installation = { changed: true, ...(await applyBootstrapInstall(plan, { consent: true })) }; removeInstalledConfigOnRollback = !plan.configExisted; if (await readFile(configPath, "utf8") !== plan.after) throw new Error("installed configuration read-back mismatch"); if (options.failAfterInstall) throw new Error("injected post-apply artifact failure"); }
  phase = "checkpoints";
  const reportFields = { runtimeDescriptorDigest: digest(runtimeDescriptor), routeCoverageDigest: sha256(routeCoverage), initializedAt: new Date().toISOString(), canary: installation.changed ? "verified" as const : "unchecked" as const, authority: "unavailable" as const, recoveryCommand: `npx reelier@${options.exactVersion} up`, completeness: "not-proved" as const };
  const governed = importedGovernance as { tenant: string | null; governanceRef: string | null; manifestDigest: string | null; trustHeadDigest: string | null };
  const project = { v: "reelier.agent-project/v1", agentName: options.agentName, projectId: `project_${options.agentName}`, tenant: governed.tenant, reelierVersion: options.exactVersion, installedBuildDigest: await computeInstalledBuildDigest(await installedPackageRoot()), packageTarballIntegrityDigest: null, authorityContractDigest: AUTHORITY_ADAPTER_CONTRACT_V1_DIGEST, continuityContractDigest: digest({ contract: "continuity" }), outcomeProfileContractDigest: OUTCOME_PROFILE_CONTRACT_V1_DIGEST, bootstrapContractDigest: BOOTSTRAP_CONTRACT_V1_DIGEST, initializationReportDigest: digest(inspection.report), runtimeDescriptorDigest: reportFields.runtimeDescriptorDigest, routeCoverageDigest: reportFields.routeCoverageDigest, profileGovernanceRef: governed.governanceRef, profileGovernanceManifestDigest: governed.manifestDigest, profileTrustHeadDigest: governed.trustHeadDigest, authorityMode: governed.governanceRef === null ? "unconfigured" : "managed-cell" } as const;
  const reportProjection: BootstrapReportV1 = Object.freeze({ v: "reelier.bootstrap-report/v1", projectDigest: digestAgentProjectV1(project), ...reportFields });
  const artifacts: Readonly<Record<BootstrapCheckpointId, readonly [string, unknown]>> = {
    "inspection-link": [CHECKPOINT_ARTIFACT_NAMES["inspection-link"], { v: "reelier.bootstrap-inspection-link/v1", digest: digest(inspection.report) }], "runtime-descriptor": [CHECKPOINT_ARTIFACT_NAMES["runtime-descriptor"], runtimeDescriptor], "route-coverage": [CHECKPOINT_ARTIFACT_NAMES["route-coverage"], { v: "reelier.bootstrap-route-coverage-link/v1", digest: reportProjection.routeCoverageDigest }], "workload-registration-request": [CHECKPOINT_ARTIFACT_NAMES["workload-registration-request"], registration], "profile-drafts": [CHECKPOINT_ARTIFACT_NAMES["profile-drafts"], drafts], "imported-governance": [CHECKPOINT_ARTIFACT_NAMES["imported-governance"], importedGovernance], "configuration-plan": [CHECKPOINT_ARTIFACT_NAMES["configuration-plan"], { v: "reelier.bootstrap-configuration-plan/v1", selected: options.yes === true, changes: installation.changed ? ["applied-with-backup"] : [] }], "installation-canary": [CHECKPOINT_ARTIFACT_NAMES["installation-canary"], { v: "reelier.bootstrap-installation-canary/v1", status: reportProjection.canary, reason: installation.changed ? "pinned proxy plan applied" : "no configuration surface selected" }], "project": [CHECKPOINT_ARTIFACT_NAMES.project, project], "report": [CHECKPOINT_ARTIFACT_NAMES.report, reportProjection],
  };
  let completed = existing?.completed ?? [];
  for (const id of BOOTSTRAP_CHECKPOINT_IDS.slice(completed.length)) { const [file, value] = artifacts[id]; await writeFileAtomic(path.join(bootstrapDir, file), `${JSON.stringify(value, null, 2)}\n`); completed = [...completed, { id, artifact: file, digest: digest(value) }]; await writeFileAtomic(statePath, `${JSON.stringify({ v: "reelier.bootstrap-state/v1", planDigest, completed } satisfies BootstrapState, null, 2)}\n`); }
  return Object.freeze({ ...reportProjection, actions: Object.freeze({ profileDrafted: true, profileCertified: false, authorityActivated: false }), pathC: "unavailable-no-activation" });
  } catch (error) {
    if (installation.backupPath !== undefined) await restoreFromBackup(configPath, installation.backupPath);
    else if (installation.changed && removeInstalledConfigOnRollback) await unlink(configPath).catch(() => {});
    await restoreBootstrapFiles(snapshots);
    throw new Error(`named bootstrap ${phase === "installation" ? "installation" : "transaction"} failed: ${(error as Error).message}`);
  }
  } finally { await release(); }
}

export async function dispatchFromBootstrap(_report: BootstrapPreparationReport): Promise<never> { throw new Error("validated profile activation required"); }
async function readState(file: string, expectedPlanDigest: string): Promise<BootstrapState | undefined> { try { const raw = JSON.parse(await readFile(file, "utf8")) as BootstrapState; if (raw.v !== "reelier.bootstrap-state/v1" || raw.planDigest !== expectedPlanDigest || !Array.isArray(raw.completed) || raw.completed.some((entry, index) => !entry || entry.id !== BOOTSTRAP_CHECKPOINT_IDS[index] || typeof entry.artifact !== "string" || !/^sha256:[0-9a-f]{64}$/.test(entry.digest))) throw new Error("invalid"); return raw; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw new Error("named bootstrap checkpoint state is malformed"); } }
function digest(value: unknown): string { return authorityDigest(value); }
function sha256(value: string): string { return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`; }

async function ensureRealDirectory(directory: string, label: string): Promise<void> { await mkdir(directory, { recursive: true }); const info = await lstat(directory); if (!info.isDirectory() || info.isSymbolicLink()) throw new TypeError(`${label} is unsafe or linked`); }
async function acquireBootstrapLock(file: string): Promise<() => Promise<void>> {
  const recoveryFile = `${file}.recovery`;
  if (await fileIsPresent(recoveryFile) && !await recoverOrphanedBootstrapRecovery(recoveryFile)) throw new Error("named bootstrap is busy: lock recovery present");
  const owner = JSON.stringify({ v: "reelier.bootstrap-lock/v1", pid: process.pid, processStartedAt: BOOTSTRAP_PROCESS_STARTED_AT, nonce: `${process.pid}-${Date.now()}` });
  try {
    const handle = await open(file, "wx");
    await handle.writeFile(owner);
    await handle.close();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    let ownerBytes: string;
    let parsed: { pid?: unknown; processStartedAt?: unknown };
    try { ownerBytes = await readFile(file, "utf8"); parsed = JSON.parse(ownerBytes) as { pid?: unknown; processStartedAt?: unknown }; }
    catch { throw new Error("named bootstrap is busy: lock present"); }
    if (isStaleBootstrapLockOwner(parsed)) {
      if (await retireStaleBootstrapLock(file, recoveryFile, ownerBytes)) return acquireBootstrapLock(file);
      return acquireBootstrapLock(file);
    }
    if (parsed.pid === process.pid && parsed.processStartedAt === BOOTSTRAP_PROCESS_STARTED_AT) { await new Promise(resolve => setTimeout(resolve, 10)); return acquireBootstrapLock(file); }
    throw new Error("named bootstrap is busy: lock present");
  }
  return async () => { if (await readFile(file, "utf8").catch(() => "") === owner) await unlink(file).catch(() => {}); };
}

async function recoverOrphanedBootstrapRecovery(recoveryFile: string): Promise<boolean> {
  let expectedBytes: string;
  let owner: { v?: unknown; pid?: unknown; processStartedAt?: unknown; nonce?: unknown };
  try { expectedBytes = await readFile(recoveryFile, "utf8"); owner = JSON.parse(expectedBytes) as typeof owner; }
  catch { return false; }
  if (owner.v !== "reelier.bootstrap-lock-recovery/v1" || typeof owner.nonce !== "string" || !isStaleBootstrapLockOwner(owner)) return false;
  const retiredFile = `${recoveryFile}.retired-${randomBytes(12).toString("hex")}`;
  try { await rename(recoveryFile, retiredFile); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return true; throw error; }
  try {
    const retiredBytes = await readFile(retiredFile, "utf8");
    let retiredOwner: typeof owner;
    try { retiredOwner = JSON.parse(retiredBytes) as typeof owner; } catch { await restoreRetiredRecovery(retiredFile, recoveryFile); return false; }
    if (retiredBytes !== expectedBytes || retiredOwner.v !== "reelier.bootstrap-lock-recovery/v1" || typeof retiredOwner.nonce !== "string" || !isStaleBootstrapLockOwner(retiredOwner)) { await restoreRetiredRecovery(retiredFile, recoveryFile); return false; }
    await unlink(retiredFile);
    return true;
  } catch (error) {
    if (await fileIsPresent(retiredFile)) await restoreRetiredRecovery(retiredFile, recoveryFile);
    throw error;
  }
}

async function restoreRetiredRecovery(retiredFile: string, recoveryFile: string): Promise<void> {
  try { await link(retiredFile, recoveryFile); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  await unlink(retiredFile);
}

function isStaleBootstrapLockOwner(owner: { pid?: unknown; processStartedAt?: unknown }): boolean {
  return typeof owner.pid === "number" && (!isLivePid(owner.pid) || owner.pid === process.pid && typeof owner.processStartedAt === "number" && owner.processStartedAt !== BOOTSTRAP_PROCESS_STARTED_AT);
}

async function retireStaleBootstrapLock(file: string, recoveryFile: string, expectedOwnerBytes: string): Promise<boolean> {
  const recoveryOwner = JSON.stringify({ v: "reelier.bootstrap-lock-recovery/v1", pid: process.pid, processStartedAt: BOOTSTRAP_PROCESS_STARTED_AT, nonce: `${process.pid}-${Date.now()}` });
  let handle;
  try {
    handle = await open(recoveryFile, "wx");
    await handle.writeFile(recoveryOwner);
    await handle.close();
    handle = undefined;
  } catch (error) {
    await handle?.close().catch(() => {});
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("named bootstrap is busy: lock recovery present");
    throw error;
  }
  try {
    if (await readFile(file, "utf8").catch(() => "") !== expectedOwnerBytes) return false;
    let current: { pid?: unknown; processStartedAt?: unknown };
    try { current = JSON.parse(expectedOwnerBytes) as { pid?: unknown; processStartedAt?: unknown }; } catch { return false; }
    if (!isStaleBootstrapLockOwner(current)) return false;
    await unlink(file);
    return true;
  } finally {
    if (await readFile(recoveryFile, "utf8").catch(() => "") === recoveryOwner) await unlink(recoveryFile).catch(() => {});
  }
}

async function fileIsPresent(file: string): Promise<boolean> {
  try { await access(file); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}
async function loadImportedGovernance(options: InitializeAgentProjectOptions): Promise<unknown> { if (!options.governance) { try { await access(path.join(options.homedir, ".reelier", "governance", "profile-governance.json")); throw new TypeError("self-authored governance summary is not authority"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } return { v: "reelier.imported-governance/v1", tenant: null, governanceRef: null, manifestDigest: null, trustHeadDigest: null, verificationStatus: "absent" }; } const admitted = await loadProfileGovernanceFromOperatorTrust({ ...options.governance, homedir: options.homedir }); const state = admittedProfileGovernanceState(admitted); return { v: "reelier.imported-governance/v1", tenant: options.governance.tenant, governanceRef: options.governance.governanceRef, manifestDigest: options.governance.expectedManifestDigest, trustHeadDigest: options.governance.expectedTrustHeadDigest, verificationStatus: state.manifest.profileDigest ? "verified" : "absent" }; }
function isLivePid(pid: number): boolean { if (!Number.isInteger(pid) || pid < 1) return false; try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; } }
async function validateCompletedArtifacts(root: string, state: BootstrapState): Promise<void> { for (const entry of state.completed) { if (entry.artifact !== CHECKPOINT_ARTIFACT_NAMES[entry.id] || path.basename(entry.artifact) !== entry.artifact || entry.artifact.includes("\\") || entry.artifact.includes("/")) throw new TypeError("named bootstrap checkpoint artifact path is invalid"); const info = await lstat(path.join(root, entry.artifact)).catch(() => undefined); if (!info?.isFile() || info.isSymbolicLink()) throw new TypeError("named bootstrap checkpoint artifact is unsafe or linked"); const value = await readJson(root, entry.artifact); if (digest(value) !== entry.digest) throw new TypeError("named bootstrap checkpoint artifact digest is invalid"); if (entry.id === "route-coverage" && (value as { digest?: unknown }).digest !== sha256(await readFile(path.join(root, "route-coverage.json"), "utf8"))) throw new TypeError("named bootstrap route coverage digest join is invalid"); } if (state.completed.length === BOOTSTRAP_CHECKPOINT_IDS.length) { const [project, report, runtime] = await Promise.all([readJson(root, "project.json"), readJson(root, "report.json"), readJson(root, "runtime-descriptor.json")]); parseAgentProjectV1(project); parseBootstrapReportV1(report); parseRuntimeDescriptorV1(runtime); if ((report as BootstrapReportV1).projectDigest !== digestAgentProjectV1(project)) throw new TypeError("named bootstrap project/report digest join is invalid"); } }
async function readJson(root: string, file: string): Promise<unknown> { try { return JSON.parse(await readFile(path.join(root, file), "utf8")); } catch { throw new TypeError("named bootstrap checkpoint artifact is malformed"); } }
async function installedPackageRoot(): Promise<string> { let candidate = path.dirname(fileURLToPath(import.meta.url)); for (;;) { try { await access(path.join(candidate, "package.json")); return candidate; } catch {} const parent = path.dirname(candidate); if (parent === candidate) throw new TypeError("installed package root is unavailable"); candidate = parent; } }

async function snapshotBootstrapFiles(root: string, statePath: string): Promise<readonly BootstrapFileSnapshot[]> {
  const paths = [statePath, path.join(root, "route-coverage.json"), ...Object.values(CHECKPOINT_ARTIFACT_NAMES).map(name => path.join(root, name))];
  return Promise.all([...new Set(paths)].map(async file => {
    const info = await lstat(file).catch(() => undefined);
    if (info === undefined) return { path: file, kind: "absent" as const };
    if (!info.isFile() || info.isSymbolicLink()) return { path: file, kind: "other" as const };
    return { path: file, kind: "file" as const, content: await readFile(file, "utf8") };
  }));
}

async function restoreBootstrapFiles(snapshots: readonly BootstrapFileSnapshot[]): Promise<void> {
  for (const snapshot of [...snapshots].reverse()) {
    if (snapshot.kind === "absent") await unlink(snapshot.path).catch(() => {});
    else if (snapshot.kind === "file") await writeFileAtomic(snapshot.path, snapshot.content!);
  }
}
