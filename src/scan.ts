// `reelier scan` support — discover every agent session transcript under an
// agent-projects directory (default `~/.claude/projects`) and summarize
// which ones contain a replayable workflow (per session.ts's honesty
// filter), without writing anything. The CLI layer (src/cli.ts) turns the
// resulting list into an interactive "which should Reelier turn into a
// skill?" selection; this module is pure discovery + summarization so it's
// unit-testable against a fixture directory tree.

import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { summarizeSession, type SessionSummary } from "./session.js";

/** Real transcripts live two levels down: `<dir>/<project-slug>/<uuid>.jsonl`. Scanned defensively (a couple of extra levels) in case an agent ever nests further, capped so a symlink loop or huge unrelated tree can't hang the scan. */
const MAX_DEPTH = 4;

/** Every `*.jsonl` file under `rootDir`, found by a depth-capped recursive walk. Missing/unreadable directories yield an empty list rather than throwing — scan across a machine where `~/.claude/projects` doesn't exist yet should say "found 0", not crash. */
export async function findTranscriptFiles(rootDir: string): Promise<string[]> {
  const out: string[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        out.push(full);
      }
    }
  }

  await walk(rootDir, 0);
  return out;
}

export interface ScannedSession extends SessionSummary {
  /** Directory name the transcript lives in — the project slug Claude Code derives from the cwd it was recorded in. */
  project: string;
  mtimeMs: number;
  /** Which agent/IDE this transcript came from (see AGENT_SOURCES). */
  sourceId: string;
  sourceLabel: string;
}

/**
 * A known place an agent/IDE writes tool-call session transcripts, relative to
 * the home dir. Each existing dir is scanned; formats other than Claude Code's
 * JSONL currently parse to 0 replayable (session.ts skips lines it doesn't
 * recognize) — honest degradation, never a crash or a fabricated result. A new
 * IDE is a one-line entry here PLUS, if its transcript schema differs, a parser
 * branch in session.ts. Deliberately NOT listed: IDEs whose history is a SQLite
 * DB (Cursor) or a rules/config dir (`.cursor/rules`, `.windsurfrules`) rather
 * than a replayable tool-call transcript.
 */
export interface AgentSource {
  id: string;
  label: string;
  dir: string;
}

export function agentSources(homedir: string = os.homedir()): AgentSource[] {
  return [
    { id: "claude-code", label: "Claude Code", dir: path.join(homedir, ".claude", "projects") },
    { id: "codex", label: "Codex CLI", dir: path.join(homedir, ".codex", "sessions") },
    { id: "windsurf", label: "Windsurf", dir: path.join(homedir, ".codeium", "windsurf") },
    { id: "openclaw", label: "OpenClaw", dir: path.join(homedir, ".openclaw") },
  ];
}

/**
 * Discover and summarize every transcript under `rootDir`. Never throws on a
 * single unreadable/malformed file — that file is skipped from the results
 * (session.ts's own parser already tolerates malformed lines within a file;
 * this only guards the outer read failing entirely, e.g. permissions).
 */
export async function scanTranscripts(
  rootDir: string,
  src: { id: string; label: string } = { id: "custom", label: "directory" }
): Promise<ScannedSession[]> {
  const files = await findTranscriptFiles(rootDir);
  const results: ScannedSession[] = [];

  for (const file of files) {
    let source: string;
    let mtimeMs: number;
    try {
      source = await readFile(file, "utf8");
      mtimeMs = (await stat(file)).mtimeMs;
    } catch {
      continue;
    }
    const summary = summarizeSession(source, file);
    results.push({
      ...summary,
      project: path.basename(path.dirname(file)),
      mtimeMs,
      sourceId: src.id,
      sourceLabel: src.label,
    });
  }

  results.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return results;
}

/**
 * Scan EVERY known agent/IDE transcript source (AGENT_SOURCES) under `homedir`,
 * tagging each session with where it came from. Missing sources are skipped
 * silently; an unrecognized-format source contributes 0 replayable sessions
 * rather than erroring. Returns the merged, recency-sorted list.
 */
