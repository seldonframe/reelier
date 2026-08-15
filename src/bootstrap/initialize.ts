import { createHash } from "node:crypto";
import { access, lstat, mkdir, open, readFile, realpath, unlink } from "node:fs/promises";
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
import type { BootstrapReportV1 } from "./types.js";
import { prepareWorkloadRegistration } from "./workload-registration.js";
import { applyBootstrapInstall, planBootstrapInstall } from "./install.js";

export const BOOTSTRAP_CHECKPOINT_IDS = Object.freeze(["inspection-link", "runtime-descriptor", "route-coverage", "workload-registration-request", "profile-drafts", "imported-governance", "configuration-plan", "installation-canary", "project", "report"] as const);
type BootstrapCheckpointId = (typeof BOOTSTRAP_CHECKPOINT_IDS)[number];
export interface InitializeAgentProjectOptions { readonly cwd: string; readonly homedir: string; readonly agentName: string; readonly yes?: boolean; readonly exactVersion: string; readonly dependencies?: InitializationDependencies; }
export type BootstrapPreparationReport = BootstrapReportV1 & Readonly<{ actions: { profileDrafted: boolean; profileCertified: boolean; authorityActivated: boolean }; pathC: "unavailable-no-activation"; }>;
interface BootstrapCompleted { id: BootstrapCheckpointId; artifact: string; digest: string; }
interface BootstrapState { v: "reelier.bootstrap-state/v1"; planDigest: string; completed: readonly BootstrapCompleted[]; }
const planDigest = digest({ v: "reelier.bootstrap-plan/v1", checkpoints: BOOTSTRAP_CHECKPOINT_IDS });

