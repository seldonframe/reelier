// S2 of the state-conditioned-approval design (Wave 2 spec §3.3–§3.4, §10 S2):
// the expect commitment module — per-approval key mint, keyId derivation,
// HMAC with context binding (probe + v only, amendment A5) over TYPE-TAGGED
// projected values (amendment A6: `1`, `"1"`, and `true` MUST produce
// distinct commitments — a false MATCH from type collapse is the one
// direction the scheme must never produce) — and the local keystore
// (0600, REELIER_EXPECT_KEYS, temp-file + rename with lock/retry, A10).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { mkdtemp, readFile, readdir, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  EXPECT_KEY_BYTES,
  deriveExpectKeyId,
  mintExpectKey,
  expectMac,
  probeArgsMac,
  projectObservationTyped,
  resolveKeystorePath,
  readKeystore,
  writeKeystoreEntry,
  loadExpectKey,
  TRANSIENT_LOCK_CREATE_RETRIES,
} from "../src/expect-mac.js";
import { canonicalJson } from "../src/canonical-json.js";
import { projectObservation } from "../src/runner.js";

const KEY_A = Buffer.alloc(32, 0x11);
const KEY_B = Buffer.alloc(32, 0x22);

// ---------------------------------------------------------------------------
// Key mint + keyId derivation
// ---------------------------------------------------------------------------

test("mintExpectKey returns a 32-byte key and its 16-hex keyId", () => {
  const { key, keyId } = mintExpectKey();
  assert.equal(key.length, EXPECT_KEY_BYTES);
  assert.match(keyId, /^[0-9a-f]{16}$/);
  assert.equal(keyId, deriveExpectKeyId(key));
});

test("mintExpectKey mints distinct keys and keyIds", () => {
  const a = mintExpectKey();
  const b = mintExpectKey();
  assert.notEqual(a.key.toString("hex"), b.key.toString("hex"));
  assert.notEqual(a.keyId, b.keyId);
});

test("keyId derivation pins the spec §3.3 formula: sha256('reelier expect key v1\\n' ‖ key)[0..16)", () => {
  const expected = createHash("sha256")
    .update(Buffer.concat([Buffer.from("reelier expect key v1\n", "utf8"), KEY_A]))
    .digest("hex")
    .slice(0, 16);
  assert.equal(deriveExpectKeyId(KEY_A), expected);
});

// ---------------------------------------------------------------------------
// The MAC: deterministic, context-bound, type-tagged
// ---------------------------------------------------------------------------

test("expectMac is deterministic under a fixed key and input", () => {
  const m1 = expectMac(KEY_A, "gbrain.get_page", { "body.compiled_truth": "# hi" });
  const m2 = expectMac(KEY_A, "gbrain.get_page", { "body.compiled_truth": "# hi" });
  assert.equal(m1, m2);
  assert.match(m1, /^hmac-sha256:[0-9a-f]{64}$/);
});

test("expectMac differs across keys (per-approval key is the isolation)", () => {
  const m1 = expectMac(KEY_A, "gbrain.get_page", { "body.compiled_truth": "# hi" });
  const m2 = expectMac(KEY_B, "gbrain.get_page", { "body.compiled_truth": "# hi" });
  assert.notEqual(m1, m2);
});

test("expectMac binds the probe tool (context binding, A5: probe + v only)", () => {
  const m1 = expectMac(KEY_A, "gbrain.get_page", { "body.compiled_truth": "# hi" });
  const m2 = expectMac(KEY_A, "gbrain.get_backlinks", { "body.compiled_truth": "# hi" });
  assert.notEqual(m1, m2);
});

test("expectMac differs when a projected value changes", () => {
  const m1 = expectMac(KEY_A, "t", { "body.etag": "abc" });
  const m2 = expectMac(KEY_A, "t", { "body.etag": "abd" });
  assert.notEqual(m1, m2);
});

test("A6: 1, '1', and true produce three distinct MACs (the false-MATCH class is pinned shut)", () => {
  const asNumber = expectMac(KEY_A, "t", { "body.flag": 1 });
  const asString = expectMac(KEY_A, "t", { "body.flag": "1" });
  const asBoolean = expectMac(KEY_A, "t", { "body.flag": true });
  assert.notEqual(asNumber, asString);
  assert.notEqual(asNumber, asBoolean);
  assert.notEqual(asString, asBoolean);
});

