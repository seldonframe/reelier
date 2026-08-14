import { randomBytes } from "node:crypto";
import type { Dirent } from "node:fs";
import {
  mkdir,
  lstat,
  open,
  readFile,
  readdir,
  rename,
  rm,
  rmdir,
} from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import {
  createVerifiedNativeOutcomeReplayArtifact,
  decodeNativeOutcomeReplayArtifact,
  readVerifiedNativeOutcomeProjections,
  verifyNativeOutcomeReplayArtifact,
  type NativeOutcomeReplayAnchorsV1,
  type VerifiedCertificationTaskReceiptGraphV1,
  type VerifiedNativeOutcomeReplayArtifactV1,
} from "../authority/certification/task-receipt-graph.js";
import { authorityCanonicalBytes, authorityDigest } from "../authority/wire.js";
import { continuityEventsFromVerifiedAuthorityReceipt } from "./authority-bridge.js";
import { assertFoldedContinuityState, extendFoldedContinuityEvidence, foldContinuity, type ContinuityStateV1 } from "./fold.js";
import { normalizeContinuityCheckpoint } from "./normalize.js";
import type {
  AuthenticatedWorkloadV1,
  ContinuityCheckpointV1,
  ContinuityEventV1,
  ContinuityFoldEventV1,
  NormalizedCheckpointV1,
} from "./types.js";

const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const SEGMENT_FILE = /^(\d{16})-([0-9a-f]{64})\.json$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;

export class ContinuityLedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContinuityLedgerError";
  }
}

export class ContinuityLedgerBusyError extends ContinuityLedgerError {
  constructor() {
    super("continuity writer lock is busy; explicit recovery is required if it is orphaned");
    this.name = "ContinuityLedgerBusyError";
  }
}

export class ContinuityLedgerCorruptionError extends ContinuityLedgerError {
  constructor(message: string) {
    super(`continuity ledger corruption: ${message}`);
    this.name = "ContinuityLedgerCorruptionError";
  }
}

export interface ContinuitySegmentV1 {
  readonly v: "reelier.continuity-segment/v1";
  readonly taskId: string;
  readonly cursor: number;
  readonly previousSegmentDigest: string | null;
  readonly actor: AuthenticatedWorkloadV1;
  readonly jobCardDigest: string;
  readonly authoritySnapshotDigest: string;
  readonly events: readonly ContinuityEventV1[];
  readonly authorityImports: readonly VerifiedNativeOutcomeReplayArtifactV1[];
  readonly evidenceRefs: readonly string[];
  readonly agentMemo?: Readonly<{ status: "unchecked"; text: string }>;
}

export interface VerifiedAuthorityContinuityAppendV1 {
  readonly taskId: string;
  readonly expectedCursor: number;
  readonly actorPrincipalId: string;
  readonly workloadId: string;
  readonly jobCardDigest: string;
}

export interface AuthorityReplayAnchorRequestV1 {
  readonly taskId: string;
  readonly cursor: number;
  readonly importIndex: number;
}

export interface FsContinuityLedgerOptionsV1 {
  readonly resolveAuthorityAnchors?: (
    request: AuthorityReplayAnchorRequestV1,
  ) => NativeOutcomeReplayAnchorsV1 | Promise<NativeOutcomeReplayAnchorsV1>;
}

export interface ContinuitySnapshotV1 {
  readonly taskId: string;
  readonly cursor: number;
  readonly segmentDigest: string | null;
  readonly jobCardDigest: string | null;
  readonly authoritySnapshotDigest: string | null;
  readonly state: ContinuityStateV1 | null;
}

export type ContinuityAppendResultV1 =
  | Readonly<{ ok: true; cursor: number; segmentDigest: string; state: ContinuityStateV1 }>
  | Readonly<{ ok: false; reason: "stale-cursor"; expectedCursor: number; actualCursor: number }>;

function validateTaskId(taskId: string): void {
  if (!TASK_ID.test(taskId)) throw new ContinuityLedgerError("invalid continuity task ID");
}

