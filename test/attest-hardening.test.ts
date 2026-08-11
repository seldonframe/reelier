// Adversarial hardening for the state-attestation surface (Task 6, design doc
// "State Attestation P1"): seeded fuzz + property coverage on
// parseSkill's attest field, projectObservation/buildResponseDerivedAttest,
// computeApprovalHash, and the declared-probe confidence ladder.
//
// Determinism: fast-check is pinned to a fixed global seed (mirrors
// test/fuzz.test.ts's pattern) so every `npm test` run replays the IDENTICAL
// input sequence — a fuzz test here always passes or always fails, never
// flakes. node --test runs each compiled test file in its own process, so
// this file's fc.configureGlobal call is independent of fuzz.test.ts's.
import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import { parseSkill, SkillParseError } from "../src/skill.js";
import { runSkill, projectObservation, buildResponseDerivedAttest, ATTEST_BODY_FIELDS, ATTEST_HEADER_FIELDS } from "../src/runner.js";
import { computeApprovalHash } from "../src/approval.js";
import { digestSha256 } from "../src/canonical-json.js";
import type { Tool } from "../src/tools.js";
import type { Observation } from "../src/assert.js";
import { cmdApprove, type ParsedArgs } from "../src/cli.js";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const FUZZ_SEED = 20260728;
fc.configureGlobal(process.env.FUZZ_RANDOM ? { seed: Date.now() } : { seed: FUZZ_SEED });

function obsOf(body: unknown, headers: Record<string, string> = {}): Observation {
  return { status: 200, headers, body: typeof body === "string" ? body : JSON.stringify(body) };
}

// ---------------------------------------------------------------------------
// 1. Parser fuzz: ~500 seeded mutations of a valid `attest:` line.
// ---------------------------------------------------------------------------

const VALID_ATTEST_LINE =
  '- attest: {"tool":"http.get","args":{"url":"https://api.example.com/x/{{id}}"},"projection":["etag","updated_at"]}';

const SKILL_WITH_LINE = (line: string) => `---
name: t
description: d
---
## Steps

### Step 1 — write
- intent: i
- action: http.post {"url":"https://api.example.com/x","body":{"a":1}}
${line}
- effect: idempotent-write
`;

/** One mutation strategy per fast-check run: truncate, flip a bracket/quote,
 * splice in a unicode/control char, or inject nested-object noise — applied
 * at a random offset into the valid line. */
const mutationArb = fc.record({
  kind: fc.constantFrom("truncate", "bracketFlip", "unicodeInject", "nestedNoise", "charDrop", "charDup"),
  offset: fc.nat({ max: VALID_ATTEST_LINE.length - 1 }),
  unicodeChar: fc.oneof(
    fc.constantFrom("\u0000", "​", "😀", "‮", "\n", "\t", "\\", '"'),
    fc.string({ minLength: 1, maxLength: 3 })
  ),
  nestedNoise: fc.oneof(
    fc.constantFrom('{"a":{"b":{"c":[1,2,3]}}}', "[[[]]]", '{"__proto__":{"x":1}}', "null", "NaN", "undefined"),
    fc.jsonValue().map((v) => JSON.stringify(v))
  ),
});

type Mutation = {
  kind: "truncate" | "bracketFlip" | "unicodeInject" | "nestedNoise" | "charDrop" | "charDup";
  offset: number;
  unicodeChar: string;
  nestedNoise: string;
};

function applyMutation(m: Mutation): string {
  const { kind, offset, unicodeChar, nestedNoise } = m;
  const line = VALID_ATTEST_LINE;
  switch (kind) {
    case "truncate":
      return line.slice(0, offset);
    case "bracketFlip": {
      const chars = line.split("");
      const brackets: Record<string, string> = { "{": "}", "}": "{", "[": "]", "]": "[" };
      const c = chars[offset];
      if (c !== undefined && brackets[c]) chars[offset] = brackets[c];
      return chars.join("");
    }
    case "unicodeInject":
      return line.slice(0, offset) + unicodeChar + line.slice(offset);
    case "nestedNoise":
      return line.slice(0, offset) + nestedNoise + line.slice(offset);
    case "charDrop":
      return line.slice(0, offset) + line.slice(offset + 1);
    case "charDup":
      return line.slice(0, offset) + line[offset] + line[offset] + line.slice(offset);
    default:
      return line;
  }
}

