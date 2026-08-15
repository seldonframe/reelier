import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { normalizeRouteCoverageV1 } from "../routes/normalize.js";
import { planBootstrapInstall } from "./install.js";
import type { BootstrapNativeSession } from "./native-helper.js";

export interface LocalMcpPreparationSummary {
  readonly wrapped: number;
  readonly alreadyWrapped: number;
  readonly unwrappable: number;
  readonly unsupported: number;
}

export interface LocalMcpPreparationPlan {
  readonly configPath: string;
  readonly relativePath: ".mcp.json";
  readonly before: Buffer;
  readonly after: Buffer;
  readonly changed: boolean;
  readonly summary: LocalMcpPreparationSummary;
}

export class LocalMcpConsentRequiredError extends Error {
  constructor() {
    super("named local MCP preparation requires explicit --yes consent");
    this.name = "LocalMcpConsentRequiredError";
  }
}

export async function planLocalMcpPreparation(projectRoot: string, bootstrapRoot: string, exactVersion: string, now = new Date()): Promise<LocalMcpPreparationPlan | undefined> {
  const configPath = path.join(projectRoot, ".mcp.json");
  let configInfo;
  try { configInfo = await lstat(configPath); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  if (!configInfo.isFile() || configInfo.isSymbolicLink() || await realpath(configPath) !== configPath) throw new TypeError("named local MCP config is unsafe or linked");

  const snapshotPath = path.join(bootstrapRoot, "route-coverage.json");
  const snapshotInfo = await lstat(snapshotPath).catch(error => (error as NodeJS.ErrnoException).code === "ENOENT" ? undefined : Promise.reject(error));
  if (!snapshotInfo?.isFile() || snapshotInfo.isSymbolicLink() || await realpath(snapshotPath) !== snapshotPath) throw new TypeError("fresh sealed route snapshot is required for named local MCP preparation");
  const rows = normalizeRouteCoverageV1(JSON.parse(await readFile(snapshotPath, "utf8")));
  const hostRows = rows.filter(row => row.discoverySource === "host-config");
  if (hostRows.length === 0 || hostRows.some(row => Date.parse(row.observedAt) > now.getTime() || now.getTime() >= Date.parse(row.freshUntil))) throw new TypeError("fresh sealed host-config route rows are required for named local MCP preparation");

  const before = await readFile(configPath);
  const planned = await planBootstrapInstall(configPath, exactVersion, projectRoot);
  const summary = Object.freeze({
    wrapped: planned.entries.filter(entry => entry.action === "wrap").length,
    alreadyWrapped: planned.entries.filter(entry => entry.action === "already-wrapped").length,
    unwrappable: planned.entries.filter(entry => entry.action === "skip-unwrappable").length,
    unsupported: rows.filter(row => row.discoverySource !== "host-config").length + planned.entries.filter(entry => entry.action === "skip-other-project").length,
  });
  return Object.freeze({ configPath, relativePath: ".mcp.json" as const, before, after: Buffer.from(planned.after), changed: planned.changed, summary });
}

export async function publishLocalMcpPreparation(plan: LocalMcpPreparationPlan, nativeSession: BootstrapNativeSession): Promise<void> {
  if (!plan.changed) return;
  await nativeSession.writeAtomic(plan.relativePath, plan.after);
  if (!(await readFile(plan.configPath)).equals(plan.after)) throw new Error("named local MCP config publication reread mismatch");
}

export async function rollbackLocalMcpPreparation(plan: LocalMcpPreparationPlan, nativeSession: BootstrapNativeSession): Promise<void> {
  if (!plan.changed) return;
  await nativeSession.writeAtomic(plan.relativePath, plan.before);
  if (!(await readFile(plan.configPath)).equals(plan.before)) throw new Error("named local MCP config rollback reread mismatch");
}
