import { mkdir, open, readFile, realpath, rename, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const ID = /^[A-Za-z0-9][A-Za-z0-9._~:/@+-]{0,255}$/u;
const SECRET = /^[A-Za-z0-9_-]{32,256}$/u;
type FetchLike = typeof fetch;

export type AutopilotTargetSelectionV1 = Readonly<{
  version: "reelier.autopilot-target-selection/v1";
  missionRef: string;
  workspaceId: string;
  teamId: string;
  projectId: string;
  composite: Readonly<{ issueId: string; preStatusId: string; targetStatusId: string }>;
  linearOnly: Readonly<{ issueId: string; preStatusId: string; targetStatusId: string }>;
}>;

function exactId(value: unknown, label: string): string {
  if (typeof value !== "string" || !ID.test(value)) throw new TypeError(`${label} is invalid`);
  return value;
}

function exactRecord(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Reflect.ownKeys(value).some(key => typeof key !== "string") || Object.keys(value).sort().join(",") !== [...keys].sort().join(",")) throw new TypeError(`${label} shape is invalid`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys) if (!descriptors[key] || !("value" in descriptors[key]!) || !descriptors[key]!.enumerable) throw new TypeError(`${label} must be inert`);
  return Object.fromEntries(keys.map(key => [key, descriptors[key]!.value]));
}

function operation(value: unknown, label: string) {
  const row = exactRecord(value, ["issueId", "preStatusId", "targetStatusId"], label);
  return Object.freeze({ issueId: exactId(row.issueId, `${label} issue`), preStatusId: exactId(row.preStatusId, `${label} pre-status`), targetStatusId: exactId(row.targetStatusId, `${label} target status`) });
}

export function parseAutopilotTargetSelectionV1(value: unknown): AutopilotTargetSelectionV1 {
  const row = exactRecord(value, ["version", "missionRef", "workspaceId", "teamId", "projectId", "composite", "linearOnly"], "Autopilot target selection");
  if (row.version !== "reelier.autopilot-target-selection/v1") throw new TypeError("Autopilot target selection version is invalid");
  const composite = operation(row.composite, "composite target"), linearOnly = operation(row.linearOnly, "Linear-only target");
  if (composite.issueId === linearOnly.issueId) throw new TypeError("Autopilot target issues must be distinct");
  return Object.freeze({ version: "reelier.autopilot-target-selection/v1", missionRef: exactId(row.missionRef, "mission reference"), workspaceId: exactId(row.workspaceId, "workspace identity"), teamId: exactId(row.teamId, "team identity"), projectId: exactId(row.projectId, "project identity"), composite, linearOnly });
}

async function directory(root: string): Promise<string> {
  const resolved = path.resolve(root), canonical = await realpath(resolved);
  if (resolved !== canonical) throw new TypeError("Autopilot workspace root is linked");
  const target = path.join(canonical, ".reelier", "operator", "target-selections");
  await mkdir(target, { recursive: true, mode: 0o700 });
  if (await realpath(target) !== path.resolve(target)) throw new TypeError("Autopilot target-selection directory is linked");
  return target;
}

async function atomicWrite(target: string, value: unknown): Promise<void> {
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, "wx", 0o600);
    try { await handle.writeFile(`${JSON.stringify(value)}\n`, "utf8"); await handle.sync(); }
    finally { await handle.close(); }
    await rename(temporary, target);
  } finally { await rm(temporary, { force: true }); }
}

function baseUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new TypeError("Autopilot Cloud URL is invalid");
  return url;
}