test("fuzz: parseSkill on ~500 seeded mutations of a valid attest: line — only parses or throws SkillParseError", () => {
  fc.assert(
    fc.property(mutationArb, (m) => {
      const mutatedLine = applyMutation(m);
      const source = SKILL_WITH_LINE(mutatedLine);
      try {
        parseSkill(source);
      } catch (e) {
        if (!(e instanceof SkillParseError)) throw e;
      }
    }),
    { numRuns: 500 }
  );
});

// ---------------------------------------------------------------------------
// 2. Hash-stability property: ~100 seeded random projections.
// ---------------------------------------------------------------------------

// Random projected-value records: string/number/boolean-shaped source values
// so projectObservation's stringify path is exercised the same way real
// bodies are.
const primitiveArb = fc.oneof(
  fc.string({ maxLength: 12 }),
  fc.integer(),
  fc.boolean(),
  fc.double({ noNaN: true, noDefaultInfinity: true })
);
const bodyArb = fc.dictionary(
  fc.constantFrom(...ATTEST_BODY_FIELDS),
  primitiveArb,
  { minKeys: 1, maxKeys: 8 }
);

/** Shuffle driven by a fast-check-supplied index sequence — cycles through
 * `order` (repeating/wrapping as needed) until every element of `arr` has
 * been drawn out, so a short/empty `order` array still yields a full
 * permutation rather than silently dropping trailing elements. */
function permute<T>(arr: T[], order: number[]): T[] {
  const pool = [...arr];
  const out: T[] = [];
  let seedIdx = 0;
  while (pool.length > 0) {
    const idx = order.length > 0 ? order[seedIdx % order.length] : 0;
    seedIdx++;
    const i = idx % pool.length;
    out.push(pool.splice(i, 1)[0]);
  }
  return out;
}

test("property: hash is stable under body key order / header insertion order permutation (~100 seeds)", () => {
  fc.assert(
    fc.property(
      bodyArb,
      fc.dictionary(fc.constantFrom(...ATTEST_HEADER_FIELDS), fc.string({ minLength: 1, maxLength: 10 }), { maxKeys: 2 }),
      fc.array(fc.nat({ max: 20 }), { minLength: 0, maxLength: 10 }),
      fc.array(fc.nat({ max: 20 }), { minLength: 0, maxLength: 10 }),
      (body, headers, bodyOrderSeed, headerOrderSeed) => {
        const bodyKeys = Object.keys(body);
        const headerKeys = Object.keys(headers);
        if (bodyKeys.length === 0 && headerKeys.length === 0) return; // nothing to project — skip trivial case

        const bodyEntries = bodyKeys.map((k) => [k, body[k]] as const);
        const headerEntries = headerKeys.map((k) => [k, headers[k]] as const);

        const permutedBody = Object.fromEntries(permute(bodyEntries, bodyOrderSeed));
        const permutedHeaders = Object.fromEntries(permute(headerEntries, headerOrderSeed));

        const obsA = obsOf(body, headers);
        const obsB = obsOf(permutedBody, permutedHeaders);

        const projA = projectObservation(obsA);
        const projB = projectObservation(obsB);
        assert.deepEqual(projA, projB, "permuted key order must project identically");
        assert.equal(digestSha256(projA), digestSha256(projB), "permuting key order must never change the hash");
      }
    ),
    { numRuns: 100 }
  );
});

test("property: changing any single projected value always changes the hash (~100 seeds)", () => {
  fc.assert(
    fc.property(bodyArb, fc.nat({ max: 1000 }), (body, mutSeed) => {
      const keys = Object.keys(body);
      if (keys.length === 0) return;
      const key = keys[mutSeed % keys.length];
      const original = body[key];
      // Produce a value guaranteed to stringify differently from the original.
      const mutated: Record<string, unknown> = { ...body, [key]: String(original) + "_MUTATED" };

      const before = projectObservation(obsOf(body));
      const after = projectObservation(obsOf(mutated));
      if (Object.keys(before).length === 0 || Object.keys(after).length === 0) return; // not projectable — skip
      assert.notEqual(
        digestSha256(before),
        digestSha256(after),
        `changing '${key}' must change the projection hash`
      );
    }),
    { numRuns: 100 }
  );
});

// ---------------------------------------------------------------------------
// 3. No-raw-values property: seeded random bodies.
// ---------------------------------------------------------------------------

