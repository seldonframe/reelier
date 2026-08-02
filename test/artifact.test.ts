// Pre-dispatch artifact attestation (docs/specs/artifact-attestation-v1.md
// §5): the projection over FILLED action args, the unsalted whole-artifact
// digest, and the keyed per-field commitments.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  ARTIFACT_NAMESPACE,
  artifactDigest,
  artifactFieldMac,
  partitionArtifact,
  projectArtifact,
} from "../src/artifact.js";
import { expectFieldMac, mintExpectKey } from "../src/expect-mac.js";

const ARGS = { to: "a@example.com", subject: "hi", n: 7, flag: true };

// ---------------------------------------------------------------------------
// projectArtifact — selection semantics inherited from projectObservationTyped
// ---------------------------------------------------------------------------

test("the namespace is 'args.' and nothing else", () => {
  assert.equal(ARTIFACT_NAMESPACE, "args.");
});

test("projectArtifact selects top-level scalars, keeping the args. spelling as the output key", () => {
  const out = projectArtifact(ARGS, ["args.to", "args.n", "args.flag"]);
  assert.deepEqual(out, { "args.to": "a@example.com", "args.n": 7, "args.flag": true });
});

test("projectArtifact refuses an entry without the args. prefix — there is no bare form", () => {
  // §4 [Normative]: every entry MUST carry the explicit prefix. The parser
  // enforces it, so reaching here with a bare entry is a caller bug.
  assert.throws(() => projectArtifact(ARGS, ["to"]), /args\./);
});

test("projectArtifact refuses args.__proto__ rather than silently dropping it (A6 false-MATCH class)", () => {
  assert.throws(() => projectArtifact({ x: 1 }, ["args.__proto__"]), /__proto__/);
});

test("projectArtifact refuses an own __proto__ key at any depth, even under an unresolved non-scalar", () => {
  const args = JSON.parse('{"message":{"__proto__":{"leak":true}}}') as unknown;
  assert.throws(() => projectArtifact(args, ["args.message"]), /__proto__.*message/i);
});

test("artifact coverage uses the shared absent-field caps: at most 32 names of at most 120 chars", () => {
  assert.throws(
    () => projectArtifact({}, Array.from({ length: 33 }, (_, i) => `args.field_${i}`)),
    /at most 32/i,
  );
  assert.throws(() => projectArtifact({}, [`args.${"x".repeat(116)}`]), /at most 120/i);
});

test("a non-scalar value is not projected — object, array and null alike", () => {
  const out = projectArtifact({ a: { deep: 1 }, b: [1, 2], c: null, d: "ok" }, [
    "args.a",
    "args.b",
    "args.c",
    "args.d",
  ]);
  assert.deepEqual(out, { "args.d": "ok" });
});

test("filled args that are not a JSON object project nothing", () => {
  assert.deepEqual(projectArtifact("a string", ["args.to"]), {});
  assert.deepEqual(projectArtifact([1, 2], ["args.to"]), {});
  assert.deepEqual(projectArtifact(null, ["args.to"]), {});
});

test("an inherited property is not projected — own properties only", () => {
  assert.deepEqual(projectArtifact({}, ["args.constructor", "args.toString"]), {});
});

// ---------------------------------------------------------------------------
// partitionArtifact — §5.3, declared coverage that did not resolve is reported
// ---------------------------------------------------------------------------

test("partitionArtifact splits the declared projection into resolved and unresolved, order preserved", () => {
  const { resolved, unresolved } = partitionArtifact(
    { to: "a@example.com", body: { rendered: "server-side" } },
    ["args.to", "args.body", "args.attachment_id"]
  );
  assert.deepEqual(resolved, ["args.to"]);
  assert.deepEqual(unresolved, ["args.body", "args.attachment_id"]);
});

test("resolved and unresolved always partition the declared projection exactly", () => {
  const projection = ["args.to", "args.missing", "args.n"];
  const { resolved, unresolved } = partitionArtifact(ARGS, projection);
  assert.deepEqual([...resolved, ...unresolved].sort(), [...projection].sort());
  assert.equal(resolved.length + unresolved.length, projection.length);
});