export async function startAutopilotTargetSelectionV1(input: Readonly<{ root: string; cloudBaseUrl: string; missionRef: string; fetch?: FetchLike; now?: () => Date }>) {
  const missionRef = exactId(input.missionRef, "mission reference"), base = baseUrl(input.cloudBaseUrl), target = path.join(await directory(input.root), `${missionRef}.json`);
  try {
    const prior = JSON.parse(await readFile(target, "utf8")) as Record<string, unknown>;
    if (prior.version === "reelier.autopilot-target-selection-poll/v1" && prior.missionRef === missionRef && typeof prior.browserUrl === "string") return Object.freeze({ browserUrl: prior.browserUrl });
    if (prior.version === "reelier.autopilot-target-selection/v1") throw new TypeError("Autopilot targets are already selected");
  } catch (error) { if ((error as { code?: string }).code !== "ENOENT" && !(error instanceof SyntaxError)) throw error; }
  const response = await (input.fetch ?? fetch)(new URL("/api/v1/autopilot/target-selections/start", base).toString(), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ missionRef }) });
  if (response.status !== 201) throw new Error(`Autopilot target selection refused (${response.status})`);
  const result = exactRecord(await response.json(), ["status", "pollSecret", "browserUrl", "expiresAt"], "Autopilot target-selection response");
  if (result.status !== "pending" || typeof result.pollSecret !== "string" || !SECRET.test(result.pollSecret) || typeof result.browserUrl !== "string" || typeof result.expiresAt !== "string" || Number.isNaN(Date.parse(result.expiresAt))) throw new TypeError("Autopilot target-selection response is invalid");
  const browser = new URL(result.browserUrl), expectedPath = "/autopilot/targets";
  if (browser.origin !== base.origin || browser.pathname !== expectedPath || browser.searchParams.get("mission") !== missionRef || !SECRET.test(new URLSearchParams(browser.hash.slice(1)).get("selection") ?? "")) throw new TypeError("Autopilot target-selection browser destination is invalid");
  const now = (input.now ?? (() => new Date()))();
  if (Date.parse(result.expiresAt) <= now.getTime() || Date.parse(result.expiresAt) - now.getTime() > 15 * 60_000 + 5_000) throw new TypeError("Autopilot target-selection expiry is invalid");
  await atomicWrite(target, { version: "reelier.autopilot-target-selection-poll/v1", missionRef, cloudBaseUrl: base.toString(), pollSecret: result.pollSecret, browserUrl: browser.toString(), expiresAt: result.expiresAt });
  return Object.freeze({ browserUrl: browser.toString() });
}

export async function waitForAutopilotTargetSelectionV1(input: Readonly<{ root: string; missionRef: string; fetch?: FetchLike; pollIntervalMs?: number; now?: () => Date }>): Promise<AutopilotTargetSelectionV1> {
  const missionRef = exactId(input.missionRef, "mission reference"), target = path.join(await directory(input.root), `${missionRef}.json`);
  const state = exactRecord(JSON.parse(await readFile(target, "utf8")), ["version", "missionRef", "cloudBaseUrl", "pollSecret", "browserUrl", "expiresAt"], "Autopilot target-selection poll state");
  if (state.version !== "reelier.autopilot-target-selection-poll/v1" || state.missionRef !== missionRef || typeof state.pollSecret !== "string" || !SECRET.test(state.pollSecret) || typeof state.cloudBaseUrl !== "string" || typeof state.expiresAt !== "string") throw new TypeError("Autopilot target-selection poll state is invalid");
  const base = baseUrl(state.cloudBaseUrl), expiresAt = Date.parse(state.expiresAt), interval = input.pollIntervalMs ?? 2_000;
  while ((input.now ?? (() => new Date()))().getTime() < expiresAt) {
    const response = await (input.fetch ?? fetch)(new URL("/api/v1/autopilot/target-selections/poll", base).toString(), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ missionRef, pollSecret: state.pollSecret }) });
    if (!response.ok) throw new Error(`Autopilot target selection poll refused (${response.status})`);
    const value: unknown = await response.json();
    if (value && typeof value === "object" && !Array.isArray(value) && (value as { status?: unknown }).status === "pending" && Object.keys(value).join(",") === "status") { await new Promise(resolve => setTimeout(resolve, interval)); continue; }
    const row = exactRecord(value, ["status", "selection"], "Autopilot target-selection poll response");
    if (row.status !== "selected") throw new TypeError("Autopilot target-selection poll response is invalid");
    const selection = parseAutopilotTargetSelectionV1(row.selection);
    if (selection.missionRef !== missionRef) throw new TypeError("Autopilot target selection crossed missions");
    await atomicWrite(target, selection);
    return selection;
  }
  throw new Error("Autopilot target selection expired before completion");
}
