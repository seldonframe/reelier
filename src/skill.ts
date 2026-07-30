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
  /**
   * Hash-bound write approval (docs/specs/flight-recorder-v2.md §2), stamped
   * by `reelier approve` (src/cli.ts). Absent = legacy/unapproved step — the
   * runner falls back to the `--allow-writes`/`--yes` flags for it. Present
   * = the runner recomputes `computeApprovalHash` (src/approval.ts) and
   * refuses to execute (no flag override) if it doesn't match verbatim.
   */
  approve?: string;
  /**
   * Declares the paired read for `declared-probe` attestation: a read-only
   * call, run after this step's write, whose (optionally projected) result
   * is bound into the receipt as evidence the write took effect. Covered by
   * the approval hash (src/approval.ts) when present — see the security
   * rationale there.
   */
  attest?: StepAttestDecl;
  /**
   * State-conditioned approval binding (state-conditioned-approval P1):
   * a keyed commitment (`pre`, HMAC-SHA256 under a per-approval key that
   * NEVER enters this file or any record — only its `keyId` does) over the
   * approve-time observation of the step's declared probe (`attest:`),
   * plus the observation timestamp (`at`, informational — time is never an
   * input to the comparison). Machine-written by `reelier approve --probe`,
   * never by hand. Requires BOTH `attest:` and `approve:` on the same step
   * (invariant I-12) and is itself covered by the approval hash
   * (src/approval.ts) — hand-editing or deleting it is an approval
   * mismatch, refused at the final boundary.
   */
  expect?: StepExpect;
  /** 1-indexed line in the source file where this step's header starts. */
  line: number;
}

/** A step's declared paired read for `declared-probe` attestation (see `Step.attest`). */
export interface StepAttestDecl {
  tool: string;
  args: unknown;
  projection?: string[];
}

/** A step's state-conditioned approval binding (see `Step.expect`). */
export interface StepExpect {
  /** Approve-time observation timestamp (ISO-8601). Informational — never an input to the comparison. */
  at: string;
  /** Names which local keystore key computed `pre` — 16 hex, the signing keyId length convention. */
  keyId: string;
  /** The keyed commitment over the approve-time projected observation: `hmac-sha256:<64 hex>`. */
  pre: string;
}

/** One tool this skill's steps depend on, as recorded/stamped from a live downstream's advertised schema. */
export interface ManifestTool {
  name: string;
  server?: string;
  digest: string;
}

/**
 * Environment binding: proves at replay time that the tools a skill was
 * recorded/stamped against are still the tools present (schema-identical)
 * before step 1 runs. Spec: docs/specs/flight-recorder-v2.md §1.
 */
export interface SkillManifest {
  v: 1;
  tools: ManifestTool[];
}

