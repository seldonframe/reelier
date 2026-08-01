// The seatbelt: `.reelier/policy.yml` (project) / `~/.reelier/policy.yml`
// (global fallback) — a human-declared deny-list + dry-run list enforced at
// the recorder's chokepoint (recorder.ts's buildProxyServer), not in the
// prompt where it can be talked out of. See docs/specs/flight-recorder-v1.md
// §1.
//
// Prime directive compliance (this module's entire design rests on it): the
// recorder must never break the agent. A malformed policy file at WRAP
// RUNTIME degrades to "deny nothing" (fail open for enforcement — never fail
// closed and brick every tool call), warns loudly exactly once, and leaves a
// gap marker in the trace meta record so a human sees enforcement was off.
// Strictness lives in `reelier policy check` (parsePolicyStrict below),
// which a human runs deliberately and which is allowed to be as picky as it
// wants — it never runs on the hot path.
//
// YAML: no dependency exists anywhere in this repo (package.json's only
// runtime dep is @modelcontextprotocol/sdk) and the config format needed is
// tiny — flat top-level scalars (`version: 1`) plus top-level lists of flat
// maps (`deny:`/`dry_run:`, each item a `{tool?, endpoint?, unless?}`
// record). Rather than pull in js-yaml for that, this file implements just
// that subset by hand, scoped deliberately narrow: no nested lists, no
// multi-line scalars, no anchors/aliases. If policy.yml ever needs more than
// this, that's the signal to reconsider a real YAML dependency — not to grow
// this parser ad hoc.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { stripMcpNamespacePrefix } from "./effect-verbs.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DenyRule {
  tool?: string;
  endpoint?: string;
  /** Only "--allow-writes" is wired to anything today — the one existing gate flag the spec names. */
  unless?: string;
}

export interface DryRunRule {
  tool?: string;
}

export interface Policy {
  version: number;
  deny: DenyRule[];
  dryRun: DryRunRule[];
  /**
   * State gate (wave2 §5.5, S8): "refuse" opts THIS repo into fail-closed
   * on the run path — a write step whose pre-state check lands mismatch or
   * unevaluated is refused before dispatch by `reelier run`. An explicit
   * per-repo opt-in, never a per-invocation flag (a flag is exactly the
   * "talked out of it" surface the policy file exists to prevent, I-10).
   * The WRAP runtime reads it only to name it in the banner — deny/dry_run
   * enforcement is the wrap's job, the gate is the run path's.
   */
  stateGate?: "refuse";
}

export function emptyPolicy(): Policy {
  // Deliberately gate-less: this is the wrap runtime's fail-safe for a
  // malformed file, and a malformed file cannot opt a repo in (A3). The
  // run path handles malformed-with-state_gate separately — by refusing
  // the run, never by synthesizing a policy.
  return { version: 1, deny: [], dryRun: [] };
}

const KNOWN_UNLESS_FLAGS = new Set(["--allow-writes"]);

// ---------------------------------------------------------------------------
// Tiny YAML subset parser
// ---------------------------------------------------------------------------

/** Strip a `#`-led comment that isn't inside a quoted string, then trim. */
function stripComment(line: string): string {
  let inQuote: '"' | "'" | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch === inQuote) inQuote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuote = ch;
      continue;
    }
    if (ch === "#") return line.slice(0, i);
  }
  return line;
}

function unquote(raw: string): string {
  const v = raw.trim();
  if (v.length >= 2 && ((v[0] === '"' && v[v.length - 1] === '"') || (v[0] === "'" && v[v.length - 1] === "'"))) {
    return v.slice(1, -1);
  }
  return v;
}

function indentOf(line: string): number {
  let n = 0;
  while (n < line.length && line[n] === " ") n++;
  return n;
}