/** Normalize every JSON primitive projectObservation can retain. Null is not
 * a projected value (runner.ts deliberately drops it), so it contributes no
 * privacy candidate. Objects and arrays are walked recursively so this oracle
 * remains sound for adversarial/synthetic shapes as well as today's flat map. */
function normalizedProjectedPrimitive(value: unknown): string | undefined {
  if (typeof value === "string" || typeof value === "boolean") return String(value);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

const SHA256_COMMITMENT = /^sha256:[0-9a-f]{64}$/;

function collectNormalizedPrimitives(value: unknown, omitValidCommitments: boolean, path: string[] = []): string[] {
  const primitive = normalizedProjectedPrimitive(value);
  if (primitive !== undefined) {
    const isCommitmentPath = path.length === 2
      && (path[0] === "pre" || path[0] === "post")
      && path[1] === "hash";
    if (omitValidCommitments && isCommitmentPath && SHA256_COMMITMENT.test(primitive)) return [];
    return [primitive];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectNormalizedPrimitives(item, omitValidCommitments, [...path, String(index)]));
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) =>
      collectNormalizedPrimitives(child, omitValidCommitments, [...path, key])
    );
  }
  return [];
}

/** Assert on semantic primitive leaves, not serialized bytes. Only valid
 * top-level pre/post SHA-256 commitments may contain projected text without
 * being treated as retained raw state. */
function assertNoRawProjectedValues(projected: unknown, attest: unknown): void {
  const rawValues = collectNormalizedPrimitives(projected, false);
  const attestValues = new Set(collectNormalizedPrimitives(attest, true));
  for (const raw of rawValues) {
    assert.ok(!attestValues.has(raw), `raw projected value '${raw}' survived as an attest value`);
  }
}

test("privacy oracle does not treat projected digits inside a SHA-256 digest as raw-value leakage", () => {
  const projected = { "body.sha": "10003" };
  const attest = {
    method: "response-derived",
    post: {
      hash: "sha256:c94c19f4dc439831861146b61000306b44f05d045b9b3c98ee3acb140044be79",
      at: "2026-08-11T14:18:41.701Z",
    },
    confidence: "partial",
  };
  assertNoRawProjectedValues(projected, attest);
});

test("privacy oracle rejects a raw projected string retained as an attest value", () => {
  const projected = { "body.version": "private-version-token" };
  const attestWithLeak = {
    method: "response-derived",
    confidence: "absent",
    reason: "private-version-token",
  };

  assert.throws(
    () => assertNoRawProjectedValues(projected, attestWithLeak),
    /raw projected value 'private-version-token' survived as an attest value/
  );
});

const PRIVACY_ORACLE_LEAK_CASES: Array<{ name: string; projected: unknown; attest: unknown }> = [
  { name: "short string", projected: { "body.version": "x" }, attest: { reason: "x" } },
  { name: "number", projected: { "body.id": 7 }, attest: { metadata: 7 } },
  { name: "boolean", projected: { "body.flag": true }, attest: { metadata: true } },
  {
    name: "nested object",
    projected: { body: { version: "nested-private" } },
    attest: { metadata: { retained: "nested-private" } },
  },
  {
    name: "array",
    projected: { body: ["array-private"] },
    attest: { metadata: ["array-private"] },
  },
  {
    name: "non-commitment metadata.hash",
    projected: { "body.sha": "metadata-private" },
    attest: { metadata: { hash: "metadata-private" } },
  },
  {
    name: "malformed post.hash",
    projected: { "body.sha": "not-a-valid-commitment" },
    attest: { post: { hash: "not-a-valid-commitment" } },
  },
  {
    name: "uppercase post.hash",
    projected: { "body.sha": `sha256:${"A".repeat(64)}` },
    attest: { post: { hash: `sha256:${"A".repeat(64)}` } },
  },
];

for (const c of PRIVACY_ORACLE_LEAK_CASES) {
  test(`privacy oracle rejects retained ${c.name} projected values`, () => {
    assert.throws(
      () => assertNoRawProjectedValues(c.projected, c.attest),
      /raw projected value/
    );
  });
}

test("privacy oracle ignores null because projectObservation does not project null", () => {
  assertNoRawProjectedValues({ "body.version": null }, { metadata: null });
});

