// Argument provenance: is an outbound tool-argument value traceable to
// something that came back, or to input? Spec: docs/specs/argument-provenance-v1.md.
//
// This is `bind` inverted (spec §3). `bind` is declared and forward — the author
// names a dotpath and fillTemplate substitutes the result into a later step's
// args. This is undeclared and backward: nothing names the path, so an outbound
// value is looked up against the leaves of everything that already came back.
//
// SLICE 1 — pure functions only. Nothing here reads or writes a record, nothing
// wires into the runner or the wrap, and nothing here can change an outcome or
// an exit code (spec §2, rule 4). This is a recorder's arithmetic, not a gate.
//
// THE THREE STATES ARE NEUTRAL FACTS, NEVER VERDICTS (spec §2):
//   grounded   — found in a source this run holds, at a named coordinate
//   authored   — this run held a usable, COMPLETE source set and it is not in it
//   unresolved — neither could be established (the source set had a gap)
// `authored` is not an accusation. An agent legitimately authors values all day
// — a summary, a subject line, a generated slug. Ungrounded is not wrong.

import { digestSha256 } from "./canonical-json.js";
import {
  tagScalar,
  assertNoProtoKeyDeep,
  ABSENT_FIELDS_MAX,
  ABSENT_FIELD_NAME_MAX,
} from "./expect-mac.js";

/** The only value types provenance addresses. Containers are walked, never committed. */
export type Scalar = string | number | boolean;

/**
 * The CLOSED tier-2 list (spec §7.2). Every entry preserves the WHOLE value.
 *
 * Membership is boolean: there is no weight, no confidence and no score, so
 * there is no threshold, so there is nothing for never-list #3 to bite on. That
 * is the architectural answer to "the transformation tier is where false
 * confidence enters" — not a tuning answer.
 *
 * Adding an entry means editing `test/provenance.test.ts`'s verbatim pin, which
 * means saying why. Arithmetic, unit conversion, format re-derivation, field
 * splitting and substring extraction are excluded deliberately: each is a door
 * into content correctness / business rules, which are never ours (spec §1.1).
 */
export const NORMALIZATIONS = ["trim", "nfc", "ascii-case-fold", "numeric-string", "boolean-string"] as const;
export type Normalization = (typeof NORMALIZATIONS)[number];

/**
 * How a match was reached. `exact` covers identical type-tagged scalars AND the
 * one sanctioned stringification (spec §7.1 rule 2) — `fillTemplate` stringifies
 * every non-string binding at src/runner.ts:470, so refusing that comparison
 * would report `authored` on values Reelier itself converted.
 */
export type ProvVia = "exact" | "normalized";

/** Where a grounded value was found: an opaque source id plus the leaf path inside it. Names only, never values. */
export interface SourceCoordinate {
  source: string;
  at: string;
}

/**
 * The CLOSED source list (spec §5). Sources are things that came BACK, never
 * things that went OUT.
 *
 * A prior call's ARGUMENTS are deliberately not a kind. If an agent authors a
 * value in call 1 and reuses it in call 5, matching call 5 against call 1's args
 * would report `grounded` — laundering an authored value through Reelier's own
 * record and stamping it. That is exactly the shape of the production failure
 * where an agent read back a phone number it had written itself.
 */
export const SOURCE_KINDS = ["response", "var", "approved-literal", "computed-date"] as const;
export type ProvenanceSourceKind = (typeof SOURCE_KINDS)[number];

export interface ProvenanceSource {
  kind: ProvenanceSourceKind;
  /** Opaque caller-supplied identity — a call index, a step number, a var name. Appears verbatim in a coordinate. */
  id: string;
  /**
   * The already-parsed value. `undefined` means this source could not be
   * ADDRESSED at all (an unparseable body, a multi-block MCP result whose
   * concatenation does not parse — src/mcp-tool.ts:61-74). That is a gap, never
   * an absence: it establishes nothing about any field, exactly as
   * `projectionMisses` treats a body that did not parse.
   */
  value: unknown;
}

