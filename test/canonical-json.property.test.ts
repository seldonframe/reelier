// Property-based invariants over canonicalJson/digestSha256 — generates
// thousands of random inputs to pin the contract receipts depend on:
// determinism, key-order independence, digest format, idempotent
// re-canonicalization, and distinct-form-implies-distinct-digest.
import { test } from "node:test";
import fc from "fast-check";
import { canonicalJson, digestSha256 } from "../src/canonical-json.js";

const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;

// A JSON-object-shaped arbitrary with plain string keys (including unicode)
// so we can deep-shuffle key insertion order and compare.
const jsonPrimitive = fc.oneof(
  fc.boolean(),
  fc.integer(),
  fc.double({ noNaN: true }),
  fc.string(),
  fc.constant(null)
);

function jsonValueArb(maxDepth: number): fc.Arbitrary<unknown> {
  const { value } = fc.letrec((tie) => ({
    value: fc.oneof(
      { maxDepth },
      jsonPrimitive,
      fc.array(tie("value") as fc.Arbitrary<unknown>, { maxLength: 5 }),
      fc.dictionary(
        fc.string({ minLength: 0, maxLength: 8 }).map((s) => s || "k"),
        tie("value") as fc.Arbitrary<unknown>,
        { maxKeys: 6 }
      )
    ),
  }));
  return value as fc.Arbitrary<unknown>;
}

// Unicode-key-friendly object arbitrary, at least one level of nesting.
const unicodeKeyObjectArb = fc.dictionary(
  fc.oneof(
    fc.string({ minLength: 1, maxLength: 8 }),
    fc.constantFrom("é", "日本語", "🚀key", " space ", "")
  ).map((s) => s || "k"),
  jsonValueArb(2),
  // >=2 keys so a reversed-key shuffle is always a real reorder (a 1-key
  // object is a no-op shuffle that would pass trivially).
  { minKeys: 2, maxKeys: 8 }
);

/**
 * Deep-shuffle: returns a value with the SAME entries (recursively) as
 * `value` but with object keys re-inserted in a different order. Arrays
 * keep their element order (order is meaningful there); only plain-object
 * key insertion order is permuted, recursively into nested objects/arrays.
 */
function shuffleDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(shuffleDeep);
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).map(
      ([k, v]) => [k, shuffleDeep(v)] as const
    );
    // Reverse + rotate for a deterministic-but-different insertion order.
    // (A random shuffle would be fine too, but reverse guarantees a change
    // whenever there are >=2 keys, avoiding a same-order false negative.)
    const reversed = [...entries].reverse();
    const out: Record<string, unknown> = {};
    for (const [k, v] of reversed) out[k] = v;
    return out;
  }
  return value;
}

test("property: canonicalJson depends only on value — pure, no mutation, identity-independent", () => {
  fc.assert(
    fc.property(jsonValueArb(3), (x) => {
      // An independent object graph with the same value: catches any reliance
      // on object identity/memoization. And the input must not be mutated —
      // a serializer with side effects would corrupt the record it hashes.
      const clone = JSON.parse(JSON.stringify(x));
      const before = JSON.stringify(x);
      const out = canonicalJson(x);
      return out === canonicalJson(clone) && JSON.stringify(x) === before;
    })
  );
});

test("property: key-order independence produces the same canonical form and digest", () => {
  fc.assert(
    fc.property(unicodeKeyObjectArb, (obj) => {
      const shuffled = shuffleDeep(obj);
      return (
        canonicalJson(obj) === canonicalJson(shuffled) &&
        digestSha256(obj) === digestSha256(shuffled)
      );
    })
  );
});

test("property: digestSha256 always has the sha256:<64-hex> format", () => {
  fc.assert(
    fc.property(jsonValueArb(3), (x) => {
      return DIGEST_RE.test(digestSha256(x));
    })
  );
});

test("property: re-canonicalizing a JSON-round-tripped value is idempotent", () => {
  fc.assert(
    fc.property(fc.jsonValue(), (x) => {
      const once = canonicalJson(x);
      const roundTripped = JSON.parse(once);
      const twice = canonicalJson(roundTripped);
      return once === twice;
    })
  );
});

test("property: distinct canonical forms imply distinct digests", () => {
  fc.assert(
    fc.property(jsonValueArb(3), jsonValueArb(3), (a, b) => {
      fc.pre(canonicalJson(a) !== canonicalJson(b));
      return digestSha256(a) !== digestSha256(b);
    })
  );
});
