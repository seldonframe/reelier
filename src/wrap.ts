// `reelier install` / `reelier uninstall` — turn `reelier init`'s manual
// "front an existing MCP server with reelier mcp --wrap" step into a single
// command: detect the agent's MCP config (reusing init.ts's detection),
// back it up, and rewrite every configured local server so it's fronted by
// `reelier mcp --wrap "<original command>"`. Idempotent (never double-wraps
// an already-wrapped entry) and always reversible (original config content
// is preserved verbatim in a timestamped backup file before anything is
// overwritten).

import { readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { splitCommandLine } from "./mcp-client.js";
import { writeFileAtomic } from "./writeback.js";
import { fileExists, parseMcpConfig, formatMcpConfigJson, buildReelierServerEntry, type McpConfigJson } from "./init.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Command-line join — the inverse of mcp-client.ts's splitCommandLine. Only
// needs to handle the common case (npx/node/binary + plain args); args
// containing a literal quote character are a known limitation shared with
// splitCommandLine itself (which has no escape-sequence support either).
// ---------------------------------------------------------------------------

function quoteArg(arg: string): string {
  if (arg.length === 0) return '""';
  if (/[\s"']/.test(arg)) return `"${arg.replace(/"/g, '\\"')}"`;
  return arg;
}

export function joinCommandLine(command: string, args: string[] = []): string {
  return [command, ...args].map(quoteArg).join(" ");
}

// ---------------------------------------------------------------------------
// Entry classification
// ---------------------------------------------------------------------------

export interface WrappableEntry {
  command: string;
  args?: string[];
  [key: string]: unknown;
}

/** An entry already fronted by reelier (npx reelier mcp --wrap ...) — left untouched, never double-wrapped. Detects both the current `reelier` package name and the legacy `@seldonframe/reelier`, so a re-install never double-wraps a server that was wrapped before the rename. */
export function isWrappedEntry(entry: unknown): boolean {
  if (!isRecord(entry)) return false;
  const args = entry.args;
  return (
    entry.command === "npx" &&
    Array.isArray(args) &&
    (args.includes("reelier") || args.includes("@seldonframe/reelier")) &&
    args.includes("mcp") &&
    args.includes("--wrap")
  );
}

/** A local stdio command-based server ({command, args?}) — the only shape `reelier mcp --wrap` can front. Remote/url-based servers (type: "http"/"sse", or a bare `url` field) are reported as skipped, never silently mis-wrapped. */
export function isWrappableEntry(entry: unknown): entry is WrappableEntry {
  if (!isRecord(entry)) return false;
  if (typeof entry.command !== "string" || entry.command.length === 0) return false;
  if (entry.args !== undefined && !Array.isArray(entry.args)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Plan — pure, no I/O side effects beyond the initial read. Always shows the
// caller the exact before/after before anything is written (same
// review-before-write discipline as init.ts's planMcpConfigWrite).
// ---------------------------------------------------------------------------

export type WrapAction = "wrap" | "already-wrapped" | "skip-unwrappable";

export interface WrapPlanEntry {
  name: string;
  action: WrapAction;
  reason?: string;
}

export interface InstallPlan {
  configPath: string;
  configExisted: boolean;
  before: string;
  after: string;
  entries: WrapPlanEntry[];
  /** True iff at least one entry will actually be rewritten — install is a no-op (and never writes/backs up) when false. */
  changed: boolean;
}

export async function planInstall(configPath: string): Promise<InstallPlan> {
  const configExisted = await fileExists(configPath);
  const raw = configExisted ? await readFile(configPath, "utf8") : undefined;
  const config = parseMcpConfig(raw);
  const servers = (config.mcpServers ?? {}) as Record<string, unknown>;

  const entries: WrapPlanEntry[] = [];
  const newServers: Record<string, unknown> = {};
  let changed = false;

  for (const [name, entry] of Object.entries(servers)) {
    if (isWrappedEntry(entry)) {
      entries.push({ name, action: "already-wrapped" });
      newServers[name] = entry;
      continue;
    }
    if (!isWrappableEntry(entry)) {
      entries.push({
        name,
        action: "skip-unwrappable",
        reason: "not a local command-based server (remote/url-based, or missing a 'command' field) — reelier only wraps stdio command servers",
      });
      newServers[name] = entry;
      continue;
    }
    const originalCommandLine = joinCommandLine(entry.command, entry.args ?? []);
    newServers[name] = buildReelierServerEntry(originalCommandLine);
    entries.push({ name, action: "wrap" });
    changed = true;
  }

  const afterConfig: McpConfigJson = { ...config, mcpServers: newServers };
  return {
    configPath,
    configExisted,
    before: raw ?? "(no existing file)",
    after: formatMcpConfigJson(afterConfig),
    entries,
    changed,
  };
}

// ---------------------------------------------------------------------------
// Apply — back up first (original content, byte-for-byte), then atomic write.
// ---------------------------------------------------------------------------

export interface InstallResult {
  configPath: string;
  backupPath: string | undefined;
  wrappedCount: number;
  alreadyWrappedCount: number;
  skippedCount: number;
}

export async function applyInstall(plan: InstallPlan): Promise<InstallResult> {
  let backupPath: string | undefined;
  if (plan.changed) {
    if (plan.configExisted) {
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      backupPath = `${plan.configPath}.backup-${ts}`;
      await writeFile(backupPath, plan.before, "utf8");
    }
    await writeFileAtomic(plan.configPath, plan.after);
  }
  return {
    configPath: plan.configPath,
    backupPath,
    wrappedCount: plan.entries.filter((e) => e.action === "wrap").length,
    alreadyWrappedCount: plan.entries.filter((e) => e.action === "already-wrapped").length,
    skippedCount: plan.entries.filter((e) => e.action === "skip-unwrappable").length,
  };
}

// ---------------------------------------------------------------------------
// Uninstall — restore the most recent backup for a config path. Never
// destroys anything: the backup file itself is left in place after restore,
// in case the user wants to re-apply.
// ---------------------------------------------------------------------------

export async function findLatestBackup(configPath: string): Promise<string | undefined> {
  const dir = path.dirname(configPath);
  const base = path.basename(configPath);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return undefined;
  }
  const prefix = `${base}.backup-`;
  // ISO-with-dashes timestamps in the suffix sort lexically == chronologically.
  const candidates = entries.filter((e) => e.startsWith(prefix)).sort();
  if (candidates.length === 0) return undefined;
  return path.join(dir, candidates[candidates.length - 1]);
}

export async function restoreFromBackup(configPath: string, backupPath: string): Promise<void> {
  const content = await readFile(backupPath, "utf8");
  await writeFileAtomic(configPath, content);
}