// ---------------------------------------------------------------------------
// artifactDigest — §5.1, unsalted and recomputable
// ---------------------------------------------------------------------------

test("artifactDigest is a sha256:<64 hex> over the projected artifact", () => {
  const d = artifactDigest("send_email", projectArtifact(ARGS, ["args.to"]));
  assert.match(d, /^sha256:[0-9a-f]{64}$/);
});

test("artifactDigest is stable and independent of projection insertion order", () => {
  const a = artifactDigest("send_email", projectArtifact(ARGS, ["args.to", "args.subject"]));
  const b = artifactDigest("send_email", projectArtifact(ARGS, ["args.subject", "args.to"]));
  assert.equal(a, b);
});

test("artifactDigest type-tags values: 1, \"1\" and true commit differently (A6)", () => {
  const n = artifactDigest("t", projectArtifact({ v: 1 }, ["args.v"]));
  const s = artifactDigest("t", projectArtifact({ v: "1" }, ["args.v"]));
  const b = artifactDigest("t", projectArtifact({ v: true }, ["args.v"]));
  assert.notEqual(n, s);
  assert.notEqual(n, b);
  assert.notEqual(s, b);
});

test("artifactDigest binds the action tool name — same artifact, different tool, different digest", () => {
  const projected = projectArtifact(ARGS, ["args.to"]);
  assert.notEqual(artifactDigest("send_email", projected), artifactDigest("send_sms", projected));
});

test("artifactDigest changes when any covered value changes", () => {
  const before = artifactDigest("send_email", projectArtifact(ARGS, ["args.to"]));
  const after = artifactDigest("send_email", projectArtifact({ ...ARGS, to: "b@example.com" }, ["args.to"]));
  assert.notEqual(before, after);
});

// ---------------------------------------------------------------------------
// artifactFieldMac — §5.2, keyed, diagnosis only, domain-separated
// ---------------------------------------------------------------------------

test("artifactFieldMac is an hmac-sha256:<64 hex> under the per-approval key", () => {
  const { key } = mintExpectKey();
  assert.match(artifactFieldMac(key, "send_email", "args.to", "a@example.com"), /^hmac-sha256:[0-9a-f]{64}$/);
});

test("artifactFieldMac uses the normative {artifact,field,tool,v,value} domain shape", () => {
  const key = Buffer.alloc(32, 7);
  const expected =
    "hmac-sha256:" +
    createHmac("sha256", key)
      .update(
        '{"artifact":true,"field":"args.to","tool":"send_email","v":1,"value":"s:a@example.com"}',
        "utf8",
      )
      .digest("hex");
  assert.equal(artifactFieldMac(key, "send_email", "args.to", "a@example.com"), expected);
});

test("artifactFieldMac is domain-separated from expectFieldMac for identical inputs", () => {
  // §5.2: separated by canonical-JSON input SHAPE ({artifact,field,tool,v,value} vs
  // {field,probe,v,value}). Same key, same names, same value — different MAC.
  const { key } = mintExpectKey();
  const mine = artifactFieldMac(key, "send_email", "args.to", "a@example.com");
  const theirs = expectFieldMac(key, "send_email", "args.to", "a@example.com");
  assert.notEqual(mine, theirs);
});

test("artifactFieldMac differs per value and per field name", () => {
  const { key } = mintExpectKey();
  const base = artifactFieldMac(key, "t", "args.to", "a@example.com");
  assert.notEqual(base, artifactFieldMac(key, "t", "args.to", "b@example.com"));
  assert.notEqual(base, artifactFieldMac(key, "t", "args.cc", "a@example.com"));
});

test("artifactFieldMac refuses an unusable key rather than committing under it (I-6)", () => {
  assert.throws(() => artifactFieldMac(new Uint8Array(32), "t", "args.to", "x"), /placeholder|all-zero/i);
  assert.throws(() => artifactFieldMac(new Uint8Array(8), "t", "args.to", "x"), /32 bytes|length/i);
});
