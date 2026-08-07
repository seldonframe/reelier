// `reelier install` / `reelier uninstall` — turn `reelier init`'s manual
// "front an existing MCP server with reelier mcp --wrap" step into a single
// command: detect the agent's MCP config (reusing init.ts's detection),
// back it up, and rewrite the configured local servers so they're fronted by
// `reelier mcp --wrap "<original command>"`. Idempotent (never double-wraps
// an already-wrapped entry) and always reversible (original config content
// is preserved verbatim in a timestamped backup file before anything is
// overwritten).
//
// "the configured local servers" is two maps, not one: the top-level `mcpServers`
// object every host shares, and — in `~/.claude.json` only — the per-project map at
// `projects["<abs path>"].mcpServers`. Project-scoped entries are rewritten ONLY for
// the cwd's own project; every other project's are reported, never touched. See the
// `projects` block in planInstall for why, and `reelier coverage --host claude` for
// the report that is not cwd-scoped.

import { readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { splitCommandLine } from "./mcp-client.js";
import { writeFileAtomic } from "./writeback.js";
import { sameProjectDirectory } from "./project-scope.js";
import {
  fileExists,
  parseMcpConfig,
  formatMcpConfigJson,
  buildReelierServerEntry,
  type McpConfigJson,
  type AgentConfigDetection,
} from "./init.js";

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

export type WrapAction = "wrap" | "already-wrapped" | "skip-unwrappable" | "skip-other-project";

export interface WrapPlanEntry {
  name: string;
  action: WrapAction;
  reason?: string;
  /** Set only for entries under `projects["<abs path>"].mcpServers`; absent for top-level ones. */
  projectPath?: string;
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

/** Plan one `mcpServers` map. `projectPath` tags the resulting entries when the map is project-scoped. */
function planServerMap(
  servers: Record<string, unknown>,
  entries: WrapPlanEntry[],
  projectPath?: string
): { servers: Record<string, unknown>; changed: boolean } {
  const tag = projectPath === undefined ? {} : { projectPath };
  const newServers: Record<string, unknown> = {};
  let changed = false;

  for (const [name, entry] of Object.entries(servers)) {
    if (isWrappedEntry(entry)) {
      entries.push({ name, action: "already-wrapped", ...tag });
      newServers[name] = entry;
      continue;
    }
    if (!isWrappableEntry(entry)) {
      entries.push({
        name,
        action: "skip-unwrappable",
        reason: "not a local command-based server (remote/url-based, or missing a 'command' field) — reelier only wraps stdio command servers",
        ...tag,
      });
      newServers[name] = entry;
      continue;
    }
    const originalCommandLine = joinCommandLine(entry.command, entry.args ?? []);
    newServers[name] = buildReelierServerEntry(originalCommandLine);
    entries.push({ name, action: "wrap", ...tag });
    changed = true;
  }

  return { servers: newServers, changed };
}

/** The `mcpServers` map under a `projects["<abs path>"]` entry, or undefined when there isn't a usable one. */
function projectServerMap(projectEntry: unknown): Record<string, unknown> | undefined {
  if (!isRecord(projectEntry) || !isRecord(projectEntry.mcpServers)) return undefined;
  const servers = projectEntry.mcpServers;
  return Object.keys(servers).length > 0 ? servers : undefined;
}

/**
 * `cwd` decides which project-scoped servers get rewritten — see the `projects` block below.
 * It defaults to the process cwd; tests and `planWrapOffer` pass it explicitly so nothing here
 * depends on where the process happens to be running.
 */
export async function planInstall(configPath: string, cwd: string = process.cwd()): Promise<InstallPlan> {
  const configExisted = await fileExists(configPath);
  const raw = configExisted ? await readFile(configPath, "utf8") : undefined;
  const config = parseMcpConfig(raw);

  const entries: WrapPlanEntry[] = [];
  const topLevel = planServerMap((config.mcpServers ?? {}) as Record<string, unknown>, entries);
  let changed = topLevel.changed;

  const afterConfig: McpConfigJson = { ...config };
  // Only re-emit `mcpServers` if the operator already had one. A project-scoped wrap must not
  // add a top-level key to a config that never carried it.
  if (config.mcpServers !== undefined) afterConfig.mcpServers = topLevel.servers;

  // Claude Code ALSO stores per-project servers at `projects["<abs path>"].mcpServers` in the
  // same `~/.claude.json` this planner rewrites. Reading only the top-level map meant install
  // edited the file, reported success, and left those servers unwrapped inside it.
  //
  // Scope: ONLY the project entry whose key is the current working directory. Install is
  // already cwd-sensitive (it looks at <cwd>/.mcp.json), so cwd-scoping keeps the blast radius
  // predictable and matches operator intent. Rewriting every project entry from an arbitrary
  // cwd would modify config for projects the operator is not working in, and would make the
  // backup/uninstall story much worse — one restore would have to unwind edits across
  // unrelated projects. An entry for a DIFFERENT project is reported, never rewritten; use
  // `reelier coverage --host claude` to see all of them from anywhere.
  if (isRecord(config.projects)) {
    const newProjects: Record<string, unknown> = {};
    for (const [projectPath, projectEntry] of Object.entries(config.projects)) {
      const servers = projectServerMap(projectEntry);
      if (!servers) {
        newProjects[projectPath] = projectEntry;
        continue;
      }
      if (!sameProjectDirectory(projectPath, cwd)) {
        for (const name of Object.keys(servers)) {
          entries.push({
            name,
            action: "skip-other-project",
            reason: `configured for ${projectPath}, not the directory install is running in — reported, not rewritten`,
            projectPath,
          });
        }
        newProjects[projectPath] = projectEntry;
        continue;
      }
      const planned = planServerMap(servers, entries, projectPath);
      newProjects[projectPath] = { ...(projectEntry as Record<string, unknown>), mcpServers: planned.servers };
      if (planned.changed) changed = true;
    }
    afterConfig.projects = newProjects;
  }

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
// The backup is load-bearing, not best-effort: if it cannot be written, the
// install ABORTS with an explicit error and the config is left byte-identical
// — an existing config is never rewritten without its backup on disk first.
// ---------------------------------------------------------------------------

export interface InstallResult {
  configPath: string;
  backupPath: string | undefined;
  wrappedCount: number;
  alreadyWrappedCount: number;
  skippedCount: number;
  /** Project-scoped servers belonging to some OTHER project — reported, never rewritten. Its own denominator: merging it into `skippedCount` would read as "unwrappable", which these are not. */
  otherProjectCount: number;
}

/** `now` is injectable only so tests can pin the timestamped backup path; production callers omit it. */
export async function applyInstall(plan: InstallPlan, now: Date = new Date()): Promise<InstallResult> {
  let backupPath: string | undefined;
  if (plan.changed) {
    if (plan.configExisted) {
      const ts = now.toISOString().replace(/[:.]/g, "-");
      backupPath = `${plan.configPath}.backup-${ts}`;
      try {
        await writeFile(backupPath, plan.before, "utf8");
      } catch (err) {
        throw new Error(
          `Backup failed (${backupPath}): ${(err as Error).message}. Install aborted — ${plan.configPath} was ` +
            `NOT modified; a config is never rewritten without its backup on disk first.`
        );
      }
    }
    await writeFileAtomic(plan.configPath, plan.after);
  }
  return {
    configPath: plan.configPath,
    backupPath,
    wrappedCount: plan.entries.filter((e) => e.action === "wrap").length,
    alreadyWrappedCount: plan.entries.filter((e) => e.action === "already-wrapped").length,
    skippedCount: plan.entries.filter((e) => e.action === "skip-unwrappable").length,
    otherProjectCount: plan.entries.filter((e) => e.action === "skip-other-project").length,
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

// ---------------------------------------------------------------------------
// Init's closing offer — wrap onboarding as the recommended next step.
// Pure planning + line formatting only: this function never writes anything.
// cli.ts owns the y/N readline, and only an explicit yes there reaches
// applyInstall (which itself backs up before any write, or aborts).
// ---------------------------------------------------------------------------

/**
 * The one-line pitch init prints. Kept true by the proxy itself:
 * buildProxyServer captures each wrapped tool's tools/list annotation hints
 * into the trace meta (recorder.ts's collectToolAnnotations), so
 * wrap-captured traces really do include annotations — which scan's
 * transcript reconstruction never has.
 */
export const WRAP_PITCH =
  "Wrap captures lossless traces (tool annotations included) — scan-from-history is a reconstruction; wrap is the recording.";

export type WrapOfferMode = "prompt" | "print-command" | "none";

export interface WrapOffer {
  mode: WrapOfferMode;
  configPath?: string;
  plan?: InstallPlan;
  /** Exactly what init prints for this offer, in order — empty when there is nothing to say. */
  lines: string[];
}

/**
 * Plan the end-of-init wrap offer against the detected agent configs (same
 * project-then-user precedence as `reelier install`). `interactive` = a real
 * TTY without `--yes`: mode "prompt" means cli.ts asks y/N (default N — the
 * config is never modified without an explicit yes); otherwise mode
 * "print-command" prints the exact `reelier install` one-liner instead of
 * prompting. No config, nothing wrappable, or an unreadable config yields
 * "none" — the offer is a bonus, never a gate, but it also never skips
 * silently: an unreadable config gets an honest line saying so.
 */
export async function planWrapOffer(detection: AgentConfigDetection, interactive: boolean): Promise<WrapOffer> {
  const configPath = detection.projectConfigExists
    ? detection.projectConfigPath
    : detection.userConfigExists
      ? detection.userConfigPath
      : undefined;
  if (!configPath) return { mode: "none", lines: [] };

  // The cwd install would scope project entries to, derived from the detection rather than read
  // from the process — `agentConfigPaths` builds projectConfigPath as <cwd>/.mcp.json, so this is
  // exact, and it keeps the offer testable against fixture directories.
  const cwd = path.dirname(detection.projectConfigPath);

  let plan: InstallPlan;
  try {
    plan = await planInstall(configPath, cwd);
  } catch (err) {
    return {
      mode: "none",
      configPath,
      lines: [
        "",
        `(Skipping the wrap offer — ${configPath} could not be read as an MCP config: ${(err as Error).message})`,
      ],
    };
  }

  const wrapCount = plan.entries.filter((e) => e.action === "wrap").length;
  const alreadyWrappedCount = plan.entries.filter((e) => e.action === "already-wrapped").length;

  if (!plan.changed) {
    if (alreadyWrappedCount > 0) {
      return {
        mode: "none",
        configPath,
        plan,
        lines: [
          "",
          `Lossless capture is already on — ${alreadyWrappedCount} wrapped server(s) in ${configPath}. Revert anytime: reelier uninstall`,
        ],
      };
    }
    return { mode: "none", configPath, plan, lines: [] };
  }

  const lines = [
    "",
    "Recommended next step — turn on lossless capture:",
    `  ${WRAP_PITCH}`,
    `  ${configPath}: ${wrapCount} server(s) reelier can wrap. Your config is backed up first; revert anytime with 'reelier uninstall'.`,
  ];
  if (!interactive) {
    lines.push("  Turn it on: reelier install");
    return { mode: "print-command", configPath, plan, lines };
  }
  return { mode: "prompt", configPath, plan, lines };
}
