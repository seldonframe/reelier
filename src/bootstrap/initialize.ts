import { createHash, randomBytes } from "node:crypto";
import { access, lstat, open, readFile, realpath } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { authorityDigest } from "../authority/wire.js";
import type { InitializationDependencies } from "../initialization.js";
import { normalizeRouteCoverageV1 } from "../routes/normalize.js";
import { createBootstrapNativeSessionFactory, type BootstrapNativeSession, type BootstrapNativeSessionFactory } from "./native-helper.js";

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
  /** Deterministic filesystem-fault seam used to prove post-publication rollback. */
  readonly failAt?: "after-publication" | "final-reread";
  /** Test seam; production always selects the verified packaged native helper. */
  readonly nativeSessionFactory?: BootstrapNativeSessionFactory;
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
  readonly initializedAt: string;
  readonly priorGeneration: null;
  readonly priorGenerationDigest: null;
  readonly checkpointDigest: string | null;
  readonly reboundCheckpointDigest: string | null;
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

export async function initializeAgentProject(options: InitializeAgentProjectOptions): Promise<BootstrapPreparationReport> {
  const canonicalTarget = await canonicalizeTarget(options);
  const rootHandle = await open(canonicalTarget.projectRoot, "r");
  const rootIdentity = await rootHandle.stat();
  const journalPath = path.join(canonicalTarget.projectRoot, ".reelier", "bootstrap", "transaction.json");
  let bootstrapRoot: string;
  const freshLock: LockRecord = Object.freeze({ v: "reelier.bootstrap-lock/v2", pid: process.pid, ownerToken: randomBytes(32).toString("hex"), transactionId: randomBytes(16).toString("hex") });
  let acquired!: Readonly<{ lock: LockRecord; priorLock?: LockRecord; priorBytes?: Buffer }>;
  let nativeSession: BootstrapNativeSession | undefined;
  let lockAcquired = false;
  let bootstrapHandle: Awaited<ReturnType<typeof open>> | undefined;
  let bootstrapIdentity: Awaited<ReturnType<typeof lstat>> | undefined;
  try {
    await assertProjectIdentity(canonicalTarget.projectRoot, rootHandle, rootIdentity.dev, rootIdentity.ino);
    const factory = options.nativeSessionFactory ?? createBootstrapNativeSessionFactory();
    nativeSession = await factory({ root: canonicalTarget.projectRoot, lockName: ".reelier-bootstrap.lock", lockBytes: Buffer.from(canonicalBytes(freshLock)) });
    acquired = nativeSession.acquisition.status === "created" ? Object.freeze({ lock: freshLock }) : recoveredLock(freshLock, nativeSession.acquisition.priorBytes);
    lockAcquired = true;
    bootstrapRoot = await ensureBootstrapRoot(canonicalTarget.projectRoot, nativeSession);
    await assertProjectIdentity(canonicalTarget.projectRoot, rootHandle, rootIdentity.dev, rootIdentity.ino);
    bootstrapHandle = await open(bootstrapRoot, "r");
    bootstrapIdentity = await bootstrapHandle.stat();
    await assertDirectoryIdentity(bootstrapRoot, bootstrapHandle, bootstrapIdentity.dev, bootstrapIdentity.ino, "bootstrap root");
  } catch (error) {
    if (lockAcquired) await nativeSession?.close({ removeLock: acquired.priorLock === undefined }).catch(() => {});
    await bootstrapHandle?.close();
    await rootHandle.close();
    throw error;
  }
  const retainedBootstrapHandle = bootstrapHandle;
  const retainedBootstrapIdentity = bootstrapIdentity;
  const retainedNativeSession = nativeSession;
  if (retainedBootstrapHandle === undefined || retainedBootstrapIdentity === undefined || retainedNativeSession === undefined) throw new TypeError("named bootstrap physical identity is unavailable");
  let journal: TransactionRecord | undefined;
  let retainLock = false;
  let rollbackAuthorized = false;
  let claimRestored = false;
  let lockReplaced = false;
  let resourcesClosed = false;
  try {
    const rawJournal = await readOptionalJson(journalPath);
    if (rawJournal === undefined && acquired.priorLock !== undefined) {
      claimRestored = true;
      throw new Error("named bootstrap is busy: lock owner has no closed recovery journal");
    }
    const routeSnapshotDigest = await existingRouteSnapshotDigest(bootstrapRoot);
    await assertProjectIdentity(canonicalTarget.projectRoot, rootHandle, rootIdentity.dev, rootIdentity.ino);
    await assertDirectoryIdentity(bootstrapRoot, retainedBootstrapHandle, retainedBootstrapIdentity.dev, retainedBootstrapIdentity.ino, "bootstrap root");
    const target = Object.freeze({ ...canonicalTarget, routeSnapshotDigest });
    if (rawJournal !== undefined) {
      journal = parseTransaction(rawJournal);
      const planDigest = plannedDigest(target, journal.initializedAt);
      if (acquired.priorLock !== undefined) {
        try {
          if (journal.transactionId !== acquired.priorLock.transactionId || journal.ownerTokenCommitment !== sha256(acquired.priorLock.ownerToken)) throw new Error("named bootstrap recovery lock and journal identity mismatch");
          assertTransactionIdentity(journal, target, planDigest);
          if (journal.state === "complete") {
            const report = await readVerifiedComplete(bootstrapRoot, journal);
            return report;
          }
          const recoveryRequired = journal.state === "recovery-required";
          await retainedNativeSession.replaceLock(Buffer.from(canonicalBytes(acquired.lock)));
          lockReplaced = true;
          journal = await rebindForRollback(canonicalTarget.projectRoot, bootstrapRoot, journal, acquired.lock, retainedNativeSession);
          rollbackAuthorized = true;
          await rollbackAbsent(canonicalTarget.projectRoot, bootstrapRoot, journal, retainedNativeSession);
          await retainedNativeSession.close({ removeLock: true });
          lockAcquired = false;
          await retainedBootstrapHandle.close();
          await rootHandle.close();
          resourcesClosed = true;
          if (recoveryRequired) throw new Error("named bootstrap recovery-required rollback completed; retry initialization");
          return await initializeAgentProject(options);
        } catch (error) {
          if (!rollbackAuthorized) {
            if (lockReplaced && acquired.priorBytes !== undefined) await retainedNativeSession.replaceLock(acquired.priorBytes);
            claimRestored = true;
            journal = undefined;
          }
          throw error;
        }
      }
      assertTransactionIdentity(journal, target, planDigest);
      if (journal.state === "complete") return await readVerifiedComplete(bootstrapRoot, journal);
      throw new Error("named bootstrap journal exists without an exclusively claimed recovery lock");
    }
    if (journal === undefined) {
      const initializedAt = new Date().toISOString();
      const planDigest = plannedDigest(target, initializedAt);
      journal = Object.freeze({
        v: "reelier.bootstrap-transaction/v2",
        state: "locked",
        transactionId: acquired.lock.transactionId,
        ownerTokenCommitment: sha256(acquired.lock.ownerToken),
        planDigest,
        canonicalTarget: target,
        initializedAt,
        priorGeneration: null,
        priorGenerationDigest: null,
        checkpointDigest: null,
        reboundCheckpointDigest: null,
        publishedGeneration: null,
      });
      await writeJournal(canonicalTarget.projectRoot, journalPath, journal, retainedNativeSession);
      rollbackAuthorized = true;
      if (options.interruptAfterState === "locked") { retainLock = true; throw new InterruptedInitialization("locked"); }
    }

    if (journal.state === "locked") {
      // A crash in `locked` may leave only transaction-owned, uncommitted
      // staging bytes. They carry no checkpoint and are never adoptable.
      await retainedNativeSession.remove(relativePath(canonicalTarget.projectRoot, stagingPath(bootstrapRoot, journal.transactionId)), { recursive: true, missingOk: true });
      const prepared = await prepareGeneration(canonicalTarget.projectRoot, bootstrapRoot, journal, retainedNativeSession);
      journal = Object.freeze({ ...journal, state: "prepared", checkpointDigest: prepared.checkpointDigest });
      await writeJournal(canonicalTarget.projectRoot, journalPath, journal, retainedNativeSession);
      if (options.interruptAfterState === "prepared") { retainLock = true; throw new InterruptedInitialization("prepared"); }
    } else if (journal.state === "prepared") {
      await validateStagedGeneration(bootstrapRoot, journal);
    } else if (journal.state === "committing") {
      await validateStagedOrPublishedGeneration(bootstrapRoot, journal);
    } else if (journal.state === "rolling-back") {
      await rollbackAbsent(canonicalTarget.projectRoot, bootstrapRoot, journal, retainedNativeSession);
      throw new Error("named bootstrap recovered the interrupted rollback; retry initialization");
    }

    if (journal.state === "prepared") {
      journal = Object.freeze({ ...journal, state: "committing" });
      await writeJournal(canonicalTarget.projectRoot, journalPath, journal, retainedNativeSession);
      if (options.interruptAfterState === "committing") { retainLock = true; throw new InterruptedInitialization("committing"); }
    }

    if (journal.state !== "committing") throw new Error("named bootstrap transaction state is not forward-recoverable");
    const generation = journal.transactionId;
    const staging = stagingPath(bootstrapRoot, generation);
    const generationPath = path.join(bootstrapRoot, "generations", generation);
    if (!await exists(generationPath)) await retainedNativeSession.rename(relativePath(canonicalTarget.projectRoot, staging), relativePath(canonicalTarget.projectRoot, generationPath));
    await assertProjectIdentity(canonicalTarget.projectRoot, rootHandle, rootIdentity.dev, rootIdentity.ino);
    await validateGeneration(generationPath, journal);
    const pointer = Object.freeze({ v: "reelier.bootstrap-current/v1", generation, generationDigest: await generationDigest(generationPath) });
    await retainedNativeSession.writeAtomic(relativePath(canonicalTarget.projectRoot, path.join(bootstrapRoot, "current.json")), Buffer.from(canonicalBytes(pointer)));
    if (options.failAt === "after-publication") throw new Error("injected failure after publication");
    const completing = Object.freeze({ ...journal, state: "complete" as const, publishedGeneration: generation });
    await readVerifiedComplete(bootstrapRoot, completing);
    if (options.failAt === "final-reread") throw new Error("injected final reread failure");
    await writeJournal(canonicalTarget.projectRoot, journalPath, completing, retainedNativeSession);
    journal = completing;
    await assertProjectIdentity(canonicalTarget.projectRoot, rootHandle, rootIdentity.dev, rootIdentity.ino);
    return await readVerifiedComplete(bootstrapRoot, journal);
  } catch (error) {
    if (resourcesClosed) throw error;
    if (error instanceof InterruptedInitialization) throw error;
    if (!claimRestored && rollbackAuthorized && journal !== undefined && journal.state !== "complete") {
      try {
        const rollingBack = Object.freeze({ ...journal, state: "rolling-back" as const });
        await writeJournal(canonicalTarget.projectRoot, journalPath, rollingBack, retainedNativeSession);
        await rollbackAbsent(canonicalTarget.projectRoot, bootstrapRoot, rollingBack, retainedNativeSession);
      } catch {
        const recoveryRequired = Object.freeze({ ...journal, state: "recovery-required" as const });
        await writeJournal(canonicalTarget.projectRoot, journalPath, recoveryRequired, retainedNativeSession).catch(() => {});
        retainLock = true;
      }
    }
    throw error;
  } finally {
    if (!resourcesClosed) {
      if (lockAcquired) await retainedNativeSession.close({ removeLock: !retainLock && !claimRestored });
      await retainedBootstrapHandle.close();
      await rootHandle.close();
    }
  }
}