/**
 * The in-process index (spec §7.3): digest of a type-tagged scalar -> where it
 * was seen. The VALUES ARE NEVER RETAINED, which is what keeps a stateful wrap
 * from becoming a plaintext store of everything the agent read.
 *
 * [Normative, spec §7.3] Ephemeral. Never written to disk, never pushed, never
 * placed in a trace or a run record. An unsalted digest index over low-entropy
 * scalars is a confirmation oracle for exactly those scalars; it is acceptable
 * here ONLY because it never leaves the process that computed it.
 */
export interface SourceIndex {
  entries: Map<string, { from: SourceCoordinate; via: ProvVia }>;
  /** Ids of sources that could not be addressed. A non-empty list forbids claiming `authored` (spec §2). */
  gaps: string[];
}

export type LeafResolution =
  | { path: string; state: "grounded"; via: ProvVia; from: SourceCoordinate }
  | { path: string; state: "authored" }
  | { path: string; state: "unresolved"; reason: string };

export interface Leaf {
  path: string;
  value: Scalar;
}

function isScalar(v: unknown): v is Scalar {
  return typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

/**
 * Every scalar leaf of `value`, addressed by a path of object keys and array
 * indices under `prefix` (spec §6): `args.customer.phone`, `args.items[0].sku`.
 *
 * A FOURTH projection namespace with explicitly different rules — not an
 * extension of `body.`/`header.`/`status.code`, whose flat scalar selection is
 * pinned to `projectObservation` by drift tests. The fork here is sanctioned for
 * the ADDRESSING and nothing else: containers are walked rather than committed,
 * and `null`/absent contribute nothing rather than an entry.
 *
 * Paths are EMITTED, never authored — no operator writes one into a skill file
 * in v1, so no parser accepts one.
 */
export function enumerateScalarLeaves(value: unknown, prefix: string): Leaf[] {
  // An own `__proto__` anywhere would be silently dropped by canonicalJson's
  // rebuild, so a value carrying one could commit identically to a value without
  // it — A6's false-MATCH class, the one direction this must never produce.
  assertNoProtoKeyDeep(value, prefix, "provenance");
  const out: Leaf[] = [];
  walk(value, prefix, out);
  return out;
}

function walk(value: unknown, path: string, out: Leaf[]): void {
  if (isScalar(value)) {
    out.push({ path, value });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => walk(v, `${path}[${i}]`, out));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      walk(v, `${path}.${k}`, out);
    }
  }
  // null, undefined, functions, symbols: not addressed. A container with no
  // scalar leaves contributes nothing — never an "unknown" bucket.
}

/** The index key for one scalar. Type-tagged, so `1`, `"1"` and `true` are three different keys (A6). */
function keyFor(v: Scalar): string {
  return digestSha256(tagScalar(v));
}

/**
 * The tier-2 normal forms of one scalar — at most one per row of NORMALIZATIONS.
 *
 * ONE HOP ONLY. Each form applies exactly one normalization and they never
 * compose, so `" ACME "` does not reach `"acme"`. Chained normalization is where
 * a transformation quietly becomes a computation (spec §11 — single-hop by
 * design, against PACT's provenance chains), and over-reporting `authored` is
 * the safe direction while over-reporting `grounded` is not.
 */
function normalForms(v: Scalar): Scalar[] {
  const out: Scalar[] = [];
  if (typeof v !== "string") {
    // A number's/boolean's canonical string is tier 1 rule 2, indexed as `exact`
    // by buildSourceIndex — not repeated here as a normalization.
    return out;
  }
  const trimmed = v.trim();
  if (trimmed !== v) out.push(trimmed);
  const nfc = v.normalize("NFC");
  if (nfc !== v) out.push(nfc);
  // ASCII case folding, deliberately not toLowerCase(): Unicode case folding is
  // locale-sensitive and its edge cases (dotted/dotless i, final sigma) are
  // value-CHANGING in the languages that have them.
  const folded = v.replace(/[A-Z]/g, (c) => c.toLowerCase());
  if (folded !== v) out.push(folded);
  // numeric-string -> number, but only when the string is already the number's
  // canonical spelling. `"1.50"` and `" 1"` do not round-trip, so they are a
  // format difference, not a type difference, and stay unmatched.
  const asNumber = Number(v);
  if (v !== "" && Number.isFinite(asNumber) && JSON.stringify(asNumber) === v) out.push(asNumber);
  if (v === "true") out.push(true);
  if (v === "false") out.push(false);
  return out;
}

