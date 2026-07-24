// Property-based crash-resistance fuzzing for reelier's parsers/decoders.
//
// The invariant, per parser: for ARBITRARY (including malformed, adversarial,
// and unicode) input, the parser must either
//   (a) return a value, or
//   (b) throw its own DECLARED error type (SkillParseError, AssertParseError,
//       BindParseError) — never an uncaught TypeError/RangeError/stack
//       overflow/hang.
//
// For decoders with no declared error type (parseYamlSubset, parseVerifyPayload,
// buildTimeStampReq, canonicalJson/digestSha256), the fallback invariant is:
// it must at least throw a proper `Error` with a non-empty message — not an
// opaque "undefined is not a function" from an unguarded property access.
//
// Run counts are bounded (`FUZZ_RUNS` env var, default small) so this file
// stays fast inside the serialized `npm test` suite. `npm run test:fuzz`
// reruns the SAME assertions with a much higher run count for on-demand deep
// fuzzing (not wired into CI).
import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import { parseSkill, SkillParseError } from "../src/skill.js";
import { parseVerifyPayload } from "../src/verify.js";
import { evalAssert, evalBind, AssertParseError, BindParseError, type Observation } from "../src/assert.js";
import { canonicalJson, digestSha256 } from "../src/canonical-json.js";
import { parseYamlSubset } from "../src/policy.js";
import { buildTimeStampReq, imprintMatches } from "../src/tsa.js";

// Keep the serialized `npm test` run fast; `npm run test:fuzz` (FUZZ_RUNS env)
// reruns the same properties with a much higher count for deep, on-demand
// fuzzing. 200 is enough to reliably surface shape-level crashes in a parser
// this size within a couple hundred ms per property.
const NUM_RUNS = process.env.FUZZ_RUNS ? Number(process.env.FUZZ_RUNS) : 200;

// Determinism: an unseeded fast-check run picks a fresh random seed every
// process, so the exact same fuzz test can pass on one CI run and fail on
// the next (or pass on a PR and fail on main) — a flaky CI badge, not a real
// signal. Pin a fixed seed globally so every `npm test` run replays the
// IDENTICAL input sequence: a fuzz test then always passes or always fails,
// never flakes. Set FUZZ_RANDOM (any value) to explore fresh inputs instead —
// used by `npm run test:fuzz` for on-demand deep fuzzing, where finding NEW
// counterexamples is the point rather than reproducibility.
const FUZZ_SEED = 20260724;
fc.configureGlobal(
  process.env.FUZZ_RANDOM ? { seed: Date.now() } : { seed: FUZZ_SEED }
);

function obs(overrides: Partial<Observation> = {}): Observation {
  return { status: 200, headers: {}, body: "{}", ...overrides };
}

/** Assert that `fn()` either returns or throws ONLY `ErrorClass` — any other
 * thrown error (TypeError, RangeError, a stack overflow, etc.) is a real
 * crash bug and is rethrown so fast-check reports + shrinks the offending
 * input. */
function assertOnlyThrows<E extends new (...args: any[]) => Error>(fn: () => unknown, ErrorClass: E): void {
  try {
    fn();
  } catch (e) {
    if (!(e instanceof ErrorClass)) throw e;
  }
}

/** Fallback invariant for decoders with no declared error type: whatever is
 * thrown must be a proper `Error` with a non-empty message — never a raw
 * crash from an unguarded property access. */
function assertReturnsOrThrowsProperError(fn: () => unknown): void {
  try {
    fn();
  } catch (e) {
    assert.ok(e instanceof Error, `expected an Error instance, got ${String(e)}`);
    assert.ok((e as Error).message.length > 0, "thrown Error has an empty message");
  }
}

// ---------------------------------------------------------------------------
// src/skill.ts — parseSkill (SkillParseError)
// ---------------------------------------------------------------------------

test("fuzz: parseSkill never crashes on arbitrary unicode strings", () => {
  fc.assert(
    fc.property(fc.string(), (source) => {
      assertOnlyThrows(() => parseSkill(source), SkillParseError);
    }),
    { numRuns: NUM_RUNS }
  );
});

