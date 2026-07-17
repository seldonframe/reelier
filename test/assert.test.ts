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
