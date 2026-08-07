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
import {
  fileExists,
  parseMcpConfig,
  formatMcpConfigJson,
  buildReelierServerEntry,
  type McpConfigJson,
  type AgentConfigDetection,
  type KnownMcpConfig,
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
// Uninstall across every host — the reverse gear for `install`.
//
// `install` wraps every config in knownMcpConfigPaths; uninstall must walk the
// SAME set or it is not a reverse gear, it is a reverse gear for one host. It
// used to resolve a single path through detectAgentConfig (Claude Code only),
// so a Cursor or Windsurf user who installed then uninstalled stayed wrapped
// and was told the uninstall succeeded.
// ---------------------------------------------------------------------------

/**
 * Whether a config on disk currently carries reelier-wrapped entries.
 * "unknown" when the file is missing or unparseable — never collapsed to
 * "unwrapped", which a reader would take as "nothing left to revert".
 */
export type WrapState = "wrapped" | "unwrapped" | "unknown";

export type UninstallAction =
  /** A backup exists and the config is on disk — restorable. */
  | "restore"
  /** The config is on disk with no backup beside it. Reported, never skipped: if it is wrapped, this is the one case with no CLI route back. */
  | "no-backup"
  /** A backup exists but the config is gone. Reported and left alone — recreating a file the user deleted is a surprise write, not a revert. */
  | "orphan-backup";

export interface UninstallPlanEntry {
  label: string;
  configPath: string;
  action: UninstallAction;
  backupPath?: string;
  wrapState: WrapState;
  /** Names of the currently-wrapped servers, so a no-backup report can say what is still fronted rather than just how many. */
  wrappedServerNames: string[];
  /** Why `wrapState` is "unknown", verbatim. Present only then. */
  wrapStateReason?: string;
}

export interface UninstallPlan {
  /** Only paths where a config or a backup exists. A host that was never installed has nothing to report and is not noise. */
  entries: UninstallPlanEntry[];
  /** How many entries `applyUninstall` will actually write. Zero is the caller's cue to fail with an honest error rather than print a success. */
  restorable: number;
  /** Every path considered, installed or not — what the caller lists when it finds nothing. */
  checkedPaths: string[];
}

/** Read a config and report whether reelier currently fronts anything in it. Never throws: an unreadable config is an honest "unknown", not an assumed "unwrapped". */
async function inspectWrapState(
  configPath: string
): Promise<{ wrapState: WrapState; wrappedServerNames: string[]; wrapStateReason?: string }> {
  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch (err) {
    return { wrapState: "unknown", wrappedServerNames: [], wrapStateReason: (err as Error).message };
  }
  let servers: Record<string, unknown>;
  try {
    servers = (parseMcpConfig(raw).mcpServers ?? {}) as Record<string, unknown>;
  } catch (err) {
    return { wrapState: "unknown", wrappedServerNames: [], wrapStateReason: (err as Error).message };
  }
  const wrappedServerNames = Object.entries(servers)
    .filter(([, entry]) => isWrappedEntry(entry))
    .map(([name]) => name);
  return { wrapState: wrappedServerNames.length > 0 ? "wrapped" : "unwrapped", wrappedServerNames };
}

/** Plan the revert across a set of host configs — pure inspection, writes nothing. */
export async function planUninstall(targets: KnownMcpConfig[]): Promise<UninstallPlan> {
  const entries: UninstallPlanEntry[] = [];

  for (const target of targets) {
    const [exists, backupPath] = await Promise.all([fileExists(target.path), findLatestBackup(target.path)]);
    if (!exists && !backupPath) continue;

    if (!exists) {
      entries.push({
        label: target.label,
        configPath: target.path,
        action: "orphan-backup",
        backupPath,
        wrapState: "unknown",
        wrappedServerNames: [],
        wrapStateReason: "the config file no longer exists",
      });
      continue;
    }

    const state = await inspectWrapState(target.path);
    entries.push({
      label: target.label,
      configPath: target.path,
      action: backupPath ? "restore" : "no-backup",
      backupPath,
      ...state,
    });
  }

  return {
    entries,
    restorable: entries.filter((e) => e.action === "restore").length,
    checkedPaths: targets.map((t) => t.path),
  };
}

export type UninstallOutcome = "restored" | "no-backup" | "orphan-backup" | "restore-failed";

export interface UninstallEntryResult extends UninstallPlanEntry {
  outcome: UninstallOutcome;
  /** Present only on "restore-failed" — the config was left exactly as it was. */
  error?: string;
}

/**
 * Restore every restorable config. A failure on one config does NOT abort the
 * rest and is never reported as a skip: each config has its own backup, and an
 * operator who gets three of four hosts back needs to know which one is still
 * wrapped. Backups are left on disk — restoring is not consuming.
 */
export async function applyUninstall(plan: UninstallPlan): Promise<UninstallEntryResult[]> {
  const results: UninstallEntryResult[] = [];
  for (const entry of plan.entries) {
    if (entry.action !== "restore") {
      results.push({ ...entry, outcome: entry.action });
      continue;
    }
    try {
      await restoreFromBackup(entry.configPath, entry.backupPath!);
      results.push({ ...entry, outcome: "restored" });
    } catch (err) {
      results.push({ ...entry, outcome: "restore-failed", error: (err as Error).message });
    }
  }
  return results;
}

/**
 * The `--agent` rejection both install and uninstall print. Shared so the two
 * can never drift into describing different host coverage — and it names the
 * offending value, which the message lost when install grew multi-host support
 * (the interpolation was dropped, leaving a literal empty `''`).
 */
export function agentGuardMessage(command: "install" | "uninstall", agent: string): string {
  const verb = command === "install" ? "install now wraps" : "uninstall now reverts";
  return (
    `Unsupported --agent '${agent}' — omit it: ${verb} every known host config it finds ` +
    `(Claude Code, Cursor, Windsurf). Use --config <path> to target one file.`
  );
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

  let plan: InstallPlan;
  try {
    plan = await planInstall(configPath);
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