test("A6 continued: 'true' vs true, '0' vs 0, and tag-injection lookalikes stay distinct", () => {
  assert.notEqual(expectMac(KEY_A, "t", { f: "true" }), expectMac(KEY_A, "t", { f: true }));
  assert.notEqual(expectMac(KEY_A, "t", { f: "0" }), expectMac(KEY_A, "t", { f: 0 }));
  // A string value that already carries a would-be tag prefix must not
  // collide with the genuinely-typed value it imitates.
  assert.notEqual(expectMac(KEY_A, "t", { f: "n:1" }), expectMac(KEY_A, "t", { f: 1 }));
  assert.notEqual(expectMac(KEY_A, "t", { f: "b:true" }), expectMac(KEY_A, "t", { f: true }));
});

test("A6: a projected field literally named '__proto__' is refused, never silently dropped (false-MATCH guard)", () => {
  // Object literals can't carry an own '__proto__' property, but JSON.parse
  // output can — and the tagging/canonicalJson rebuild would silently drop
  // it, making MAC({__proto__:'a'}) === MAC({}) — a false MATCH.
  const hostile = JSON.parse(`{"__proto__":"a"}`) as Record<string, string>;
  assert.throws(() => expectMac(KEY_A, "t", hostile), /__proto__/);
});

// ---------------------------------------------------------------------------
// probeArgsMac: RECURSIVE __proto__ guard (blocker 2, wave-3 review) — args
// are arbitrary nested JSON, unlike expectMac/expectFieldMac's flat scalar
// projection, so the guard has to walk the whole tree.
// ---------------------------------------------------------------------------

test("W3-S4 review-fix: probeArgsMac refuses a __proto__ key ANYWHERE in nested args, never silently dropping it (recursive false-MATCH guard)", () => {
  // Object literals can't carry an own '__proto__' property, but JSON.parse
  // output can — and canonicalJson's rebuild (bracket-assignment onto a
  // plain {} at every level) would silently drop it at ANY depth, making
  // probeArgsMac({a:{__proto__:{x:1}}}) === probeArgsMac({a:{}}) — a false
  // MATCH between two different arg sets.
  const hostile = JSON.parse(`{"a":{"__proto__":{"x":1}}}`) as Record<string, unknown>;
  assert.throws(() => probeArgsMac(KEY_A, "t", hostile), /__proto__/);
});

test("W3-S4 review-fix: a __proto__ key nested inside an array element is refused too", () => {
  const hostile = JSON.parse(`{"a":[{"__proto__":{"x":1}}]}`) as Record<string, unknown>;
  assert.throws(() => probeArgsMac(KEY_A, "t", hostile), /__proto__/);
});

test("W3-S4 review-fix: a normal nested object (no __proto__ anywhere) still commits deterministically", () => {
  const args = { a: { b: 1, c: [1, 2, { d: "x", e: [true, false] }] } };
  const m1 = probeArgsMac(KEY_A, "t", args);
  const m2 = probeArgsMac(KEY_A, "t", JSON.parse(JSON.stringify(args)));
  assert.equal(m1, m2);
  assert.match(m1, /^hmac-sha256:[0-9a-f]{64}$/);
});

test("expectMac is stable across projected-map key insertion order (canonical JSON)", () => {
  const m1 = expectMac(KEY_A, "t", { a: "1", b: "2" });
  const m2 = expectMac(KEY_A, "t", { b: "2", a: "1" });
  assert.equal(m1, m2);
});

test("expectMac pins the spec §3.3 MAC input shape: {probe, projection: tagged, v: 1}", () => {
  const mac = expectMac(KEY_A, "gbrain.get_page", { "body.compiled_truth": "# hi", "body.n": 3, "body.ok": true });
  const taggedProjection = { "body.compiled_truth": "s:# hi", "body.n": "n:3", "body.ok": "b:true" };
  const expected =
    "hmac-sha256:" +
    createHmac("sha256", KEY_A)
      .update(canonicalJson({ probe: "gbrain.get_page", projection: taggedProjection, v: 1 }), "utf8")
      .digest("hex");
  assert.equal(mac, expected);
});