// Structured-but-broken markdown: a real frontmatter fence plus a grab-bag of
// step-shaped lines, so the fuzz explores deeper into the step/field state
// machine than pure fc.string() ever reaches on its own (most random strings
// never even get past "must start with '---'").
const skillFieldLineArb = fc.oneof(
  fc.constantFrom(
    "- intent: do something",
    "- action: http.get {}",
    "- action: http.get not-json",
    "- assert: status == 200",
    "- assert:",
    "- bind: x = json.a",
    "- bind: today = json.a",
    "- effect: read",
    "- effect: not-a-real-effect",
    "- approve: sha256:notvalidhex",
    "- typo: whatever",
    "-",
    "### Step 1 — dup",
    "### Step abc — bad number",
    "## Open questions",
    ""
  ),
  fc.string({ maxLength: 30 })
);

const brokenSkillMdArb = fc
  .array(skillFieldLineArb, { minLength: 0, maxLength: 12 })
  .map((lines) => `---\nname: x\ndescription: y\n---\n### Step 1 — t\n${lines.join("\n")}\n`);

test("fuzz: parseSkill never crashes on structured-but-broken step bodies", () => {
  fc.assert(
    fc.property(brokenSkillMdArb, (source) => {
      assertOnlyThrows(() => parseSkill(source), SkillParseError);
    }),
    { numRuns: NUM_RUNS }
  );
});

test("fuzz: parseSkill never crashes on frontmatter with a random 'manifest' JSON blob", () => {
  fc.assert(
    fc.property(fc.string({ maxLength: 60 }), (manifestRaw) => {
      const source = `---\nname: x\ndescription: y\nmanifest: ${manifestRaw.replace(/\r?\n/g, " ")}\n---\n### Step 1 — t\n- intent: i\n- action: t {}\n- effect: read\n`;
      assertOnlyThrows(() => parseSkill(source), SkillParseError);
    }),
    { numRuns: NUM_RUNS }
  );
});

// ---------------------------------------------------------------------------
// src/policy.ts — parseYamlSubset (no declared error type: raw `Error`)
// ---------------------------------------------------------------------------

test("fuzz: parseYamlSubset never crashes on arbitrary unicode strings", () => {
  fc.assert(
    fc.property(fc.string(), (source) => {
      assertReturnsOrThrowsProperError(() => parseYamlSubset(source));
    }),
    { numRuns: NUM_RUNS }
  );
});

const yamlishLineArb = fc.oneof(
  fc.constantFrom(
    "version: 1",
    "deny:",
    "  - tool: x",
    "  - endpoint: '*.stripe.com'",
    "    unless: --allow-writes",
    "  bad-indent: oops",
    "- no key here just a dash",
    "not-a-key-line !!!",
    "  key: value # comment",
    "key: 'unterminated",
    ""
  ),
  fc.string({ maxLength: 20 })
);

test("fuzz: parseYamlSubset never crashes on structured-but-broken YAML-subset text", () => {
  fc.assert(
    fc.property(fc.array(yamlishLineArb, { minLength: 0, maxLength: 15 }).map((l) => l.join("\n")), (source) => {
      assertReturnsOrThrowsProperError(() => parseYamlSubset(source));
    }),
    { numRuns: NUM_RUNS }
  );
});

// ---------------------------------------------------------------------------
// src/verify.ts — parseVerifyPayload (no declared error type: JSON.parse's
// native SyntaxError, or whatever parsed-value shape falls through)
// ---------------------------------------------------------------------------

test("fuzz: parseVerifyPayload never crashes on arbitrary unicode strings", () => {
  fc.assert(
    fc.property(fc.string(), (raw) => {
      assertReturnsOrThrowsProperError(() => parseVerifyPayload(raw));
    }),
    { numRuns: NUM_RUNS }
  );
});

