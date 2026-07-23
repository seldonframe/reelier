// Faithful Skill -> SKILL.md serializer, plus the escalation ladder's
// mandatory write-back: apply an LLM-proposed patch to the in-memory skill,
// serialize it, write the file, and append a changelog line. A heal that
// isn't persisted is a spec failure — but a write-back failure must never
// crash the run (the heal already worked in-memory for this run; only
// *persistence* failed, and that gets a loud stderr warning instead of a
// thrown error).

import { writeFile, rename, unlink } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import type { Skill, Step } from "./skill.js";
import { RECORDED_WITH_FOOTER_RE } from "./compile.js";
import { canonicalJson } from "./canonical-json.js";

// ---------------------------------------------------------------------------
// Atomic write-back: write-temp-then-rename so a torn/partial skill file is
// unrepresentable. Full inter-process locking (concurrent writers racing on
// the same skill file from two processes) is explicitly deferred to cloud
// execution — this only guarantees a single writer never leaves the file
// half-written if it crashes or the process is killed mid-write.
// ---------------------------------------------------------------------------

/** The subset of node:fs/promises this needs — injectable so tests can force the EEXIST/EPERM fallback branch without touching the real filesystem module. */
export interface AtomicWriteFsOps {
  writeFile: typeof writeFile;
  rename: typeof rename;
  unlink: typeof unlink;
}

const defaultAtomicWriteFsOps: AtomicWriteFsOps = { writeFile, rename, unlink };

/**
 * Write `content` to `filePath` via write-temp-then-rename: content is
 * written in full to a temp file in the same directory (`<filePath>.tmp-
 * <random>`), then renamed over the target. A reader can therefore only ever
 * see the old complete file or the new complete file, never a partial write.
 *
 * `fs.rename` renaming over an existing file already works on POSIX and on
 * modern Node/Windows (libuv's uv_fs_rename uses MoveFileExW with
 * MOVEFILE_REPLACE_EXISTING) — but as a defensive fallback for the case
 * where the target is locked or an older platform rejects the direct
 * rename, an EEXIST/EPERM from the first rename attempt is handled by
 * unlinking the target and retrying the rename once.
 *
 * The temp file is always cleaned up (success or failure) via `finally` —
 * it must never be left behind.
 */
export async function writeFileAtomic(
  filePath: string,
  content: string,
  fsOps: AtomicWriteFsOps = defaultAtomicWriteFsOps
): Promise<void> {
  const tempPath = `${filePath}.tmp-${randomBytes(6).toString("hex")}`;
  try {
    await fsOps.writeFile(tempPath, content, "utf8");
    try {
      await fsOps.rename(tempPath, filePath);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EEXIST" || code === "EPERM") {
        await fsOps.unlink(filePath).catch(() => {});
        await fsOps.rename(tempPath, filePath);
      } else {
        throw err;
      }
    }
  } finally {
    // No-op (ENOENT) on the success path, where the temp file no longer
    // exists under its own name because it was just renamed onto filePath.
    await fsOps.unlink(tempPath).catch(() => {});
  }
}

/** Render a single step back into its "### Step N — Title" block form. Exported for reuse when building escalation prompts (src/escalate.ts) so the LLM sees the exact step-block text a human would edit. */
export function renderStepBlock(step: Step): string[] {
  const lines: string[] = [];
  lines.push(`### Step ${step.n} — ${step.title}`);
  lines.push(`- intent: ${step.intent}`);
  lines.push(`- action: ${step.actionTool} ${JSON.stringify(step.actionArgs)}`);
  for (const a of step.asserts) lines.push(`- assert: ${a}`);
  for (const b of step.binds) lines.push(`- bind: ${b}`);
  lines.push(`- effect: ${step.effect}`);
  if (step.approve !== undefined) lines.push(`- approve: ${step.approve}`);
  lines.push("");
  return lines;
}

/**
 * Serialize a parsed Skill back into SKILL.md source. Round-trips through
 * parseSkill: preamble/trailing content (title, "Inputs:" line, "## Open
 * questions", "## Changelog", etc.) is preserved verbatim from the parse;
 * only step blocks are re-rendered canonically, which is stable under
 * repeated serialize->parse->serialize (idempotent), even where it isn't a
 * byte-for-byte copy of hand-formatted input (e.g. JSON.stringify spacing
 * on the action line).
 */
export function serializeSkill(skill: Skill): string {
  const lines: string[] = [];
  lines.push("---");
  lines.push(`name: ${skill.name}`);
  lines.push(`description: ${skill.description}`);
  if (skill.manifest) lines.push(`manifest: ${canonicalJson(skill.manifest)}`);
  lines.push("---");

  if (skill.preamble.length > 0) {
    lines.push(...skill.preamble.split(/\r\n|\n/));
  } else {
    lines.push("");
  }

  for (const step of skill.steps) {
    lines.push(...renderStepBlock(step));
  }

  if (skill.trailing.length > 0) {
    lines.push(...skill.trailing.split(/\r\n|\n/));
  }

  return lines.join("\n");
}

