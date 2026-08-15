import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { AUTHORITY_ADAPTER_CONTRACT_V1_DIGEST } from "../authority/adapter-contract.js";
import { OUTCOME_PROFILE_CONTRACT_V1_DIGEST } from "../authority/outcome-profile-contract.js";
import { authorityDigest } from "../authority/wire.js";
import { initializeInspection, type InitializationDependencies } from "../initialization.js";
import { writeFileAtomic } from "../writeback.js";
import { BOOTSTRAP_CONTRACT_V1_DIGEST } from "./contract.js";
import { createProfileDrafts } from "./profile-drafts.js";
import type { BootstrapReportV1 } from "./types.js";
import { prepareWorkloadRegistration } from "./workload-registration.js";

export const BOOTSTRAP_CHECKPOINT_IDS = Object.freeze(["inspection-link", "runtime-descriptor", "route-coverage", "workload-registration-request", "profile-drafts", "imported-governance", "configuration-plan", "installation-canary", "project", "report"] as const);
type BootstrapCheckpointId = (typeof BOOTSTRAP_CHECKPOINT_IDS)[number];
export interface InitializeAgentProjectOptions { readonly cwd: string; readonly homedir: string; readonly agentName: string; readonly yes?: boolean; readonly exactVersion: string; readonly dependencies?: InitializationDependencies; }
export type BootstrapPreparationReport = BootstrapReportV1 & Readonly<{ actions: { profileDrafted: boolean; profileCertified: boolean; authorityActivated: boolean }; pathC: "unavailable-no-activation"; }>;
interface BootstrapState { v: "reelier.bootstrap-state/v1"; planDigest: string; completed: readonly BootstrapCheckpointId[]; }
const planDigest = digest({ v: "reelier.bootstrap-plan/v1", checkpoints: BOOTSTRAP_CHECKPOINT_IDS });

