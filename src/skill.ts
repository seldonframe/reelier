// Parser for the SKILL.md format: SKILL.md-standard-compatible frontmatter
// plus human-editable step blocks. Reject malformed skills loudly — never
// silently skip a step or field (no Optimistic Path).

export type Effect = "read" | "idempotent-write" | "destructive";

export interface Step {
  n: number;
  title: string;
  intent: string;
  actionTool: string;
  actionArgs: unknown; // JSON value, may contain {{var}} placeholders in strings
  asserts: string[];
  binds: string[];
  effect: Effect;
  /** 1-indexed line in the source file where this step's header starts. */
  line: number;
}

export interface Skill {
  name: string;
  description: string;
  steps: Step[];
}

export class SkillParseError extends Error {
  constructor(message: string, opts?: { step?: number; line?: number }) {
    const where = [
      opts?.step !== undefined ? `step ${opts.step}` : null,
      opts?.line !== undefined ? `line ${opts.line}` : null,
    ]
      .filter(Boolean)
      .join(", ");
    super(where ? `${message} (${where})` : message);
    this.name = "SkillParseError";
  }
}

const EFFECTS: readonly Effect[] = ["read", "idempotent-write", "destructive"];

function isEffect(value: string): value is Effect {
  return (EFFECTS as readonly string[]).includes(value);
}

/** Split a raw SKILL.md file into frontmatter + body, erroring on either being absent/malformed. */
function splitFrontmatter(source: string): { frontmatter: string; body: string; bodyStartLine: number } {
  const lines = source.split(/\r\n|\n/);
  if (lines[0]?.trim() !== "---") {
    throw new SkillParseError("SKILL.md must start with a '---' frontmatter fence", { line: 1 });
  }
  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      endIdx = i;
      break;
    }
  }
  if (endIdx === -1) {
    throw new SkillParseError("Frontmatter fence '---' was never closed", { line: 1 });
  }
  const frontmatter = lines.slice(1, endIdx).join("\n");
  const body = lines.slice(endIdx + 1).join("\n");
  return { frontmatter, body, bodyStartLine: endIdx + 2 };
}

/** Minimal frontmatter parser: flat `key: value` pairs only (name, description). */
function parseFrontmatter(frontmatter: string): { name: string; description: string } {
  const fields: Record<string, string> = {};
  const fmLines = frontmatter.split(/\r\n|\n/);
  for (const raw of fmLines) {
    const line = raw.trim();
    if (line === "") continue;
    const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)$/);
    if (!m) {
      throw new SkillParseError(`Malformed frontmatter line: ${JSON.stringify(raw)}`);
    }
    fields[m[1]] = m[2].trim();
  }
  if (!fields.name) {
    throw new SkillParseError("Frontmatter is missing required field 'name'");
  }
  if (!fields.description) {
    throw new SkillParseError("Frontmatter is missing required field 'description'");
  }
  return { name: fields.name, description: fields.description };
}

const STEP_HEADER_RE = /^###\s+Step\s+(\d+)\s*[—-]\s*(.+)$/;
/** A level-2 heading (e.g. "## Open questions", "## Changelog") — not a step header. Marks the end of the preceding step's field block. */
const SECTION_HEADER_RE = /^##(?!#)\s+/;

/** Parse the `action` line: `<tool> <json-args>`. */
function parseAction(rest: string, ctx: { step: number; line: number }): { tool: string; args: unknown } {
  const spaceIdx = rest.indexOf(" ");
  if (spaceIdx === -1) {
    throw new SkillParseError(
      `Malformed action line, expected '<tool> <json-args>', got: ${JSON.stringify(rest)}`,
      ctx
    );
  }
  const tool = rest.slice(0, spaceIdx).trim();
  const jsonText = rest.slice(spaceIdx + 1).trim();
  if (!tool) {
    throw new SkillParseError("Action line is missing a tool name", ctx);
  }
  let args: unknown;
  try {
    args = JSON.parse(jsonText);
  } catch (err) {
    throw new SkillParseError(
      `Action args are not valid JSON: ${(err as Error).message}`,
      ctx
    );
  }
  return { tool, args };
}

/**
 * Parse a full SKILL.md source string into a Skill.
 * Throws SkillParseError naming the step/line on any malformed input.
 */