/**
 * Parse the narrow YAML subset described at the top of this file into a
 * plain object: top-level scalar keys stay scalars (as raw unquoted
 * strings — the caller coerces types), top-level list keys become
 * `Record<string, string>[]`. Throws a descriptive Error on anything
 * outside the supported subset — never silently drops or misreads a line.
 */
export function parseYamlSubset(source: string): Record<string, unknown> {
  // A leading BOM is never meaningful YAML content, and rejecting the file
  // over it fails the WRAP open (enforcement disabled) and the GATE closed
  // (refuse-run) for a file every editor shows as correct — on the one
  // platform whose default shell redirect writes one (review finding).
  const rawLines = stripBom(source).split(/\r\n|\n/);
  const out: Record<string, unknown> = {};

  let currentListKey: string | null = null;
  let currentItem: Record<string, string> | null = null;

  for (let lineNo = 0; lineNo < rawLines.length; lineNo++) {
    const withComment = rawLines[lineNo];
    const line = stripComment(withComment);
    if (!line.trim()) continue;

    const indent = indentOf(line);
    const content = line.slice(indent);

    if (indent === 0) {
      // Top-level: either `key: value` (scalar) or `key:` (list header).
      const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(content);
      if (!m) {
        throw new Error(`line ${lineNo + 1}: expected "key: value" or "key:", got ${JSON.stringify(withComment)}`);
      }
      const [, key, rest] = m;
      currentListKey = null;
      currentItem = null;
      if (rest.trim() === "") {
        // List header — items follow as indented "- " lines.
        out[key] = [];
        currentListKey = key;
      } else {
        out[key] = unquote(rest);
      }
      continue;
    }

    // Indented line: must belong to the most recently opened list.
    if (!currentListKey) {
      throw new Error(`line ${lineNo + 1}: unexpected indentation (no open list above it): ${JSON.stringify(withComment)}`);
    }

    if (content.startsWith("- ") || content === "-") {
      // New list item. The remainder (if any) is its first "key: value".
      currentItem = {};
      (out[currentListKey] as Record<string, string>[]).push(currentItem);
      const itemContent = content === "-" ? "" : content.slice(2);
      if (itemContent.trim() === "") continue;
      const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(itemContent);
      if (!m) {
        throw new Error(`line ${lineNo + 1}: malformed list item, expected "- key: value": ${JSON.stringify(withComment)}`);
      }
      currentItem[m[1]] = unquote(m[2]);
      continue;
    }

    // A continuation "key: value" line for the current item (deeper-indented,
    // no leading "-").
    if (!currentItem) {
      throw new Error(`line ${lineNo + 1}: expected a "- " list item start: ${JSON.stringify(withComment)}`);
    }
    const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(content);
    if (!m) {
      throw new Error(`line ${lineNo + 1}: malformed continuation line: ${JSON.stringify(withComment)}`);
    }
    // Reject a repeated key within the SAME rule map rather than silently
    // letting the later occurrence win — a duplicate `tool:`/`unless:` in
    // one rule is almost always a typo'd third key, and last-wins would
    // hide whichever one the author actually meant.
    if (Object.prototype.hasOwnProperty.call(currentItem, m[1])) {
      throw new Error(`line ${lineNo + 1}: duplicate key "${m[1]}" within the same rule (list item)`);
    }
    currentItem[m[1]] = unquote(m[2]);
  }

  return out;
}

// ---------------------------------------------------------------------------
// Strict validation — used by `reelier policy check` AND as the single
// source of truth the lenient runtime loader wraps. Collects EVERY error
// found (not just the first) so a human fixing the file sees the whole
// picture in one pass.
// ---------------------------------------------------------------------------

const KNOWN_TOP_KEYS = new Set(["version", "deny", "dry_run", "state_gate"]);
const KNOWN_DENY_KEYS = new Set(["tool", "endpoint", "unless"]);
const KNOWN_DRY_RUN_KEYS = new Set(["tool"]);

export interface PolicyValidation {
  errors: string[];
  /** Present iff errors is empty. */
  policy?: Policy;
}

