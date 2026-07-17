// Faithful Skill -> SKILL.md serializer, plus the escalation ladder's
// mandatory write-back: apply an LLM-proposed patch to the in-memory skill,
// serialize it, write the file, and append a changelog line. A heal that
// isn't persisted is a spec failure — but a write-back failure must never
// crash the run (the heal already worked in-memory for this run; only
// *persistence* failed, and that gets a loud stderr warning instead of a
// thrown error).

import { writeFile } from "node:fs/promises";
import type { Skill, Step } from "./skill.js";

/** Render a single step back into its "### Step N — Title" block form. Exported for reuse when building escalation prompts (src/escalate.ts) so the LLM sees the exact step-block text a human would edit. */
export function renderStepBlock(step: Step): string[] {
  const lines: string[] = [];
  lines.push(`### Step ${step.n} — ${step.title}`);
  lines.push(`- intent: ${step.intent}`);
  lines.push(`- action: ${step.actionTool} ${JSON.stringify(step.actionArgs)}`);
  for (const a of step.asserts) lines.push(`- assert: ${a}`);
  for (const b of step.binds) lines.push(`- bind: ${b}`);
  lines.push(`- effect: ${step.effect}`);
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
function appendChangelogLine(trailing: string, line: string): string {
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
  // over any trailing blank lines so the new line lands directly after the
  // last existing changelog bullet.
  while (insertAt > headingIdx + 1 && trailingLines[insertAt - 1].trim() === "") {
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
  await writeFile(opts.skillPath, rendered, "utf8");
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
