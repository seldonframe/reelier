import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalJson, digestSha256 } from "../src/canonical-json.js";

/**
 * Is `canonicalJson` RFC 8785 (JSON Canonicalization Scheme) compatible?
 *
 * An interoperability question, not a correctness one — nothing we ship today depends on the
 * answer. It matters because the receipt ecosystem forming around us canonicalizes with JCS:
 * Microsoft's Agent Governance Toolkit signs "Ed25519 signatures over RFC 8785 (JCS) canonical
 * payloads", and its cross-framework receipt proposal specifies "SHA-256 of RFC 8785 JCS canonical
 * form. Sorted keys, no whitespace, UTF-8." If our digest agrees byte for byte, a Reelier receipt
 * can be referenced and re-verified by anything in that ecosystem. If it does not, we sit outside
 * the ecosystem forming around the exact hole we fill.
 *
 * The claim, stated exactly: **for the value space Reelier actually hashes** — records built from
 * JSON parsed off the wire — `canonicalJson` emits the bytes JCS specifies. This is not a general
 * JCS implementation; the penultimate test documents inputs we deliberately refuse.
 *
 * Why it holds with no rewrite: JCS mandates (1) property sorting by UTF-16 code units, which is
 * exactly `Array.prototype.sort()` on strings; (2) number serialization per ECMAScript
 * `Number::toString`, exactly `JSON.stringify`; (3) no whitespace, `JSON.stringify`'s default;
 * (4) ECMAScript string escaping, likewise. Our implementation is a recursive key sort plus
 * `JSON.stringify` — the same four properties, arrived at independently.
 *
 * **If this suite goes red, do NOT "fix" canonicalJson.** Changing what we hash invalidates every
 * signature and timestamp ever issued and breaks the pinned wire-contract fixture. Record the
 * divergence in SPEC.md and treat JCS interop as a separate, explicitly versioned digest.
 *
 * No literal control character or astral character appears anywhere in this file. Every one is
 * built with `String.fromCodePoint`, because a raw control byte in a source file is at the mercy
 * of every tool that touches it — that cost this suite two false reds before it was written this
 * way.
 */

/** Build a string from code points, so no exotic byte ever lives in this source file. */
const cp = (...points: number[]): string => String.fromCodePoint(...points);

const NUL = cp(0x00);
const BACKSPACE = cp(0x08);
const TAB = cp(0x09);
const LF = cp(0x0a);
const FF = cp(0x0c);
const CR = cp(0x0d);
const US = cp(0x1f); // Unit Separator, the last C0 control
const PAD = cp(0x80); // U+0080, a C1 control
const O_UML = cp(0xf6); // ö
const A_UML = cp(0xe4); // ä
const REPLACEMENT = cp(0xfffd); // U+FFFD
const EURO = cp(0x20ac); // €
const EMOJI = cp(0x1f600); // grinning face — surrogate pair, high unit 0xD83D

test("JCS: keys are sorted, and sorting is by UTF-16 code unit", () => {
  assert.equal(canonicalJson({ b: 1, a: 2 }), '{"a":2,"b":1}');
  assert.equal(canonicalJson({ B: 1, a: 2 }), '{"B":1,"a":2}', "uppercase sorts before lowercase (0x42 < 0x61)");
  assert.equal(
    canonicalJson({ [A_UML]: 1, z: 2 }),
    `{"z":2,"${A_UML}":1}`,
    "z (0x7A) sorts before a-umlaut (0xE4)",
  );
  // Separates code-UNIT ordering from code-POINT ordering: an astral character is a surrogate
  // pair starting 0xD800-0xDBFF, so by code unit it sorts BELOW U+FFFD.
  assert.deepEqual(
    Object.keys(JSON.parse(canonicalJson({ [EMOJI]: 1, [REPLACEMENT]: 2 })) as Record<string, number>).map((k) =>
      k.charCodeAt(0),
    ),
    [0xd83d, 0xfffd],
    "astral (high surrogate 0xD83D) must sort before U+FFFD",
  );
});

test("JCS: sorting is recursive through nested objects", () => {
  assert.equal(canonicalJson({ b: { d: 1, c: 2 }, a: 3 }), '{"a":3,"b":{"c":2,"d":1}}');
});

test("JCS: array order is preserved, never sorted", () => {
  assert.equal(canonicalJson([3, 1, 2]), "[3,1,2]");
  assert.equal(canonicalJson({ a: [{ b: 1, a: 2 }] }), '{"a":[{"a":2,"b":1}]}', "objects inside arrays still sort");
});

test("JCS: no whitespace anywhere", () => {
  const out = canonicalJson({ a: 1, b: [1, 2], c: { d: null } });
  assert.equal(out, '{"a":1,"b":[1,2],"c":{"d":null}}');
  assert.ok(!/\s/.test(out), "canonical form must contain no whitespace");
});

test("JCS: numbers serialize per ECMAScript Number::toString", () => {
  const cases: [number, string][] = [
    [1, "1"],
    [1.0, "1"],
    [-0, "0"],
    [1e21, "1e+21"],
    [1e20, "100000000000000000000"],
    [1e-7, "1e-7"],
    [0.000001, "0.000001"],
    [Number.MAX_SAFE_INTEGER, "9007199254740991"],
    [333333333.33333329, "333333333.3333333"],
  ];
  for (const [input, expected] of cases) {
    assert.equal(canonicalJson(input), expected, `number ${String(input)}`);
  }
});