// ---------------------------------------------------------------------------
// I-6: no default-key MAC — empty/wrong-length/placeholder keys throw
// ---------------------------------------------------------------------------

test("I-6: expectMac throws on an empty key, never computes", () => {
  assert.throws(() => expectMac(Buffer.alloc(0), "t", { f: "x" }), /key/i);
});

test("I-6: expectMac throws on a wrong-length key", () => {
  assert.throws(() => expectMac(Buffer.alloc(16, 0x11), "t", { f: "x" }), /key/i);
});

test("I-6: expectMac throws on an all-zero (placeholder) key", () => {
  assert.throws(() => expectMac(Buffer.alloc(32, 0), "t", { f: "x" }), /key/i);
});

// ---------------------------------------------------------------------------
// The probe-name guard: context binding is probe + v (A5), so an empty probe
// name would commit under a blank context — refused, never computed.
// ---------------------------------------------------------------------------

test("expectMac refuses an empty or whitespace-only probe tool name, never computes a blank-context commitment", () => {
  for (const badProbe of ["", "   ", "\t", "\n"]) {
    assert.throws(
      () => expectMac(KEY_A, badProbe, { "body.etag": "abc" }),
      /probe tool name must be a non-empty string/,
      `probe ${JSON.stringify(badProbe)} must be refused`
    );
  }
});

test("expectMac refuses a non-string probe tool name — the guard is for untyped callers, so it needs an untyped test", () => {
  // TypeScript already forbids these at compile time, which is exactly why
  // the runtime half of the guard is invisible to every typed test. The
  // casts below are the only way to exercise it, and without them a
  // commitment could be computed under `undefined` or `[object Object]` as
  // its probe context.
  for (const badProbe of [undefined, null, 42, {}, ["gbrain.get_page"]]) {
    assert.throws(
      () => expectMac(KEY_A, badProbe as unknown as string, { "body.etag": "abc" }),
      /probe tool name must be a non-empty string/,
      `probe ${JSON.stringify(badProbe)} must be refused`
    );
  }
});

// ---------------------------------------------------------------------------
// Typed projection: same selection semantics as projectObservation's
// explicit-projection branch, types preserved (A6)
// ---------------------------------------------------------------------------

test("projectObservationTyped selects declared top-level body scalars, preserving type", () => {
  const body = JSON.stringify({ compiled_truth: "# hi", count: 3, flagged: false, nested: { a: 1 }, arr: [1], nil: null });
  const out = projectObservationTyped({ body, headers: {}, status: 200 }, ["compiled_truth", "count", "flagged", "nested", "arr", "nil", "absent"]);
  assert.deepEqual(out, {
    "body.compiled_truth": "# hi",
    "body.count": 3,
    "body.flagged": false,
  });
});

test("projectObservationTyped mirrors projectObservation: non-JSON body → empty; array body → empty", () => {
  assert.deepEqual(projectObservationTyped({ body: "not json", headers: {}, status: 200 }, ["a"]), {});
  assert.deepEqual(projectObservationTyped({ body: "[1,2]", headers: {}, status: 200 }, ["a"]), {});
});

test("a JSON scalar body projects to {} even when the projection names one of its intrinsic properties", () => {
  // A bare JSON string parses fine and has real, scalar-valued properties
  // ("length"), so it's the case that separates "rejected a non-object body"
  // from "looked and found nothing". Without the object check, a string body
  // would start contributing a projected value to the commitment.
  assert.deepEqual(projectObservationTyped({ body: `"hello"`, headers: {}, status: 200 }, ["length"]), {});
  assert.deepEqual(projectObservationTyped({ body: `5`, headers: {}, status: 200 }, ["toFixed", "length"]), {});
  assert.deepEqual(projectObservationTyped({ body: `true`, headers: {}, status: 200 }, ["length"]), {});
});