/** A glob is empty/whitespace-only — never a `*`-only pattern (matches everything intentionally is allowed) but never blank. */
function isBadGlob(value: string): boolean {
  return value.trim().length === 0;
}

export function validatePolicyObject(raw: Record<string, unknown>): PolicyValidation {
  const errors: string[] = [];

  for (const key of Object.keys(raw)) {
    if (!KNOWN_TOP_KEYS.has(key)) {
      errors.push(`unknown top-level key "${key}" (known keys: ${[...KNOWN_TOP_KEYS].join(", ")})`);
    }
  }

  let version = 1;
  if (raw.version !== undefined) {
    const parsed = Number(raw.version);
    if (!Number.isInteger(parsed)) {
      errors.push(`"version" must be an integer, got ${JSON.stringify(raw.version)}`);
    } else if (parsed !== 1) {
      errors.push(`"version: ${parsed}" is not supported — only version 1 exists today`);
    } else {
      version = parsed;
    }
  }

  // S8 (§5.5): the only supported mode is "refuse" — a closed enum, so a
  // typo'd or future value is a strict error here, which on the run path
  // means refuse-the-run (fail closed with the key present), never a
  // silently-off gate wearing an opt-in's clothes.
  let stateGate: "refuse" | undefined;
  if (raw.state_gate !== undefined) {
    if (raw.state_gate === "refuse") {
      stateGate = "refuse";
    } else {
      const shown = typeof raw.state_gate === "string" ? raw.state_gate : JSON.stringify(raw.state_gate);
      errors.push(
        `"state_gate: ${shown}" is not supported — the only mode is "refuse" (fail-closed on pre-state mismatch/unevaluated at run time); remove the key for recorder mode`
      );
    }
  }

  const deny: DenyRule[] = [];
  const rawDeny = raw.deny;
  if (rawDeny !== undefined) {
    if (!Array.isArray(rawDeny)) {
      errors.push(`"deny" must be a list of rules`);
    } else {
      rawDeny.forEach((item, i) => {
        const rule = item as Record<string, string>;
        for (const key of Object.keys(rule)) {
          if (!KNOWN_DENY_KEYS.has(key)) {
            errors.push(`deny[${i}]: unknown key "${key}" (known keys: ${[...KNOWN_DENY_KEYS].join(", ")})`);
          }
        }
        const hasTool = typeof rule.tool === "string" && rule.tool.length > 0;
        const hasEndpoint = typeof rule.endpoint === "string" && rule.endpoint.length > 0;
        if (!hasTool && !hasEndpoint) {
          errors.push(`deny[${i}]: empty rule — must set "tool" and/or "endpoint"`);
        }
        if (rule.tool !== undefined && isBadGlob(rule.tool)) {
          errors.push(`deny[${i}]: "tool" glob is empty`);
        }
        if (rule.endpoint !== undefined && isBadGlob(rule.endpoint)) {
          errors.push(`deny[${i}]: "endpoint" glob is empty`);
        }
        if (rule.unless !== undefined) {
          if (rule.unless.length === 0) {
            errors.push(`deny[${i}]: "unless" is empty`);
          } else if (!KNOWN_UNLESS_FLAGS.has(rule.unless)) {
            errors.push(
              `deny[${i}]: unknown "unless" flag "${rule.unless}" (only ${[...KNOWN_UNLESS_FLAGS].join(", ")} is supported)`
            );
          }
        }
        deny.push({
          ...(hasTool ? { tool: rule.tool } : {}),
          ...(hasEndpoint ? { endpoint: rule.endpoint } : {}),
          ...(rule.unless ? { unless: rule.unless } : {}),
        });
      });
    }
  }

  const dryRun: DryRunRule[] = [];
  const rawDryRun = raw.dry_run;
  if (rawDryRun !== undefined) {
    if (!Array.isArray(rawDryRun)) {
      errors.push(`"dry_run" must be a list of rules`);
    } else {
      rawDryRun.forEach((item, i) => {
        const rule = item as Record<string, string>;
        for (const key of Object.keys(rule)) {
          if (!KNOWN_DRY_RUN_KEYS.has(key)) {
            errors.push(`dry_run[${i}]: unknown key "${key}" (known keys: ${[...KNOWN_DRY_RUN_KEYS].join(", ")})`);
          }
        }
        const hasTool = typeof rule.tool === "string" && rule.tool.length > 0;
        if (!hasTool) {
          errors.push(`dry_run[${i}]: empty rule — must set "tool"`);
        } else if (isBadGlob(rule.tool)) {
          errors.push(`dry_run[${i}]: "tool" glob is empty`);
        } else {
          dryRun.push({ tool: rule.tool });
        }
      });
    }
  }

  if (errors.length > 0) return { errors };
  return { errors: [], policy: { version, deny, dryRun, ...(stateGate !== undefined ? { stateGate } : {}) } };
}