/** The address prefix a source's leaves are reported under. A response's leaves are body leaves. */
function prefixFor(kind: ProvenanceSourceKind): string {
  return kind === "response" ? "body" : kind;
}

/**
 * Index every scalar leaf of every source. Two passes so an `exact` key always
 * beats a `normalized` one for the same digest, and so the FIRST source to claim
 * a digest keeps it — both properties make the coordinate deterministic rather
 * than insertion-order-dependent.
 */
export function buildSourceIndex(sources: ProvenanceSource[]): SourceIndex {
  const entries = new Map<string, { from: SourceCoordinate; via: ProvVia }>();
  const gaps: string[] = [];
  const addressable: Array<{ src: ProvenanceSource; leaves: Leaf[] }> = [];

  for (const src of sources) {
    if (!(SOURCE_KINDS as readonly string[]).includes(src.kind)) {
      throw new Error(
        `provenance: unknown source kind ${JSON.stringify(src.kind)} — the source list is closed (spec §5.1). ` +
          `Sources are things that came back, never things that went out.`
      );
    }
    if (src.value === undefined) {
      gaps.push(src.id);
      continue;
    }
    addressable.push({ src, leaves: enumerateScalarLeaves(src.value, prefixFor(src.kind)) });
  }

  const put = (key: string, from: SourceCoordinate, via: ProvVia): void => {
    if (!entries.has(key)) entries.set(key, { from, via });
  };

  for (const { src, leaves } of addressable) {
    for (const leaf of leaves) {
      const from = { source: src.id, at: leaf.path };
      put(keyFor(leaf.value), from, "exact");
      // Tier 1 rule 2 (spec §7.1): the runner's own stringification.
      if (typeof leaf.value !== "string") put(keyFor(JSON.stringify(leaf.value)), from, "exact");
    }
  }
  for (const { src, leaves } of addressable) {
    for (const leaf of leaves) {
      const from = { source: src.id, at: leaf.path };
      for (const form of normalForms(leaf.value)) put(keyFor(form), from, "normalized");
    }
  }

  return { entries, gaps };
}

function lookup(value: Scalar, index: SourceIndex): { from: SourceCoordinate; via: ProvVia } | undefined {
  const direct = index.entries.get(keyFor(value));
  if (direct) return direct;
  for (const form of normalForms(value)) {
    const hit = index.entries.get(keyFor(form));
    // The reported tier is the WEAKER of the two sides: reaching an exact entry
    // through a normalized query is a normalized match.
    if (hit) return { from: hit.from, via: "normalized" };
  }
  return undefined;
}

export interface ResolveOptions {
  /**
   * Set when the source set is known to be incomplete for a reason the index
   * cannot see — outside a `reelier_start_recording` window there is no corpus
   * at all, and a bounded retention may have evicted one.
   *
   * [Normative, spec §4.2] `authored` MUST NOT be inferred from an emptiness
   * that was never established.
   */
  corpusGap?: string;
}

/**
 * Resolve every scalar leaf of an outbound argument object.
 *
 * One rule, stated once:
 *   hit                -> grounded  (always; a gap elsewhere cannot unfind a match)
 *   miss + no gaps     -> authored  (the absence was established)
 *   miss + any gap     -> unresolved (the absence was not established)
 */
export function resolveArgs(args: unknown, index: SourceIndex, options: ResolveOptions = {}): LeafResolution[] {
  const reasons = [
    ...index.gaps.map((id) => `source-unaddressable: ${id}`),
    ...(options.corpusGap ? [options.corpusGap] : []),
  ];
  const reason = reasons.join("; ");

  return enumerateScalarLeaves(args, "args").map((leaf): LeafResolution => {
    const hit = lookup(leaf.value, index);
    if (hit) return { path: leaf.path, state: "grounded", via: hit.via, from: hit.from };
    if (reason) return { path: leaf.path, state: "unresolved", reason };
    return { path: leaf.path, state: "authored" };
  });
}