export async function initializeAgentProject(options: InitializeAgentProjectOptions): Promise<BootstrapPreparationReport> {
  if (!path.isAbsolute(options.cwd) || !path.isAbsolute(options.homedir) || !/^[A-Za-z0-9._~-]{1,128}$/.test(options.agentName) || options.agentName === "." || options.agentName === ".." || !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/.test(options.exactVersion)) throw new TypeError("named bootstrap options are invalid");
  const projectRoot = await realpath(options.cwd);
  const reelierDir = path.join(projectRoot, ".reelier");
  await ensureRealDirectory(reelierDir, "project Reelier directory");
  const bootstrapParent = path.join(reelierDir, "bootstrap");
  await ensureRealDirectory(bootstrapParent, "named bootstrap directory");
  const release = await acquireBootstrapLock(path.join(bootstrapParent, ".lock"));
  try {
  const inspection = await initializeInspection({ cwd: projectRoot, homedir: options.homedir, ...(options.dependencies === undefined ? {} : { dependencies: options.dependencies }), namedBootstrapRouteDiscovery: { agentName: options.agentName, now: new Date(), contractIdentityDigest: BOOTSTRAP_CONTRACT_V1_DIGEST, findings: [] } });
  if (inspection.status === "busy") throw new Error("named bootstrap is busy");
  const bootstrapDir = path.join(projectRoot, ".reelier", "bootstrap");
  const info = await lstat(bootstrapDir);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new TypeError("named bootstrap directory is unsafe");
  const statePath = path.join(bootstrapDir, "state.json");
  const existing = await readState(statePath);
  const importedGovernance = await loadImportedGovernance(options.homedir);
  const registration = await prepareWorkloadRegistration(options.homedir, options.agentName);
  if (existing !== undefined && existing.completed.length === BOOTSTRAP_CHECKPOINT_IDS.length) {
    await validateCompletedArtifacts(bootstrapDir, existing);
    const report = parseBootstrapReportV1(await readJson(bootstrapDir, "report.json"));
    return Object.freeze({ ...report, actions: Object.freeze({ profileDrafted: true, profileCertified: false, authorityActivated: false }), pathC: "unavailable-no-activation" });
  }
  const drafts = createProfileDrafts();
  const runtimeDescriptor = { v: "reelier.runtime-descriptor/v1", adapterId: "externally-managed", adapterVersion: "1.0.0", adapterDigest: digest({ adapter: "externally-managed" }), launchMode: "externally-managed", command: null, args: [], cwd: null, connectionRef: "managed-cell", environmentAllowlist: [], authenticatedBinding: "host-private", shutdown: "external" } as const;
  const routeCoverage = await readFile(path.join(bootstrapDir, "route-coverage.json"), "utf8");
  const configPath = path.join(projectRoot, ".mcp.json");
  let installation = { changed: false, backupPath: undefined as string | undefined };
  try {
    const plan = await planBootstrapInstall(configPath, options.exactVersion, projectRoot);
    if (plan.changed && options.yes) installation = { changed: true, ...(await applyBootstrapInstall(plan, { consent: true })) };
  } catch (error) { throw new Error(`named bootstrap installation failed: ${(error as Error).message}`); }
  const reportFields = { runtimeDescriptorDigest: digest(runtimeDescriptor), routeCoverageDigest: sha256(routeCoverage), initializedAt: new Date().toISOString(), canary: installation.changed ? "verified" as const : "unchecked" as const, authority: "unavailable" as const, recoveryCommand: `npx reelier@${options.exactVersion} up`, completeness: "not-proved" as const };
  const project = { v: "reelier.agent-project/v1", agentName: options.agentName, projectId: `project_${options.agentName}`, tenant: null, reelierVersion: options.exactVersion, installedBuildDigest: digest({ package: "reelier", version: options.exactVersion }), packageTarballIntegrityDigest: null, authorityContractDigest: AUTHORITY_ADAPTER_CONTRACT_V1_DIGEST, continuityContractDigest: digest({ contract: "continuity" }), outcomeProfileContractDigest: OUTCOME_PROFILE_CONTRACT_V1_DIGEST, bootstrapContractDigest: BOOTSTRAP_CONTRACT_V1_DIGEST, initializationReportDigest: digest(inspection.report), runtimeDescriptorDigest: reportFields.runtimeDescriptorDigest, routeCoverageDigest: reportFields.routeCoverageDigest, profileGovernanceRef: null, profileGovernanceManifestDigest: null, profileTrustHeadDigest: null, authorityMode: "unconfigured" } as const;
  const reportProjection: BootstrapReportV1 = Object.freeze({ v: "reelier.bootstrap-report/v1", projectDigest: digestAgentProjectV1(project), ...reportFields });
  const artifacts: Readonly<Record<BootstrapCheckpointId, readonly [string, unknown]>> = {
    "inspection-link": ["inspection-link.json", { v: "reelier.bootstrap-inspection-link/v1", digest: digest(inspection.report) }], "runtime-descriptor": ["runtime-descriptor.json", runtimeDescriptor], "route-coverage": ["route-coverage-link.json", { v: "reelier.bootstrap-route-coverage-link/v1", digest: reportProjection.routeCoverageDigest }], "workload-registration-request": ["workload-registration-request.json", registration], "profile-drafts": ["profile-drafts.json", drafts], "imported-governance": ["imported-governance.json", importedGovernance], "configuration-plan": ["configuration-plan.json", { v: "reelier.bootstrap-configuration-plan/v1", selected: options.yes === true, changes: installation.changed ? ["applied-with-backup"] : [] }], "installation-canary": ["installation-canary.json", { v: "reelier.bootstrap-installation-canary/v1", status: reportProjection.canary, reason: installation.changed ? "pinned proxy plan applied" : "no configuration surface selected" }], "project": ["project.json", project], "report": ["report.json", reportProjection],
  };
  let completed = existing?.completed ?? [];
  for (const id of BOOTSTRAP_CHECKPOINT_IDS.slice(completed.length)) { const [file, value] = artifacts[id]; await writeFileAtomic(path.join(bootstrapDir, file), `${JSON.stringify(value, null, 2)}\n`); completed = [...completed, { id, artifact: file, digest: digest(value) }]; await writeFileAtomic(statePath, `${JSON.stringify({ v: "reelier.bootstrap-state/v1", planDigest, completed } satisfies BootstrapState, null, 2)}\n`); }
  return Object.freeze({ ...reportProjection, actions: Object.freeze({ profileDrafted: true, profileCertified: false, authorityActivated: false }), pathC: "unavailable-no-activation" });
  } finally { await release(); }
}