async function rebindForRollback(projectRoot: string, bootstrapRoot: string, journal: TransactionRecord, lock: LockRecord, nativeSession: BootstrapNativeSession): Promise<TransactionRecord> {
  const commitment = sha256(lock.ownerToken);
  if (journal.checkpointDigest === null) {
    const rolling = Object.freeze({ ...journal, state: "rolling-back" as const, ownerTokenCommitment: commitment, reboundCheckpointDigest: null });
    await writeJournal(projectRoot, path.join(bootstrapRoot, "transaction.json"), rolling, nativeSession);
    return rolling;
  }
  const staged = stagingPath(bootstrapRoot, journal.transactionId);
  const published = path.join(bootstrapRoot, "generations", journal.transactionId);
  const generationRoot = await exists(staged) ? staged : published;
  const checkpointPath = path.join(generationRoot, "checkpoint.json");
  const checkpoint = parseCheckpoint(await readJsonFile(checkpointPath, "named bootstrap recovery checkpoint is malformed"));
  await validateRecoverableGeneration(generationRoot, journal, checkpoint);
  const rebound = Object.freeze({ ...checkpoint, ownerTokenCommitment: commitment });
  const reboundDigest = digest(rebound);
  const transitional = Object.freeze({ ...journal, state: "rolling-back" as const, ownerTokenCommitment: commitment, reboundCheckpointDigest: reboundDigest });
  await writeJournal(projectRoot, path.join(bootstrapRoot, "transaction.json"), transitional, nativeSession);
  await nativeSession.writeAtomic(relativePath(projectRoot, checkpointPath), Buffer.from(canonicalBytes(rebound)));
  const rolling = Object.freeze({ ...transitional, checkpointDigest: reboundDigest, reboundCheckpointDigest: null });
  await writeJournal(projectRoot, path.join(bootstrapRoot, "transaction.json"), rolling, nativeSession);
  return rolling;
}

