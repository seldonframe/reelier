import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import canonicalize from "canonicalize";
import { createMissionControlJournalV1 } from "./mission-journal.js";

export type MissionEvidenceKindV1 = "git-head" | "diff" | "test" | "build" | "artifact";
export type MissionEvidenceStatusV1 = "observed" | "passed" | "failed";
export type MissionEvidenceInputV1 = Readonly<{
  kind: MissionEvidenceKindV1;
  subjectDigest: string;
  resultDigest: string;
  status: MissionEvidenceStatusV1;
  observedAt: string;
}>;
export type MissionEvidenceV1 = Readonly<MissionEvidenceInputV1 & {
  v: "reelier.mission-evidence/v1";
  evidenceRef: string;
}>;
export type MissionEvidenceStoreV1 = Readonly<{
  publish(input: MissionEvidenceInputV1): Promise<MissionEvidenceV1>;
  load(evidenceRef: string): Promise<MissionEvidenceV1 | null>;
}>;

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const INPUT_KEYS = new Set(["kind", "subjectDigest", "resultDigest", "status", "observedAt"]);
const RECORD_KEYS = new Set(["v", "evidenceRef", ...INPUT_KEYS]);
const KINDS = new Set<MissionEvidenceKindV1>(["git-head", "diff", "test", "build", "artifact"]);
const STATUSES = new Set<MissionEvidenceStatusV1>(["observed", "passed", "failed"]);

function dataRecord(value: unknown, keys: Set<string>, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${name} is invalid`);
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.size || ownKeys.some((key) => typeof key !== "string" || !keys.has(key))) throw new TypeError(`${name} shape is invalid`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw new TypeError(`${name} must use inert fields`);
    result[key] = descriptor.value;
  }
  return result;
}

function parseInput(value: unknown): MissionEvidenceInputV1 {
  const record = dataRecord(value, INPUT_KEYS, "mission evidence");
  if (typeof record.kind !== "string" || !KINDS.has(record.kind as MissionEvidenceKindV1)) throw new TypeError("mission evidence kind is invalid");
  if (typeof record.status !== "string" || !STATUSES.has(record.status as MissionEvidenceStatusV1)) throw new TypeError("mission evidence status is invalid");
  if (typeof record.subjectDigest !== "string" || !DIGEST.test(record.subjectDigest) || typeof record.resultDigest !== "string" || !DIGEST.test(record.resultDigest)) throw new TypeError("mission evidence digest is invalid");
  if (typeof record.observedAt !== "string" || record.observedAt.length > 64 || Number.isNaN(Date.parse(record.observedAt))) throw new TypeError("mission evidence timestamp is invalid");
  return Object.freeze({ kind: record.kind as MissionEvidenceKindV1, subjectDigest: record.subjectDigest, resultDigest: record.resultDigest, status: record.status as MissionEvidenceStatusV1, observedAt: record.observedAt });
}

function evidenceDigest(input: MissionEvidenceInputV1): string {
  const bytes = canonicalize({ v: "reelier.mission-evidence/v1", ...input });
  if (bytes === undefined) throw new TypeError("mission evidence is not canonicalizable");
  return `sha256:${createHash("sha256").update(bytes, "utf8").digest("hex")}`;
}

function parseRecord(value: unknown): MissionEvidenceV1 {
  const record = dataRecord(value, RECORD_KEYS, "mission evidence record");
  if (record.v !== "reelier.mission-evidence/v1" || typeof record.evidenceRef !== "string" || !DIGEST.test(record.evidenceRef)) throw new TypeError("mission evidence record identity is invalid");
  const input = parseInput(Object.fromEntries([...INPUT_KEYS].map((key) => [key, record[key]])));
  if (evidenceDigest(input) !== record.evidenceRef) throw new Error("mission evidence digest mismatch: evidence was tampered");
  return Object.freeze({ v: "reelier.mission-evidence/v1", evidenceRef: record.evidenceRef, ...input });
}

export async function createMissionEvidenceStoreV1(input: Readonly<{ root: string }>): Promise<MissionEvidenceStoreV1> {
  await (await createMissionControlJournalV1({ root: input.root })).reconstruct();
  const directory = path.join(path.resolve(input.root), ".reelier", "operator", "evidence");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (await realpath(directory) !== path.resolve(directory)) throw new Error("mission evidence directory is linked or symlinked");
  const targetFor = (evidenceRef: string): string => {
    if (!DIGEST.test(evidenceRef)) throw new TypeError("mission evidence reference is invalid");
    return path.join(directory, `${evidenceRef.slice("sha256:".length)}.json`);
  };
  const load = async (evidenceRef: string): Promise<MissionEvidenceV1 | null> => {
    try { return parseRecord(JSON.parse(await readFile(targetFor(evidenceRef), "utf8"))); }
    catch (error: unknown) {
      if ((error as { code?: string }).code === "ENOENT") return null;
      throw error;
    }
  };
  return Object.freeze({
    load,
    async publish(value: MissionEvidenceInputV1): Promise<MissionEvidenceV1> {
      const parsed = parseInput(value);
      const evidenceRef = evidenceDigest(parsed);
      const record = parseRecord({ v: "reelier.mission-evidence/v1", evidenceRef, ...parsed });
      try {
        await writeFile(targetFor(evidenceRef), `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
      } catch (error: unknown) {
        if ((error as { code?: string }).code !== "EEXIST") throw error;
        const existing = await load(evidenceRef);
        if (!existing || JSON.stringify(existing) !== JSON.stringify(record)) throw new Error("mission evidence content-address conflict");
      }
      return record;
    },
  });
}