test("privacy oracle exempts only valid pre.hash and post.hash commitments", () => {
  const preHash = `sha256:${"a".repeat(64)}`;
  const postHash = `sha256:${"b".repeat(64)}`;
  assertNoRawProjectedValues(
    { preHash, postHash },
    { pre: { hash: preHash }, post: { hash: postHash } }
  );
});

test("property: projected primitive values never survive as semantic attest values, only as hashes (~100 seeds)", () => {
  fc.assert(
    fc.property(
      fc.dictionary(
        fc.constantFrom(...ATTEST_BODY_FIELDS),
        fc.oneof(fc.string({ maxLength: 40 }), fc.integer(), fc.boolean(), fc.constant(null)),
        { minKeys: 1, maxKeys: 8 }
      ),
      (body) => {
        const proj = projectObservation(obsOf(body));
        const attest = buildResponseDerivedAttest(obsOf(body));
        assertNoRawProjectedValues(proj, attest);
      }
    ),
    { numRuns: 100 }
  );
});

// ---------------------------------------------------------------------------
// 4. Confidence-ladder transition table: {preOk, postOk, preEmpty, postEmpty}.
// ---------------------------------------------------------------------------

type ProbeState = "fail" | "empty" | "present";

function makeProbeTool(preState: ProbeState, postState: ProbeState): { tool: Tool; calls: string[] } {
  const calls: string[] = [];
  const behave = (state: ProbeState): Observation => {
    if (state === "fail") throw new Error("boom");
    if (state === "empty") return obsOf({}); // projection ["v"] finds nothing
    return obsOf({ v: "x" });
  };
  const tool: Tool = {
    effect: "read",
    run: async () => {
      calls.push("read");
      const state = calls.length === 1 ? preState : postState;
      return behave(state);
    },
  };
  return { tool, calls };
}

const PROBE_SKILL = `---
name: ladder-t
description: d
---
## Steps

### Step 1 — write
- intent: i
- action: fake.update {"id":"x1"}
- assert: status == 200
- attest: {"tool":"fake.read","args":{"id":"x1"},"projection":["v"]}
- effect: idempotent-write
`;

/** PROBE_SKILL with a CURRENT approve: hash stamped (attest bound in) — since
 * fix-wave F2 the declared probe only dispatches on the approved path. */
function approvedProbeSkill(): string {
  const s = parseSkill(PROBE_SKILL).steps[0];
  const hash = computeApprovalHash({ emit: undefined, actionTool: s.actionTool, actionArgs: s.actionArgs, attest: s.attest, expect: s.expect });
  return `${PROBE_SKILL}- approve: ${hash}\n`;
}

const LADDER_CASES: Array<{
  pre: ProbeState;
  post: ProbeState;
  confidence: "exact" | "partial" | "absent";
  reasonPattern?: RegExp;
  reasonAbsent?: boolean;
}> = [
  { pre: "present", post: "present", confidence: "exact", reasonAbsent: true },
  { pre: "present", post: "empty", confidence: "partial", reasonPattern: /^post: empty-projection$/ },
  { pre: "present", post: "fail", confidence: "partial", reasonPattern: /^post: probe-failed/ },
  { pre: "empty", post: "present", confidence: "partial", reasonPattern: /^pre: empty-projection$/ },
  { pre: "empty", post: "empty", confidence: "absent", reasonPattern: /pre: empty-projection; post: empty-projection/ },
  { pre: "empty", post: "fail", confidence: "absent", reasonPattern: /pre: empty-projection; post: probe-failed/ },
  { pre: "fail", post: "present", confidence: "partial", reasonPattern: /^pre: probe-failed/ },
  { pre: "fail", post: "empty", confidence: "absent", reasonPattern: /pre: probe-failed.*; post: empty-projection/ },
  { pre: "fail", post: "fail", confidence: "absent", reasonPattern: /pre: probe-failed.*; post: probe-failed/ },
];

for (const c of LADDER_CASES) {
  test(`confidence ladder: pre=${c.pre} post=${c.post} => ${c.confidence}`, async () => {
    const { tool, calls } = makeProbeTool(c.pre, c.post);
    const tools: Record<string, Tool> = {
      "fake.update": { effect: "idempotent-write", run: async () => obsOf({ id: "x1" }) },
      "fake.read": tool,
    };
    const rec = await runSkill(parseSkill(approvedProbeSkill()), { tools, allowWrites: true, dryRun: true });
    const a = rec.steps[0].attest!;
    assert.equal(a.method, "declared-probe");
    assert.equal(a.confidence, c.confidence, `expected confidence ${c.confidence}, got ${a.confidence} (reason: ${a.reason})`);
    if (c.reasonAbsent) {
      assert.equal(a.reason, undefined, "exact confidence must carry no reason");
    } else {
      assert.ok(a.reason !== undefined, "non-exact confidence must carry a reason");
      assert.match(a.reason!, c.reasonPattern!);
    }
    assert.equal(calls.length, 2, "probe must fire exactly twice (pre + post), regardless of outcome");
    assert.equal(rec.steps[0].outcome, "passed", "a probe never fails the step, degrade-never-fail");
  });
}