async function assertDirectoryPath(directory: string, label: string, allowMissing: boolean): Promise<boolean> {
  try {
    const stat = await lstat(directory);
    if (stat.isSymbolicLink()) throw new ContinuityLedgerError(`${label} must not be a symbolic link or directory link`);
    if (!stat.isDirectory()) throw new ContinuityLedgerError(`${label} must be a directory`);
    return true;
  } catch (error) {
    if (allowMissing && (error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function exactKeys(record: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): void {
  const allowed = new Set([...required, ...optional]);
  const unknown = Object.keys(record).filter((key) => !allowed.has(key));
  const missing = required.filter((key) => !Object.hasOwn(record, key));
  if (unknown.length > 0 || missing.length > 0) {
    throw new ContinuityLedgerCorruptionError(`segment has invalid closed shape${unknown.length > 0 ? `; unknown fields: ${unknown.join(", ")}` : ""}${missing.length > 0 ? `; missing fields: ${missing.join(", ")}` : ""}`);
  }
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ContinuityLedgerCorruptionError("segment body is not an object");
  }
  return value as Record<string, unknown>;
}

function withEvidence(state: ContinuityStateV1, segmentEvidence: readonly string[]): ContinuityStateV1 {
  return extendFoldedContinuityEvidence(state, segmentEvidence);
}

interface ContinuitySnapshotProvenanceV1 {
  readonly envelopeDigest: string;
  readonly state: ContinuityStateV1;
}

const continuitySnapshotProvenance = new WeakMap<object, ContinuitySnapshotProvenanceV1>();

function snapshotEnvelopeDigest(snapshot: ContinuitySnapshotV1): string {
  return authorityDigest({
    taskId: snapshot.taskId,
    cursor: snapshot.cursor,
    segmentDigest: snapshot.segmentDigest,
    jobCardDigest: snapshot.jobCardDigest,
    authoritySnapshotDigest: snapshot.authoritySnapshotDigest,
  });
}

function registerContinuitySnapshot(snapshot: ContinuitySnapshotV1 & { readonly state: ContinuityStateV1 }): ContinuitySnapshotV1 {
  continuitySnapshotProvenance.set(snapshot, Object.freeze({
    envelopeDigest: snapshotEnvelopeDigest(snapshot),
    state: snapshot.state,
  }));
  return snapshot;
}

export function assertLedgerContinuitySnapshot(value: unknown): asserts value is ContinuitySnapshotV1 & { readonly state: ContinuityStateV1 } {
  if (value === null || typeof value !== "object") throw new TypeError("ledger continuity snapshot provenance is required");
  const snapshot = value as ContinuitySnapshotV1;
  const provenance = continuitySnapshotProvenance.get(value);
  if (
    provenance === undefined
    || provenance.state !== snapshot.state
    || provenance.envelopeDigest !== snapshotEnvelopeDigest(snapshot)
  ) throw new TypeError("ledger continuity snapshot provenance or envelope integrity is invalid");
  assertFoldedContinuityState(snapshot.state);
}

function digestValues(value: unknown, target = new Set<string>()): Set<string> {
  if (typeof value === "string") {
    if (DIGEST.test(value)) target.add(value);
    return target;
  }
  if (Array.isArray(value)) {
    for (const item of value) digestValues(item, target);
    return target;
  }
  if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) digestValues(item, target);
  }
  return target;
}

async function syncDirectoryBestEffort(directory: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(directory, "r");
    await handle.sync();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EPERM" && code !== "EACCES" && code !== "EISDIR" && code !== "EINVAL") throw error;
  } finally {
    await handle?.close();
  }
}

export class FsContinuityLedger {
  readonly #root: string;
  readonly #resolveAuthorityAnchors: FsContinuityLedgerOptionsV1["resolveAuthorityAnchors"];

  constructor(root: string, options: FsContinuityLedgerOptionsV1 = {}) {
    if (typeof root !== "string" || root.length === 0 || !isAbsolute(root)) {
      throw new ContinuityLedgerError("continuity ledger root must be an absolute path");
    }
    this.#root = resolve(root);
    this.#resolveAuthorityAnchors = options.resolveAuthorityAnchors;
  }