test("fuzz: parseVerifyPayload never crashes on json-shaped-but-wrong payloads", () => {
  fc.assert(
    fc.property(fc.jsonValue(), (value) => {
      assertReturnsOrThrowsProperError(() => parseVerifyPayload(JSON.stringify(value)));
    }),
    { numRuns: NUM_RUNS }
  );
});

// A closer-to-real envelope shape, with fields renamed/missing/wrong-typed —
// exercises `isVerifyPayloadShape`'s "record" in value check plus whatever
// downstream code (evaluateUnalteredSincePushClaim/evaluateTimestampClaim)
// would eventually touch the resulting VerifyPayload.
const almostEnvelopeArb = fc.record(
  {
    record: fc.option(fc.jsonValue(), { nil: undefined }),
    signature: fc.option(
      fc.record(
        { alg: fc.option(fc.string(), { nil: undefined }), keyId: fc.option(fc.string(), { nil: undefined }), sig: fc.option(fc.string(), { nil: undefined }) },
        { requiredKeys: [] }
      ),
      { nil: undefined }
    ),
    timestamp: fc.option(
      fc.record({ tsa: fc.option(fc.string(), { nil: undefined }), token: fc.option(fc.string(), { nil: undefined }) }, { requiredKeys: [] }),
      { nil: undefined }
    ),
  },
  { requiredKeys: [] }
);

test("fuzz: parseVerifyPayload never crashes on near-miss envelope shapes", () => {
  fc.assert(
    fc.property(almostEnvelopeArb, (value) => {
      assertReturnsOrThrowsProperError(() => parseVerifyPayload(JSON.stringify(value)));
    }),
    { numRuns: NUM_RUNS }
  );
});

// ---------------------------------------------------------------------------
// src/assert.ts — evalAssert (AssertParseError) / evalBind (BindParseError)
// ---------------------------------------------------------------------------

test("fuzz: evalAssert never crashes on arbitrary expression strings", () => {
  fc.assert(
    fc.property(fc.string(), fc.string(), (line, body) => {
      assertOnlyThrows(() => evalAssert(line, obs({ body })), AssertParseError);
    }),
    { numRuns: NUM_RUNS }
  );
});

// Near-miss expressions: real keywords/operators recombined in broken ways,
// so the fuzz actually walks into each regex branch (json.<path>, matches
// /.../ , length, ==, etc.) instead of bouncing off the first `line.match`.
const assertKeywordArb = fc.constantFrom(
  "status",
  "==",
  "!=",
  ">=",
  "<=",
  ">",
  "<",
  "body",
  "contains",
  "not contains",
  "json.",
  "json.a.b.c",
  "is",
  "array",
  "matches",
  "/",
  "length",
  "0x1",
  "NaN",
  "{",
  "}",
  '"',
  "\\"
);
const brokenAssertLineArb = fc
  .array(assertKeywordArb, { minLength: 0, maxLength: 6 })
  .map((parts) => parts.join(" "));

test("fuzz: evalAssert never crashes on near-miss assert-grammar recombinations", () => {
  fc.assert(
    fc.property(brokenAssertLineArb, fc.string({ maxLength: 40 }), (line, body) => {
      assertOnlyThrows(() => evalAssert(line, obs({ body })), AssertParseError);
    }),
    { numRuns: NUM_RUNS }
  );
});

test("fuzz: evalBind never crashes on arbitrary expression strings", () => {
  fc.assert(
    fc.property(fc.string(), fc.string(), (line, body) => {
      assertOnlyThrows(() => evalBind(line, obs({ body })), BindParseError);
    }),
    { numRuns: NUM_RUNS }
  );
});

const bindKeywordArb = fc.constantFrom(
  "x",
  "=",
  "json.",
  "json.a.b",
  "body",
  "match",
  "/",
  "(",
  ")",
  "[",
  "today",
  "1abc",
  "_valid_name"
);
const brokenBindLineArb = fc.array(bindKeywordArb, { minLength: 0, maxLength: 6 }).map((parts) => parts.join(" "));