export async function scanAgentSessions(homedir: string = os.homedir()): Promise<ScannedSession[]> {
  const all: ScannedSession[] = [];
  for (const src of agentSources(homedir)) {
    const found = await scanTranscripts(src.dir, { id: src.id, label: src.label });
    all.push(...found);
  }
  all.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return all;
}

// ---------------------------------------------------------------------------
// The self-measuring KPI: how many replayable sessions are fully read-only
// (the ideal replay targets), and how many miss that bar ONLY because of
// unknown-verb tools — i.e. exactly the sessions a verb-list addition in
// effect-verbs.ts would convert. The top-blockers list is the self-improvement
// loop: it names the tools to consider classifying next.
// ---------------------------------------------------------------------------

/** The per-session fields the KPI consumes (a subset of SessionSummary). */
export type ReplayableRateInput = Pick<SessionSummary, "replayableCount" | "readOnly" | "effects" | "unknownCount" | "unknownTools">;

export interface ReplayableRateStats {
  /** Sessions with at least one replayable call — the KPI's denominator. */
  replayableSessions: number;
  /** Of those, fully read-only sessions — the KPI's numerator. */
  readOnlySessions: number;
  /** readOnlySessions / replayableSessions as a percentage (one decimal); 0 when there are no replayable sessions. */
  readOnlyPct: number;
  /** Replayable sessions that are NOT read-only solely because every non-read call was an unknown→destructive fallthrough (no known write/destructive verb involved). */
  blockedOnlyByUnknown: number;
  /** Unknown-classified tool names ranked by how many blocked-only sessions they appear in (desc, ties alphabetical). */
  topBlockers: Array<{ tool: string; sessions: number }>;
}

/** True iff this session would be fully read-only were its unknown-verb tools classified `read` — every non-read call is an unknown fallthrough, no KNOWN write/destructive verb anywhere. */
function isBlockedOnlyByUnknown(s: ReplayableRateInput): boolean {
  return (
    s.replayableCount > 0 &&
    !s.readOnly &&
    s.effects["idempotent-write"] === 0 &&
    s.effects.destructive > 0 &&
    s.effects.destructive === s.unknownCount
  );
}

export function replayableRateStats(sessions: ReplayableRateInput[]): ReplayableRateStats {
  const replayable = sessions.filter((s) => s.replayableCount > 0);
  const readOnly = replayable.filter((s) => s.readOnly);
  const blocked = replayable.filter(isBlockedOnlyByUnknown);

  const counts = new Map<string, number>();
  for (const s of blocked) {
    for (const tool of new Set(s.unknownTools)) {
      counts.set(tool, (counts.get(tool) ?? 0) + 1);
    }
  }
  const topBlockers = [...counts.entries()]
    .map(([tool, sessions]) => ({ tool, sessions }))
    .sort((a, b) => b.sessions - a.sessions || a.tool.localeCompare(b.tool));

  return {
    replayableSessions: replayable.length,
    readOnlySessions: readOnly.length,
    readOnlyPct: replayable.length === 0 ? 0 : Math.round((readOnly.length / replayable.length) * 1000) / 10,
    blockedOnlyByUnknown: blocked.length,
    topBlockers,
  };
}

/** Render the KPI stat block as printable lines (`reelier scan` output). */
export function formatReplayableRate(stats: ReplayableRateStats, topN = 5): string[] {
  const lines = [
    `Replayable rate: ${stats.readOnlySessions}/${stats.replayableSessions} sessions fully read-only (${stats.readOnlyPct}%).`,
  ];
  if (stats.blockedOnlyByUnknown > 0) {
    const top = stats.topBlockers
      .slice(0, topN)
      .map((b) => `${b.tool} ×${b.sessions}`)
      .join(", ");
    lines.push(
      `${stats.blockedOnlyByUnknown} session(s) blocked ONLY by unknown-verb tools (top blockers: ${top}) — ` +
        `these are the verbs to consider classifying next (effect-verbs.ts).`
    );
  } else {
    lines.push(`0 sessions blocked only by unknown-verb tools.`);
  }
  return lines;
}
