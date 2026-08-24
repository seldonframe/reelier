import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseMissionControlMissionV1, type MissionControlMissionV1 } from "./mission-control.js";

type MissionSnapshotEventV1 = Readonly<{
  v: "reelier.mission-control-event/v1";
  eventId: string;
  kind: "mission-snapshot";
  mission: MissionControlMissionV1;
}>;

export type MissionControlJournalV1 = Readonly<{
  appendMission(mission: MissionControlMissionV1): Promise<MissionControlMissionV1>;
  reconstruct(): Promise<readonly MissionControlMissionV1[]>;
}>;

type RootIdentity = Readonly<{ canonical: string; device: bigint; inode: bigint }>;
const EVENT_KEYS = new Set(["v", "eventId", "kind", "mission"]);
const EVENT_ID = /^[0-9a-f-]{36}$/;

async function bindRoot(root: string): Promise<RootIdentity> {
  const resolved = path.resolve(root);
  const canonical = await realpath(resolved);
  if (canonical !== resolved) throw new Error("Mission Control workspace root is linked or symlinked");
  const details = await stat(canonical, { bigint: true });
  if (!details.isDirectory()) throw new Error("Mission Control workspace root is invalid");
  return Object.freeze({ canonical, device: details.dev, inode: details.ino });
}

async function assertRoot(identity: RootIdentity): Promise<void> {
  const canonical = await realpath(identity.canonical);
  const details = await stat(identity.canonical, { bigint: true });
  if (canonical !== identity.canonical || details.dev !== identity.device || details.ino !== identity.inode || !details.isDirectory()) throw new Error("Mission Control workspace root identity changed");
}

function operatorRoot(identity: RootIdentity): string {
  return path.join(identity.canonical, ".reelier", "operator");
}

async function ensureLocalDirectory(identity: RootIdentity, target: string): Promise<void> {
  await mkdir(target, { recursive: true, mode: 0o700 });
  const actual = await realpath(target);
  if (actual !== path.resolve(target)) throw new Error("Mission Control operator root is linked or symlinked");
  const relative = path.relative(identity.canonical, actual);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Mission Control operator root escaped the workspace");
}

async function ensureOperatorRoot(identity: RootIdentity): Promise<void> {
  await ensureLocalDirectory(identity, path.join(identity.canonical, ".reelier"));
  await ensureLocalDirectory(identity, operatorRoot(identity));
}

function missionPath(identity: RootIdentity, missionId: string): string {
  return path.join(operatorRoot(identity), "missions", `${missionId}.json`);
}

async function atomicWrite(target: string, contents: string): Promise<void> {
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, contents, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

function parseEvent(value: unknown): MissionSnapshotEventV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Mission Control journal event is invalid");
  const keys = Reflect.ownKeys(value);
  if (keys.length !== EVENT_KEYS.size || keys.some((key) => typeof key !== "string" || !EVENT_KEYS.has(key))) throw new TypeError("Mission Control journal event shape is invalid");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of EVENT_KEYS) {
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw new TypeError("Mission Control journal event must be inert");
  }
  if (descriptors.v!.value !== "reelier.mission-control-event/v1" || descriptors.kind!.value !== "mission-snapshot") throw new TypeError("Mission Control journal event version or kind is invalid");
  const eventId = descriptors.eventId!.value;
  if (typeof eventId !== "string" || !EVENT_ID.test(eventId)) throw new TypeError("Mission Control journal event id is invalid");
  return Object.freeze({
    v: "reelier.mission-control-event/v1",
    eventId,
    kind: "mission-snapshot",
    mission: parseMissionControlMissionV1(descriptors.mission!.value),
  });
}

async function withLock<T>(identity: RootIdentity, operation: () => Promise<T>): Promise<T> {
  const locks = path.join(operatorRoot(identity), "locks");
  await ensureOperatorRoot(identity);
  await ensureLocalDirectory(identity, locks);
  const lockPath = path.join(locks, "journal.lock");
  let handle;
  for (let attempt = 0; ; attempt += 1) {
    try {
      handle = await open(lockPath, "wx", 0o600);
      break;
    } catch (error: unknown) {
      if ((error as { code?: string }).code !== "EEXIST" || attempt >= 100) throw error;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
  try {
    return await operation();
  } finally {
    await handle.close();
    await rm(lockPath, { force: true });
  }
}

export async function createMissionControlJournalV1(input: Readonly<{ root: string }>): Promise<MissionControlJournalV1> {
  const identity = await bindRoot(input.root);
  await assertRoot(identity);
  return Object.freeze({
    async appendMission(value: MissionControlMissionV1): Promise<MissionControlMissionV1> {
      const mission = parseMissionControlMissionV1(value);
      return withLock(identity, async () => {
        await assertRoot(identity);
        const base = operatorRoot(identity);
        await ensureLocalDirectory(identity, path.join(base, "missions"));
        const event: MissionSnapshotEventV1 = Object.freeze({
          v: "reelier.mission-control-event/v1",
          eventId: randomUUID(),
          kind: "mission-snapshot",
          mission,
        });
        const eventHandle = await open(path.join(base, "events.jsonl"), "a", 0o600);
        try {
          await eventHandle.appendFile(`${JSON.stringify(event)}\n`, "utf8");
          await eventHandle.sync();
        } finally {
          await eventHandle.close();
        }
        await atomicWrite(missionPath(identity, mission.missionId), `${JSON.stringify(mission)}\n`);
        await assertRoot(identity);
        return mission;
      });
    },

    async reconstruct(): Promise<readonly MissionControlMissionV1[]> {
      return withLock(identity, async () => {
        await assertRoot(identity);
        let contents: string;
        try {
          contents = await readFile(path.join(operatorRoot(identity), "events.jsonl"), "utf8");
        } catch (error: unknown) {
          if ((error as { code?: string }).code === "ENOENT") return Object.freeze([]);
          throw error;
        }
        if (contents.length > 0 && !contents.endsWith("\n")) throw new Error("Mission Control journal is truncated");
        const latest = new Map<string, MissionControlMissionV1>();
        const eventIds = new Set<string>();
        for (const [index, line] of contents.split("\n").entries()) {
          if (line.length === 0) continue;
          let event: MissionSnapshotEventV1;
          try {
            event = parseEvent(JSON.parse(line));
          } catch (error: unknown) {
            throw new Error(`Mission Control journal event ${index + 1} is invalid`, { cause: error });
          }
          if (eventIds.has(event.eventId)) throw new Error(`Mission Control journal contains duplicate event identity ${event.eventId}`);
          eventIds.add(event.eventId);
          latest.set(event.mission.missionId, event.mission);
        }
        await assertRoot(identity);
        return Object.freeze([...latest.values()].sort((left, right) => left.missionId.localeCompare(right.missionId)));
      });
    },
  });
}