// ---------------------------------------------------------------------------
// 5. Latency guard: a read-only skill never fires a probe.
// ---------------------------------------------------------------------------

const READ_ONLY_SKILL = `---
name: read-only-t
description: d
---
## Steps

### Step 1 — get one
- intent: i
- action: fake.get {"id":"1"}
- assert: status == 200
- effect: read

### Step 2 — get two
- intent: i
- action: fake.get {"id":"2"}
- assert: status == 200
- effect: read

### Step 3 — get three
- intent: i
- action: fake.get {"id":"3"}
- assert: status == 200
- effect: read
`;

test("latency guard: read-only skill invokes its tool exactly once per step — no probe ever fires", async () => {
  let invocations = 0;
  const tools: Record<string, Tool> = {
    "fake.get": {
      effect: "read",
      run: async () => {
        invocations++;
        return obsOf({ id: "1" });
      },
    },
  };
  const skill = parseSkill(READ_ONLY_SKILL);
  const rec = await runSkill(skill, { tools, dryRun: true });
  assert.equal(invocations, skill.steps.length, "invocation count must equal step count exactly");
  assert.equal(invocations, 3);
  for (const step of rec.steps) {
    assert.equal(step.attest, undefined, "a read step must never carry an attest block");
  }
});

// ---------------------------------------------------------------------------
// 6. Controller-added: cmdApprove's attest advisory fires even when the
// write step's `approve:` hash is already CURRENT (pre-stamped valid hash).
// ---------------------------------------------------------------------------

function fakeArgs(positional: string[], flags: string[] = []): ParsedArgs {
  return { positional, flags: new Set(flags), vars: {}, wraps: [], opts: {}, fails: [] };
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-attest-hardening-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function captureConsole<T>(fn: () => Promise<T>): Promise<{ result: T; logs: string[] }> {
  const logs: string[] = [];
  const origLog = console.log;
  console.log = (msg: string) => logs.push(String(msg));
  try {
    const result = await fn();
    return { result, logs };
  } finally {
    console.log = origLog;
  }
}

test("cmdApprove --all: attest advisory still fires on a write step whose approve: hash is already CURRENT", async () => {
  await withTempDir(async (dir) => {
    // Build the skill, compute its real current approval hash (attest-less
    // step), and pre-stamp it — so this step is "approved (current)" AND
    // still missing an `attest:` declaration.
    const skillPath = path.join(dir, "s.skill.md");
    const withoutHash = `---
name: attest-advisory-current
description: one pre-approved write step with no attest
---

### Step 1 — delete the account
- intent: delete it
- action: delete_account {"id": "acc_1"}
- assert: status == 200
- effect: destructive
`;
    const parsed = parseSkill(withoutHash);
    const currentHash = computeApprovalHash({ emit: undefined, ...parsed.steps[0], attest: parsed.steps[0].attest, expect: parsed.steps[0].expect });
    const skillSource = `---
name: attest-advisory-current
description: one pre-approved write step with no attest
---

### Step 1 — delete the account
- intent: delete it
- action: delete_account {"id": "acc_1"}
- assert: status == 200
- effect: destructive
- approve: ${currentHash}
`;
    await writeFile(skillPath, skillSource, "utf8");

    const { result: code, logs } = await captureConsole(() => cmdApprove(fakeArgs([skillPath], ["all"])));
    assert.equal(code, 0);

    assert.ok(logs.some((l) => /approved \(current\)/.test(l)), "expected the step to be reported as already-current");
    assert.ok(logs.some((l) => /unchanged/.test(l)), "expected the idempotent 'unchanged' no-op path");
    assert.ok(
      logs.some((l) => /no 'attest:' declared/.test(l)),
      "the attest advisory must still fire even though the approve: hash is current"
    );
  });
});
