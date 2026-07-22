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
}

export function emptyPolicy(): Policy {
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
  const rawLines = source.split(/\r\n|\n/);
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

const KNOWN_TOP_KEYS = new Set(["version", "deny", "dry_run"]);
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
  return { errors: [], policy: { version, deny, dryRun } };
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
        if (matchGlob(rule.endpoint, host)) {
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
  | { ok: false; policy: Policy; sourcePath: string; error: string };

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
    } catch {
      continue; // not found (or unreadable) — try the next candidate, then fall through to "no policy"
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
// Human-facing summary — the 1-2 line banner `reelier mcp` prints on start.
// ---------------------------------------------------------------------------

export function summarizePolicyForWrapStart(result: PolicyLoadResult): string[] {
  if (!result.ok) {
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
  return [
    `[reelier] policy: ${denyCount} deny rule(s), ${dryRunCount} dry-run rule(s) loaded from ${result.sourcePath}`,
  ];
}