export async function initializeAgentProject(options: InitializeAgentProjectOptions): Promise<BootstrapPreparationReport> {
  if (!path.isAbsolute(options.cwd) || !path.isAbsolute(options.homedir) || !/^[A-Za-z0-9._~-]{1,128}$/.test(options.agentName) || !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/.test(options.exactVersion)) throw new TypeError("named bootstrap options are invalid");
  const projectRoot = await realpath(options.cwd);
  await mkdir(path.join(projectRoot, ".reelier"), { recursive: true });
  const inspection = await initializeInspection({ cwd: projectRoot, homedir: options.homedir, ...(options.dependencies === undefined ? {} : { dependencies: options.dependencies }), namedBootstrapRouteDiscovery: { agentName: options.agentName, now: new Date(), contractIdentityDigest: BOOTSTRAP_CONTRACT_V1_DIGEST, findings: [] } });
  if (inspection.status === "busy") throw new Error("named bootstrap is busy");
  const bootstrapDir = path.join(projectRoot, ".reelier", "bootstrap");
  const info = await lstat(bootstrapDir);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new TypeError("named bootstrap directory is unsafe");
  const statePath = path.join(bootstrapDir, "state.json");
  const existing = await readState(statePath);
  const registration = await prepareWorkloadRegistration(options.homedir, options.agentName);
  const drafts = createProfileDrafts();
  const runtimeDescriptor = { v: "reelier.runtime-descriptor/v1", adapterId: "externally-managed", adapterVersion: "1", adapterDigest: digest({ adapter: "externally-managed" }), launchMode: "externally-managed", command: null, args: [], cwd: null, connectionRef: "managed-cell", environmentAllowlist: [], authenticatedBinding: "host-private", shutdown: "external" } as const;
  const routeCoverage = await readFile(path.join(bootstrapDir, "route-coverage.json"), "utf8");
  const reportProjection: BootstrapReportV1 = Object.freeze({ v: "reelier.bootstrap-report/v1", projectDigest: digest({ agentName: options.agentName, version: options.exactVersion }), runtimeDescriptorDigest: digest(runtimeDescriptor), routeCoverageDigest: sha256(routeCoverage), initializedAt: new Date().toISOString(), canary: "unchecked", authority: "unavailable", recoveryCommand: `npx reelier@${options.exactVersion} up`, completeness: "not-proved" });
  const project = { v: "reelier.agent-project/v1", agentName: options.agentName, projectId: `project_${options.agentName}`, tenant: null, reelierVersion: options.exactVersion, installedBuildDigest: digest({ package: "reelier", version: options.exactVersion }), packageTarballIntegrityDigest: null, authorityContractDigest: AUTHORITY_ADAPTER_CONTRACT_V1_DIGEST, continuityContractDigest: digest({ contract: "continuity" }), outcomeProfileContractDigest: OUTCOME_PROFILE_CONTRACT_V1_DIGEST, bootstrapContractDigest: BOOTSTRAP_CONTRACT_V1_DIGEST, initializationReportDigest: digest(inspection.report), runtimeDescriptorDigest: reportProjection.runtimeDescriptorDigest, routeCoverageDigest: reportProjection.routeCoverageDigest, profileGovernanceRef: null, profileGovernanceManifestDigest: null, profileTrustHeadDigest: null, authorityMode: "unconfigured" } as const;
  const artifacts: Readonly<Record<BootstrapCheckpointId, readonly [string, unknown]>> = {
    "inspection-link": ["inspection-link.json", { v: "reelier.bootstrap-inspection-link/v1", digest: digest(inspection.report) }], "runtime-descriptor": ["runtime-descriptor.json", runtimeDescriptor], "route-coverage": ["route-coverage-link.json", { v: "reelier.bootstrap-route-coverage-link/v1", digest: reportProjection.routeCoverageDigest }], "workload-registration-request": ["workload-registration-request.json", registration], "profile-drafts": ["profile-drafts.json", drafts], "imported-governance": ["imported-governance.json", { v: "reelier.imported-governance/v1", governanceRef: null, manifestDigest: null, trustHeadDigest: null, verificationStatus: "absent" }], "configuration-plan": ["configuration-plan.json", { v: "reelier.bootstrap-configuration-plan/v1", selected: options.yes === true, changes: [] }], "installation-canary": ["installation-canary.json", { v: "reelier.bootstrap-installation-canary/v1", status: "unchecked", reason: "no configuration surface selected" }], "project": ["project.json", project], "report": ["report.json", reportProjection],
  };
  let completed = existing?.completed ?? [];
  for (const id of BOOTSTRAP_CHECKPOINT_IDS.slice(completed.length)) { const [file, value] = artifacts[id]; await writeFileAtomic(path.join(bootstrapDir, file), `${JSON.stringify(value, null, 2)}\n`); completed = [...completed, id]; await writeFileAtomic(statePath, `${JSON.stringify({ v: "reelier.bootstrap-state/v1", planDigest, completed } satisfies BootstrapState, null, 2)}\n`); }
  return Object.freeze({ ...reportProjection, actions: Object.freeze({ profileDrafted: true, profileCertified: false, authorityActivated: false }), pathC: "unavailable-no-activation" });
}

export async function dispatchFromBootstrap(_report: BootstrapPreparationReport): Promise<never> { throw new Error("validated profile activation required"); }
async function readState(file: string): Promise<BootstrapState | undefined> { try { const raw = JSON.parse(await readFile(file, "utf8")) as BootstrapState; if (raw.v !== "reelier.bootstrap-state/v1" || raw.planDigest !== planDigest || !Array.isArray(raw.completed) || raw.completed.some((id, index) => id !== BOOTSTRAP_CHECKPOINT_IDS[index])) throw new Error("invalid"); return raw; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw new Error("named bootstrap checkpoint state is malformed"); } }
function digest(value: unknown): string { return authorityDigest(value); }
function sha256(value: string): string { return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`; }
