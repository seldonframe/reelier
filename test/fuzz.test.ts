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
// A second flavor lives at the bottom of the file: POSITIVE-SPACE properties
// for the wave-2 state-conditioned approval modules (expect grammar
// round-trip, expectMac determinism/non-collision, keystore round-trip) —
// same conventions, stronger invariants than "doesn't crash".
//
// Run counts are bounded (`FUZZ_RUNS` env var, default small) so this file
// stays fast inside the serialized `npm test` suite. `npm run test:fuzz`
// reruns the SAME assertions with a much higher run count for on-demand deep
// fuzzing (not wired into CI).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import fc from "fast-check";

import { parseSkill, SkillParseError } from "../src/skill.js";
import { parseVerifyPayload } from "../src/verify.js";
import { evalAssert, evalBind, AssertParseError, BindParseError, type Observation } from "../src/assert.js";
import { canonicalJson, digestSha256 } from "../src/canonical-json.js";
import { parseYamlSubset } from "../src/policy.js";
import { buildTimeStampReq, imprintMatches } from "../src/tsa.js";
import { serializeSkill } from "../src/writeback.js";
import {
  expectMac,
  projectObservationTyped,
  readKeystore,
  writeKeystoreEntry,
  loadExpectKey,
  type ExpectKeystoreEntry,
} from "../src/expect-mac.js";
import { projectObservation } from "../src/runner.js";

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

// ---------------------------------------------------------------------------
// Wave 2 state-conditioned approval (spec §2.1, §3.3–§3.4): positive-space
// properties, not crash resistance — round-trip stability of the expect
// grammar, expectMac determinism + type-tag non-collision (A6), the I-6 key
// guard's totality, and keystore write→read round-trip. Same NUM_RUNS /
// pinned-seed conventions as the properties above; `npm run test:fuzz`
// deep-runs these too.
// ---------------------------------------------------------------------------

const HEX_CHARS = "0123456789abcdef".split("");
const hexStringArb = (len: number) => fc.array(fc.constantFrom(...HEX_CHARS), { minLength: len, maxLength: len }).map((cs) => cs.join(""));

const expectPreArb = hexStringArb(64).map((h) => `hmac-sha256:${h}`);
const expectKeyIdArb = hexStringArb(16);

const pad = (n: number, w: number) => String(n).padStart(w, "0");

// `expect.at` values that satisfy the grammar's shape anchor AND Date.parse:
// toISOString() output (millis + Z), plus hand-built no-millis / long-fraction
// / ±HH:MM-offset forms the regex also admits. Day is capped at 28 so every
// generated calendar date is real (the validator also runs Date.parse).
const isoMillisZArb = fc
  .date({ min: new Date("1000-01-01T00:00:00Z"), max: new Date("9999-12-31T00:00:00Z"), noInvalidDate: true })
  .map((d) => d.toISOString());
const isoHandBuiltArb = fc
  .record({
    y: fc.integer({ min: 1000, max: 9999 }),
    mo: fc.integer({ min: 1, max: 12 }),
    d: fc.integer({ min: 1, max: 28 }),
    h: fc.integer({ min: 0, max: 23 }),
    mi: fc.integer({ min: 0, max: 59 }),
    s: fc.integer({ min: 0, max: 59 }),
    frac: fc.option(fc.array(fc.constantFrom(..."0123456789".split("")), { minLength: 1, maxLength: 6 }).map((ds) => ds.join("")), { nil: undefined }),
    tz: fc.oneof(
      fc.constant("Z"),
      fc
        .record({ sign: fc.constantFrom("+", "-"), oh: fc.integer({ min: 0, max: 13 }), om: fc.constantFrom(0, 15, 30, 45) })
        .map(({ sign, oh, om }) => `${sign}${pad(oh, 2)}:${pad(om, 2)}`)
    ),
  })
  .map(
    ({ y, mo, d, h, mi, s, frac, tz }) =>
      `${pad(y, 4)}-${pad(mo, 2)}-${pad(d, 2)}T${pad(h, 2)}:${pad(mi, 2)}:${pad(s, 2)}${frac !== undefined ? `.${frac}` : ""}${tz}`
  );

// fc.record yields null-prototype objects; rebuild as a plain literal so
// deepEqual against parseSkill's output compares values, not prototypes.
const stepExpectArb = fc
  .record({
    at: fc.oneof(isoMillisZArb, isoHandBuiltArb),
    keyId: expectKeyIdArb,
    pre: expectPreArb,
  })
  .map(({ at, keyId, pre }) => ({ at, keyId, pre }));

// All six key orders a hand-editor (or a foreign tool) could write the JSON in.
const expectKeyOrderArb = fc.constantFrom<Array<"at" | "keyId" | "pre">>(
  ["at", "keyId", "pre"],
  ["at", "pre", "keyId"],
  ["keyId", "at", "pre"],
  ["keyId", "pre", "at"],
  ["pre", "at", "keyId"],
  ["pre", "keyId", "at"]
);