/**
 * Does the RAW policy text contain a top-level `state_gate` key? This is
 * the run path's strict-consequence scope (A3): only a file that textually
 * declares the key can make the run path fail closed — a malformed file
 * cannot opt a repo IN, so nothing without the key ever refuses a run.
 * Comment-stripped (a commented-out line is not intent); indent-0 only (a
 * nested occurrence is a list value, not a declaration); whitespace
 * tolerated before the colon — the subset parser rejects such a line, but
 * the intent is unmistakable, and the detector being MORE forgiving than
 * the parser errs in the only safe direction here: toward refusing the
 * run over a malformed opt-in, never toward silently ignoring one.
 */
export function detectStateGateKey(source: string): boolean {
  // A leading UTF-8 BOM must never hide a declared opt-in (review finding,
  // blocking): Windows PowerShell 5.1's `>` and Out-File write one by
  // default, so it is the LIKELIEST authoring path on this project's own
  // platform — and an undetected key means the gate silently fails open
  // against text a human plainly sees. Stripped for detection only; the
  // strict parser still rejects the BOM'd line, so a BOM'd opt-in resolves
  // to refuse-run (fail closed, loud) rather than off.
  for (const rawLine of stripBom(source).split(/\r\n|\n/)) {
    if (/^state_gate\s*:/.test(stripComment(rawLine))) return true;
  }
  return false;
}

/** Strip a leading UTF-8 BOM (U+FEFF) — node's readFile(utf8) preserves it. */
function stripBom(source: string): string {
  return source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
}

/**
 * Resolve the state gate for a `reelier run` (S8, §5.5). NEVER consulted by
 * the wrap runtime and reads nothing when no policy file exists — the
 * recorder path for non-opted-in repos is unchanged. First existing
 * candidate (project, then global) decides, whole-file — the same
 * precedence rule as loadPolicyForWrap, never a per-key merge across
 * files. Outcomes:
 *  - "refuse": valid opt-in — the caller threads it into the runner.
 *  - "refuse-run": the file DECLARES state_gate but fails strict parse —
 *    the caller must refuse the whole run before step 1 (fail closed;
 *    silently ignoring a declared operator intent is the one direction an
 *    opt-in gate must never fail).
 *  - "off": no file, no key, or (with `warning` set) a malformed file
 *    WITHOUT the key — fail open per the wrap doctrine, warned on stderr
 *    only: the warning line IS the gap marker on this path; the run
 *    record is never mutated for a repo that did not opt in (I-2).
 */
export type StateGateResolution =
  | { mode: "off"; warning?: string }
  | { mode: "refuse"; sourcePath: string }
  | { mode: "refuse-run"; sourcePath: string; errors: string[] };

