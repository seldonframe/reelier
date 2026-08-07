// Comparing an absolute directory path that WE produced (process.cwd()) against one the HOST
// wrote (a `projects` key in ~/.claude.json). Its own module because both consumers need it and
// neither should pull the other's import graph in: src/wrap.ts (which rewrites the matching
// project entry) and src/coverage.ts (which reports every project entry, matching or not).

/**
 * True when two absolute paths name the same directory.
 *
 * The `projects` keys in `~/.claude.json` are written by Claude Code, not by us, so they
 * routinely disagree with `process.cwd()` on cosmetics: separator style (`/` vs `\`) and
 * drive-letter/segment case on Windows. A raw `===` would miss the operator's own project and
 * leave install reporting "nothing to wrap" against a file that visibly has servers in it —
 * silent under-coverage, which is worse than a loud failure.
 *
 * Normalization is platform-conditional on purpose. On POSIX a backslash is a legal filename
 * character and paths are case-sensitive, so folding either there would make two genuinely
 * different directories compare equal — and a false match here means rewriting config for a
 * project the operator is not in.
 *
 * Honest limit: this is a lexical comparison. It does not resolve symlinks, `..` segments, or
 * 8.3 short names, so two paths that reach the same directory by different routes read as
 * different. That direction is the safe one — it under-matches (report, don't rewrite) rather
 * than over-matching.
 */
export function sameProjectDirectory(a: string, b: string): boolean {
  return normalizeProjectKey(a) === normalizeProjectKey(b);
}

function normalizeProjectKey(p: string): string {
  const unified = process.platform === "win32" ? p.replace(/\\/g, "/").toLowerCase() : p;
  // A trailing separator is cosmetic; a lone "/" is the root itself and is preserved.
  return unified.length > 1 ? unified.replace(/\/+$/, "") : unified;
}