async function validateRecoverableGeneration(root: string, journal: TransactionRecord, checkpoint: CheckpointRecord): Promise<void> {
  const actualDigest = digest(checkpoint);
  if (actualDigest !== journal.checkpointDigest && actualDigest !== journal.reboundCheckpointDigest || checkpoint.transactionId !== journal.transactionId || checkpoint.planDigest !== journal.planDigest || digest(checkpoint.canonicalTarget) !== digest(journal.canonicalTarget)) throw new Error("named bootstrap recovery checkpoint identity mismatch");
  for (const artifact of checkpoint.artifacts) {
    const file = path.join(root, artifact.name);
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || sha256(await readFile(file)) !== artifact.digest) throw new Error("named bootstrap recovery artifact digest mismatch");
  }
  for (const [name, expected] of plannedArtifacts(journal.canonicalTarget, journal.initializedAt)) if (!Buffer.from(await readFile(path.join(root, name))).equals(Buffer.from(expected))) throw new Error("named bootstrap recovery artifact plan mismatch");
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
  const installed = await computeInstalledBuildIdentityWithoutSpawn(packageRoot);
  if (options.exactVersion !== installed.version) throw new TypeError("named bootstrap exact version does not match the executing package");
  return Object.freeze({
    agentName: options.agentName,
    agentNameFold: options.agentName.toLocaleLowerCase("en-US"),
    projectRoot,
    reelierVersion: options.exactVersion,
    installedBuildDigest: installed.digest,
  });
}