export async function resolveStateGateForRun(cwd: string, homedir: string): Promise<StateGateResolution> {
  const { project, global } = policyPaths(cwd, homedir);
  for (const candidate of [project, global]) {
    let source: string;
    try {
      source = await readFile(candidate, "utf8");
    } catch (err) {
      // ENOENT is "no file here" — try the next candidate. ANY OTHER read
      // error means a file exists whose declared intent we cannot inspect
      // (EACCES, EISDIR, a Windows lock): skipping it silently would drop
      // a possible opt-in with no marker AND would let the global file
      // decide despite an existing project file, breaking the documented
      // first-existing-file rule. Fail loud instead — but not closed: the
      // key may well be absent, and refusing every run over an unreadable
      // keyless file would brick repos that never opted in (review
      // finding). The warning IS the gap marker on this path.
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      return {
        mode: "off",
        warning:
          `[reelier] policy: ${candidate} exists but could not be read (${(err as Error).message}) — ` +
          `state gate OFF and this file's declared intent is UNKNOWN (if it opts in with 'state_gate: refuse', that opt-in is NOT in effect). Fix the file's readability.`,
      };
    }
    if (detectStateGateKey(source)) {
      const validation = parsePolicyStrict(source);
      if (validation.errors.length > 0) {
        return { mode: "refuse-run", sourcePath: candidate, errors: validation.errors };
      }
      if (validation.policy!.stateGate === "refuse") {
        return { mode: "refuse", sourcePath: candidate };
      }
      // Unreachable today (a valid parse with the key present implies
      // "refuse" — every other value is a strict error). Kept explicit so
      // a future mode lands here as OFF, never as an accidental gate.
      return { mode: "off" };
    }
    const validation = parsePolicyStrict(source);
    if (validation.errors.length > 0) {
      return {
        mode: "off",
        warning:
          // "no top-level 'state_gate' key DETECTED" — never "contains
          // no key" (review finding): the detector cannot know what the
          // file contains, and asserting absence steers an operator whose
          // key is masked by an encoding quirk away from the real defect.
          `[reelier] policy: ${candidate} is malformed and no top-level 'state_gate' key was detected — state gate OFF ` +
          `(a malformed file cannot opt a repo in; enforcement gap). Run 'reelier policy check' to see every error.`,
      };
    }
    return { mode: "off" };
  }
  return { mode: "off" };
}

/** Parse + validate raw policy.yml text in one shot. A syntax error (bad subset) is reported as a single validation error, same bucket as a schema error — `policy check` doesn't need callers to distinguish the two. */
export function parsePolicyStrict(source: string): PolicyValidation {
  let raw: Record<string, unknown>;
  try {
    raw = parseYamlSubset(source);
  } catch (err) {
    return { errors: [(err as Error).message] };
  }
  return validatePolicyObject(raw);
}

// ---------------------------------------------------------------------------
// Glob matching — `*` wildcard only (no `?`, no character classes), matched
// case-insensitively (tool names and hostnames both have no meaningful case
// distinction for this purpose). Anchored full-string match.
// ---------------------------------------------------------------------------

export function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

export function matchGlob(glob: string, value: string): boolean {
  return globToRegExp(glob).test(value);
}

/**
 * Endpoint-rule glob matching: a leading `*.` is given host-or-subdomain
 * semantics rather than plain glob semantics — `"*.stripe.com"` matches
 * BOTH the apex `stripe.com` and any subdomain (`api.stripe.com`,
 * `checkout.stripe.com`). Plain `matchGlob`'s literal `*` would treat
 * `"*.stripe.com"` as "one or more characters, then .stripe.com", so the
 * apex itself (with no leading segment to fill the `*`) never matches —
 * a false negative on the single most common way someone writes this
 * rule. This asymmetry is deliberately ONE-directional: it only ever
 * matches MORE hosts than plain-glob semantics would, never fewer, so
 * widening it can't create a false sense of a call being blocked when it
 * wasn't. Any other endpoint glob shape (no leading `*.`, or `*` used
 * elsewhere) falls back to plain glob matching, unchanged. Tool-name
 * globs are NEVER routed through this function — only `endpoint:` rules.
 */