export interface Skill {
  name: string;
  description: string;
  steps: Step[];
  /** Optional tool-schema manifest (docs/specs/flight-recorder-v2.md §1) — absent for skills predating this feature or never stamped. */
  manifest?: SkillManifest;
  /**
   * Raw body text preceding the first step header (title, "Inputs:" line,
   * "## Steps" heading, any prose/comments), preserved verbatim so
   * serializeSkill (src/writeback.ts) can round-trip a skill without
   * inventing or dropping human-authored content.
   */
  preamble: string;
  /**
   * Raw body text following the last step's field block (e.g. "## Open
   * questions", "## Changelog"), preserved verbatim for the same reason.
   */
  trailing: string;
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

/**
 * `today`, `today-Nd`, `today+Nd` are reserved for the runner's computed
 * date template vars (src/runner.ts) — resolved at fill time, never looked
 * up in a skill's own bindings. A skill that tries to `bind` one of these
 * names would silently shadow the computed value in a way that's confusing
 * to debug, so it's rejected loudly at parse time instead.
 */
function isReservedBindName(name: string): boolean {
  return name === "today" || /^today[+-]\d+d$/.test(name);
}

/**
 * Extract the would-be name from a (not-yet-validated) bind expression by
 * splitting on the first '='. This is deliberately looser than the real
 * bind-name identifier grammar (`evalBind` in src/assert.ts, which requires
 * `[a-zA-Z_][a-zA-Z0-9_]*`) — the reserved-name guard needs to catch
 * `today-7d = ...` too, even though that particular string would ALSO fail
 * `evalBind`'s own grammar check later as an ordinary bind name (it contains
 * a `-`, not a valid identifier character). Catching it here gives an
 * earlier, clearer "this name is reserved" error instead of the more
 * confusing generic "Unrecognized bind expression" it would otherwise hit
 * at run time.
 */
function extractBindNameForReservedCheck(bindText: string): string | undefined {
  const eqIdx = bindText.indexOf("=");
  if (eqIdx === -1) return undefined;
  return bindText.slice(0, eqIdx).trim();
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

const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;

/**
 * Validate the shape of a parsed `manifest:` frontmatter value. Thrown
 * errors are loud and specific (no Optimistic Path — a malformed manifest
 * must never silently degrade to "no manifest").
 */
function validateManifestShape(value: unknown): SkillManifest {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new SkillParseError("Malformed 'manifest' frontmatter (expected an object)");
  }
  const obj = value as Record<string, unknown>;
  if (obj.v !== 1) {
    throw new SkillParseError(`Malformed 'manifest' frontmatter: expected "v": 1, got ${JSON.stringify(obj.v)}`);
  }
  if (!Array.isArray(obj.tools)) {
    throw new SkillParseError("Malformed 'manifest' frontmatter: 'tools' must be an array");
  }
  const tools: ManifestTool[] = obj.tools.map((t, i) => {
    if (t === null || typeof t !== "object" || Array.isArray(t)) {
      throw new SkillParseError(`Malformed 'manifest' frontmatter: tools[${i}] must be an object`);
    }
    const tool = t as Record<string, unknown>;
    if (typeof tool.name !== "string" || tool.name === "") {
      throw new SkillParseError(`Malformed 'manifest' frontmatter: tools[${i}] is missing a string 'name'`);
    }
    if (typeof tool.digest !== "string" || !DIGEST_RE.test(tool.digest)) {
      throw new SkillParseError(
        `Malformed 'manifest' frontmatter: tools[${i}] ('${tool.name}') has an invalid 'digest' (expected sha256:<64 hex>)`
      );
    }
    if (tool.server !== undefined && typeof tool.server !== "string") {
      throw new SkillParseError(`Malformed 'manifest' frontmatter: tools[${i}] ('${tool.name}') has a non-string 'server'`);
    }
    const out: ManifestTool = { name: tool.name, digest: tool.digest };
    if (typeof tool.server === "string") out.server = tool.server;
    return out;
  });
  return { v: 1, tools };
}

/**
 * Validate the shape of a parsed `attest:` step-field value. Thrown errors
 * are loud and specific (no Optimistic Path — a malformed attest decl must
 * never silently degrade to "no attest").
 */
function validateAttestShape(value: unknown, ctx: { step: number; line: number }): StepAttestDecl {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new SkillParseError("Malformed 'attest' value (expected a JSON object)", ctx);
  }
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (key !== "tool" && key !== "args" && key !== "projection") {
      throw new SkillParseError(`Unknown 'attest' key ${JSON.stringify(key)} — expected tool/args/projection`, ctx);
    }
  }
  if (typeof obj.tool !== "string" || obj.tool.trim() === "") {
    throw new SkillParseError("'attest' is missing a non-empty string 'tool'", ctx);
  }
  if (!("args" in obj)) {
    throw new SkillParseError("'attest' is missing 'args'", ctx);
  }
  let projection: string[] | undefined;
  if (obj.projection !== undefined) {
    if (!Array.isArray(obj.projection) || obj.projection.length === 0 || obj.projection.some((p) => typeof p !== "string" || p.trim() === "")) {
      throw new SkillParseError("'attest.projection' must be a non-empty array of non-empty strings", ctx);
    }
    projection = obj.projection as string[];
  }
  return { tool: obj.tool, args: obj.args, ...(projection ? { projection } : {}) };
}