async function ensureBootstrapRoot(projectRoot: string, nativeSession: BootstrapNativeSession): Promise<string> {
  const reelier = path.join(projectRoot, ".reelier");
  await ensureExactDirectory(projectRoot, reelier, projectRoot, ".reelier", nativeSession);
  const bootstrap = path.join(reelier, "bootstrap");
  await ensureExactDirectory(projectRoot, bootstrap, reelier, "bootstrap", nativeSession);
  return bootstrap;
}

async function ensureExactDirectory(projectRoot: string, directory: string, parent: string, basename: string, nativeSession: BootstrapNativeSession): Promise<void> {
  await nativeSession.mkdir(relativePath(projectRoot, directory));
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
  const routes = normalizeRouteCoverageV1(JSON.parse(bytes));
  const now = Date.now();
  if (routes.some(route => Date.parse(route.observedAt) > now || now >= Date.parse(route.freshUntil))) return null;
  return sha256(bytes);
}

async function prepareGeneration(projectRoot: string, bootstrapRoot: string, journal: TransactionRecord, nativeSession: BootstrapNativeSession): Promise<{ checkpointDigest: string }> {
  await ensureExactDirectory(projectRoot, path.join(bootstrapRoot, "staging"), bootstrapRoot, "staging", nativeSession);
  await ensureExactDirectory(projectRoot, path.join(bootstrapRoot, "generations"), bootstrapRoot, "generations", nativeSession);
  const root = stagingPath(bootstrapRoot, journal.transactionId);
  await nativeSession.mkdir(relativePath(projectRoot, root));
  const artifacts = plannedArtifacts(journal.canonicalTarget, journal.initializedAt);
  for (const [name, bytes] of artifacts) await writeExclusiveFile(projectRoot, path.join(root, name), bytes, nativeSession);
  const checkpoint: CheckpointRecord = Object.freeze({
    v: "reelier.bootstrap-checkpoint/v2",
    transactionId: journal.transactionId,
    ownerTokenCommitment: journal.ownerTokenCommitment,
    planDigest: journal.planDigest,
    canonicalTarget: journal.canonicalTarget,
    priorTargetDigest: null,
    artifacts: Object.freeze(artifacts.map(([name, bytes]) => Object.freeze({ name, digest: sha256(bytes) }))),
  });
  await writeExclusiveFile(projectRoot, path.join(root, "checkpoint.json"), canonicalBytes(checkpoint), nativeSession);
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
  for (const [name, expected] of plannedArtifacts(journal.canonicalTarget, journal.initializedAt)) {
    if (!Buffer.from(await readFile(path.join(root, name))).equals(Buffer.from(expected))) throw new Error(`named bootstrap checkpoint ${name} artifact drift`);
  }
}