const FUZZ_ATTEST = `- attest: {"tool":"gbrain.get_page","args":{"slug":"p"},"projection":["compiled_truth"]}`;
const FUZZ_APPROVE = `- approve: sha256:${"a".repeat(64)}`;

/** The expect-grammar test file's one-write-step skill, with the expect line's JSON rendered in an arbitrary key order. */
function skillWithExpect(value: { at: string; keyId: string; pre: string }, order: Array<"at" | "keyId" | "pre">): string {
  const json = `{${order.map((k) => `${JSON.stringify(k)}:${JSON.stringify(value[k])}`).join(",")}}`;
  return `---
name: t
description: d
---
## Steps

### Step 1 — write
- intent: i
- action: gbrain.put_page {"slug":"p","markdown":"# hi"}
${FUZZ_ATTEST}
${FUZZ_APPROVE}
- expect: ${json}
- effect: idempotent-write
`;
}

test("fuzz property: expect grammar round-trips — parse→serialize→parse identity for arbitrary valid expect values, any key order", () => {
  fc.assert(
    fc.property(stepExpectArb, expectKeyOrderArb, (value, order) => {
      const parsed = parseSkill(skillWithExpect(value, order));
      // Parse fidelity: the StepExpect is exactly the generated value,
      // regardless of the key order the JSON arrived in.
      assert.deepEqual(parsed.steps[0].expect, value);
      const rendered = serializeSkill(parsed);
      const reparsed = parseSkill(rendered);
      assert.deepEqual(reparsed.steps[0].expect, value);
      // Byte-stable idempotence: a second serialize changes nothing.
      assert.equal(serializeSkill(reparsed), rendered);
    }),
    { numRuns: NUM_RUNS }
  );
});

const expectKeyArb = fc.uint8Array({ minLength: 32, maxLength: 32 }).filter((k) => k.some((b) => b !== 0));
const probeArb = fc
  .oneof(fc.string({ minLength: 1, maxLength: 20 }), fc.constantFrom("gbrain.get_page", "日本語.probe", "é probe"))
  .filter((s) => s.trim() !== "");
// '__proto__' is refused by expectMac by design (A6) — every other field name
// is fair game, unicode included.
const projectedFieldArb = fc
  .oneof(fc.string({ maxLength: 12 }), fc.constantFrom("body.compiled_truth", "日本語", "é", " ", ""))
  .filter((s) => s !== "__proto__");
const projectedScalarArb = fc.oneof(
  fc.string({ maxLength: 20 }),
  fc.integer(),
  fc.double({ noNaN: true, noDefaultInfinity: true }),
  fc.boolean()
);
const projectedMapArb = fc.dictionary(projectedFieldArb, projectedScalarArb, { maxKeys: 6 });

test("fuzz property: expectMac is deterministic and insertion-order independent for arbitrary keys/probes/maps", () => {
  fc.assert(
    fc.property(expectKeyArb, probeArb, projectedMapArb, (key, probe, map) => {
      const mac1 = expectMac(key, probe, map);
      const reversed: Record<string, string | number | boolean> = {};
      for (const k of Object.keys(map).reverse()) reversed[k] = map[k];
      const mac2 = expectMac(key, probe, reversed);
      assert.equal(mac1, mac2);
      assert.match(mac1, /^hmac-sha256:[0-9a-f]{64}$/);
    }),
    { numRuns: NUM_RUNS }
  );
});

/**
 * The faithful cross-type twin of a scalar, when one exists: the value that a
 * type-collapsing MAC input (String(v)-style) would CONFLATE with `v`. Returns
 * undefined when no exact twin exists (e.g. a string that doesn't read back as
 * a number or boolean) — the property skips those.
 */
function crossTypeTwin(v: string | number | boolean): string | number | boolean | undefined {
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v === "true") return true;
  if (v === "false") return false;
  const n = Number(v);
  if (v.trim() !== "" && !Number.isNaN(n) && String(n) === v) return n;
  return undefined;
}

test("fuzz property: A6 non-collision — a value and its cross-type twin never share a MAC (number/string/bool variants stay distinct)", () => {
  fc.assert(
    fc.property(expectKeyArb, probeArb, projectedMapArb, fc.nat(), (key, probe, map, pick) => {
      const fields = Object.keys(map);
      fc.pre(fields.length > 0);
      const field = fields[pick % fields.length];
      const twin = crossTypeTwin(map[field]);
      fc.pre(twin !== undefined);
      const flipped = { ...map, [field]: twin! };
      assert.notEqual(
        expectMac(key, probe, map),
        expectMac(key, probe, flipped),
        `false MATCH across the type-tag boundary: ${JSON.stringify(map[field])} vs ${JSON.stringify(twin)}`
      );
    }),
    { numRuns: NUM_RUNS }
  );
});

test("fuzz property: a string value carrying a forged tag prefix never collides with the genuinely-typed value", () => {
  fc.assert(
    fc.property(
      expectKeyArb,
      probeArb,
      projectedFieldArb,
      fc.oneof(fc.integer(), fc.double({ noNaN: true, noDefaultInfinity: true }), fc.boolean()),
      (key, probe, field, v) => {
        const forged = typeof v === "number" ? `n:${String(v)}` : `b:${String(v)}`;
        assert.notEqual(expectMac(key, probe, { [field]: v }), expectMac(key, probe, { [field]: forged }));
      }
    ),
    { numRuns: NUM_RUNS }
  );
});

