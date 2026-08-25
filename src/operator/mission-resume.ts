import { mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { createMissionControlJournalV1 } from "./mission-journal.js";
import type { OperatorHarnessIdV1 } from "./harness.js";

export type MissionResumeInputV1 = Readonly<{
  missionId: string;
  harness: OperatorHarnessIdV1;
  resumeIdentity: string;
  workspaceDigest: string;
}>;
export type MissionResumeRecordV1 = Readonly<MissionResumeInputV1 & { v: "reelier.mission-resume/v1" }>;
export type MissionResumeStoreV1 = Readonly<{
  save(input: MissionResumeInputV1): Promise<MissionResumeRecordV1>;
  load(missionId: string): Promise<MissionResumeRecordV1 | null>;
}>;

const MISSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const RESUME_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,255}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const INPUT_KEYS = new Set(["missionId", "harness", "resumeIdentity", "workspaceDigest"]);
const RECORD_KEYS = new Set(["v", ...INPUT_KEYS]);

function inert(value: unknown, keys: Set<string>, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(`${label} is invalid`);
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.size || own.some((key) => typeof key !== "string" || !keys.has(key))) throw new TypeError(`${label} shape is invalid`);
  const descriptors = Object.getOwnPropertyDescriptors(value), result: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw new TypeError(`${label} must be inert`);
    result[key] = descriptor.value;
  }
  return result;
}

function parseInput(value: unknown): MissionResumeInputV1 {
  const row = inert(value, INPUT_KEYS, "mission resume input");
  if (typeof row.missionId !== "string" || !MISSION_ID.test(row.missionId)) throw new TypeError("mission resume mission identity is invalid");
  if (row.harness !== "codex" && row.harness !== "claude-code") throw new TypeError("mission resume harness is invalid");
  if (typeof row.resumeIdentity !== "string" || !RESUME_ID.test(row.resumeIdentity)) throw new TypeError("mission resume identity is invalid");
  if (typeof row.workspaceDigest !== "string" || !DIGEST.test(row.workspaceDigest)) throw new TypeError("mission resume workspace digest is invalid");
  return Object.freeze({ missionId: row.missionId, harness: row.harness, resumeIdentity: row.resumeIdentity, workspaceDigest: row.workspaceDigest });
}

function parseRecord(value: unknown): MissionResumeRecordV1 {
  const row = inert(value, RECORD_KEYS, "mission resume record");
  if (row.v !== "reelier.mission-resume/v1") throw new TypeError("mission resume version is invalid");
  return Object.freeze({ v: "reelier.mission-resume/v1", ...parseInput(Object.fromEntries([...INPUT_KEYS].map((key) => [key, row[key]]))) });
}

export async function createMissionResumeStoreV1(input: Readonly<{ root: string }>): Promise<MissionResumeStoreV1> {
  await (await createMissionControlJournalV1({ root: input.root })).reconstruct();
  const directory = path.join(path.resolve(input.root), ".reelier", "operator", "resume");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (await realpath(directory) !== path.resolve(directory)) throw new Error("mission resume directory is linked or symlinked");
  const target = (missionId: string): string => {
    if (!MISSION_ID.test(missionId)) throw new TypeError("mission resume mission identity is invalid");
    return path.join(directory, `${missionId}.json`);
  };
  const load = async (missionId: string): Promise<MissionResumeRecordV1 | null> => {
    try { return parseRecord(JSON.parse(await readFile(target(missionId), "utf8"))); }
    catch (error: unknown) { if ((error as { code?: string }).code === "ENOENT") return null; throw error; }
  };
  return Object.freeze({
    load,
    async save(value: MissionResumeInputV1): Promise<MissionResumeRecordV1> {
      const record = parseRecord({ v: "reelier.mission-resume/v1", ...parseInput(value) });
      const file = target(record.missionId), existing = await load(record.missionId);
      if (existing) {
        if (JSON.stringify(existing) !== JSON.stringify(record)) throw new Error("mission resume identity conflict");
        return existing;
      }
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
        await rename(temporary, file);
      } finally { await rm(temporary, { force: true }); }
      return record;
    },
  });
}