export function parseSkill(source: string): Skill {
  const { frontmatter, body, bodyStartLine } = splitFrontmatter(source);
  const { name, description } = parseFrontmatter(frontmatter);

  const bodyLines = body.split(/\r\n|\n/);

  // Find step header line indices (0-indexed within bodyLines), and section
  // (non-step, level-2 "## ...") header indices — the latter close out a
  // step's field block early so trailing "## Open questions" / "## Changelog"
  // sections are never swallowed into the last step (and their prose/bullet
  // lines are simply ignored, never mistaken for step fields).
  const headerIdxs: number[] = [];
  const sectionIdxs: number[] = [];
  for (let i = 0; i < bodyLines.length; i++) {
    const trimmed = bodyLines[i].trim();
    if (STEP_HEADER_RE.test(trimmed)) {
      headerIdxs.push(i);
    } else if (SECTION_HEADER_RE.test(trimmed)) {
      sectionIdxs.push(i);
    }
  }

  if (headerIdxs.length === 0) {
    throw new SkillParseError("No '### Step N — Title' headers found in skill body");
  }

  const allBreaks = [...headerIdxs, ...sectionIdxs].sort((a, b) => a - b);

  const steps: Step[] = [];
  let expectedN = 1;

  for (let h = 0; h < headerIdxs.length; h++) {
    const startIdx = headerIdxs[h];
    const nextBreak = allBreaks.find((idx) => idx > startIdx);
    const endIdx = nextBreak !== undefined ? nextBreak : bodyLines.length;
    const headerLine = bodyLines[startIdx].trim();
    const fileLine = bodyStartLine + startIdx;

    const m = headerLine.match(STEP_HEADER_RE);
    if (!m) {
      // Unreachable given headerIdxs construction, but keep for safety.
      throw new SkillParseError(`Malformed step header: ${JSON.stringify(headerLine)}`, { line: fileLine });
    }
    const n = parseInt(m[1], 10);
    const title = m[2].trim();

    if (n !== expectedN) {
      throw new SkillParseError(
        `Expected step ${expectedN} but found step ${n} — steps must be numbered sequentially from 1`,
        { step: n, line: fileLine }
      );
    }
    expectedN++;

    let intent: string | undefined;
    let actionTool: string | undefined;
    let actionArgs: unknown;
    const asserts: string[] = [];
    const binds: string[] = [];
    let effect: Effect | undefined;

    for (let i = startIdx + 1; i < endIdx; i++) {
      const raw = bodyLines[i];
      const line = raw.trim();
      if (line === "") continue;
      const curLine = bodyStartLine + i;

      const bulletMatch = line.match(/^-\s*(intent|action|assert|bind|effect)\s*:\s*(.*)$/);
      if (!bulletMatch) {
        // Ignore non-bullet prose lines within a step block (e.g. blank/comment text),
        // but reject anything that looks like an attempted bullet with a typo'd key.
        if (line.startsWith("-")) {
          throw new SkillParseError(
            `Unrecognized step field, expected one of intent/action/assert/bind/effect: ${JSON.stringify(line)}`,
            { step: n, line: curLine }
          );
        }
        continue;
      }
      const [, key, rest] = bulletMatch;
      switch (key) {
        case "intent":
          if (intent !== undefined) {
            throw new SkillParseError("Duplicate 'intent' field in step", { step: n, line: curLine });
          }
          intent = rest.trim();
          break;
        case "action": {
          if (actionTool !== undefined) {
            throw new SkillParseError("Duplicate 'action' field in step", { step: n, line: curLine });
          }
          const parsed = parseAction(rest, { step: n, line: curLine });
          actionTool = parsed.tool;
          actionArgs = parsed.args;
          break;
        }
        case "assert":
          asserts.push(rest.trim());
          break;
        case "bind":
          binds.push(rest.trim());
          break;
        case "effect":
          if (effect !== undefined) {
            throw new SkillParseError("Duplicate 'effect' field in step", { step: n, line: curLine });
          }
          if (!isEffect(rest.trim())) {
            throw new SkillParseError(
              `Invalid effect ${JSON.stringify(rest.trim())} — must be one of ${EFFECTS.join(", ")}`,
              { step: n, line: curLine }
            );
          }
          effect = rest.trim() as Effect;
          break;
      }
    }

    if (!intent) {
      throw new SkillParseError("Step is missing required 'intent' field", { step: n, line: fileLine });
    }
    if (!actionTool) {
      throw new SkillParseError("Step is missing required 'action' field", { step: n, line: fileLine });
    }
    if (!effect) {
      throw new SkillParseError("Step is missing required 'effect' field", { step: n, line: fileLine });
    }

    steps.push({
      n,
      title,
      intent,
      actionTool,
      actionArgs,
      asserts,
      binds,
      effect,
      line: fileLine,
    });
  }

  return { name, description, steps };
}