test("JCS: string escaping matches the ECMAScript short forms", () => {
  assert.equal(
    canonicalJson(BACKSPACE + TAB + LF + FF + CR + '"' + "\\"),
    '"\\b\\t\\n\\f\\r\\"\\\\"',
    "the seven two-character escapes",
  );
  assert.equal(canonicalJson(NUL), '"\\u0000"', "other C0 controls take the \\u00XX form");
  assert.equal(canonicalJson(US), '"\\u001f"', "lowercase hex, per ECMAScript");
  assert.equal(canonicalJson("/"), '"/"', "forward slash must NOT be escaped");
  assert.equal(canonicalJson(EURO + EMOJI), `"${EURO + EMOJI}"`, "non-ASCII stays literal UTF-8, never \\u-escaped");
});

test("JCS: literals", () => {
  assert.equal(canonicalJson(null), "null");
  assert.equal(canonicalJson(true), "true");
  assert.equal(canonicalJson(false), "false");
  assert.equal(canonicalJson({}), "{}");
  assert.equal(canonicalJson([]), "[]");
});

/**
 * THE ONE KNOWN DIVERGENCE, pinned rather than fixed.
 *
 * JavaScript objects hoist integer-like keys to the front and order them numerically, regardless
 * of insertion order. `sortValue` inserts keys in sorted order, and then `JSON.stringify` puts the
 * integer-like ones back at the front — silently undoing the sort for exactly those keys:
 *
 *   canonicalJson({b:1, "2":2, a:3, "10":4})  ->  {"2":2,"10":4,"a":3,"b":1}
 *   JCS requires                              ->  {"10":4,"2":2,"a":3,"b":1}
 *
 * ("10" sorts before "2" under JCS because ordering is lexicographic over code units; JS sorts
 * integer indices numerically, so it emits "2" first.)
 *
 * What this does NOT break: determinism. Every producer and every verifier hoists identically, so
 * the same logical object always yields the same digest — verified below. Every signature and
 * timestamp ever issued remains valid, which is precisely why this must not be "fixed": changing
 * what we hash would invalidate all of them and break the pinned wire-contract fixture.
 *
 * What it does mean: a Reelier digest is NOT byte-identical to a JCS digest for any object
 * carrying an integer-like key. Cross-ecosystem verification against a JCS implementation would
 * disagree on those records and only those. See SPEC.md §0.3.
 */
test("known divergence: integer-like keys are hoisted, unlike JCS", () => {
  assert.equal(
    canonicalJson({ b: 1, "2": 2, a: 3, "10": 4 }),
    '{"2":2,"10":4,"a":3,"b":1}',
    "pins today's behavior — if this changes, every existing signature is invalidated",
  );
});

test("the divergence does not cost determinism: same logical object, same digest", () => {
  assert.equal(
    digestSha256({ b: 1, "2": 2, a: 3 }),
    digestSha256({ "2": 2, a: 3, b: 1 }),
    "insertion order must never change the digest — this is the property signatures actually rest on",
  );
});

/**
 * RFC 8785 §3.2.3's mixed-script ordering sample, minus the integer-like key covered above. Every
 * remaining key orders exactly as JCS requires. If the rule were code-point rather than code-unit,
 * or locale-aware, this is the test that breaks.
 */
test("JCS: the RFC's mixed-script ordering sample (non-integer keys)", () => {
  const input: Record<string, string> = {
    [EURO]: "Euro Sign",
    [CR]: "Carriage Return",
    [EMOJI]: "Emoji",
    [PAD]: "Control",
    [O_UML]: "Latin Small Letter O With Diaeresis",
    a: "Latin Small Letter A",
  };
  // Asserted against the canonical STRING, never a re-parsed object: JSON.parse followed by
  // Object.keys() re-applies JavaScript's own property order and would destroy the very ordering
  // under test.
  //
  // Note CR takes the two-character escape while U+0080 does not — ECMAScript escapes only C0
  // controls (below 0x20), so this C1 control rides through as literal UTF-8. JCS agrees.
  const expected =
    '{"\\r":"Carriage Return",' +
    '"a":"Latin Small Letter A",' +
    `"${PAD}":"Control",` +
    `"${O_UML}":"Latin Small Letter O With Diaeresis",` +
    `"${EURO}":"Euro Sign",` +
    `"${EMOJI}":"Emoji"}`;

  assert.equal(
    canonicalJson(input),
    expected,
    "keys must order by UTF-16 code unit: CR < 'a' < U+0080 < o-umlaut < euro < high surrogate",
  );
});

/**
 * Where we deliberately differ, documented rather than hidden. None of these can arise from JSON
 * parsed off the wire, so they are not JCS violations for our value space — but a general
 * implementation would have to decide, and we decided to refuse loudly.
 */
test("JCS: non-JSON inputs are refused loudly, not silently coerced", () => {
  assert.throws(() => canonicalJson(1n as unknown as number), /BigInt/, "BigInt is rejected with a declared error");
  for (const bad of [undefined, () => {}, Symbol("x")]) {
    assert.throws(
      () => canonicalJson(bad as unknown),
      /canonicalJson/,
      `top-level ${String(bad)} must throw a declared error`,
    );
  }
});

test("JCS: undefined-valued keys are dropped, matching JSON's own object model", () => {
  assert.equal(canonicalJson({ a: 1, b: undefined }), '{"a":1}');
});