test("fuzz: evalBind never crashes on near-miss bind-grammar recombinations", () => {
  fc.assert(
    fc.property(brokenBindLineArb, fc.string({ maxLength: 40 }), (line, body) => {
      assertOnlyThrows(() => evalBind(line, obs({ body })), BindParseError);
    }),
    { numRuns: NUM_RUNS }
  );
});

// ---------------------------------------------------------------------------
// src/canonical-json.ts — canonicalJson / digestSha256 (no declared error
// type). Fuzzed with fc.anything(), including values well outside the
// module's documented JSON-value contract (bigint, functions — fast-check
// has no built-in Symbol arbitrary, so a constant Symbol is mixed in by
// hand) to see what happens outside that contract.
//
// This fuzzer originally caught digestSha256 throwing an OPAQUE, undeclared
// TypeError on non-JSON input (see .superpowers-fuzz/fuzz-report.md): for
// top-level undefined/functions/symbols canonicalJson returned `undefined`
// and crypto.update(undefined) crashed, and any BigInt anywhere made
// JSON.stringify throw. canonical-json.ts now REJECTS those explicitly with a
// clear, declared `canonicalJson: ...` TypeError. The two tests below pin both
// halves: no crash on JSON-safe input, an explicit typed rejection otherwise.
// ---------------------------------------------------------------------------

test("fuzz: canonicalJson/digestSha256 never crash with an improper (message-less) error on JSON-safe values", () => {
  fc.assert(
    fc.property(fc.anything(), (value) => {
      assertReturnsOrThrowsProperError(() => canonicalJson(value));
      assertReturnsOrThrowsProperError(() => digestSha256(value));
    }),
    { numRuns: NUM_RUNS }
  );
});

test("fuzz: canonicalJson/digestSha256 REJECT non-JSON values (bigint anywhere, top-level undefined/function/symbol) with a clear canonical-json TypeError — never an opaque crash", () => {
  // Every value here is outside the JSON contract and MUST be rejected
  // explicitly. This fuzzer originally found these throwing an opaque
  // TypeError from deep inside JSON.stringify / crypto.update; canonical-json.ts
  // now rejects them with a declared `canonicalJson: ...` message, and this
  // test pins that so the crash can't quietly return.
  const nonJsonArb = fc.oneof(
    fc.bigInt(),
    fc.constant(undefined),
    fc.constant(Symbol("fuzz")),
    fc.func(fc.integer()),
    fc.dictionary(fc.string(), fc.bigInt(), { minKeys: 1 }), // bigint nested in an object
    fc.array(fc.bigInt(), { minLength: 1 })                  // bigint nested in an array
  );
  fc.assert(
    fc.property(nonJsonArb, (value) => {
      for (const fn of [() => canonicalJson(value), () => digestSha256(value)]) {
        let threw: unknown;
        try {
          fn();
        } catch (e) {
          threw = e;
        }
        assert.ok(threw instanceof TypeError, "expected a TypeError rejection, got: " + String(threw));
        assert.match(
          (threw as Error).message,
          /canonicalJson:/,
          "expected the declared canonical-json rejection message, not an opaque crash"
        );
      }
    }),
    { numRuns: NUM_RUNS }
  );
});

// ---------------------------------------------------------------------------
// src/tsa.ts — buildTimeStampReq (no declared error type: raw `Error`) and
// imprintMatches (never throws by contract — returns false on any bad input).
// ---------------------------------------------------------------------------

test("fuzz: buildTimeStampReq never crashes on arbitrary digestHex strings", () => {
  fc.assert(
    fc.property(fc.string(), (digestHex) => {
      assertReturnsOrThrowsProperError(() => buildTimeStampReq(digestHex));
    }),
    { numRuns: NUM_RUNS }
  );
});

test("fuzz: imprintMatches never throws — always returns a boolean, even on garbage base64/hex", () => {
  fc.assert(
    fc.property(fc.string(), fc.string(), (tokenB64, digestHex) => {
      const result = imprintMatches(tokenB64, digestHex);
      return typeof result === "boolean";
    }),
    { numRuns: NUM_RUNS }
  );
});