test("fuzz property: expectMac binds the probe tool — two different probe names never share a MAC", () => {
  fc.assert(
    fc.property(expectKeyArb, probeArb, probeArb, projectedMapArb, (key, p1, p2, map) => {
      fc.pre(p1 !== p2);
      assert.notEqual(expectMac(key, p1, map), expectMac(key, p2, map));
    }),
    { numRuns: NUM_RUNS }
  );
});

test("fuzz property: the I-6 guard is total — wrong-length or all-zero keys always throw, every usable key MACs", () => {
  fc.assert(
    fc.property(fc.uint8Array({ maxLength: 64 }), probeArb, projectedMapArb, (key, probe, map) => {
      if (key.length !== 32 || key.every((b) => b === 0)) {
        assert.throws(() => expectMac(key, probe, map), /I-6/);
      } else {
        assert.match(expectMac(key, probe, map), /^hmac-sha256:[0-9a-f]{64}$/);
      }
    }),
    { numRuns: NUM_RUNS }
  );
});

test("fuzz property: projectObservationTyped and projectObservation select identically on arbitrary JSON bodies (spec: one notion of state)", () => {
  fc.assert(
    fc.property(
      fc.dictionary(fc.string({ maxLength: 8 }), fc.jsonValue(), { maxKeys: 6 }),
      fc.array(fc.string({ maxLength: 8 }), { maxLength: 4 }),
      (obj, extraKeys) => {
        // Project a mix of keys that exist (any JSON type) and keys that don't.
        const projection = [...Object.keys(obj).slice(0, 3), ...extraKeys];
        const body = JSON.stringify(obj);
        const typed = projectObservationTyped(body, projection);
        const stringified = projectObservation({ status: 200, headers: {}, body }, projection);
        assert.deepEqual(
          Object.fromEntries(Object.entries(typed).map(([k, v]) => [k, String(v)])),
          stringified
        );
      }
    ),
    { numRuns: NUM_RUNS }
  );
});

// Real file I/O per case, so diversity (not volume) is what this one buys —
// capped so the deep `npm run test:fuzz` pass doesn't turn into a disk
// benchmark.
const KEYSTORE_RUNS = Math.min(NUM_RUNS, 200);

const keystoreEntryArb: fc.Arbitrary<ExpectKeystoreEntry> = fc
  .record({
    key: fc
      .uint8Array({ minLength: 32, maxLength: 32 })
      .filter((k) => k.some((b) => b !== 0))
      .map((k) => Buffer.from(k).toString("base64")),
    createdAt: fc.oneof(fc.string({ minLength: 1, maxLength: 30 }), fc.constantFrom("2026-07-30T00:00:00.000Z", "日本語", " ")),
    skill: fc.option(fc.string({ maxLength: 15 }), { nil: undefined }),
    // JSON-representable numbers only: NaN/±Infinity JSON.stringify to null,
    // which readKeystore would (correctly, loudly) refuse on the next read —
    // that write-side footgun is out of scope for a round-trip property.
    step: fc.option(
      fc.double({ noNaN: true, noDefaultInfinity: true }).map((v) => (Object.is(v, -0) ? 0 : v)),
      { nil: undefined }
    ),
  })
  .map(({ key, createdAt, skill, step }) => ({
    key,
    createdAt,
    ...(skill !== undefined ? { skill } : {}),
    ...(step !== undefined ? { step } : {}),
  }));

test("fuzz property: keystore write→read round-trips arbitrary valid entries (last write wins per keyId, no leftover temp/lock files)", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-fuzz-keys-"));
  let n = 0;
  try {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.tuple(expectKeyIdArb, keystoreEntryArb), { minLength: 1, maxLength: 4 }), async (entries) => {
        const base = `store-${n++}`;
        const file = path.join(dir, `${base}.json`);
        const expected: Record<string, ExpectKeystoreEntry> = {};
        for (const [keyId, entry] of entries) {
          await writeKeystoreEntry(file, keyId, entry);
          expected[keyId] = entry;
        }
        const store = await readKeystore(file);
        assert.deepEqual(store, { v: 1, keys: expected });
        for (const [keyId, entry] of Object.entries(expected)) {
          assert.equal(loadExpectKey(store, keyId)?.toString("base64"), entry.key);
        }
        // Revoked-or-never-present reads as undefined (spec C7) — pick a
        // keyId guaranteed absent from this run's generated set.
        const absent = ["f".repeat(16), "e".repeat(16)].find((k) => !(k in expected))!;
        assert.equal(loadExpectKey(store, absent), undefined);
        // Durability discipline (A10): no .lock/.tmp-*/.bak-* left behind.
        const leftovers = (await readdir(dir)).filter((f) => f.startsWith(`${base}.json.`));
        assert.deepEqual(leftovers, []);
      }),
      { numRuns: KEYSTORE_RUNS }
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