test("an array body projects to {} even when the projection names indices — arrays are rejected as a body, not indexed into", () => {
  // Projecting ["a"] off an array can't tell "rejected the array" from
  // "looked and found nothing". Index names can: if the array guard stopped
  // firing, these would sail through as real projected scalars and the
  // commitment would silently start covering a shape the spec excludes.
  assert.deepEqual(projectObservationTyped({ body: "[1,2]", headers: {}, status: 200 }, ["0", "1"]), {});
  assert.deepEqual(projectObservationTyped({ body: `["a","b"]`, headers: {}, status: 200 }, ["0", "length"]), {});
});

test("drift pin: projectObservationTyped selects EXACTLY what projectObservation selects (spec: no second notion of state)", () => {
  // The fork was sanctioned for the ENCODING (A6 type tags), never the
  // SELECTION. If either selection rule changes without the other, this
  // test is the tripwire — approve-time and execute-time inputs must come
  // from one notion of "what the state is".
  const bodies = [
    JSON.stringify({ compiled_truth: "# hi", count: 3, flagged: false, nested: { a: 1 }, arr: [1], nil: null }),
    JSON.stringify({ etag: "W/123", updated_at: "2026-07-29", n: 0, t: true }),
    JSON.stringify({ "0": "numeric-key", "": "empty-key" }),
    "not json",
    "[1,2]",
    "null",
    JSON.stringify({ __proto__: "a" }),
  ];
  const projections = [
    ["compiled_truth", "count", "flagged", "nested", "arr", "nil", "absent"],
    ["etag", "updated_at", "n", "t"],
    ["0", "", "absent"],
    ["a"],
    ["a"],
    ["a"],
    ["__proto__"],
  ];
  for (let i = 0; i < bodies.length; i++) {
    const typed = projectObservationTyped({ body: bodies[i], headers: {} , status: 200}, projections[i]);
    const stringified = projectObservation({ status: 200, headers: {}, body: bodies[i] }, projections[i]);
    assert.deepEqual(
      Object.fromEntries(Object.entries(typed).map(([k, v]) => [k, String(v)])),
      stringified,
      `selection divergence for body ${bodies[i]} projection ${JSON.stringify(projections[i])}`
    );
  }
});

// ---------------------------------------------------------------------------
// Keystore: path resolution, round-trip, durability, loud failure
// ---------------------------------------------------------------------------

test("resolveKeystorePath honors REELIER_EXPECT_KEYS, else ~/.reelier/expect-keys.json", () => {
  assert.equal(resolveKeystorePath({ REELIER_EXPECT_KEYS: "/ci/keys.json" }, "/home/u"), "/ci/keys.json");
  assert.equal(resolveKeystorePath({}, "/home/u"), path.join("/home/u", ".reelier", "expect-keys.json"));
});

test("resolveKeystorePath treats an empty or whitespace-only REELIER_EXPECT_KEYS as unset (a blank CI secret must not resolve to a blank path)", () => {
  // An unset-but-declared CI secret arrives as "" — resolving that to a path
  // of "" would send every mint and lookup to a file nobody can find, and
  // every bound check would degrade to `unevaluated` with no explanation.
  const fallback = path.join("/home/u", ".reelier", "expect-keys.json");
  assert.equal(resolveKeystorePath({ REELIER_EXPECT_KEYS: "" }, "/home/u"), fallback);
  assert.equal(resolveKeystorePath({ REELIER_EXPECT_KEYS: "   " }, "/home/u"), fallback);
  assert.equal(resolveKeystorePath({ REELIER_EXPECT_KEYS: "\t" }, "/home/u"), fallback);
});