/**
 * Bounded, hash-only source index for the live proxy.
 *
 * The index stops accepting leaves at `capacity`; it never evicts and never
 * retains source values. Once saturated, a miss is `unresolved` because the
 * corpus is no longer complete, while a retained hit remains `grounded`.
 */
export class LiveProvenanceIndex {
  readonly capacity: number;
  private readonly exact = new Map<string, SourceCoordinate>();
  private readonly normalized = new Map<string, SourceCoordinate>();
  private readonly gaps: string[] = [];
  private acceptedLeaves = 0;
  saturated = false;

  constructor(capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new Error(`provenance: live index capacity must be a positive safe integer, got ${capacity}`);
    }
    this.capacity = capacity;
  }

  get size(): number {
    return this.acceptedLeaves;
  }

  addGap(source: string): void {
    this.gaps.push(source);
  }

  addSource(source: string, value: unknown): void {
    for (const leaf of enumerateScalarLeaves(value, "body")) {
      if (this.acceptedLeaves >= this.capacity) {
        this.saturated = true;
        continue;
      }
      this.acceptedLeaves++;
      const from = { source, at: leaf.path };
      const exactKey = keyFor(leaf.value);
      if (!this.exact.has(exactKey)) this.exact.set(exactKey, from);
      if (typeof leaf.value !== "string") {
        const stringKey = keyFor(JSON.stringify(leaf.value));
        if (!this.exact.has(stringKey)) this.exact.set(stringKey, from);
      }
      for (const form of normalForms(leaf.value)) {
        const normalizedKey = keyFor(form);
        if (!this.normalized.has(normalizedKey)) this.normalized.set(normalizedKey, from);
      }
    }
  }

  resolve(args: unknown): LeafResolution[] {
    const reasons = [
      ...this.gaps.map((source) => `source-unaddressable: ${source}`),
      ...(this.saturated ? [`source-index-cap: ${this.capacity} leaves`] : []),
    ];
    const reason = reasons.join("; ");

    return enumerateScalarLeaves(args, "args").map((leaf): LeafResolution => {
      const exact = this.exact.get(keyFor(leaf.value));
      if (exact) return { path: leaf.path, state: "grounded", via: "exact", from: exact };
      const normalizedDirect = this.normalized.get(keyFor(leaf.value));
      if (normalizedDirect) {
        return { path: leaf.path, state: "grounded", via: "normalized", from: normalizedDirect };
      }
      for (const form of normalForms(leaf.value)) {
        const hit = this.exact.get(keyFor(form)) ?? this.normalized.get(keyFor(form));
        if (hit) return { path: leaf.path, state: "grounded", via: "normalized", from: hit };
      }
      return reason
        ? { path: leaf.path, state: "unresolved", reason }
        : { path: leaf.path, state: "authored" };
    });
  }
}

/** Parse the one JSON text block an MCP result must carry to be addressable. */
export function addressableMcpResultBody(body: unknown): unknown {
  if (body === null || typeof body !== "object") return undefined;
  const content = (body as { content?: unknown }).content;
  if (!Array.isArray(content) || content.length !== 1) return undefined;
  const item = content[0];
  if (item === null || typeof item !== "object") return undefined;
  const { type, text } = item as { type?: unknown; text?: unknown };
  if (type !== "text" || typeof text !== "string") return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * The shared render caps (spec §6), reusing `expect`'s single definition so a
 * wide argument object and a wide projection look the same to an operator.
 *
 * [Normative] A truncated list states how many it dropped. A truncated list
 * rendered as a complete one is the silent-cap failure run-shape-priors §8 bans.
 */
export function capNameList(names: string[]): { names: string[]; truncated?: number } {
  const clipped = names.map((n) => (n.length > ABSENT_FIELD_NAME_MAX ? n.slice(0, ABSENT_FIELD_NAME_MAX) : n));
  if (clipped.length <= ABSENT_FIELDS_MAX) return { names: clipped };
  return { names: clipped.slice(0, ABSENT_FIELDS_MAX), truncated: clipped.length - ABSENT_FIELDS_MAX };
}