const EXPECT_PRE_RE = /^hmac-sha256:[0-9a-f]{64}$/;
const EXPECT_KEY_ID_RE = /^[0-9a-f]{16}$/;
// Shape-anchored, not just Date.parse: V8's Date.parse accepts plenty of
// non-ISO strings ("March 5, 2026", "2026/07/30", "0", padded input), so a
// bare parseability check would under-enforce the "ISO-8601" contract this
// field's own error message states. Shape first, then parseability.
const EXPECT_AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * Validate the shape of a parsed `expect:` step-field value. Thrown errors
 * are loud and specific (no Optimistic Path — a malformed expect binding
 * must never silently degrade to "no binding"). Mirrors validateAttestShape.
 */
function validateExpectShape(value: unknown, ctx: { step: number; line: number }): StepExpect {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new SkillParseError("Malformed 'expect' value (expected a JSON object)", ctx);
  }
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (key !== "at" && key !== "keyId" && key !== "pre") {
      throw new SkillParseError(`Unknown 'expect' key ${JSON.stringify(key)} — expected pre/keyId/at`, ctx);
    }
  }
  if (typeof obj.pre !== "string" || !EXPECT_PRE_RE.test(obj.pre)) {
    throw new SkillParseError(
      `Invalid 'expect.pre' ${JSON.stringify(obj.pre)} — expected hmac-sha256:<64 hex>`,
      ctx
    );
  }
  if (typeof obj.keyId !== "string" || !EXPECT_KEY_ID_RE.test(obj.keyId)) {
    throw new SkillParseError(
      `Invalid 'expect.keyId' ${JSON.stringify(obj.keyId)} — expected 16 lowercase hex chars`,
      ctx
    );
  }
  if (typeof obj.at !== "string" || !EXPECT_AT_RE.test(obj.at) || Number.isNaN(Date.parse(obj.at))) {
    throw new SkillParseError(
      `Invalid 'expect.at' ${JSON.stringify(obj.at)} — expected a non-empty ISO-8601 timestamp`,
      ctx
    );
  }
  return { at: obj.at, keyId: obj.keyId, pre: obj.pre };
}

