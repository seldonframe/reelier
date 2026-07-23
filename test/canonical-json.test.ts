import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalJson, digestSha256 } from "../src/canonical-json.js";

test("object keys are sorted recursively", () => {
  assert.equal(
    canonicalJson({ b: 1, a: { d: 2, c: [3, { z: 4, y: 5 }] } }),
    '{"a":{"c":[3,{"y":5,"z":4}],"d":2},"b":1}'
  );
});

test("key order does not change the digest; value change does", () => {
  const d1 = digestSha256({ a: 1, b: 2 });
  const d2 = digestSha256({ b: 2, a: 1 });
  const d3 = digestSha256({ a: 1, b: 3 });
  assert.equal(d1, d2);
  assert.notEqual(d1, d3);
  assert.match(d1, /^sha256:[0-9a-f]{64}$/);
});

test("arrays preserve order", () => {
  assert.notEqual(canonicalJson([1, 2]), canonicalJson([2, 1]));
});

test("primitives and null round through", () => {
  assert.equal(canonicalJson(null), "null");
  assert.equal(canonicalJson("x"), '"x"');
  assert.equal(canonicalJson(3), "3");
});