  async read(taskId: string): Promise<ContinuitySnapshotV1> {
    return this.#read(taskId, false);
  }

  async #read(taskId: string, writerOwnsLock: boolean): Promise<ContinuitySnapshotV1> {
    validateTaskId(taskId);
    const taskDirectory = join(this.#root, taskId);
    if (!await assertDirectoryPath(taskDirectory, "continuity task path", true)) {
      return { taskId, cursor: 0, segmentDigest: null, jobCardDigest: null, authoritySnapshotDigest: null, state: null };
    }
    let entries: Dirent<string>[];
    try {
      entries = await readdir(taskDirectory, { withFileTypes: true, encoding: "utf8" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { taskId, cursor: 0, segmentDigest: null, jobCardDigest: null, authoritySnapshotDigest: null, state: null };
      }
      throw error;
    }

    const segmentNames: string[] = [];
    for (const entry of entries) {
      if (entry.name === ".writer-lock" && entry.isDirectory()) {
        if (!writerOwnsLock) throw new ContinuityLedgerBusyError();
        continue;
      }
      if (!entry.isFile() || !SEGMENT_FILE.test(entry.name)) {
        throw new ContinuityLedgerCorruptionError(`unknown task-directory entry: ${entry.name}`);
      }
      segmentNames.push(entry.name);
    }
    segmentNames.sort();

    const allEvents: ContinuityFoldEventV1[] = [];
    const allEvidence = new Set<string>();
    let previousSegmentDigest: string | null = null;
    let latestJobCardDigest: string | null = null;
    let latestAuthoritySnapshotDigest: string | null = null;

    for (const [index, name] of segmentNames.entries()) {
      const match = SEGMENT_FILE.exec(name);
      if (match === null) throw new ContinuityLedgerCorruptionError(`invalid segment filename: ${name}`);
      const cursor = index + 1;
      if (Number(match[1]) !== cursor) throw new ContinuityLedgerCorruptionError(`non-contiguous segment cursor at ${name}`);
      const json = await readFile(join(taskDirectory, name), "utf8");
      let parsed: unknown;
      try {
        parsed = JSON.parse(json);
      } catch {
        throw new ContinuityLedgerCorruptionError(`segment is invalid JSON: ${name}`);
      }
      if (authorityCanonicalBytes(parsed).toString("utf8") !== json) {
        throw new ContinuityLedgerCorruptionError(`segment is not canonical: ${name}`);
      }
      const segmentDigest = authorityDigest(parsed);
      if (segmentDigest !== `sha256:${match[2]}`) throw new ContinuityLedgerCorruptionError(`segment digest mismatch: ${name}`);

      const body = record(parsed);
      exactKeys(body, ["v", "taskId", "cursor", "previousSegmentDigest", "actor", "jobCardDigest", "authoritySnapshotDigest", "events", "authorityImports", "evidenceRefs"], ["agentMemo"]);
      if (body.v !== "reelier.continuity-segment/v1" || body.taskId !== taskId || body.cursor !== cursor) {
        throw new ContinuityLedgerCorruptionError(`segment identity mismatch: ${name}`);
      }
      if (body.previousSegmentDigest !== previousSegmentDigest) throw new ContinuityLedgerCorruptionError(`broken previous digest chain: ${name}`);
      if (previousSegmentDigest !== null && !DIGEST.test(previousSegmentDigest)) throw new ContinuityLedgerCorruptionError(`invalid previous segment digest: ${name}`);

      let normalized: NormalizedCheckpointV1;
      let authorityImports: readonly VerifiedNativeOutcomeReplayArtifactV1[];
      let importedEvents: readonly ContinuityFoldEventV1[];
      try {
        normalized = normalizeContinuityCheckpoint({
          v: "reelier.continuity-checkpoint/v1",
          taskId: body.taskId,
          expectedCursor: cursor - 1,
          actorPrincipalId: record(body.actor).principalId,
          workloadId: record(body.actor).workloadId,
          jobCardDigest: body.jobCardDigest,
          authoritySnapshotDigest: body.authoritySnapshotDigest,
          proposedEvents: body.events,
          evidenceRefs: body.evidenceRefs,
          ...(body.agentMemo === undefined ? {} : { agentMemo: body.agentMemo }),
        }, body.actor);
        if (!Array.isArray(body.authorityImports)) throw new TypeError("authority imports must be an array");
        const verifiedImports = await Promise.all(body.authorityImports.map(async (item, importIndex) => {
          if (this.#resolveAuthorityAnchors === undefined) throw new TypeError("external authority anchor resolver is required for verified continuity replay");
          const decoded = decodeNativeOutcomeReplayArtifact(item);
          const anchors = await this.#resolveAuthorityAnchors(Object.freeze({
            taskId,
            cursor,
            importIndex,
          }));
          const verified = verifyNativeOutcomeReplayArtifact(item, anchors);
          const projections = readVerifiedNativeOutcomeProjections(verified);
          if (projections.length === 0 || projections.some((projection) => projection.taskId !== taskId)) {
            throw new TypeError("verified native outcome task does not match continuity task");
          }
          const replay = createVerifiedNativeOutcomeReplayArtifact(verified);
          if (replay.authoritySnapshotDigest !== decoded.artifact.authoritySnapshotDigest || replay.authoritySnapshotDigest !== normalized.checkpoint.authoritySnapshotDigest) {
            throw new TypeError("verified native outcome authority snapshot does not match segment");
          }
          return { replay, events: continuityEventsFromVerifiedAuthorityReceipt(verified) };
        }));
        authorityImports = Object.freeze(verifiedImports.map((item) => item.replay));
        importedEvents = Object.freeze(verifiedImports.flatMap((item) => item.events));
      } catch (error) {
        throw new ContinuityLedgerCorruptionError(`invalid segment payload ${name}: ${(error as Error).message}`);
      }
      const normalizedSegment: ContinuitySegmentV1 = {
        v: "reelier.continuity-segment/v1",
        taskId,
        cursor,
        previousSegmentDigest,
        actor: normalized.actor,
        jobCardDigest: normalized.checkpoint.jobCardDigest,
        authoritySnapshotDigest: normalized.checkpoint.authoritySnapshotDigest,
        events: normalized.checkpoint.proposedEvents,
        authorityImports,
        evidenceRefs: normalized.checkpoint.evidenceRefs,
        ...(normalized.checkpoint.agentMemo === undefined ? {} : { agentMemo: normalized.checkpoint.agentMemo }),
      };
      if (authorityCanonicalBytes(normalizedSegment).compare(authorityCanonicalBytes(parsed)) !== 0) {
        throw new ContinuityLedgerCorruptionError(`segment is not in normalized form: ${name}`);
      }
      allEvents.push(...normalizedSegment.events, ...importedEvents);
      for (const evidence of normalizedSegment.evidenceRefs) allEvidence.add(evidence);
      previousSegmentDigest = segmentDigest;
      latestJobCardDigest = normalizedSegment.jobCardDigest;
      latestAuthoritySnapshotDigest = normalizedSegment.authoritySnapshotDigest;
    }