/** Minimal frontmatter parser: flat `key: value` pairs (name, description, optional manifest). */
function parseFrontmatter(frontmatter: string): { name: string; description: string; manifest?: SkillManifest } {
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
  let manifest: SkillManifest | undefined;
  if (fields.manifest !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(fields.manifest);
    } catch (err) {
      throw new SkillParseError(`Malformed manifest frontmatter (not valid JSON): ${(err as Error).message}`);
    }
    manifest = validateManifestShape(parsed);
  }
  return { name: fields.name, description: fields.description, manifest };
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
  const { name, description, manifest } = parseFrontmatter(frontmatter);

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

  const preamble = bodyLines.slice(0, headerIdxs[0]).join("\n");

  const steps: Step[] = [];
  let expectedN = 1;
  let lastEndIdx = bodyLines.length;

  for (let h = 0; h < headerIdxs.length; h++) {
    const startIdx = headerIdxs[h];
    const nextBreak = allBreaks.find((idx) => idx > startIdx);
    const endIdx = nextBreak !== undefined ? nextBreak : bodyLines.length;
    lastEndIdx = endIdx;
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
    let approve: string | undefined;
    let attest: StepAttestDecl | undefined;
    let expect: StepExpect | undefined;
    let expectLine: number | undefined;

    for (let i = startIdx + 1; i < endIdx; i++) {
      const raw = bodyLines[i];
      const line = raw.trim();
      if (line === "") continue;
      const curLine = bodyStartLine + i;

      const bulletMatch = line.match(/^-\s*(intent|action|assert|bind|effect|approve|attest|expect)\s*:\s*(.*)$/);
      if (!bulletMatch) {
        // Ignore non-bullet prose lines within a step block (e.g. blank/comment text),
        // but reject anything that looks like an attempted bullet with a typo'd key.
        if (line.startsWith("-")) {
          throw new SkillParseError(
            `Unrecognized step field, expected one of intent/action/assert/bind/effect/approve/attest/expect: ${JSON.stringify(line)}`,
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
        case "bind": {
          const bindText = rest.trim();
          const candidateName = extractBindNameForReservedCheck(bindText);
          if (candidateName !== undefined && isReservedBindName(candidateName)) {
            throw new SkillParseError(
              `Bind name '${candidateName}' is reserved for the computed date template vars ({{today}}, {{today-Nd}}, {{today+Nd}}) and cannot be used as a bind name`,
              { step: n, line: curLine }
            );
          }
          binds.push(bindText);
          break;
        }
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
        case "approve":
          if (approve !== undefined) {
            throw new SkillParseError("Duplicate 'approve' field in step", { step: n, line: curLine });
          }
          {
            const value = rest.trim();
            if (!DIGEST_RE.test(value)) {
              throw new SkillParseError(
                `Invalid 'approve' value ${JSON.stringify(value)} — expected sha256:<64 hex>`,
                { step: n, line: curLine }
              );
            }
            approve = value;
          }
          break;
        case "attest": {
          if (attest !== undefined) {
            throw new SkillParseError("Duplicate 'attest' field in step", { step: n, line: curLine });
          }
          let parsedAttest: unknown;
          try {
            parsedAttest = JSON.parse(rest.trim());
          } catch (err) {
            throw new SkillParseError(`Attest value is not valid JSON: ${(err as Error).message}`, { step: n, line: curLine });
          }
          attest = validateAttestShape(parsedAttest, { step: n, line: curLine });
          break;
        }
        case "expect": {
          if (expect !== undefined) {
            throw new SkillParseError("Duplicate 'expect' field in step", { step: n, line: curLine });
          }
          let parsedExpect: unknown;
          try {
            parsedExpect = JSON.parse(rest.trim());
          } catch (err) {
            throw new SkillParseError(`Expect value is not valid JSON: ${(err as Error).message}`, { step: n, line: curLine });
          }
          expect = validateExpectShape(parsedExpect, { step: n, line: curLine });
          expectLine = curLine;
          break;
        }
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
    // Joint validation (state-conditioned-approval I-12): the only writer of
    // `expect:` (`reelier approve --probe`) always writes the attest/approve/
    // expect trio, so a lone `expect` can only be a hand edit — and there is
    // no probe to compare with (attest) and no approval to condition (approve)
    // without the other two. Rejected loudly, never silently ignored.
    if (expect !== undefined && (attest === undefined || approve === undefined)) {
      throw new SkillParseError("'expect' requires both 'attest:' and 'approve:' on the step", {
        step: n,
        line: expectLine ?? fileLine,
      });
    }
    // And never on a read step (S4 adversarial-review finding): the runner's
    // write gates — approval hash, state check, write receipt — all key off
    // the write effect, so `expect` on an `effect: read` step would be a
    // stamped binding NOTHING checks, silently rendering as a clean pass
    // (never-list #1). `approve --probe` only ever binds write steps; this
    // shape can only be a hand edit flipping the effect after binding.
    if (expect !== undefined && effect === "read") {
      throw new SkillParseError(
        "'expect' requires a write-effect step — a read step has no gated dispatch to condition (did the step's 'effect' change after it was state-bound?)",
        { step: n, line: expectLine ?? fileLine }
      );
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
      ...(approve !== undefined ? { approve } : {}),
      ...(attest !== undefined ? { attest } : {}),
      ...(expect !== undefined ? { expect } : {}),
      line: fileLine,
    });
  }

  const trailing = bodyLines.slice(lastEndIdx).join("\n");

  return manifest !== undefined
    ? { name, description, steps, manifest, preamble, trailing }
    : { name, description, steps, preamble, trailing };
}
