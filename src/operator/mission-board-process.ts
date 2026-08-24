import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createMissionControlBoardV1 } from "./mission-board.js";
import { createMissionControlJournalV1 } from "./mission-journal.js";
import { stopOwnedMissionProcessV1 } from "./mission-process-control.js";

type SpawnOptionsV1 = Readonly<{ env: NodeJS.ProcessEnv; cwd: string; detached: true; stdio: "ignore"; windowsHide: true }>;
export type BoardSpawnV1 = (command: string, args: readonly string[], options: SpawnOptionsV1) => Readonly<{ unref(): void }>;

export type DetachedMissionControlBoardV1 = Readonly<{ origin: string; url: string; pid: number; expiresAt: string }>;

function boardProcessEnvironment(): NodeJS.ProcessEnv {
  const allowed = new Set(["path", "pathext", "systemroot", "windir", "comspec", "temp", "tmp", "tmpdir", "lang", "lc_all"]);
  return Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && allowed.has(key.toLowerCase())));
}

function descriptor(value: unknown): Readonly<{ origin: string; pid: number; expiresAt: string }> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Mission Control board descriptor is invalid");
  const record = value as Record<string, unknown>;
  if (Reflect.ownKeys(record).length !== 4 || record.v !== "reelier.mission-control-board-process/v1" || typeof record.origin !== "string" || typeof record.pid !== "number" || typeof record.expiresAt !== "string") throw new Error("Mission Control board descriptor is invalid");
  const url = new URL(record.origin);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.pathname !== "/" || url.username || url.password || url.search || url.hash || !Number.isSafeInteger(record.pid) || record.pid <= 0 || Number.isNaN(Date.parse(record.expiresAt))) throw new Error("Mission Control board descriptor is invalid");
  return Object.freeze({ origin: url.origin, pid: record.pid, expiresAt: record.expiresAt });
}

async function waitForDescriptor(file: string, timeoutMs: number): Promise<Readonly<{ origin: string; pid: number; expiresAt: string }>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { return descriptor(JSON.parse(await readFile(file, "utf8"))); } catch (error: unknown) {
      if ((error as { code?: string }).code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  throw new Error("Mission Control board did not become ready");
}

export async function launchDetachedMissionControlBoardV1(input: Readonly<{
  root: string;
  cliPath?: string;
  openBrowser?: (url: string) => void;
  spawnImpl?: BoardSpawnV1;
  timeoutMs?: number;
  lifetimeMs?: number;
}>): Promise<DetachedMissionControlBoardV1> {
  await (await createMissionControlJournalV1({ root: input.root })).reconstruct();
  const operatorDirectory = path.join(path.resolve(input.root), ".reelier", "operator");
  await mkdir(operatorDirectory, { recursive: true, mode: 0o700 });
  const descriptorPath = path.join(operatorDirectory, `board-${randomUUID()}.json`);
  const capability = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + (input.lifetimeMs ?? 8 * 60 * 60_000)).toISOString();
  const environment: NodeJS.ProcessEnv = {
    ...boardProcessEnvironment(),
    REELIER_BOARD_ROOT: path.resolve(input.root),
    REELIER_BOARD_CAPABILITY: capability,
    REELIER_BOARD_EXPIRES_AT: expiresAt,
    REELIER_BOARD_DESCRIPTOR: descriptorPath,
  };
  const spawnImpl = input.spawnImpl ?? ((command, args, options) => spawn(command, [...args], options));
  const child = spawnImpl(process.execPath, [input.cliPath ?? fileURLToPath(new URL("../cli.js", import.meta.url)), "operator", "board-server"], {
    env: environment,
    cwd: path.resolve(input.root),
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  try {
    const ready = await waitForDescriptor(descriptorPath, input.timeoutMs ?? 5_000);
    const result = Object.freeze({ ...ready, url: `${ready.origin}/#${capability}` });
    input.openBrowser?.(result.url);
    return result;
  } finally {
    await rm(descriptorPath, { force: true });
  }
}

async function atomicDescriptor(target: string, value: unknown): Promise<void> {
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function runMissionControlBoardServerFromEnvironmentV1(environment: NodeJS.ProcessEnv = process.env): Promise<never> {
  const root = environment.REELIER_BOARD_ROOT;
  const capability = environment.REELIER_BOARD_CAPABILITY;
  const expiresAt = environment.REELIER_BOARD_EXPIRES_AT;
  const descriptorPath = environment.REELIER_BOARD_DESCRIPTOR;
  if (!root || !capability || !expiresAt || !descriptorPath) throw new Error("Mission Control board environment is incomplete");
  delete environment.REELIER_BOARD_CAPABILITY;
  const board = await createMissionControlBoardV1({
    root,
    capability,
    expiresAt,
    stopMission: async (missionId) => { await stopOwnedMissionProcessV1({ root, missionId }); },
  });
  await atomicDescriptor(descriptorPath, { v: "reelier.mission-control-board-process/v1", origin: board.origin, pid: process.pid, expiresAt });
  await new Promise<void>((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
  await board.close();
  process.exit(0);
}
