import type { Effect } from "./skill.js";

/**
 * Tool-name tokens recognized by the effect classifier below.
 *
 * Keep additions conservative: destructive tokens take precedence over
 * idempotent writes, which take precedence over reads. A false "read" is a
 * write that slips past replay's write gate; a false "destructive" only
 * costs coverage — when in doubt, leave a verb out.
 */
export const EFFECT_VERBS = {
  read: [
    "get",
    "list",
    "read",
    "search",
    "fetch",
    "query",
    "describe",
    "find",
    "check",
    "status",
    "show",
    "view",
    "lookup",
    "inspect",
    // 2026-07 empirical audit additions — each semantically unambiguous
    // read-only in English. Deliberately NOT added (write sense exists, or a
    // plausible unlisted-write-verb + noun combo would slip the gate):
    // resolve (resolve_incident), watch (watch = subscribe, a server-side
    // write), snapshot (take_snapshot CREATES one), meta (sync_meta/patch_meta),
    // context (append_context), navigate (can trigger arbitrary URLs).
    "count",
    "retrieve",
    "tail",
    "preview",
    "ping",
    "health",
    "browse",
    "glob",
    "grep",
    "stat",
    "stats",
    "head",
    "exists",
    "info",
    "summarize",
    "screenshot",
    "logs",
  ],
  "idempotent-write": [
    "create",
    "update",
    "set",
    "upsert",
    "put",
    "write",
    "save",
    "add",
    "modify",
    "move",
    "insert",
    "label",
    // 2026-07 empirical audit additions — writes, but set-state/put-like:
    // repeating them converges rather than compounds. "publish" stays
    // destructive (it broadcasts).
    "mark",
    "upload",
    "embed",
    "patch",
    "append",
    "sync",
  ],
  destructive: [
    "delete",
    "remove",
    "cancel",
    "refund",
    "pay",
    "send",
    "publish",
    "post",
    "charge",
    "drop",
    "destroy",
    "purge",
    "wipe",
    "forward",
    "reply",
    "execute",
    "run",
    "transfer",
    "approve",
    "revoke",
    "terminate",
    "kill",
    "grant",
    "deploy",
    "merge",
    "submit",
    "trash",
    "expire",
    "disable",
    "deactivate",
    "suspend",
    "reset",
    "overwrite",
    "replace",
    "truncate",
    // 2026-07 empirical audit additions — execution/process-control/outbound
    // verbs. Also close read-noun gate slips: "clear" guards clear_logs,
    // "rotate" guards rotate_logs/rotate_secret, "push" guards push_context.
    "spawn",
    "exec",
    "eval",
    "evaluate",
    "start",
    "stop",
    "clear",
    "push",
    "rotate",
    "finalize",
  ],
} as const satisfies Record<Effect, readonly string[]>;

// ---------------------------------------------------------------------------
// Effect classification (lives with its data so both the compiler and the
// MCP tool adapter share ONE classifier — they can never disagree).
// ---------------------------------------------------------------------------

const READ_VERBS = new Set<string>(EFFECT_VERBS.read);
const DESTRUCTIVE_VERBS = new Set<string>(EFFECT_VERBS.destructive);
const IDEMPOTENT_VERBS = new Set<string>(EFFECT_VERBS["idempotent-write"]);

/**
 * The three MCP `tools/list` annotation hints relevant to effect
 * classification. Hints, NOT security: they can tighten a classification or
 * refine an unrecognized verb, but replay's write gating (`--allow-writes`)
 * still applies to everything classified `idempotent-write` or worse, and no
 * hint can downgrade ANY verb-list match (see the trust ladder in
 * `classifyEffect`).
 */
export interface ToolEffectAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
}

/** Strip MCP-server namespace prefixes (double-underscore groups, e.g.
 *  `composio__`) so `composio__GMAIL_FETCH_EMAILS` classifies like
 *  `GMAIL_FETCH_EMAILS`. Dot namespaces keep their last segment as before. */
function normalizeToolName(tool: string): string {
  const lastSegment = tool.split(".").pop() ?? tool;
  return lastSegment.replace(/^(?:[A-Za-z0-9-]+__)+/, "");
}

/**
 * Token-based classification with a strict trust ladder (first match wins).
 * The invariant across every rung: an annotation may only make a
 * classification MORE restrictive, or refine an unrecognized verb — it can
 * never downgrade any verb-list match. A false "read" is a write that slips
 * past replay's write gate (see the header above), so a server's own
 * `readOnlyHint` carries no authority over a verb the lists recognize.
 *
 *  1. `destructiveHint: true` annotation → destructive, always.
 *  2. ANY destructive verb anywhere in the name → destructive. An annotation
 *     NEVER downgrades a destructive verb match (so `search_and_purge` can
 *     never classify read — position in the name carries no authority, and
 *     neither does a server's own `readOnlyHint`).
 *  3. Any idempotent-write verb → idempotent-write. A `readOnlyHint` cannot
 *     downgrade a verb-recognized write to read (`create_note` +
 *     `readOnlyHint: true` stays gated behind `--allow-writes`).
 *  4. Any read verb → read, unless `idempotentHint: true` tightens it to
 *     idempotent-write (a `readOnlyHint` merely agrees and outranks a
 *     contradictory `idempotentHint`).
 *  5. No verb recognized → hints refine the unknown: `readOnlyHint` → read,
 *     else `idempotentHint` → idempotent-write.
 *  6. Otherwise → destructive + review flag (`unknown: true`).
 *
 * Builtins (`http.get`/`http.post`) keep their fixed classification — they
 * never carry annotations, and `http.post`'s "post" token must not hit the
 * destructive list.
 */
export function classifyEffect(tool: string, annotations?: ToolEffectAnnotations): { effect: Effect; unknown: boolean } {
  // (1) A server declaring its own tool destructive is never overruled.
  if (annotations?.destructiveHint === true) return { effect: "destructive", unknown: false };

  if (tool === "http.get") return { effect: "read", unknown: false };
  if (tool === "http.post") return { effect: "idempotent-write", unknown: false };

  const tokens = normalizeToolName(tool).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  // (2) Destructive verb match — annotations below this line cannot downgrade it.
  if (tokens.some((t) => DESTRUCTIVE_VERBS.has(t))) return { effect: "destructive", unknown: false };
  // (3) Idempotent-write verb match — a readOnlyHint cannot downgrade it.
  if (tokens.some((t) => IDEMPOTENT_VERBS.has(t))) return { effect: "idempotent-write", unknown: false };
  // (4) Read verb match — an idempotentHint may tighten it, never the reverse.
  if (tokens.some((t) => READ_VERBS.has(t))) {
    if (annotations?.readOnlyHint !== true && annotations?.idempotentHint === true) {
      return { effect: "idempotent-write", unknown: false };
    }
    return { effect: "read", unknown: false };
  }
  // (5) No verb recognized — hints refine the unknown before default-deny.
  if (annotations?.readOnlyHint === true) return { effect: "read", unknown: false };
  if (annotations?.idempotentHint === true) return { effect: "idempotent-write", unknown: false };
  // (6) Unknown → destructive, flagged for human review.
  return { effect: "destructive", unknown: true };
}