test("keystore round-trip: write two entries, read both back; superseded entries are never pruned (A10)", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-expect-"));
  const file = path.join(dir, "expect-keys.json");
  try {
    const a = mintExpectKey();
    const b = mintExpectKey();
    await writeKeystoreEntry(file, a.keyId, { key: a.key.toString("base64"), createdAt: "2026-07-29T00:00:00.000Z", skill: "s", step: 1 });
    await writeKeystoreEntry(file, b.keyId, { key: b.key.toString("base64"), createdAt: "2026-07-29T00:01:00.000Z", skill: "s", step: 1 });
    const store = await readKeystore(file);
    assert.equal(store.v, 1);
    assert.equal(Object.keys(store.keys).length, 2);
    const loadedA = loadExpectKey(store, a.keyId);
    assert.ok(loadedA);
    assert.equal(loadedA.toString("hex"), a.key.toString("hex"));
    assert.equal(loadExpectKey(store, "0000000000000000"), undefined);
    // No temp or lock files left behind.
    const leftovers = (await readdir(dir)).filter((f) => f !== "expect-keys.json");
    assert.deepEqual(leftovers, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("keystore file mode is 0600 on POSIX", { skip: process.platform === "win32" }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-expect-"));
  const file = path.join(dir, "expect-keys.json");
  try {
    const a = mintExpectKey();
    await writeKeystoreEntry(file, a.keyId, { key: a.key.toString("base64"), createdAt: "2026-07-29T00:00:00.000Z" });
    const mode = (await stat(file)).mode & 0o777;
    assert.equal(mode, 0o600);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readKeystore: missing file is a fresh empty keystore (normal first run)", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-expect-"));
  try {
    const store = await readKeystore(path.join(dir, "nope.json"));
    assert.deepEqual(store, { v: 1, keys: {} });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readKeystore: malformed JSON and wrong shape are loud failures, never a silent empty store", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-expect-"));
  try {
    const badJson = path.join(dir, "bad.json");
    await writeFile(badJson, "{not json", "utf8");
    // Specifically the JSON diagnosis — a generic /keystore/i also matches the
    // downstream "malformed (expected an object)" you'd get if the parse
    // failure were swallowed, which would send the operator looking for a
    // shape bug in a file that simply doesn't parse.
    await assert.rejects(() => readKeystore(badJson), /is not valid JSON/);

    const badShape = path.join(dir, "shape.json");
    await writeFile(badShape, JSON.stringify({ v: 2, keys: {} }), "utf8");
    await assert.rejects(() => readKeystore(badShape), /keystore/i);

    const badEntry = path.join(dir, "entry.json");
    await writeFile(badEntry, JSON.stringify({ v: 1, keys: { "3c9a01d2e4f5b6a7": { createdAt: "x" } } }), "utf8");
    await assert.rejects(() => readKeystore(badEntry), /keystore/i);

    // keyIds must be 16 lowercase hex — also closes the '__proto__' keyId
    // prototype-setter hazard (a crafted keyId must be LOUD, never a
    // silently vanishing entry).
    const badKeyId = path.join(dir, "keyid.json");
    const goodKey = Buffer.alloc(32, 0x11).toString("base64");
    // Raw string on purpose: a {__proto__: ...} object LITERAL sets the
    // prototype and never serializes — only hand-crafted JSON reaches
    // readKeystore with this shape.
    await writeFile(badKeyId, `{"v":1,"keys":{"__proto__":{"key":"${goodKey}","createdAt":"x"}}}`, "utf8");
    await assert.rejects(() => readKeystore(badKeyId), /keystore.*keyId/is);

    // An all-zero placeholder key must be refused at the store-read
    // boundary, not detonate later inside expectMac mid-run (I-6 layering).
    const zeroKey = path.join(dir, "zero.json");
    await writeFile(
      zeroKey,
      JSON.stringify({ v: 1, keys: { "3c9a01d2e4f5b6a7": { key: Buffer.alloc(32, 0).toString("base64"), createdAt: "x" } } }),
      "utf8"
    );
    await assert.rejects(() => readKeystore(zeroKey), /all-zero/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// Every branch of readKeystore's shape validation, each pinned to its OWN
// message. A keystore that exists but can't be trusted must fail loudly and
// specifically — "some error happened" is not enough, because the whole point
// is that a malformed store never silently degrades to "no keys" (which would
// flip every bound check to `unevaluated`).
test("readKeystore rejects each malformed shape with its specific message — never a generic or silent failure", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-expect-"));
  const goodKey = Buffer.alloc(32, 0x11).toString("base64");
  const ID = "3c9a01d2e4f5b6a7";
  let n = 0;
  /** Write `raw` to a fresh file and assert readKeystore rejects it with `re`. */
  const rejects = async (raw: string, re: RegExp, why: string) => {
    const file = path.join(dir, `bad-${n++}.json`);
    await writeFile(file, raw, "utf8");
    await assert.rejects(() => readKeystore(file), re, why);
  };
  try {
    // Top level must be a non-array object: an array and a bare `null` are
    // both "parsed fine, wrong shape" — the branch a naive typeof check misses.
    await rejects(`[]`, /malformed \(expected an object\)/, "a JSON array is not a keystore");
    await rejects(`null`, /malformed \(expected an object\)/, "JSON null is not a keystore");
    await rejects(`"a string"`, /malformed \(expected an object\)/, "a JSON string is not a keystore");

    // 'keys' must be a non-array object. The scalar cases matter as much as
    // the array/null ones: Object.entries(5) is a harmless [], so a store
    // with a scalar 'keys' would otherwise read as an empty-but-valid
    // keystore and silently strand every lookup.
    await rejects(`{"v":1,"keys":[]}`, /'keys' must be an object/, "keys as an array");
    await rejects(`{"v":1,"keys":null}`, /'keys' must be an object/, "keys as null");
    await rejects(`{"v":1,"keys":5}`, /'keys' must be an object/, "keys as a number");
    await rejects(`{"v":1,"keys":"x"}`, /'keys' must be an object/, "keys as a string");
    await rejects(`{"v":1,"keys":true}`, /'keys' must be an object/, "keys as a boolean");

    // Entries must be non-array objects.
    await rejects(`{"v":1,"keys":{"${ID}":[]}}`, /entry '3c9a01d2e4f5b6a7' must be an object/, "entry as an array");
    await rejects(`{"v":1,"keys":{"${ID}":null}}`, /entry '3c9a01d2e4f5b6a7' must be an object/, "entry as null");
    await rejects(`{"v":1,"keys":{"${ID}":"nope"}}`, /entry '3c9a01d2e4f5b6a7' must be an object/, "entry as a string");

    // createdAt must be a NON-EMPTY string (empty is the case a bare typeof
    // check waves through).
    await rejects(
      `{"v":1,"keys":{"${ID}":{"key":"${goodKey}","createdAt":""}}}`,
      /needs a string 'createdAt'/,
      "empty-string createdAt"
    );
    await rejects(
      `{"v":1,"keys":{"${ID}":{"key":"${goodKey}","createdAt":17}}}`,
      /needs a string 'createdAt'/,
      "non-string createdAt"
    );

    // Optional bookkeeping fields are optional, but never wrong-typed.
    await rejects(
      `{"v":1,"keys":{"${ID}":{"key":"${goodKey}","createdAt":"x","skill":5}}}`,
      /non-string 'skill'/,
      "numeric skill"
    );
    await rejects(
      `{"v":1,"keys":{"${ID}":{"key":"${goodKey}","createdAt":"x","step":"1"}}}`,
      /non-number 'step'/,
      "string step"
    );

    // A base64 'key' that decodes to the wrong length is refused at the
    // store-read boundary (so expectMac's I-6 throw stays a programmer-error
    // signal, never a mid-run detonation).
    await rejects(
      `{"v":1,"keys":{"${ID}":{"key":"${Buffer.alloc(16, 0x11).toString("base64")}","createdAt":"x"}}}`,
      /base64 'key' decoding to 32 bytes/,
      "16-byte key"
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readKeystore's keyId check is anchored at BOTH ends — a 16-hex run buried in a longer keyId is still malformed", async () => {
  // '__proto__' (covered above) is rejected by any of these regex variants, so
  // it alone can't prove the anchors are intact. These two can: each is
  // 17 chars containing a valid 16-hex run at one end, so dropping either
  // anchor would wave one of them through and silently accept a corrupt keyId.
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-expect-"));
  const goodKey = Buffer.alloc(32, 0x11).toString("base64");
  try {
    for (const badKeyId of [
      "03c9a01d2e4f5b6a7", // 16 valid hex chars at the END — survives a missing '^'
      "3c9a01d2e4f5b6a7f", // 16 valid hex chars at the START — survives a missing '$'
      "z3c9a01d2e4f5b6a7", // non-hex prefix, hex run at the end
    ]) {
      const file = path.join(dir, `${badKeyId}.json`);
      await writeFile(file, `{"v":1,"keys":{"${badKeyId}":{"key":"${goodKey}","createdAt":"x"}}}`, "utf8");
      await assert.rejects(
        () => readKeystore(file),
        /is not 16 lowercase hex chars/,
        `keyId ${JSON.stringify(badKeyId)} must be rejected`
      );
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readKeystore: only ENOENT is a fresh empty store — any other read failure is loud (never a silent 'no keys')", async () => {
  // A store that exists but is unreadable (here: the path is a directory)
  // must NOT read as "no keys yet". That degradation would flip every bound
  // check to `unevaluated` while looking exactly like a normal first run.
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-expect-"));
  try {
    await assert.rejects(() => readKeystore(dir), /could not be read/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("writeKeystoreEntry retries on a held lock and fails loudly when it never frees (A10)", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-expect-"));
  const file = path.join(dir, "expect-keys.json");
  const lock = `${file}.lock`;
  try {
    await writeFile(lock, "held", "utf8");
    const a = mintExpectKey();
    const slept: number[] = [];
    await assert.rejects(
      () =>
        writeKeystoreEntry(
          file,
          a.keyId,
          { key: a.key.toString("base64"), createdAt: "2026-07-29T00:00:00.000Z" },
          { lockRetries: 2, lockRetryDelayMs: 5, sleepImpl: async (ms) => void slept.push(ms) }
        ),
      /lock/i
    );
    // The upper end of the budget: 2 retries buys exactly 2 sleeps before the
    // loud failure — never a third (which would mean the loop outspends what
    // the caller authorised) and never fewer (which would mean it gave up early).
    assert.deepEqual(slept, [5, 5]);
    // The held lock (not ours) must NOT have been deleted.
    assert.equal(await readFile(lock, "utf8"), "held");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("writeKeystoreEntry spends exactly the retries it was given — lockRetries: 0 fails on the first attempt without sleeping (A10 off-by-one)", async () => {
  // Both the correct `attempt >= retries` and an off-by-one `attempt >`
  // eventually throw the same message, so the retry BUDGET is not observable
  // in the error at all — only in whether a sleep happened. Two independent
  // assertions cover each other's blind spot:
  //   - the sleep ledger is exact and instant: an off-by-one shows up as one
  //     recorded sleep, not as a 5s test.
  //   - the elapsed bound still watches the REAL clock, so a future refactor
  //     that sleeps past the seam (leaving the ledger empty while burning the
  //     5s delay) fails here rather than passing silently.
  // Neither is a race: the correct path performs no sleep at all, by either
  // route, so there is no window for load to close.
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-expect-"));
  const file = path.join(dir, "expect-keys.json");
  const lock = `${file}.lock`;
  try {
    await writeFile(lock, "held", "utf8");
    const a = mintExpectKey();
    const slept: number[] = [];
    const startedAt = Date.now();
    await assert.rejects(
      () =>
        writeKeystoreEntry(
          file,
          a.keyId,
          { key: a.key.toString("base64"), createdAt: "2026-07-29T00:00:00.000Z" },
          { lockRetries: 0, lockRetryDelayMs: 5000, sleepImpl: async (ms) => void slept.push(ms) }
        ),
      /lock/i
    );
    const elapsedMs = Date.now() - startedAt;
    assert.deepEqual(slept, [], "lockRetries: 0 must give up without sleeping");
    assert.ok(elapsedMs < 2000, `lockRetries: 0 must not sleep past the seam either, but took ${elapsedMs}ms`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("writeKeystoreEntry proceeds once the lock frees (A10 retry path)", async () => {
  // The lock is freed FROM INSIDE the retry sleep, so "the lock outlived two
  // retries and then went away" is a fact this test establishes rather than a
  // race it hopes to win. The previous form started a 30ms release timer and
  // hoped it landed inside a 100x10ms retry budget. It could lose two ways,
  // and under CPU contention the same write took anywhere from 46ms to 4860ms
  // (measured over 120 loaded iterations), so nothing bounded the margin it
  // depended on: the budget can run out before the release lands, or the
  // release's unlink can race the loop's own O_EXCL create and come back EPERM
  // on win32 (seen once in 60 loaded iterations — that one is a real defect,
  // fixed in updateKeystore and covered below). Nothing here reads a clock.
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-expect-"));
  const file = path.join(dir, "expect-keys.json");
  const lock = `${file}.lock`;
  try {
    await writeFile(lock, "held", "utf8");
    const a = mintExpectKey();
    const slept: number[] = [];
    await writeKeystoreEntry(
      file,
      a.keyId,
      { key: a.key.toString("base64"), createdAt: "2026-07-29T00:00:00.000Z" },
      {
        lockRetries: 100,
        lockRetryDelayMs: 10,
        sleepImpl: async (ms) => {
          slept.push(ms);
          if (slept.length === 2) await rm(lock, { force: true });
        },
      },
    );
    // Retry accounting, not elapsed time: it slept while the lock was held,
    // stopped the moment it was free, and spent nothing extra. A loop that
    // never retried would record 0 sleeps; one that kept sleeping past the
    // release would record more than 2.
    assert.deepEqual(slept, [10, 10]);
    const store = await readKeystore(file);
    assert.ok(store.keys[a.keyId]);
    // The lock it took to do the write is its own, and it released it.
    await assert.rejects(() => stat(lock), { code: "ENOENT" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("writeKeystoreEntry retries a lock create that fails with EPERM — a concurrent RELEASE is contention, not a fatal error (A10, win32 delete-pending)", async () => {
  // On win32 an unlink marks the file delete-pending; an O_EXCL create landing
  // in that window returns EPERM rather than EEXIST (measured on win32 with no
  // load: 29 EPERM in 3000 create-vs-unlink races). That is another approver
  // handing the lock over — exactly what the retry loop is for — so treating
  // it as fatal turns normal contention into a failed approve and an
  // unwritten key. Forced through the seam because the real window is
  // microseconds wide and platform-specific; a test that waited for it would
  // be the flake this file just removed.
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-expect-"));
  const file = path.join(dir, "expect-keys.json");
  try {
    const a = mintExpectKey();
    let attempts = 0;
    await writeKeystoreEntry(
      file,
      a.keyId,
      { key: a.key.toString("base64"), createdAt: "2026-07-29T00:00:00.000Z" },
      {
        lockRetries: 5,
        lockRetryDelayMs: 1,
        sleepImpl: async () => {},
        lockCreateImpl: async (lockPath, contents) => {
          if (++attempts === 1) {
            const err: NodeJS.ErrnoException = new Error(`EPERM: operation not permitted, open '${lockPath}'`);
            err.code = "EPERM";
            throw err;
          }
          await writeFile(lockPath, contents, { flag: "wx" });
        },
      },
    );
    assert.equal(attempts, 2, "the EPERM attempt must be retried, not surfaced");
    const store = await readKeystore(file);
    assert.ok(store.keys[a.keyId]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("writeKeystoreEntry surfaces a lock create error that never clears — a persistent EPERM is a permission failure, never a 'locked' message (A10)", async () => {
  // The other half of the branch above, and the reason its budget is 3 rather
  // than the full lock budget: an unwritable directory returns EPERM forever.
  // Retrying it to exhaustion would report "is locked ... remove the stale
  // lock", sending an operator to delete a file that was never the problem.
  // The real errno has to survive.
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-expect-"));
  const file = path.join(dir, "expect-keys.json");
  try {
    const a = mintExpectKey();
    let attempts = 0;
    await assert.rejects(
      () =>
        writeKeystoreEntry(
          file,
          a.keyId,
          { key: a.key.toString("base64"), createdAt: "2026-07-29T00:00:00.000Z" },
          {
            lockRetries: 50,
            lockRetryDelayMs: 1,
            sleepImpl: async () => {},
            lockCreateImpl: async () => {
              attempts++;
              const err: NodeJS.ErrnoException = new Error("EACCES: permission denied, open 'expect-keys.json.lock'");
              err.code = "EACCES";
              throw err;
            },
          },
        ),
      (err: Error) => {
        assert.equal((err as NodeJS.ErrnoException).code, "EACCES");
        assert.doesNotMatch(err.message, /is locked/, "a permission failure must not be reported as a held lock");
        return true;
      }
    );
    // Bounded: it gives up well inside the 50-retry lock budget rather than
    // burning it on an error that is not contention.
    assert.equal(attempts, TRANSIENT_LOCK_CREATE_RETRIES + 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