async function assertProjectIdentity(projectRoot: string, handle: Awaited<ReturnType<typeof open>>, device: number, inode: number): Promise<void> {
  await assertDirectoryIdentity(projectRoot, handle, device, inode, "project root");
}

async function assertDirectoryIdentity(directory: string, handle: Awaited<ReturnType<typeof open>>, device: number, inode: number, label: string): Promise<void> {
  const [held, current, physical] = await Promise.all([handle.stat(), lstat(directory), realpath(directory)]);
  if (!held.isDirectory() || !current.isDirectory() || current.isSymbolicLink() || held.dev !== device || held.ino !== inode || current.dev !== device || current.ino !== inode || physical !== directory) throw new TypeError(`named bootstrap ${label} changed during transaction`);
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

async function rollbackAbsent(projectRoot: string, bootstrapRoot: string, journal: TransactionRecord, nativeSession: BootstrapNativeSession): Promise<void> {
  if (journal.priorGeneration !== null || journal.priorGenerationDigest !== null) throw new Error("named bootstrap prior generation is unsupported by the minimal transaction");
  await nativeSession.remove(relativePath(projectRoot, stagingPath(bootstrapRoot, journal.transactionId)), { recursive: true, missingOk: true });
  await nativeSession.remove(relativePath(projectRoot, path.join(bootstrapRoot, "generations", journal.transactionId)), { recursive: true, missingOk: true });
  const pointer = path.join(bootstrapRoot, "current.json");
  await nativeSession.remove(relativePath(projectRoot, pointer), { recursive: false, missingOk: true });
  await nativeSession.remove(relativePath(projectRoot, path.join(bootstrapRoot, "transaction.json")), { recursive: false, missingOk: false });
  if (await exists(stagingPath(bootstrapRoot, journal.transactionId)) || await exists(path.join(bootstrapRoot, "generations", journal.transactionId)) || await exists(pointer)) throw new Error("named bootstrap rollback could not prove prior absence");
}

function parseLock(value: unknown): LockRecord {
  if (!isRecord(value) || !hasExactKeys(value, ["v", "pid", "ownerToken", "transactionId"]) || value.v !== "reelier.bootstrap-lock/v2" || !Number.isInteger(value.pid) || !TOKEN.test(String(value.ownerToken)) || !TRANSACTION_ID.test(String(value.transactionId))) throw new Error("named bootstrap orphan lock is malformed");
  return value as unknown as LockRecord;
}

function parseTransaction(value: unknown): TransactionRecord {
  const keys = ["v", "state", "transactionId", "ownerTokenCommitment", "planDigest", "canonicalTarget", "initializedAt", "priorGeneration", "priorGenerationDigest", "checkpointDigest", "reboundCheckpointDigest", "publishedGeneration"];
  if (!isRecord(value) || !hasExactKeys(value, keys) || value.v !== "reelier.bootstrap-transaction/v2" || !PREPARATION_STATES.includes(value.state as PreparationState) || value.state === "absent" || !TRANSACTION_ID.test(String(value.transactionId)) || !SHA256.test(String(value.ownerTokenCommitment)) || !SHA256.test(String(value.planDigest)) || typeof value.initializedAt !== "string" || new Date(value.initializedAt).toISOString() !== value.initializedAt || value.priorGeneration !== null || value.priorGenerationDigest !== null || value.checkpointDigest !== null && !SHA256.test(String(value.checkpointDigest)) || value.reboundCheckpointDigest !== null && !SHA256.test(String(value.reboundCheckpointDigest)) || value.publishedGeneration !== null && !TRANSACTION_ID.test(String(value.publishedGeneration)) || !isCanonicalTarget(value.canonicalTarget)) throw new Error("named bootstrap transaction journal is malformed");
  const journal = value as unknown as TransactionRecord;
  const checkpointRequired = journal.state === "prepared" || journal.state === "committing" || journal.state === "complete";
  const publicationRequired = journal.state === "complete";
  if (checkpointRequired && journal.checkpointDigest === null || journal.state === "locked" && (journal.checkpointDigest !== null || journal.reboundCheckpointDigest !== null) || journal.state !== "rolling-back" && journal.reboundCheckpointDigest !== null || (journal.publishedGeneration !== null) !== publicationRequired || publicationRequired && journal.publishedGeneration !== journal.transactionId) throw new Error("named bootstrap transaction state identity is malformed");
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

async function writeJournal(projectRoot: string, file: string, journal: TransactionRecord, nativeSession: BootstrapNativeSession): Promise<void> { await nativeSession.writeAtomic(relativePath(projectRoot, file), Buffer.from(canonicalBytes(journal))); }
async function writeExclusiveFile(projectRoot: string, file: string, bytes: string, nativeSession: BootstrapNativeSession): Promise<void> { await nativeSession.writeExclusive(relativePath(projectRoot, file), Buffer.from(bytes)); }
async function readJsonFile(file: string, message: string): Promise<unknown> { try { const info = await lstat(file); if (!info.isFile() || info.isSymbolicLink()) throw new Error(message); return JSON.parse(await readFile(file, "utf8")); } catch { throw new Error(message); } }
async function readOptionalJson(file: string): Promise<unknown | undefined> { try { const info = await lstat(file); if (!info.isFile() || info.isSymbolicLink()) throw new Error("unsafe"); return JSON.parse(await readFile(file, "utf8")); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw new Error("named bootstrap transaction journal is malformed"); } }
async function exists(file: string): Promise<boolean> { try { await access(file); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; } }
function relativePath(projectRoot: string, absolute: string): string {
  const relative = path.relative(projectRoot, absolute).split(path.sep).join("/");
  if (relative.length === 0 || relative.startsWith("../") || path.isAbsolute(relative)) throw new TypeError("named bootstrap mutation escaped the project root");
  return relative;
}

function recoveredLock(fresh: LockRecord, priorBytes: Buffer): Readonly<{ lock: LockRecord; priorLock: LockRecord; priorBytes: Buffer }> {
  let prior: LockRecord;
  try { prior = parseLock(JSON.parse(priorBytes.toString("utf8"))); }
  catch { throw new Error("named bootstrap is busy: lock owner cannot be proved recoverable"); }
  return Object.freeze({ lock: Object.freeze({ ...fresh, transactionId: prior.transactionId }), priorLock: prior, priorBytes });
}
function stagingPath(root: string, transactionId: string): string { return path.join(root, "staging", transactionId); }
function plannedArtifacts(target: CanonicalTarget, initializedAt: string) {
  const project: MinimalNamedProjectV1 = Object.freeze({
    v: "reelier.named-project/v1", agentName: target.agentName, projectRoot: target.projectRoot,
    reelierVersion: target.reelierVersion, installedBuildDigest: target.installedBuildDigest,
    routeSnapshotDigest: target.routeSnapshotDigest, authority: "absent", completeness: "not-proved",
  });
  const recoveryCommand = `npx reelier@${target.reelierVersion} up`;
  const report: BootstrapPreparationReport = Object.freeze({
    v: "reelier.named-preparation-report/v1", state: "complete", projectDigest: digest(project), initializedAt,
    authority: "absent", completeness: "not-proved", recoveryCommand, up: "unavailable",
  });
  return Object.freeze([
    ["project.json", canonicalBytes(project)],
    ["report.json", canonicalBytes(report)],
    ["recovery-command.txt", `${recoveryCommand}\n`],
  ] as const);
}
function plannedDigest(target: CanonicalTarget, initializedAt: string): string {
  return digest({
    v: "reelier.bootstrap-plan/v2", target, initializedAt,
    artifacts: plannedArtifacts(target, initializedAt).map(([name, bytes]) => ({ name, digest: sha256(bytes) })),
    states: PREPARATION_STATES,
  });
}
function canonicalBytes(value: unknown): string { return `${JSON.stringify(value, null, 2)}\n`; }
function digest(value: unknown): string { return authorityDigest(value); }
function sha256(value: string | Buffer): string { return `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype; }
function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean { const actual = Object.keys(value); return actual.length === keys.length && actual.every(key => keys.includes(key)); }
async function generationDigest(root: string): Promise<string> { return digest({ checkpoint: sha256(await readFile(path.join(root, "checkpoint.json"))), project: sha256(await readFile(path.join(root, "project.json"))), recovery: sha256(await readFile(path.join(root, "recovery-command.txt"))), report: sha256(await readFile(path.join(root, "report.json"))) }); }
async function installedPackageRoot(): Promise<string> { let candidate = path.dirname(fileURLToPath(import.meta.url)); for (;;) { try { await access(path.join(candidate, "package.json")); return candidate; } catch {} const parent = path.dirname(candidate); if (parent === candidate) throw new TypeError("installed package root is unavailable"); candidate = parent; } }

async function computeInstalledBuildIdentityWithoutSpawn(packageRoot: string): Promise<{ version: string; digest: string }> {
  const manifest = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8")) as { version?: unknown; files?: unknown };
  if (typeof manifest.version !== "string" || !VERSION.test(manifest.version) || !Array.isArray(manifest.files) || manifest.files.some(value => typeof value !== "string")) throw new TypeError("installed package manifest contract is invalid");
  const npmRoot = await npmInternalModulesRoot();
  let packlist: (tree: unknown) => Promise<string[]>;
  let Arborist: new (options: { path: string }) => { loadActual(): Promise<unknown> };
  try {
    packlist = (await import(pathToFileURL(path.join(npmRoot, "npm-packlist", "lib", "index.js")).href)).default as typeof packlist;
    Arborist = (await import(pathToFileURL(path.join(npmRoot, "@npmcli", "arborist", "lib", "index.js")).href)).default as typeof Arborist;
  } catch { throw new TypeError("canonical npm shipped-file membership is unavailable"); }
  const tree = await new Arborist({ path: packageRoot }).loadActual();
  const paths = (await packlist(tree)).filter(relative => path.basename(relative) !== "installed-build-digest.json").sort((a, b) => Buffer.from(a).compare(Buffer.from(b)));
  if (new Set(paths).size !== paths.length) throw new TypeError("installed package membership contains duplicates");
  const folded = new Set<string>();
  const files: { path: string; digest: string }[] = [];
  for (const relative of paths) {
    if (relative.length === 0 || relative.includes("\\") || path.isAbsolute(relative) || relative.split("/").some(part => part === "" || part === "." || part === "..")) throw new TypeError("installed package membership is unconfined");
    const fold = relative.toLocaleLowerCase("en-US");
    if (folded.has(fold)) throw new TypeError("installed package paths contain a case collision");
    folded.add(fold);
    const absolute = path.join(packageRoot, ...relative.split("/"));
    const info = await lstat(absolute);
    if (!info.isFile() || info.isSymbolicLink() || path.relative(packageRoot, await realpath(absolute)).split(path.sep).join("/") !== relative) throw new TypeError("installed package membership contains an unsafe file");
    files.push({ path: relative, digest: sha256(await readFile(absolute)) });
  }
  return { version: manifest.version, digest: digest({ v: "reelier.installed-build-identity/v1", packageVersion: manifest.version, files }) };
}

async function npmInternalModulesRoot(): Promise<string> {
  const candidates = [
    process.env.npm_execpath === undefined ? undefined : path.join(path.dirname(path.dirname(process.env.npm_execpath)), "node_modules"),
    path.join(path.dirname(process.execPath), "node_modules", "npm", "node_modules"),
    path.resolve(path.dirname(process.execPath), "../lib/node_modules/npm/node_modules"),
    path.resolve(path.dirname(process.execPath), "../node_modules/npm/node_modules"),
  ];
  for (const candidate of candidates) if (candidate !== undefined) {
    try { await access(path.join(candidate, "npm-packlist", "lib", "index.js")); await access(path.join(candidate, "@npmcli", "arborist", "lib", "index.js")); return candidate; } catch {}
  }
  throw new TypeError("canonical npm shipped-file membership is unavailable");
}

class InterruptedInitialization extends Error {
  constructor(state: string) { super(`named bootstrap interrupted after ${state}`); this.name = "InterruptedInitialization"; }
}

// Kept as a deterministic refusal boundary for callers compiled against the historical helper.
export async function dispatchFromBootstrap(_report: BootstrapPreparationReport): Promise<never> { throw new Error("validated profile activation required"); }