    if (segmentNames.length === 0) {
      return { taskId, cursor: 0, segmentDigest: null, jobCardDigest: null, authoritySnapshotDigest: null, state: null };
    }
    let state: ContinuityStateV1;
    try {
      state = withEvidence(foldContinuity(allEvents), [...allEvidence]);
    } catch (error) {
      throw new ContinuityLedgerCorruptionError(`illegal folded history: ${(error as Error).message}`);
    }
    return registerContinuitySnapshot({
      taskId,
      cursor: segmentNames.length,
      segmentDigest: previousSegmentDigest,
      jobCardDigest: latestJobCardDigest,
      authoritySnapshotDigest: latestAuthoritySnapshotDigest,
      state,
    });
  }

  async append(actor: AuthenticatedWorkloadV1, checkpointValue: ContinuityCheckpointV1): Promise<ContinuityAppendResultV1> {
    const normalized = normalizeContinuityCheckpoint(checkpointValue, actor);
    return this.#appendNormalized(normalized, [], []);
  }

  async appendVerifiedAuthority(
    actor: AuthenticatedWorkloadV1,
    checkpoint: VerifiedAuthorityContinuityAppendV1,
    verified: VerifiedCertificationTaskReceiptGraphV1,
  ): Promise<ContinuityAppendResultV1> {
    const projections = readVerifiedNativeOutcomeProjections(verified);
    if (projections.length === 0 || projections.some((projection) => projection.taskId !== checkpoint.taskId)) {
      throw new ContinuityLedgerError("verified native outcome task does not match continuity task");
    }
    const replay = createVerifiedNativeOutcomeReplayArtifact(verified);
    const events = continuityEventsFromVerifiedAuthorityReceipt(verified);
    const evidenceRefs = [...digestValues(projections)].sort();
    const normalized = normalizeContinuityCheckpoint({
      v: "reelier.continuity-checkpoint/v1",
      ...checkpoint,
      authoritySnapshotDigest: replay.authoritySnapshotDigest,
      proposedEvents: [],
      evidenceRefs,
    }, actor);
    return this.#appendNormalized(normalized, [replay], events);
  }

  async #appendNormalized(
    normalized: NormalizedCheckpointV1,
    authorityImports: readonly VerifiedNativeOutcomeReplayArtifactV1[],
    importedEvents: readonly ContinuityFoldEventV1[],
  ): Promise<ContinuityAppendResultV1> {
    const taskId = normalized.checkpoint.taskId;
    validateTaskId(taskId);
    const taskDirectory = join(this.#root, taskId);
    const lockDirectory = join(taskDirectory, ".writer-lock");
    await mkdir(this.#root, { recursive: true });
    await assertDirectoryPath(this.#root, "continuity ledger root", false);
    try {
      await mkdir(taskDirectory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    await assertDirectoryPath(taskDirectory, "continuity task path", false);
    try {
      await mkdir(lockDirectory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new ContinuityLedgerBusyError();
      throw error;
    }

    let safeToUnlock = true;
    let temporaryPath: string | null = null;
    try {
      const current = await this.#read(taskId, true);
      if (normalized.checkpoint.expectedCursor !== current.cursor) {
        return {
          ok: false,
          reason: "stale-cursor",
          expectedCursor: normalized.checkpoint.expectedCursor,
          actualCursor: current.cursor,
        };
      }
      const allEvents = [...(current.state?.events ?? []), ...normalized.checkpoint.proposedEvents, ...importedEvents];
      const state = withEvidence(
        foldContinuity(allEvents),
        [...(current.state?.evidenceRefs ?? []), ...normalized.checkpoint.evidenceRefs],
      );
      const cursor = current.cursor + 1;
      const segment: ContinuitySegmentV1 = {
        v: "reelier.continuity-segment/v1",
        taskId,
        cursor,
        previousSegmentDigest: current.segmentDigest,
        actor: normalized.actor,
        jobCardDigest: normalized.checkpoint.jobCardDigest,
        authoritySnapshotDigest: normalized.checkpoint.authoritySnapshotDigest,
        events: normalized.checkpoint.proposedEvents,
        authorityImports,
        evidenceRefs: normalized.checkpoint.evidenceRefs,
        ...(normalized.checkpoint.agentMemo === undefined ? {} : { agentMemo: normalized.checkpoint.agentMemo }),
      };
      const bytes = authorityCanonicalBytes(segment);
      const segmentDigest = authorityDigest(segment);
      const filename = `${String(cursor).padStart(16, "0")}-${segmentDigest.slice("sha256:".length)}.json`;
      temporaryPath = join(taskDirectory, `.segment-${randomBytes(16).toString("hex")}.tmp`);
      const handle = await open(temporaryPath, "wx");
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      safeToUnlock = false;
      await rename(temporaryPath, join(taskDirectory, filename));
      temporaryPath = null;
      await syncDirectoryBestEffort(taskDirectory);
      safeToUnlock = true;
      return { ok: true, cursor, segmentDigest, state };
    } finally {
      if (safeToUnlock) {
        if (temporaryPath !== null) await rm(temporaryPath, { force: true });
        await rmdir(lockDirectory);
      }
    }
  }
}
