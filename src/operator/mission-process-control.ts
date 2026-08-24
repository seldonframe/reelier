import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createMissionControlJournalV1 } from "./mission-journal.js";

const MISSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const CAPABILITY = /^[0-9a-f]{64}$/;
type ProcessDescriptorV1 = Readonly<{ v: "reelier.mission-process-control/v1"; missionId: string; origin: string; capability: string; pid: number }>;

function parseDescriptor(value: unknown, expectedMissionId: string): ProcessDescriptorV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("mission process descriptor is invalid");
  const record = value as Record<string, unknown>;
  if (Reflect.ownKeys(record).length !== 5 || record.v !== "reelier.mission-process-control/v1" || record.missionId !== expectedMissionId || typeof record.origin !== "string" || typeof record.capability !== "string" || !CAPABILITY.test(record.capability) || typeof record.pid !== "number" || !Number.isSafeInteger(record.pid) || record.pid <= 0) throw new Error("mission process descriptor is invalid");
  const origin = new URL(record.origin);
  if (origin.protocol !== "http:" || origin.hostname !== "127.0.0.1" || origin.pathname !== "/" || origin.username || origin.password || origin.search || origin.hash) throw new Error("mission process descriptor origin is invalid");
  return Object.freeze({ v: "reelier.mission-process-control/v1", missionId: expectedMissionId, origin: origin.origin, capability: record.capability, pid: record.pid });
}

async function processDirectory(root: string): Promise<string> {
  await (await createMissionControlJournalV1({ root })).reconstruct();
  const directory = path.join(path.resolve(root), ".reelier", "operator", "processes");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (await realpath(directory) !== path.resolve(directory)) throw new Error("mission process directory is linked or symlinked");
  return directory;
}

function controlPath(directory: string, missionId: string): string {
  if (!MISSION_ID.test(missionId)) throw new TypeError("mission process id is invalid");
  return path.join(directory, `${missionId}.json`);
}

export async function createMissionProcessControlV1(input: Readonly<{ root: string; missionId: string; stop: () => Promise<void> }>): Promise<Readonly<{ close(): Promise<void> }>> {
  const directory = await processDirectory(input.root);
  const target = controlPath(directory, input.missionId);
  const capability = randomBytes(32).toString("hex");
  let stopped = false;
  const server = createServer(async (request, response) => {
    const header = request.headers.authorization;
    const supplied = typeof header === "string" && header.startsWith("Bearer ") ? Buffer.from(header.slice(7), "utf8") : Buffer.alloc(0);
    const expected = Buffer.from(capability, "utf8");
    if (request.method !== "POST" || request.url !== "/stop" || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      response.writeHead(401, { "cache-control": "no-store" }); response.end(); return;
    }
    if (stopped) { response.writeHead(409, { "cache-control": "no-store" }); response.end(); return; }
    stopped = true;
    await input.stop();
    response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(JSON.stringify({ status: "stopped", missionId: input.missionId }));
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") { server.close(); throw new Error("mission process loopback address is unavailable"); }
  const descriptor: ProcessDescriptorV1 = Object.freeze({ v: "reelier.mission-process-control/v1", missionId: input.missionId, origin: `http://127.0.0.1:${address.port}`, capability, pid: process.pid });
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(descriptor)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
  let closed = false;
  return Object.freeze({
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await rm(target, { force: true });
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  });
}

export async function stopOwnedMissionProcessV1(input: Readonly<{ root: string; missionId: string }>): Promise<Readonly<{ status: "stopped"; missionId: string }>> {
  const directory = await processDirectory(input.root);
  let parsed: ProcessDescriptorV1;
  try { parsed = parseDescriptor(JSON.parse(await readFile(controlPath(directory, input.missionId), "utf8")), input.missionId); }
  catch (error: unknown) {
    if ((error as { code?: string }).code === "ENOENT") throw new Error("mission process is not active or was not found");
    throw error;
  }
  const response = await fetch(`${parsed.origin}/stop`, { method: "POST", headers: { authorization: `Bearer ${parsed.capability}` } });
  if (!response.ok) throw new Error(`mission process stop was refused (${response.status})`);
  const body = await response.json() as Record<string, unknown>;
  if (body.status !== "stopped" || body.missionId !== input.missionId || Reflect.ownKeys(body).length !== 2) throw new Error("mission process stop response is invalid");
  return Object.freeze({ status: "stopped", missionId: input.missionId });
}
