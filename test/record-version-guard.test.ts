import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  classifyRecordVersion,
  UNSUPPORTED_VERSION_CLAIM,
} from "../src/record-version-guard.js";
import { evaluateVerifyClaims, evaluateUnalteredSincePushClaim, evaluateTimestampClaim, parseVerifyPayload, type VerifyPayload } from "../src/verify.js";
import { cmdVerify, type ParsedArgs } from "../src/cli.js";
import { generateSigningKeypair, loadSigningKey, signRecordDigest } from "../src/signing.js";
import { digestSha256 } from "../src/canonical-json.js";
import type { RunRecord } from "../src/runner.js";

// The guard-only N-1 release (task-nminus1-guard-brief.md). This release does NOT understand
// authority-aware records. Its whole job is to refuse them LOUDLY instead of evaluating them as
// legacy records, because a versioned record that falls through to legacy crypto is the one
// outcome that would let an old CLI render a confident, wrong answer about a receipt it cannot
// actually read. Every legacy byte and every legacy output line must survive untouched.
//
// The classification rule is exact: a record with NO own top-level `v` is legacy; a record with
// ANY own top-level `v` is an unsupported-version failure. Inherited `v` is not an own version.

function legacyRecord(): RunRecord {
  return {
    skill: "guard-fixture",
    startedAt: "2026-08-07T00:00:00.000Z",
    finishedAt: "2026-08-07T00:00:00.500Z",
    passed: true,
    steps: [{ n: 1, title: "one", level: 0, outcome: "passed", ms: 5, failures: [] }],
    totals: { steps: 1, passed: 1, unchecked: 0, skipped: 0, failed: 0, ms: 5, llmInputTokens: 0, llmOutputTokens: 0 },
  } as RunRecord;
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-guard-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function withCapturedLogs<T>(run: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const originalLog = console.log;
  const originalError = console.error;
  const lines: string[] = [];
  console.log = ((...args: unknown[]) => {
    lines.push(args.map((a) => String(a)).join(" "));
  }) as typeof console.log;
  console.error = console.log;
  try {
    return { result: await run(), lines };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

function argsFor(target: string, key?: string): ParsedArgs {
  return { positional: [target], opts: key ? { key } : {} } as ParsedArgs;
}

// --- the classifier itself -------------------------------------------------

test("the classifier calls a record with no own top-level v legacy", () => {
  assert.deepEqual(classifyRecordVersion(legacyRecord()), { kind: "legacy" });
});

test("the classifier refuses the authority receipt version by name", () => {
  const classified = classifyRecordVersion({ ...legacyRecord(), v: "reelier.authority-receipt/v1" });
  assert.equal(classified.kind, "unsupported-version");
  assert.equal(classified.kind === "unsupported-version" && classified.declared, "reelier.authority-receipt/v1");
});

test("the classifier refuses unknown FUTURE versions, not just the one it knows about", () => {
  for (const declared of [
    "reelier.authority-receipt/v2",
    "reelier.authority-receipt/v99",
    "reelier.some-future-record/v1",
    "urn:something:entirely:unforeseen",
  ]) {
    const classified = classifyRecordVersion({ ...legacyRecord(), v: declared });
    assert.equal(classified.kind, "unsupported-version", declared);
  }
});

test("the classifier refuses ANY own v regardless of its type, failing closed", () => {
  for (const declared of [1, 0, true, false, null, {}, [], ""] as const) {
    const classified = classifyRecordVersion({ ...legacyRecord(), v: declared });
    assert.equal(classified.kind, "unsupported-version", JSON.stringify(declared));
  }
  // An own `v` whose value is undefined still DECLARES a version key. Fail closed.
  const withUndefined = { ...legacyRecord(), v: undefined };
  assert.equal(classifyRecordVersion(withUndefined).kind, "unsupported-version");
});

test("an INHERITED v is not an own record version and stays legacy", () => {
  const inherited = Object.create({ v: "reelier.authority-receipt/v1" }) as Record<string, unknown>;
  Object.assign(inherited, legacyRecord());
  assert.equal(Object.getPrototypeOf(inherited).v, "reelier.authority-receipt/v1");
  assert.deepEqual(classifyRecordVersion(inherited), { kind: "legacy" });
});

test("non-object records are left to the existing parser boundary, not claimed as versioned", () => {
  for (const value of [null, undefined, 42, "a string", true]) {
    assert.deepEqual(classifyRecordVersion(value), { kind: "legacy" }, String(value));
  }
});

// --- the evaluator ---------------------------------------------------------

test("evaluateVerifyClaims refuses a WRAPPED versioned record without evaluating any legacy claim", () => {
  const payload = { record: { ...legacyRecord(), v: "reelier.authority-receipt/v1" } } as unknown as VerifyPayload;
  const result = evaluateVerifyClaims(payload);
  assert.equal(result.exitCode, 1, "an unreadable record must not exit 0");
  assert.equal(result.claims.length, 1, "no legacy claim line is produced");
  assert.equal(result.claims[0]!.claim, UNSUPPORTED_VERSION_CLAIM);
  assert.equal(result.claims[0]!.status, "failed");
  assert.match(result.claims[0]!.line, /reelier\.authority-receipt\/v1/);
});

test("evaluateVerifyClaims refuses a BARE versioned record parsed from raw JSON", () => {
  const bare = JSON.stringify({ ...legacyRecord(), v: "reelier.authority-receipt/v1" });
  const result = evaluateVerifyClaims(parseVerifyPayload(bare));
  assert.equal(result.exitCode, 1);
  assert.equal(result.claims[0]!.claim, UNSUPPORTED_VERSION_CLAIM);
});

// The dangerous shape the brief names explicitly: a versioned record carrying trust siblings that
// LOOK legitimate. Neither may pull it into legacy crypto.
test("a valid-looking signature or timestamp sibling cannot pull a versioned record into legacy crypto", async () => {
  await withTempDir(async (keyDir) => {
  const generated = await generateSigningKeypair(keyDir);
  const loaded = await loadSigningKey(keyDir);
  const record = { ...legacyRecord(), v: "reelier.authority-receipt/v1" };
  const sig = signRecordDigest(loaded!.privateKey, digestSha256(record as unknown as RunRecord));
  const payload = {
    record,
    signature: { alg: "ed25519", keyId: generated.keyId, sig },
    timestamp: { tsa: "https://tsa.example", token: "AAAA" },
  } as unknown as VerifyPayload;

  const result = evaluateVerifyClaims(payload, generated.publicPem);
  assert.equal(result.exitCode, 1);
  assert.equal(result.claims.length, 1);
  assert.equal(result.claims[0]!.claim, UNSUPPORTED_VERSION_CLAIM);
  assert.equal(
    result.claims.some((c) => c.claim === "unaltered-since-push" || c.claim === "timestamped"),
    false,
    "no legacy claim may be evaluated for a versioned record even when its siblings verify"
  );
  });
});

// The two per-claim evaluators are exported, so a consumer can reach legacy crypto without going
// through evaluateVerifyClaims. The guard has to hold there too.
test("the individually exported claim evaluators refuse versioned records as well", () => {
  const payload = { record: { ...legacyRecord(), v: "reelier.authority-receipt/v1" } } as unknown as VerifyPayload;
  for (const line of [evaluateUnalteredSincePushClaim(payload), evaluateTimestampClaim(payload)]) {
    assert.equal(line.status, "failed", line.claim);
    assert.equal(line.claim, UNSUPPORTED_VERSION_CLAIM);
  }
});

// --- legacy preservation: the half that must NOT change ---------------------

test("a valid legacy SIGNED record still verifies exactly as before", async () => {
  await withTempDir(async (keyDir) => {
  const generated = await generateSigningKeypair(keyDir);
  const loaded = await loadSigningKey(keyDir);
  const record = legacyRecord();
  const sig = signRecordDigest(loaded!.privateKey, digestSha256(record));
  const signature = { alg: "ed25519", keyId: generated.keyId, sig };
  const result = evaluateVerifyClaims({ record, signature } as VerifyPayload, generated.publicPem);
  assert.equal(result.exitCode, 0);
  assert.equal(result.claims.length, 2, "both legacy claim lines are still produced");
  assert.equal(result.claims[0]!.claim, "unaltered-since-push");
  assert.equal(result.claims[0]!.status, "verified");
  assert.equal(result.claims[1]!.claim, "timestamped");
  assert.equal(result.claims[1]!.status, "absent");
  });
});

test("the exact legacy output snapshot for an unsigned record is byte-identical", () => {
  const result = evaluateVerifyClaims({ record: legacyRecord() } as VerifyPayload);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(
    result.claims.map((c) => c.line),
    [
      "unaltered-since-push: — unsigned (sign your pushes: reelier init --signing)",
      "timestamped: — none",
    ],
    "legacy output is preserved byte-for-byte by this guard release"
  );
});

// --- the CLI --------------------------------------------------------------

test("the CLI refuses a versioned record file with exit 1 and names the version", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "authority.json");
    await writeFile(file, JSON.stringify({ ...legacyRecord(), v: "reelier.authority-receipt/v1" }), "utf8");
    const { result: code, lines } = await withCapturedLogs(() => cmdVerify(argsFor(file)));
    assert.equal(code, 1);
    const joined = lines.join("\n");
    assert.match(joined, /reelier\.authority-receipt\/v1/);
    assert.equal(/unaltered-since-push/.test(joined), false, "no legacy claim line is printed");
    assert.equal(/No present claim failed verification/.test(joined), false, "never renders as a pass");
  });
});

test("the CLI still verifies a legacy signed record file exactly as before", async () => {
  await withTempDir(async (dir) => {
    const generated = await generateSigningKeypair(path.join(dir, "keys"));
    const loaded = await loadSigningKey(path.join(dir, "keys"));
    const record = legacyRecord();
    const sig = signRecordDigest(loaded!.privateKey, digestSha256(record));
    const signature = { alg: "ed25519", keyId: generated.keyId, sig };
    const file = path.join(dir, "legacy.json");
    const pub = path.join(dir, "pub.pem");
    await writeFile(file, JSON.stringify({ record, signature }), "utf8");
    await writeFile(pub, generated.publicPem, "utf8");
    const { result: code, lines } = await withCapturedLogs(() => cmdVerify(argsFor(file, pub)));
    assert.equal(code, 0);
    assert.match(lines.join("\n"), /unaltered-since-push: ✓/);
  });
});