export async function dispatchFromBootstrap(_report: BootstrapPreparationReport): Promise<never> { throw new Error("validated profile activation required"); }
async function readState(file: string): Promise<BootstrapState | undefined> { try { const raw = JSON.parse(await readFile(file, "utf8")) as BootstrapState; if (raw.v !== "reelier.bootstrap-state/v1" || raw.planDigest !== planDigest || !Array.isArray(raw.completed) || raw.completed.some((entry, index) => !entry || entry.id !== BOOTSTRAP_CHECKPOINT_IDS[index] || typeof entry.artifact !== "string" || !/^sha256:[0-9a-f]{64}$/.test(entry.digest))) throw new Error("invalid"); return raw; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw new Error("named bootstrap checkpoint state is malformed"); } }
function digest(value: unknown): string { return authorityDigest(value); }
function sha256(value: string): string { return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`; }

async function ensureRealDirectory(directory: string, label: string): Promise<void> { await mkdir(directory, { recursive: true }); const info = await lstat(directory); if (!info.isDirectory() || info.isSymbolicLink()) throw new TypeError(`${label} is unsafe or linked`); }
async function acquireBootstrapLock(file: string): Promise<() => Promise<void>> { try { const handle = await open(file, "wx"); await handle.writeFile(JSON.stringify({ v: "reelier.bootstrap-lock/v1", pid: process.pid, nonce: `${process.pid}-${Date.now()}` })); await handle.close(); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; let raw: { pid?: unknown }; try { raw = JSON.parse(await readFile(file, "utf8")) as { pid?: unknown }; } catch { throw new Error("named bootstrap is busy: lock present"); } if (typeof raw.pid === "number" && raw.pid < 0) { await unlink(file); return acquireBootstrapLock(file); } if (raw.pid === process.pid) { await new Promise(resolve => setTimeout(resolve, 10)); return acquireBootstrapLock(file); } throw new Error("named bootstrap is busy: lock present"); } return async () => { await unlink(file).catch(() => {}); }; }
async function loadImportedGovernance(homedir: string): Promise<unknown> { const file = path.join(homedir, ".reelier", "governance", "profile-governance.json"); try { const value = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>; if (Object.keys(value).sort().join("\0") !== ["governanceRef", "manifestDigest", "trustHeadDigest", "verificationStatus"].join("\0") || typeof value.governanceRef !== "string" || !/^sha256:[0-9a-f]{64}$/.test(String(value.manifestDigest)) || !/^sha256:[0-9a-f]{64}$/.test(String(value.trustHeadDigest)) || value.verificationStatus !== "verified") throw new TypeError("imported governance is partial or invalid"); return { v: "reelier.imported-governance/v1", ...value }; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { v: "reelier.imported-governance/v1", governanceRef: null, manifestDigest: null, trustHeadDigest: null, verificationStatus: "absent" }; throw error; } }
async function validateCompletedArtifacts(root: string, state: BootstrapState): Promise<void> { for (const entry of state.completed) { const value = await readJson(root, entry.artifact); if (digest(value) !== entry.digest) throw new TypeError("named bootstrap checkpoint artifact digest is invalid"); } const [project, report, runtime] = await Promise.all([readJson(root, "project.json"), readJson(root, "report.json"), readJson(root, "runtime-descriptor.json")]); parseAgentProjectV1(project); parseBootstrapReportV1(report); parseRuntimeDescriptorV1(runtime); if ((report as BootstrapReportV1).projectDigest !== digestAgentProjectV1(project)) throw new TypeError("named bootstrap project/report digest join is invalid"); }
async function readJson(root: string, file: string): Promise<unknown> { try { return JSON.parse(await readFile(path.join(root, file), "utf8")); } catch { throw new TypeError("named bootstrap checkpoint artifact is malformed"); } }