export function matchEndpointGlob(glob: string, host: string): boolean {
  const g = glob.toLowerCase();
  const h = host.toLowerCase();
  const apexMatch = /^\*\.([^*]+)$/.exec(g);
  if (apexMatch) {
    const apex = apexMatch[1];
    return h === apex || h.endsWith(`.${apex}`);
  }
  return matchGlob(glob, host);
}

// ---------------------------------------------------------------------------
// Endpoint extraction — deep-walk call args collecting every string value
// that parses as an absolute URL, so a deny rule can target a destination
// ("*.stripe.com") regardless of which arg field happens to carry it
// (url, endpoint, webhook, ...). Mirrors redact.ts's walk shape.
// ---------------------------------------------------------------------------

export function extractEndpointHosts(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (typeof value === "string") {
    try {
      const url = new URL(value);
      out.add(url.hostname.toLowerCase());
    } catch {
      // Not a URL — not an endpoint.
    }
  } else if (Array.isArray(value)) {
    for (const v of value) extractEndpointHosts(v, out);
  } else if (value !== null && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) extractEndpointHosts(v, out);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Evaluation — deny > dry_run > allow (spec §1 precedence).
// ---------------------------------------------------------------------------

export type PolicyVerdict =
  | { verdict: "allow" }
  | { verdict: "deny"; rule: DenyRule; description: string }
  | { verdict: "dry_run"; rule: DryRunRule; description: string };

export interface PolicyEvalContext {
  /** Set when the wrapping process was started with --allow-writes — the one escape flag `unless` recognizes today. */
  allowWrites: boolean;
}

function describeDenyRule(rule: DenyRule): string {
  const parts: string[] = [];
  if (rule.tool) parts.push(`tool:"${rule.tool}"`);
  if (rule.endpoint) parts.push(`endpoint:"${rule.endpoint}"`);
  return parts.join(" ");
}

export function evaluatePolicy(policy: Policy, toolName: string, args: unknown, ctx: PolicyEvalContext): PolicyVerdict {
  // Reuse the effect-ladder's collision-prefix stripping (composio__-style
  // namespacing) so a deny/dry_run glob matches regardless of which
  // downstream exposed the tool — but NOT the effect classifier's
  // dot-segment truncation, which would mangle a literal dotted tool name
  // like "gmail.send_email" into just "send_email" and make the spec's own
  // policy.yml example ("tool: gmail.send_email") unmatchable.
  const normalizedTool = stripMcpNamespacePrefix(toolName).toLowerCase();
  let hosts: Set<string> | undefined;

  for (const rule of policy.deny) {
    let matched = false;
    if (rule.tool && matchGlob(rule.tool, normalizedTool)) matched = true;
    if (!matched && rule.endpoint) {
      hosts ??= extractEndpointHosts(args);
      for (const host of hosts) {
        if (matchEndpointGlob(rule.endpoint, host)) {
          matched = true;
          break;
        }
      }
    }
    if (!matched) continue;
    if (rule.unless === "--allow-writes" && ctx.allowWrites) continue; // escaped — this rule doesn't apply
    return { verdict: "deny", rule, description: describeDenyRule(rule) };
  }

  for (const rule of policy.dryRun) {
    if (rule.tool && matchGlob(rule.tool, normalizedTool)) {
      return { verdict: "dry_run", rule, description: `tool:"${rule.tool}"` };
    }
  }

  return { verdict: "allow" };
}

// ---------------------------------------------------------------------------
// Resolution — project policy.yml overrides global; neither existing is not
// an error (no policy configured, everything allowed).
// ---------------------------------------------------------------------------

export function policyPaths(cwd: string, homedir: string): { project: string; global: string } {
  return {
    project: path.join(cwd, ".reelier", "policy.yml"),
    global: path.join(homedir, ".reelier", "policy.yml"),
  };
}

export type PolicyLoadResult =
  | { ok: true; policy: Policy; sourcePath: string | undefined }
  | { ok: false; policy: Policy; sourcePath: string; error: string; unreadable?: true };

/**
 * Load the active policy for a `reelier mcp` (wrap) run. NEVER throws —
 * this is the Prime Directive boundary: a missing file is simply "no
 * policy" (ok:true, sourcePath undefined); a present-but-malformed file
 * fails SAFE (ok:false, policy is the empty/deny-nothing policy) so the
 * agent is never bricked by a typo in a YAML file. The caller is
 * responsible for the "WARN loudly once" + trace gap marker — this
 * function only reports the fact, once, per call.
 */
export async function loadPolicyForWrap(cwd: string, homedir: string): Promise<PolicyLoadResult> {
  const { project, global } = policyPaths(cwd, homedir);

  for (const candidate of [project, global]) {
    let source: string;
    try {
      source = await readFile(candidate, "utf8");
    } catch (err) {
      // ENOENT is "no file here" — try the next candidate. ANY OTHER read
      // error means a file EXISTS whose rules we cannot inspect (EACCES,
      // EISDIR, a Windows lock). Skipping it silently would report a repo
      // that HAS a policy as one that has none ("none configured … all calls
      // pass through") AND would let the global file decide despite an
      // existing project file, breaking the documented first-existing-file
      // rule. Stop the traversal and report it instead — the exact fix
      // resolveStateGateForRun already carries (see its comment above);
      // this function never got it. Still fails SAFE, never closed: the
      // wrap starts with a deny-nothing policy so an unreadable file can
      // never brick the agent (Prime Directive), but the fact is now
      // reportable rather than invisible.
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      return {
        ok: false,
        unreadable: true,
        policy: emptyPolicy(),
        sourcePath: candidate,
        error: `${candidate} exists but could not be read (${(err as Error).message})`,
      };
    }
    const validation = parsePolicyStrict(source);
    if (validation.errors.length > 0) {
      return {
        ok: false,
        policy: emptyPolicy(),
        sourcePath: candidate,
        error: `${candidate} is malformed (${validation.errors.length} error(s)): ${validation.errors.join("; ")}`,
      };
    }
    return { ok: true, policy: validation.policy!, sourcePath: candidate };
  }

  return { ok: true, policy: emptyPolicy(), sourcePath: undefined };
}

// ---------------------------------------------------------------------------
// Endpoint-rule honesty note — printed by BOTH `reelier policy check` and
// the wrap-start banner whenever a loaded policy has any `endpoint` rules,
// so the URL-only limitation (see docs/specs/flight-recorder-v1.md §1) is
// never a silent gap between what the file promises and what the code does.
// ---------------------------------------------------------------------------

export const ENDPOINT_RULE_NOTE =
  "note: endpoint rules match literal URLs in tool arguments only — structured tools without URLs in " +
  "args are not covered; use tool rules for those.";

export function hasEndpointRules(policy: Policy): boolean {
  return policy.deny.some((r) => r.endpoint !== undefined);
}

// ---------------------------------------------------------------------------
// Human-facing summary — the 1-2 line banner `reelier mcp` prints on start.
// ---------------------------------------------------------------------------

export function summarizePolicyForWrapStart(result: PolicyLoadResult): string[] {
  if (!result.ok) {
    if (result.unreadable) {
      // A malformed file's rules are KNOWN and rejected; an unreadable
      // file's rules are UNKNOWN. Never conflate the two — telling an
      // operator to run 'policy check' on a file nothing can read sends
      // them at the wrong defect, and claiming the rules are invalid
      // asserts something we did not observe.
      return [
        `[reelier] policy: WARNING — ${result.error}`,
        `[reelier] policy: enforcement DISABLED for this session (fail-safe — deny-nothing) and this file's rules are UNKNOWN — no rule in it is in force. Fix the file's readability.`,
      ];
    }
    return [
      `[reelier] policy: WARNING — ${result.error}`,
      `[reelier] policy: enforcement DISABLED for this session (fail-safe — deny-nothing) until the file is fixed. Run 'reelier policy check' to see every error.`,
    ];
  }
  if (!result.sourcePath) {
    return [`[reelier] policy: none configured (.reelier/policy.yml or ~/.reelier/policy.yml) — all calls pass through.`];
  }
  const denyCount = result.policy.deny.length;
  const dryRunCount = result.policy.dryRun.length;
  const lines = [`[reelier] policy: ${denyCount} deny rule(s), ${dryRunCount} dry-run rule(s) loaded from ${result.sourcePath}`];
  if (hasEndpointRules(result.policy)) {
    lines.push(`[reelier] policy: ${ENDPOINT_RULE_NOTE}`);
  }
  if (result.policy.stateGate === "refuse") {
    // Name WHERE the gate is enforced — the wrap records and applies
    // deny/dry_run rules; the state gate acts in 'reelier run' at dispatch
    // time. Silence here would let an operator believe the wrap refuses.
    lines.push(
      `[reelier] policy: state_gate: refuse declared — enforced by 'reelier run' at dispatch time (the wrap itself never gates on pre-state).`
    );
  }
  return lines;
}

// ---------------------------------------------------------------------------
// N1 — unmatched-tool-rule detection. At wrap start, a deny/dry_run TOOL
// rule that matches NONE of the currently-wrapped tools is almost always a
// typo or a missed collision-rename prefix (mcp-client.ts's buildToolRoutes
// renames a colliding tool to `<downstreamIndex>_<name>`) — today that
// silently no-ops. Surfacing it costs nothing (it's read-only, computed
// once at wrap start) and the reviewer rated it the highest-value hardening
// item, so it always runs — never opt-in.
// ---------------------------------------------------------------------------

export interface UnmatchedToolRule {
  kind: "deny" | "dry_run";
  glob: string;
}

/** `availableToolNames` = the exposed (post collision-rename) tool names the proxy is actually routing — the SAME normalization used at match time (stripMcpNamespacePrefix, lowercased) is applied here so this never over-reports a rule as unmatched just because of namespacing. */
export function findUnmatchedToolRules(policy: Policy, availableToolNames: string[]): UnmatchedToolRule[] {
  const normalizedAvailable = availableToolNames.map((t) => stripMcpNamespacePrefix(t).toLowerCase());
  const unmatched: UnmatchedToolRule[] = [];
  for (const rule of policy.deny) {
    if (rule.tool && !normalizedAvailable.some((t) => matchGlob(rule.tool!, t))) {
      unmatched.push({ kind: "deny", glob: rule.tool });
    }
  }
  for (const rule of policy.dryRun) {
    if (rule.tool && !normalizedAvailable.some((t) => matchGlob(rule.tool!, t))) {
      unmatched.push({ kind: "dry_run", glob: rule.tool });
    }
  }
  return unmatched;
}

/** Formats the wrap-start warning line(s) for `findUnmatchedToolRules`' output — empty array when nothing is unmatched (no warning printed). Names up to 5 available tools so the human can spot a typo/missing-prefix at a glance without dumping the whole tool list. */
export function formatUnmatchedToolRuleWarnings(unmatched: UnmatchedToolRule[], availableToolNames: string[]): string[] {
  if (unmatched.length === 0) return [];
  const sample = availableToolNames.slice(0, 5);
  const available =
    sample.length > 0 ? `available: ${sample.join(", ")}${availableToolNames.length > 5 ? ", ..." : ""}` : "no tools wrapped";
  return unmatched.map(
    (u) =>
      `[reelier] policy: WARNING — ${u.kind} rule tool:"${u.glob}" matches none of the currently-wrapped tools (${available}) — check for a typo or a missing namespace/collision prefix.`
  );
}
