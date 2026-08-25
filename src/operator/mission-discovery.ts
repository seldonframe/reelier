import { createHash } from "node:crypto";
import { open, stat } from "node:fs/promises";
import path from "node:path";
import { agentSources, findTranscriptFiles } from "../scan.js";
import { parseMissionControlMissionV1, type MissionControlMissionV1 } from "./mission-control.js";

export type DiscoveredMissionControlMissionV1 = Readonly<{
  mission: MissionControlMissionV1;
  harness: "codex" | "claude-code";
  currentWorkspace: boolean;
  lastActivityAt: string;
}>;

export type ObservedOnlyHarnessV1 = Readonly<{
  harness: string;
  sessions: number;
  reason: "history-observed-control-unverified";
}>;

export type MissionControlDiscoveryV1 = Readonly<{
  missions: readonly DiscoveredMissionControlMissionV1[];
  observedOnly: readonly ObservedOnlyHarnessV1[];
}>;

type HistoryMetadata = Readonly<{ sessionId: string; cwd?: string }>;
export type MissionControlSessionMetadataV1 = Readonly<{
  path: string;
  mtimeMs: number;
  sourceId: string;
  sourceLabel: string;
}>;
const MAX_METADATA_BYTES = 1_048_576;
const MAX_SESSIONS = 2_000;

function digest(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function boundedMetadata(source: string, fallback: string): HistoryMetadata {
  const prefix = source.slice(0, MAX_METADATA_BYTES);
  for (const raw of prefix.split(/\r?\n/, 100)) {
    if (raw.length === 0 || raw.length > 262_144) continue;
    let value: unknown;
    try { value = JSON.parse(raw); } catch { continue; }
    const record = asRecord(value);
    if (!record) continue;
    const payload = asRecord(record.payload);
    const sessionId = typeof payload?.id === "string"
      ? payload.id
      : typeof record.sessionId === "string"
        ? record.sessionId
        : typeof record.id === "string"
          ? record.id
          : undefined;
    const cwd = typeof payload?.cwd === "string" ? payload.cwd : typeof record.cwd === "string" ? record.cwd : undefined;
    if (sessionId || cwd) return Object.freeze({ sessionId: sessionId?.slice(0, 256) ?? fallback, ...(cwd && cwd.length <= 32_768 ? { cwd } : {}) });
  }
  return Object.freeze({ sessionId: fallback });
}

function samePath(left: string | undefined, right: string): boolean {
  if (!left) return false;
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

async function readMetadataPrefix(transcriptPath: string): Promise<string> {
  const handle = await open(transcriptPath, "r");
  try {
    const buffer = Buffer.allocUnsafe(MAX_METADATA_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}

export async function scanMissionControlSessionMetadataV1(home: string): Promise<readonly MissionControlSessionMetadataV1[]> {
  const sources = agentSources(home);
  const groups = await Promise.all(sources.map(async (source) => {
    const files = await findTranscriptFiles(source.dir);
    const rows = await Promise.all(files.map(async (transcriptPath): Promise<MissionControlSessionMetadataV1 | null> => {
      try {
        const details = await stat(transcriptPath);
        if (!details.isFile()) return null;
        return Object.freeze({ path: transcriptPath, mtimeMs: details.mtimeMs, sourceId: source.id, sourceLabel: source.label });
      } catch {
        return null;
      }
    }));
    return rows.filter((row): row is MissionControlSessionMetadataV1 => row !== null);
  }));
  return Object.freeze(groups.flat().sort((left, right) => right.mtimeMs - left.mtimeMs).slice(0, MAX_SESSIONS));
}

export async function discoverMissionControlV1(input: Readonly<{
  cwd: string;
  home: string;
  scan?: (home: string) => Promise<readonly MissionControlSessionMetadataV1[]>;
  readTranscript?: (transcriptPath: string) => Promise<string>;
}>): Promise<MissionControlDiscoveryV1> {
  const scan = input.scan ?? scanMissionControlSessionMetadataV1;
  const readTranscript = input.readTranscript ?? readMetadataPrefix;
  const sessions = (await scan(input.home)).slice(0, MAX_SESSIONS);
  const missions: DiscoveredMissionControlMissionV1[] = [];
  const observedCounts = new Map<string, number>();
  for (const session of sessions) {
    if (session.sourceId !== "codex" && session.sourceId !== "claude-code") {
      observedCounts.set(session.sourceId, (observedCounts.get(session.sourceId) ?? 0) + 1);
      continue;
    }
    let source: string;
    try { source = await readTranscript(session.path); } catch { continue; }
    const pathRef = digest(session.path);
    const metadata = boundedMetadata(source, pathRef.slice("sha256:".length, "sha256:".length + 32));
    const workspaceDigest = digest(metadata.cwd ? path.resolve(metadata.cwd) : `unknown:${session.sourceId}:${metadata.sessionId}`);
    const updatedAt = new Date(session.mtimeMs).toISOString();
    const missionId = `mission-${digest(`${session.sourceId}\0${metadata.sessionId}\0${pathRef}`).slice("sha256:".length, "sha256:".length + 32)}`;
    const mission = parseMissionControlMissionV1({
      v: "reelier.mission-control-mission/v1",
      missionId,
      workspaceDigest,
      harness: session.sourceId,
      harnessLifecycle: "discovered",
      outcomeLifecycle: "unrequested",
      attentionState: "none",
      attentionReasons: [],
      evidenceRefs: [],
      processOwnership: "external",
      imported: true,
      updatedAt,
    });
    missions.push(Object.freeze({ mission, harness: session.sourceId, currentWorkspace: samePath(metadata.cwd, input.cwd), lastActivityAt: updatedAt }));
  }
  missions.sort((left, right) => Number(right.currentWorkspace) - Number(left.currentWorkspace) || Date.parse(right.lastActivityAt) - Date.parse(left.lastActivityAt) || left.mission.missionId.localeCompare(right.mission.missionId));
  const observedOnly = [...observedCounts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([harness, sessionCount]) => Object.freeze({ harness, sessions: sessionCount, reason: "history-observed-control-unverified" as const }));
  return Object.freeze({ missions: Object.freeze(missions), observedOnly: Object.freeze(observedOnly) });
}
