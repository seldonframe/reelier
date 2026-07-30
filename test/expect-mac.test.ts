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
  projectObservationTyped,
  resolveKeystorePath,
  readKeystore,
  writeKeystoreEntry,
  loadExpectKey,
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
// Typed projection: same selection semantics as projectObservation's
// explicit-projection branch, types preserved (A6)
// ---------------------------------------------------------------------------

test("projectObservationTyped selects declared top-level body scalars, preserving type", () => {
  const body = JSON.stringify({ compiled_truth: "# hi", count: 3, flagged: false, nested: { a: 1 }, arr: [1], nil: null });
  const out = projectObservationTyped({ body, headers: {} }, ["compiled_truth", "count", "flagged", "nested", "arr", "nil", "absent"]);
  assert.deepEqual(out, {
    "body.compiled_truth": "# hi",
    "body.count": 3,
    "body.flagged": false,
  });
});

test("projectObservationTyped mirrors projectObservation: non-JSON body → empty; array body → empty", () => {
  assert.deepEqual(projectObservationTyped({ body: "not json", headers: {} }, ["a"]), {});
  assert.deepEqual(projectObservationTyped({ body: "[1,2]", headers: {} }, ["a"]), {});
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
    const typed = projectObservationTyped({ body: bodies[i], headers: {} }, projections[i]);
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
    await assert.rejects(() => readKeystore(badJson), /keystore/i);

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

test("writeKeystoreEntry retries on a held lock and fails loudly when it never frees (A10)", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-expect-"));
  const file = path.join(dir, "expect-keys.json");
  const lock = `${file}.lock`;
  try {
    await writeFile(lock, "held", "utf8");
    const a = mintExpectKey();
    await assert.rejects(
      () =>
        writeKeystoreEntry(
          file,
          a.keyId,
          { key: a.key.toString("base64"), createdAt: "2026-07-29T00:00:00.000Z" },
          { lockRetries: 2, lockRetryDelayMs: 5 }
        ),
      /lock/i
    );
    // The held lock (not ours) must NOT have been deleted.
    assert.equal(await readFile(lock, "utf8"), "held");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("writeKeystoreEntry proceeds once the lock frees (A10 retry path)", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-expect-"));
  const file = path.join(dir, "expect-keys.json");
  const lock = `${file}.lock`;
  try {
    await writeFile(lock, "held", "utf8");
    const a = mintExpectKey();
    const write = writeKeystoreEntry(
      file,
      a.keyId,
      { key: a.key.toString("base64"), createdAt: "2026-07-29T00:00:00.000Z" },
      { lockRetries: 100, lockRetryDelayMs: 10 }
    );
    const release = new Promise((r) => setTimeout(r, 30)).then(() => rm(lock, { force: true }));
    await write;
    await release;
    const store = await readKeystore(file);
    assert.ok(store.keys[a.keyId]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
