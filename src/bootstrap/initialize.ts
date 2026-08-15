import { createHash, randomBytes } from "node:crypto";
import { access, lstat, mkdir, open, readFile, realpath, rename, rm, unlink, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { authorityDigest } from "../authority/wire.js";
import type { InitializationDependencies } from "../initialization.js";
import { normalizeRouteCoverageV1 } from "../routes/normalize.js";
import { writeFileAtomic } from "../writeback.js";
import { computeInstalledBuildDigest } from "./build-identity.js";

export const PREPARATION_STATES = Object.freeze(["absent", "locked", "prepared", "committing", "complete", "rolling-back", "recovery-required"] as const);
export type PreparationState = (typeof PREPARATION_STATES)[number];

export interface InitializeAgentProjectOptions {
  readonly cwd: string;
  readonly homedir: string;
  readonly agentName: string;
  readonly exactVersion: string;
  readonly yes?: boolean;
  /** Retained only so callers can prove named preparation does not invoke inspection dependencies. */
  readonly dependencies?: InitializationDependencies;
  /** Deterministic crash seam for transaction tests; leaves the durable lock and journal in place. */
  readonly interruptAfterState?: "locked" | "prepared" | "committing";
}

export interface MinimalNamedProjectV1 {
  readonly v: "reelier.named-project/v1";
  readonly agentName: string;
  readonly projectRoot: string;
  readonly reelierVersion: string;
  readonly installedBuildDigest: string;
  readonly routeSnapshotDigest: string | null;
  readonly authority: "absent";
  readonly completeness: "not-proved";
}

export interface BootstrapPreparationReport {
  readonly v: "reelier.named-preparation-report/v1";
  readonly state: "complete";
  readonly projectDigest: string;
  readonly initializedAt: string;
  readonly authority: "absent";
  readonly completeness: "not-proved";
  readonly recoveryCommand: string;
  readonly up: "unavailable";
}

interface CanonicalTarget {
  readonly agentName: string;
  readonly agentNameFold: string;
  readonly projectRoot: string;
  readonly reelierVersion: string;
  readonly installedBuildDigest: string;
  readonly routeSnapshotDigest: string | null;
}

interface LockRecord {
  readonly v: "reelier.bootstrap-lock/v2";
  readonly pid: number;
  readonly ownerToken: string;
  readonly transactionId: string;
}

interface TransactionRecord {
  readonly v: "reelier.bootstrap-transaction/v2";
  readonly state: Exclude<PreparationState, "absent">;
  readonly transactionId: string;
  readonly ownerTokenCommitment: string;
  readonly planDigest: string;
  readonly canonicalTarget: CanonicalTarget;
  readonly priorGeneration: null;
  readonly priorGenerationDigest: null;
  readonly checkpointDigest: string | null;
  readonly publishedGeneration: string | null;
}

interface CheckpointRecord {
  readonly v: "reelier.bootstrap-checkpoint/v2";
  readonly transactionId: string;
  readonly ownerTokenCommitment: string;
  readonly planDigest: string;
  readonly canonicalTarget: CanonicalTarget;
  readonly priorTargetDigest: null;
  readonly artifacts: readonly Readonly<{ name: "project.json" | "report.json" | "recovery-command.txt"; digest: string }>[];
}

const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/;
const NAME = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const TOKEN = /^[0-9a-f]{64}$/;
const TRANSACTION_ID = /^[0-9a-f]{32}$/;
const PROCESS_STARTED_AT = Math.floor(Date.now() - process.uptime() * 1_000);

export async function initializeAgentProject(options: InitializeAgentProjectOptions): Promise<BootstrapPreparationReport> {
  const canonicalTarget = await canonicalizeTarget(options);
  const bootstrapRoot = await ensureBootstrapRoot(canonicalTarget.projectRoot);
  const routeSnapshotDigest = await existingRouteSnapshotDigest(bootstrapRoot);
  const target = Object.freeze({ ...canonicalTarget, routeSnapshotDigest });
  const planDigest = digest({
    v: "reelier.bootstrap-plan/v2",
    target,
    artifacts: ["project.json", "report.json", "recovery-command.txt"],
    states: PREPARATION_STATES,
  });
  const journalPath = path.join(bootstrapRoot, "transaction.json");
  const lockPath = path.join(bootstrapRoot, ".lock");
  const existingJournal = await readOptionalJson(journalPath);

  if (existingJournal !== undefined) {
    const journal = parseTransaction(existingJournal);
    assertTransactionIdentity(journal, target, planDigest);
    if (journal.state === "complete") return readVerifiedComplete(bootstrapRoot, journal);
    if (journal.state === "recovery-required") throw new Error("named bootstrap recovery-required rollback must complete before forward progress");
  }

  const acquired = await acquireLock(lockPath, journalPath, existingJournal, target, planDigest);
  let journal = acquired.journal;
  let retainLock = false;
  try {
    if (journal === undefined) {
      journal = Object.freeze({
        v: "reelier.bootstrap-transaction/v2",
        state: "locked",
        transactionId: acquired.lock.transactionId,
        ownerTokenCommitment: sha256(acquired.lock.ownerToken),
        planDigest,
        canonicalTarget: target,
        priorGeneration: null,
        priorGenerationDigest: null,
        checkpointDigest: null,
        publishedGeneration: null,
      });
      await writeJournal(journalPath, journal);
      if (options.interruptAfterState === "locked") { await markSimulatedOrphan(lockPath, acquired.lock); retainLock = true; throw new InterruptedInitialization("locked"); }
    }

    if (journal.state === "locked") {
      // A crash in `locked` may leave only transaction-owned, uncommitted
      // staging bytes. They carry no checkpoint and are never adoptable.
      await rm(stagingPath(bootstrapRoot, journal.transactionId), { recursive: true, force: true });
      const prepared = await prepareGeneration(bootstrapRoot, journal);
      journal = Object.freeze({ ...journal, state: "prepared", checkpointDigest: prepared.checkpointDigest });
      await writeJournal(journalPath, journal);
      if (options.interruptAfterState === "prepared") { await markSimulatedOrphan(lockPath, acquired.lock); retainLock = true; throw new InterruptedInitialization("prepared"); }
    } else if (journal.state === "prepared") {
      await validateStagedGeneration(bootstrapRoot, journal);
    } else if (journal.state === "committing") {
      await validateStagedOrPublishedGeneration(bootstrapRoot, journal);
    } else if (journal.state === "rolling-back") {
      await rollbackAbsent(bootstrapRoot, journal);
      throw new Error("named bootstrap recovered the interrupted rollback; retry initialization");
    }

    if (journal.state === "prepared") {
      journal = Object.freeze({ ...journal, state: "committing" });
      await writeJournal(journalPath, journal);
      if (options.interruptAfterState === "committing") { await markSimulatedOrphan(lockPath, acquired.lock); retainLock = true; throw new InterruptedInitialization("committing"); }
    }

    if (journal.state !== "committing") throw new Error("named bootstrap transaction state is not forward-recoverable");
    const generation = journal.transactionId;
    const staging = stagingPath(bootstrapRoot, generation);
    const generationPath = path.join(bootstrapRoot, "generations", generation);
    if (!await exists(generationPath)) await rename(staging, generationPath);
    await validateGeneration(generationPath, journal);
    const pointer = Object.freeze({ v: "reelier.bootstrap-current/v1", generation, generationDigest: await generationDigest(generationPath) });
    await writeFileAtomic(path.join(bootstrapRoot, "current.json"), canonicalBytes(pointer));
    journal = Object.freeze({ ...journal, state: "complete", publishedGeneration: generation });
    await writeJournal(journalPath, journal);
    return await readVerifiedComplete(bootstrapRoot, journal);
  } catch (error) {
    if (error instanceof InterruptedInitialization) throw error;
    if (journal !== undefined && journal.state !== "complete" && journal.state !== "recovery-required") {
      try {
        const rollingBack = Object.freeze({ ...journal, state: "rolling-back" as const });
        await writeJournal(journalPath, rollingBack);
        await rollbackAbsent(bootstrapRoot, rollingBack);
      } catch {
        const recoveryRequired = Object.freeze({ ...journal, state: "recovery-required" as const });
        await writeJournal(journalPath, recoveryRequired).catch(() => {});
        retainLock = true;
      }
    }
    throw error;
  } finally {
    if (!retainLock) await releaseLock(lockPath, acquired.lock);
  }
}

async function canonicalizeTarget(options: InitializeAgentProjectOptions): Promise<Omit<CanonicalTarget, "routeSnapshotDigest">> {
  if (!path.isAbsolute(options.cwd) || !path.isAbsolute(options.homedir) || !VERSION.test(options.exactVersion)) throw new TypeError("named bootstrap options are invalid");
  if (!NAME.test(options.agentName) || options.agentName.normalize("NFC") !== options.agentName || options.agentName === "." || options.agentName === "..") throw new TypeError("named bootstrap agent name is invalid");
  const cwdInfo = await lstat(options.cwd);
  if (!cwdInfo.isDirectory() || cwdInfo.isSymbolicLink() || await realpath(options.cwd) !== path.resolve(options.cwd)) throw new TypeError("named bootstrap project directory is unsafe or linked");
  const homeInfo = await lstat(options.homedir);
  if (!homeInfo.isDirectory() || homeInfo.isSymbolicLink() || await realpath(options.homedir) !== path.resolve(options.homedir)) throw new TypeError("named bootstrap home directory is unsafe or linked");
  const projectRoot = await realpath(options.cwd);
  const packageRoot = await installedPackageRoot();
  return Object.freeze({
    agentName: options.agentName,
    agentNameFold: options.agentName.toLocaleLowerCase("en-US"),
    projectRoot,
    reelierVersion: options.exactVersion,
    installedBuildDigest: await computeInstalledBuildDigest(packageRoot),
  });
}

async function ensureBootstrapRoot(projectRoot: string): Promise<string> {
  const reelier = path.join(projectRoot, ".reelier");
  await ensureExactDirectory(reelier, projectRoot, ".reelier");
  const bootstrap = path.join(reelier, "bootstrap");
  await ensureExactDirectory(bootstrap, reelier, "bootstrap");
  return bootstrap;
}

async function ensureExactDirectory(directory: string, parent: string, basename: string): Promise<void> {
  await mkdir(directory).catch(error => { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || path.relative(parent, await realpath(directory)) !== basename) throw new TypeError(`named bootstrap ${basename} directory is unsafe or linked`);
}

async function existingRouteSnapshotDigest(bootstrapRoot: string): Promise<string | null> {
  const file = path.join(bootstrapRoot, "route-coverage.json");
  let bytes: string;
  try { bytes = await readFile(file, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink()) throw new TypeError("named bootstrap route snapshot is unsafe or linked");
  normalizeRouteCoverageV1(JSON.parse(bytes));
  return sha256(bytes);
}

async function acquireLock(lockPath: string, journalPath: string, rawJournal: unknown, target: CanonicalTarget, planDigest: string): Promise<{ lock: LockRecord; journal?: TransactionRecord }> {
  const ownerToken = randomBytes(32).toString("hex");
  const fresh: LockRecord = Object.freeze({ v: "reelier.bootstrap-lock/v2", pid: process.pid, ownerToken, transactionId: randomBytes(16).toString("hex") });
  try {
    const handle = await open(lockPath, "wx");
    await handle.writeFile(canonicalBytes(fresh));
    await handle.close();
    if (rawJournal !== undefined) throw new Error("named bootstrap journal exists without its owning lock");
    return { lock: fresh };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      if (await sameLock(lockPath, fresh)) await unlink(lockPath).catch(() => {});
      throw error;
    }
  }

  const current = parseLock(await readJsonFile(lockPath, "named bootstrap orphan lock is malformed"));
  if (isLiveLock(current)) throw new Error("named bootstrap is busy: live lock owner");
  if (rawJournal === undefined) throw new Error("named bootstrap orphan lock has no valid journal for recovery");
  const journal = parseTransaction(rawJournal);
  assertTransactionIdentity(journal, target, planDigest);
  if (journal.transactionId !== current.transactionId || journal.ownerTokenCommitment !== sha256(current.ownerToken)) throw new Error("named bootstrap orphan lock and journal identity mismatch");
  if (journal.state === "complete") throw new Error("named bootstrap complete journal retained an orphan lock");
  if (journal.state === "recovery-required") throw new Error("named bootstrap recovery-required rollback must complete before forward progress");
  const bootstrapRoot = path.dirname(lockPath);
  if (journal.state === "prepared") await validateStagedGeneration(bootstrapRoot, journal);
  if (journal.state === "committing") await validateStagedOrPublishedGeneration(bootstrapRoot, journal);

  const retired = `${lockPath}.orphan-${randomBytes(12).toString("hex")}`;
  await rename(lockPath, retired);
  const resumed: LockRecord = Object.freeze({ ...fresh, transactionId: journal.transactionId });
  try {
    const handle = await open(lockPath, "wx");
    await handle.writeFile(canonicalBytes(resumed));
    await handle.close();
    await unlink(retired);
    return { lock: resumed, journal };
  } catch (error) {
    await rename(retired, lockPath).catch(() => {});
    throw error;
  }
}

async function prepareGeneration(bootstrapRoot: string, journal: TransactionRecord): Promise<{ checkpointDigest: string }> {
  await ensureExactDirectory(path.join(bootstrapRoot, "staging"), bootstrapRoot, "staging");
  await ensureExactDirectory(path.join(bootstrapRoot, "generations"), bootstrapRoot, "generations");
  const root = stagingPath(bootstrapRoot, journal.transactionId);
  await mkdir(root);
  const project: MinimalNamedProjectV1 = Object.freeze({
    v: "reelier.named-project/v1",
    agentName: journal.canonicalTarget.agentName,
    projectRoot: journal.canonicalTarget.projectRoot,
    reelierVersion: journal.canonicalTarget.reelierVersion,
    installedBuildDigest: journal.canonicalTarget.installedBuildDigest,
    routeSnapshotDigest: journal.canonicalTarget.routeSnapshotDigest,
    authority: "absent",
    completeness: "not-proved",
  });
  const recoveryCommand = `npx reelier@${journal.canonicalTarget.reelierVersion} up`;
  const report: BootstrapPreparationReport = Object.freeze({
    v: "reelier.named-preparation-report/v1",
    state: "complete",
    projectDigest: digest(project),
    initializedAt: new Date().toISOString(),
    authority: "absent",
    completeness: "not-proved",
    recoveryCommand,
    up: "unavailable",
  });
  const artifacts = [
    ["project.json", canonicalBytes(project)],
    ["report.json", canonicalBytes(report)],
    ["recovery-command.txt", `${recoveryCommand}\n`],
  ] as const;
  for (const [name, bytes] of artifacts) await writeExclusiveFile(path.join(root, name), bytes);
  const checkpoint: CheckpointRecord = Object.freeze({
    v: "reelier.bootstrap-checkpoint/v2",
    transactionId: journal.transactionId,
    ownerTokenCommitment: journal.ownerTokenCommitment,
    planDigest: journal.planDigest,
    canonicalTarget: journal.canonicalTarget,
    priorTargetDigest: null,
    artifacts: Object.freeze(artifacts.map(([name, bytes]) => Object.freeze({ name, digest: sha256(bytes) }))),
  });
  await writeExclusiveFile(path.join(root, "checkpoint.json"), canonicalBytes(checkpoint));
  return { checkpointDigest: digest(checkpoint) };
}

async function validateStagedGeneration(bootstrapRoot: string, journal: TransactionRecord): Promise<void> {
  await validateGeneration(stagingPath(bootstrapRoot, journal.transactionId), journal);
}

async function validateStagedOrPublishedGeneration(bootstrapRoot: string, journal: TransactionRecord): Promise<void> {
  const staged = stagingPath(bootstrapRoot, journal.transactionId);
  const published = path.join(bootstrapRoot, "generations", journal.transactionId);
  if (await exists(staged)) await validateGeneration(staged, journal);
  else await validateGeneration(published, journal);
}

async function validateGeneration(root: string, journal: TransactionRecord): Promise<void> {
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("named bootstrap checkpoint generation is unsafe");
  const checkpoint = parseCheckpoint(await readJsonFile(path.join(root, "checkpoint.json"), "named bootstrap checkpoint is malformed"));
  if (digest(checkpoint) !== journal.checkpointDigest || checkpoint.transactionId !== journal.transactionId || checkpoint.ownerTokenCommitment !== journal.ownerTokenCommitment || checkpoint.planDigest !== journal.planDigest || digest(checkpoint.canonicalTarget) !== digest(journal.canonicalTarget)) throw new Error("named bootstrap checkpoint plan identity mismatch");
  for (const artifact of checkpoint.artifacts) {
    const file = path.join(root, artifact.name);
    const artifactInfo = await lstat(file);
    if (!artifactInfo.isFile() || artifactInfo.isSymbolicLink() || sha256(await readFile(file)) !== artifact.digest) throw new Error("named bootstrap checkpoint artifact digest mismatch");
  }
}

async function readVerifiedComplete(bootstrapRoot: string, journal: TransactionRecord): Promise<BootstrapPreparationReport> {
  if (journal.state !== "complete" || journal.publishedGeneration !== journal.transactionId || journal.checkpointDigest === null) throw new Error("named bootstrap completion identity is invalid");
  const pointer = await readJsonFile(path.join(bootstrapRoot, "current.json"), "named bootstrap current generation is malformed") as Record<string, unknown>;
  if (pointer.v !== "reelier.bootstrap-current/v1" || pointer.generation !== journal.transactionId || typeof pointer.generationDigest !== "string") throw new Error("named bootstrap current generation identity mismatch");
  const root = path.join(bootstrapRoot, "generations", journal.transactionId);
  await validateGeneration(root, journal);
  if (await generationDigest(root) !== pointer.generationDigest) throw new Error("named bootstrap committed generation digest mismatch");
  const project = await readJsonFile(path.join(root, "project.json"), "named project descriptor is malformed") as MinimalNamedProjectV1;
  if (digest(project) !== (await readJsonFile(path.join(root, "report.json"), "named preparation report is malformed") as BootstrapPreparationReport).projectDigest) throw new Error("named bootstrap project report identity mismatch");
  return await readJsonFile(path.join(root, "report.json"), "named preparation report is malformed") as BootstrapPreparationReport;
}

async function rollbackAbsent(bootstrapRoot: string, journal: TransactionRecord): Promise<void> {
  if (journal.priorGeneration !== null || journal.priorGenerationDigest !== null) throw new Error("named bootstrap prior generation is unsupported by the minimal transaction");
  await rm(stagingPath(bootstrapRoot, journal.transactionId), { recursive: true, force: true });
  await rm(path.join(bootstrapRoot, "generations", journal.transactionId), { recursive: true, force: true });
  const pointer = path.join(bootstrapRoot, "current.json");
  if (await exists(pointer)) await unlink(pointer);
  await unlink(path.join(bootstrapRoot, "transaction.json"));
  if (await exists(stagingPath(bootstrapRoot, journal.transactionId)) || await exists(path.join(bootstrapRoot, "generations", journal.transactionId)) || await exists(pointer)) throw new Error("named bootstrap rollback could not prove prior absence");
}

function parseLock(value: unknown): LockRecord {
  if (!isRecord(value) || !hasExactKeys(value, ["v", "pid", "ownerToken", "transactionId"]) || value.v !== "reelier.bootstrap-lock/v2" || !Number.isInteger(value.pid) || !TOKEN.test(String(value.ownerToken)) || !TRANSACTION_ID.test(String(value.transactionId))) throw new Error("named bootstrap orphan lock is malformed");
  return value as unknown as LockRecord;
}

function parseTransaction(value: unknown): TransactionRecord {
  const keys = ["v", "state", "transactionId", "ownerTokenCommitment", "planDigest", "canonicalTarget", "priorGeneration", "priorGenerationDigest", "checkpointDigest", "publishedGeneration"];
  if (!isRecord(value) || !hasExactKeys(value, keys) || value.v !== "reelier.bootstrap-transaction/v2" || !PREPARATION_STATES.includes(value.state as PreparationState) || value.state === "absent" || !TRANSACTION_ID.test(String(value.transactionId)) || !SHA256.test(String(value.ownerTokenCommitment)) || !SHA256.test(String(value.planDigest)) || value.priorGeneration !== null || value.priorGenerationDigest !== null || value.checkpointDigest !== null && !SHA256.test(String(value.checkpointDigest)) || value.publishedGeneration !== null && !TRANSACTION_ID.test(String(value.publishedGeneration)) || !isCanonicalTarget(value.canonicalTarget)) throw new Error("named bootstrap transaction journal is malformed");
  const journal = value as unknown as TransactionRecord;
  const checkpointRequired = journal.state === "prepared" || journal.state === "committing" || journal.state === "complete";
  const publicationRequired = journal.state === "complete";
  if (checkpointRequired && journal.checkpointDigest === null || journal.state === "locked" && journal.checkpointDigest !== null || (journal.publishedGeneration !== null) !== publicationRequired || publicationRequired && journal.publishedGeneration !== journal.transactionId) throw new Error("named bootstrap transaction state identity is malformed");
  return journal;
}

function parseCheckpoint(value: unknown): CheckpointRecord {
  if (!isRecord(value) || !hasExactKeys(value, ["v", "transactionId", "ownerTokenCommitment", "planDigest", "canonicalTarget", "priorTargetDigest", "artifacts"]) || value.v !== "reelier.bootstrap-checkpoint/v2" || !TRANSACTION_ID.test(String(value.transactionId)) || !SHA256.test(String(value.ownerTokenCommitment)) || !SHA256.test(String(value.planDigest)) || value.priorTargetDigest !== null || !isCanonicalTarget(value.canonicalTarget) || !Array.isArray(value.artifacts)) throw new Error("named bootstrap checkpoint is malformed");
  const names = ["project.json", "report.json", "recovery-command.txt"];
  if (value.artifacts.length !== names.length || value.artifacts.some((entry, index) => !isRecord(entry) || !hasExactKeys(entry, ["name", "digest"]) || entry.name !== names[index] || !SHA256.test(String(entry.digest)))) throw new Error("named bootstrap checkpoint artifact identity is malformed");
  return value as unknown as CheckpointRecord;
}

function assertTransactionIdentity(journal: TransactionRecord, target: CanonicalTarget, planDigest: string): void {
  if (journal.planDigest !== planDigest || digest(journal.canonicalTarget) !== digest(target)) throw new Error("named bootstrap plan identity mismatch or agent name case collision");
}

function isCanonicalTarget(value: unknown): value is CanonicalTarget {
  return isRecord(value) && hasExactKeys(value, ["agentName", "agentNameFold", "projectRoot", "reelierVersion", "installedBuildDigest", "routeSnapshotDigest"]) && NAME.test(String(value.agentName)) && value.agentNameFold === String(value.agentName).toLocaleLowerCase("en-US") && path.isAbsolute(String(value.projectRoot)) && VERSION.test(String(value.reelierVersion)) && SHA256.test(String(value.installedBuildDigest)) && (value.routeSnapshotDigest === null || SHA256.test(String(value.routeSnapshotDigest)));
}

async function writeJournal(file: string, journal: TransactionRecord): Promise<void> { await writeFileAtomic(file, canonicalBytes(journal)); }
async function writeExclusiveFile(file: string, bytes: string): Promise<void> { const handle = await open(file, "wx"); try { await handle.writeFile(bytes); } finally { await handle.close(); } }
async function readJsonFile(file: string, message: string): Promise<unknown> { try { const info = await lstat(file); if (!info.isFile() || info.isSymbolicLink()) throw new Error(message); return JSON.parse(await readFile(file, "utf8")); } catch { throw new Error(message); } }
async function readOptionalJson(file: string): Promise<unknown | undefined> { try { const info = await lstat(file); if (!info.isFile() || info.isSymbolicLink()) throw new Error("unsafe"); return JSON.parse(await readFile(file, "utf8")); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw new Error("named bootstrap transaction journal is malformed"); } }
async function releaseLock(file: string, lock: LockRecord): Promise<void> { if (await sameLock(file, lock)) await unlink(file).catch(() => {}); }
async function markSimulatedOrphan(file: string, lock: LockRecord): Promise<void> { await writeFileAtomic(file, canonicalBytes({ ...lock, pid: 2147483647 })); }
async function sameLock(file: string, lock: LockRecord): Promise<boolean> { try { return digest(await readJsonFile(file, "invalid lock")) === digest(lock); } catch { return false; } }
async function exists(file: string): Promise<boolean> { try { await access(file); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; } }
function isLiveLock(lock: LockRecord): boolean { if (lock.pid === process.pid) return true; try { process.kill(lock.pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; } }
function stagingPath(root: string, transactionId: string): string { return path.join(root, "staging", transactionId); }
function canonicalBytes(value: unknown): string { return `${JSON.stringify(value, null, 2)}\n`; }
function digest(value: unknown): string { return authorityDigest(value); }
function sha256(value: string | Buffer): string { return `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype; }
function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean { const actual = Object.keys(value); return actual.length === keys.length && actual.every(key => keys.includes(key)); }
async function generationDigest(root: string): Promise<string> { return digest({ checkpoint: sha256(await readFile(path.join(root, "checkpoint.json"))), project: sha256(await readFile(path.join(root, "project.json"))), recovery: sha256(await readFile(path.join(root, "recovery-command.txt"))), report: sha256(await readFile(path.join(root, "report.json"))) }); }
async function installedPackageRoot(): Promise<string> { let candidate = path.dirname(fileURLToPath(import.meta.url)); for (;;) { try { await access(path.join(candidate, "package.json")); return candidate; } catch {} const parent = path.dirname(candidate); if (parent === candidate) throw new TypeError("installed package root is unavailable"); candidate = parent; } }

class InterruptedInitialization extends Error {
  constructor(state: string) { super(`named bootstrap interrupted after ${state}`); this.name = "InterruptedInitialization"; }
}

// Kept as a deterministic refusal boundary for callers compiled against the historical helper.
export async function dispatchFromBootstrap(_report: BootstrapPreparationReport): Promise<never> { throw new Error("validated profile activation required"); }
