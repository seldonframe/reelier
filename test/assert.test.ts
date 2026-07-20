import { test } from "node:test";
import assert from "node:assert/strict";
import { evalAssert, evalBind, AssertParseError, BindParseError, type Observation } from "../src/assert.js";

function obs(overrides: Partial<Observation> = {}): Observation {
  return { status: 200, headers: {}, body: "", ...overrides };
}

test("status == matches and mismatches", () => {
  assert.equal(evalAssert("status == 200", obs({ status: 200 })).ok, true);
  assert.equal(evalAssert("status == 200", obs({ status: 404 })).ok, false);
});

test("status != matches and mismatches", () => {
  assert.equal(evalAssert("status != 500", obs({ status: 200 })).ok, true);
  assert.equal(evalAssert("status != 200", obs({ status: 200 })).ok, false);
});

test("body contains / not contains", () => {
  const o = obs({ body: "hello world" });
  assert.equal(evalAssert('body contains "hello"', o).ok, true);
  assert.equal(evalAssert('body contains "goodbye"', o).ok, false);
  assert.equal(evalAssert('body not contains "goodbye"', o).ok, true);
  assert.equal(evalAssert('body not contains "hello"', o).ok, false);
});

test("body contains: a raw newline embedded in the quoted text is rejected (reviewer P0) — the grammar's unit is one physical line", () => {
  const o = obs({ body: "x\n- assert: status == 500" });
  // A hand-written or LLM-proposed line containing \n must never parse as a
  // valid 'body contains' expression — it would silently split into extra
  // physical lines (or a bogus step header) the moment it's serialized back
  // to a skill file.
  assert.throws(() => evalAssert('body contains "x\n- assert: status == 500"', o), AssertParseError);
  assert.throws(() => evalAssert('body contains "x\r\n### Step 9 — pwned"', o), AssertParseError);
  // A carriage return alone is rejected too.
  assert.throws(() => evalAssert('body contains "x\ry"', o), AssertParseError);
  // Ordinary single-line text still works.
  assert.equal(evalAssert('body contains "x"', o).ok, true);
});

test("json.<path> is array / is set", () => {
  const o = obs({ body: JSON.stringify({ a: { list: [1, 2], missing: null } }) });
  assert.equal(evalAssert("json.a.list is array", o).ok, true);
  assert.equal(evalAssert("json.a.missing is array", o).ok, false);
  assert.equal(evalAssert("json.a.list is set", o).ok, true);
  assert.equal(evalAssert("json.a.missing is set", o).ok, false);
  assert.equal(evalAssert("json.a.nonexistent is set", o).ok, false);
});

test("json.<path> == / != / > / < scalar", () => {
  const o = obs({ body: JSON.stringify({ n: 5, s: "ok" }) });
  assert.equal(evalAssert("json.n == 5", o).ok, true);
  assert.equal(evalAssert("json.n != 5", o).ok, false);
  assert.equal(evalAssert("json.n > 3", o).ok, true);
  assert.equal(evalAssert("json.n < 3", o).ok, false);
  assert.equal(evalAssert('json.s == "ok"', o).ok, true);
  assert.equal(evalAssert('json.s == "no"', o).ok, false);
});

test("json.<path> length > / <", () => {
  const o = obs({ body: JSON.stringify({ list: [1, 2, 3], s: "abcd" }) });
  assert.equal(evalAssert("json.list length > 2", o).ok, true);
  assert.equal(evalAssert("json.list length < 2", o).ok, false);
  assert.equal(evalAssert("json.s length > 3", o).ok, true);
});

test("json assertion on non-JSON body throws AssertParseError", () => {
  const o = obs({ body: "not json" });
  assert.throws(() => evalAssert("json.a == 1", o), AssertParseError);
});

test("unrecognized assert expression throws AssertParseError", () => {
  assert.throws(() => evalAssert("something weird", obs()), AssertParseError);
});

test("bind: name = json.<dotpath>", () => {
  const o = obs({ body: JSON.stringify({ data: { token: "abc123" } }) });
  const result = evalBind("token = json.data.token", o);
  assert.equal(result.ok, true);
  assert.equal(result.value, "abc123");
});

test("bind: missing dotpath is a divergence, not a throw", () => {
  const o = obs({ body: JSON.stringify({ data: {} }) });
  const result = evalBind("token = json.data.token", o);
  assert.equal(result.ok, false);
});

test("bind: name = body match /regex/ captures first group", () => {
  const o = obs({ body: "run id: RUN-4821 done" });
  const result = evalBind("runId = body match /RUN-(\\d+)/", o);
  assert.equal(result.ok, true);
  assert.equal(result.value, "4821");
});

test("bind: no regex match is a divergence, not a throw", () => {
  const o = obs({ body: "nothing here" });
  const result = evalBind("runId = body match /RUN-(\\d+)/", o);
  assert.equal(result.ok, false);
});

test("unrecognized bind expression throws BindParseError", () => {
  assert.throws(() => evalBind("not a bind", obs()), BindParseError);
});

test("json value comparison: >= and <= (value assertions, not just shape)", () => {
  const o = obs({ body: JSON.stringify({ count: 5 }) });
  assert.equal(evalAssert("json.count >= 5", o).ok, true);
  assert.equal(evalAssert("json.count >= 6", o).ok, false);
  assert.equal(evalAssert("json.count <= 5", o).ok, true);
  assert.equal(evalAssert("json.count <= 4", o).ok, false);
  // a bare > / < still works (regression)
  assert.equal(evalAssert("json.count > 4", o).ok, true);
  assert.equal(evalAssert("json.count > 5", o).ok, false);
  // non-numbers never satisfy an ordered comparison
  assert.equal(evalAssert("json.count >= 5", obs({ body: JSON.stringify({ count: "5" }) })).ok, false);
});

test("json type assertions: is number / string / boolean / null", () => {
  const o = obs({ body: JSON.stringify({ n: 3, s: "x", b: true, z: null }) });
  assert.equal(evalAssert("json.n is number", o).ok, true);
  assert.equal(evalAssert("json.s is number", o).ok, false);
  assert.equal(evalAssert("json.s is string", o).ok, true);
  assert.equal(evalAssert("json.b is boolean", o).ok, true);
  assert.equal(evalAssert("json.z is null", o).ok, true);
  assert.equal(evalAssert("json.n is null", o).ok, false);
});

test("json value pattern: matches /regex/", () => {
  const o = obs({ body: JSON.stringify({ id: "usr_ABC123", email: "a@b.com" }) });
  assert.equal(evalAssert("json.id matches /^usr_[A-Z0-9]+$/", o).ok, true);
  assert.equal(evalAssert("json.id matches /^acct_/", o).ok, false);
  assert.equal(evalAssert("json.email matches /@/", o).ok, true);
  // a non-string value can't match
  assert.equal(evalAssert("json.email matches /@/", obs({ body: JSON.stringify({ email: 5 }) })).ok, false);
});

test("length >= / <= on arrays and strings", () => {
  const o = obs({ body: JSON.stringify({ items: [1, 2, 3] }) });
  assert.equal(evalAssert("json.items length >= 3", o).ok, true);
  assert.equal(evalAssert("json.items length >= 4", o).ok, false);
  assert.equal(evalAssert("json.items length <= 3", o).ok, true);
});