const CHANGELOG_HEADING_RE = /^##\s+Changelog\s*$/;
const SECTION_HEADING_RE = /^##(?!#)\s+/;

/**
 * Insert `line` under an existing "## Changelog" section in `trailing`
 * (appended after the existing bullets, before the next section or EOF), or
 * create the section (appended to the end of `trailing`) if absent.
 */
/** Exported so callers outside the escalation write-back path (e.g. `reelier approve`, src/cli.ts) can append a changelog bullet using the exact same insertion rule. */
export function appendChangelogLine(trailing: string, line: string): string {
  const trailingLines = trailing.length > 0 ? trailing.split(/\r\n|\n/) : [];
  const headingIdx = trailingLines.findIndex((l) => CHANGELOG_HEADING_RE.test(l.trim()));

  if (headingIdx === -1) {
    const out = trailingLines.slice();
    if (out.length > 0 && out[out.length - 1].trim() !== "") out.push("");
    out.push("## Changelog", "", line, "");
    return out.join("\n");
  }

  let insertAt = trailingLines.length;
  for (let i = headingIdx + 1; i < trailingLines.length; i++) {
    if (SECTION_HEADING_RE.test(trailingLines[i].trim())) {
      insertAt = i;
      break;
    }
  }
  // Insert right before the next section heading (or EOF), skipping back
  // over any trailing blank lines AND a trailing renderSkillMd provenance
  // footer line (there's no "## " section heading between the changelog and
  // that footer, so without this the footer would sit ABOVE the loop's
  // insertAt and every heal bullet would land after it — the footer must
  // stay the file's true last line, and new bullets belong at the end of
  // the changelog list, above it).
  while (
    insertAt > headingIdx + 1 &&
    (trailingLines[insertAt - 1].trim() === "" || RECORDED_WITH_FOOTER_RE.test(trailingLines[insertAt - 1].trim()))
  ) {
    insertAt--;
  }
  const out = trailingLines.slice(0, insertAt);
  out.push(line);
  out.push(...trailingLines.slice(insertAt));
  return out.join("\n");
}

function isoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/** One line, truncated defensively — a changelog entry should never wrap the file into unreadable prose. */
function oneLine(text: string, maxLen = 300): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > maxLen ? `${flat.slice(0, maxLen)}…` : flat;
}

export interface WritebackPatch {
  asserts: string[];
  binds: string[];
  /** Only meaningful for a Level 2 heal — the re-derived action args. */
  args?: unknown;
}

export interface WritebackOptions {
  skillPath: string;
  skill: Skill;
  stepN: number;
  level: 1 | 2;
  patch: WritebackPatch;
  reason: string;
}

/**
 * Apply a successful escalation patch: mutate the in-memory step, serialize
 * the skill, write the file, append a changelog line. Mutates `skill`
 * in place (asserts/binds/actionArgs on the target step, plus trailing) so
 * later write-backs in the same run accumulate correctly.
 *
 * Throws only on a programmer error (unknown step number). Filesystem
 * failures are the caller's concern — see `applyWritebackSafely` for the
 * non-crashing wrapper used by the runner.
 */
export async function applyWriteback(opts: WritebackOptions): Promise<void> {
  const step = opts.skill.steps.find((s) => s.n === opts.stepN);
  if (!step) {
    throw new Error(`Write-back target step ${opts.stepN} not found in skill '${opts.skill.name}'`);
  }
  step.asserts = opts.patch.asserts;
  step.binds = opts.patch.binds;
  if (opts.level === 2 && opts.patch.args !== undefined) {
    step.actionArgs = opts.patch.args;
  }

  const changelogLine = `- ${isoDate()} — L${opts.level} heal, step ${opts.stepN} (${step.title}): ${oneLine(
    opts.reason
  )}`;
  opts.skill.trailing = appendChangelogLine(opts.skill.trailing, changelogLine);

  const rendered = serializeSkill(opts.skill);
  await writeFileAtomic(opts.skillPath, rendered);
}

/**
 * Write-back is mandatory on a successful heal, but a persistence failure
 * (disk full, permission denied, ...) must never crash the run — the heal
 * already happened in-memory for this run. Warn loudly on stderr and return
 * so the caller can still record the run's (true) outcome.
 */
export async function applyWritebackSafely(opts: WritebackOptions): Promise<void> {
  try {
    await applyWriteback(opts);
  } catch (err) {
    console.error(
      `WARNING: Level ${opts.level} heal of step ${opts.stepN} succeeded for this run, but writing it back to ${
        opts.skillPath
      } failed — the same drift will escalate again on the next run: ${(err as Error).message}`
    );
  }
}
