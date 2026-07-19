// `reelier scan` support — discover every agent session transcript under an
// agent-projects directory (default `~/.claude/projects`) and summarize
// which ones contain a replayable workflow (per session.ts's honesty
// filter), without writing anything. The CLI layer (src/cli.ts) turns the
// resulting list into an interactive "which should Reelier turn into a
// skill?" selection; this module is pure discovery + summarization so it's
// unit-testable against a fixture directory tree.

import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
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
}

/**
 * Discover and summarize every transcript under `rootDir`. Never throws on a
 * single unreadable/malformed file — that file is skipped from the results
 * (session.ts's own parser already tolerates malformed lines within a file;
 * this only guards the outer read failing entirely, e.g. permissions).
 */
export async function scanTranscripts(rootDir: string): Promise<ScannedSession[]> {
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
    results.push({ ...summary, project: path.basename(path.dirname(file)), mtimeMs });
  }

  results.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return results;
}
