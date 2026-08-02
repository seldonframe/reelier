// Argument provenance, slice 1: the leaf grammar and the resolver.
// Spec: docs/specs/argument-provenance-v1.md §§6-7.
//
// Pure functions only — no wiring into the runner or the wrap. Nothing here
// reads or writes a record, and nothing here can change an outcome or an exit
// code (spec §2, rule 4).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  enumerateScalarLeaves,
  buildSourceIndex,
  resolveArgs,
  LiveProvenanceIndex,
  capNameList,
  NORMALIZATIONS,
  type ProvenanceSource,
  type LeafResolution,
} from "../src/provenance.js";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function response(id: string, value: unknown): ProvenanceSource {
  return { kind: "response", id, value };
}

/** The resolution for one path, or undefined. Tests read one leaf at a time. */
function at(rows: LeafResolution[], path: string): LeafResolution | undefined {
  return rows.find((r) => r.path === path);
}

function resolveOne(outbound: unknown, sources: ProvenanceSource[]): LeafResolution {
  const rows = resolveArgs({ v: outbound }, buildSourceIndex(sources));
  const row = at(rows, "args.v");
  assert.ok(row, "expected a resolution for args.v");
  return row;
}

// ---------------------------------------------------------------------------
// §6 — the leaf grammar
// ---------------------------------------------------------------------------

test("scalar leaves of a nested object are addressed under the args. prefix", () => {
  const leaves = enumerateScalarLeaves({ customer: { phone: "555", name: "Jo" } }, "args");
  assert.deepEqual(leaves, [
    { path: "args.customer.phone", value: "555" },
    { path: "args.customer.name", value: "Jo" },
  ]);
});

test("array elements are addressed by index", () => {
  const leaves = enumerateScalarLeaves({ items: [{ sku: "A" }, { sku: "B" }] }, "args");
  assert.deepEqual(leaves.map((l) => l.path), ["args.items[0].sku", "args.items[1].sku"]);
});

test("containers are not addressed — an object with no scalar leaves contributes nothing", () => {
  assert.deepEqual(enumerateScalarLeaves({ meta: {}, tags: [] }, "args"), []);
});

test("null is not a scalar leaf", () => {
  assert.deepEqual(enumerateScalarLeaves({ note: null }, "args"), []);
});

test("an own __proto__ key at any depth is refused loudly, never silently dropped", () => {
  const nested = JSON.parse('{"a":{"__proto__":{"x":1}}}');
  assert.throws(() => enumerateScalarLeaves(nested, "args"), /__proto__/);
});

// ---------------------------------------------------------------------------
// §7.1 — tier 1, exact
// ---------------------------------------------------------------------------

test("a value identical to a prior response leaf is grounded, naming the source coordinate", () => {
  const row = resolveOne("+15551234567", [response("call:3", { phone: "+15551234567" })]);
  assert.equal(row.state, "grounded");
  assert.equal(row.state === "grounded" && row.via, "exact");
  assert.deepEqual(row.state === "grounded" && row.from, { source: "call:3", at: "body.phone" });
});

test("a value present in no source is authored", () => {
  const row = resolveOne("not provided", [response("call:3", { phone: "+15551234567" })]);
  assert.equal(row.state, "authored");
});

test("the runner's own stringification is sanctioned: a string grounds against the number it came from", () => {
  // src/runner.ts:470 — fillTemplate stringifies every non-string binding, so
  // refusing this would report `authored` on a value Reelier itself converted.
  const row = resolveOne("42", [response("call:1", { count: 42 })]);
  assert.equal(row.state, "grounded");
  assert.equal(row.state === "grounded" && row.via, "exact");
});

test("no OTHER stringification is sanctioned — a serialized container does not ground", () => {
  const row = resolveOne('{"a":1}', [response("call:1", { payload: { a: 1 } })]);
  assert.equal(row.state, "authored");
});

test("type tags cannot be forged from inside a string value", () => {
  // tagScalar's A6 guarantee: the string "n:1" tags to "s:n:1" and must never
  // collide with the number 1's "n:1".
  const row = resolveOne(1, [response("call:1", { weird: "n:1" })]);
  assert.equal(row.state, "authored");
});

// ---------------------------------------------------------------------------
// §7.2 — tier 2, the closed normalization list
// ---------------------------------------------------------------------------

test("the normalization list is closed and pinned verbatim", () => {
  // Adding a tier means editing this line, which means saying why (§1.1 — the
  // arithmetic tier is the door business rules walk through).
  assert.deepEqual([...NORMALIZATIONS], ["trim", "nfc", "ascii-case-fold", "numeric-string", "boolean-string"]);
});

test("surrounding whitespace is normalized, in both directions", () => {
  assert.equal(resolveOne("John", [response("c", { n: "  John  " })]).state, "grounded");
  assert.equal(resolveOne("  John  ", [response("c", { n: "John" })]).state, "grounded");
});

test("a normalized match reports via 'normalized', never 'exact'", () => {
  const row = resolveOne("John", [response("c", { n: " John " })]);
  assert.equal(row.state === "grounded" && row.via, "normalized");
});

test("ASCII case is normalized", () => {
  assert.equal(resolveOne("acme", [response("c", { n: "ACME" })]).state, "grounded");
});

test("Unicode is normalized to NFC", () => {
  const decomposed = "José"; // e + combining acute
  const composed = "José";          // precomposed
  assert.notEqual(decomposed, composed, "fixture must actually differ before NFC");
  assert.equal(resolveOne(composed, [response("c", { n: decomposed })]).state, "grounded");
});

test("a numeric string grounds against a number in either direction", () => {
  assert.equal(resolveOne(42, [response("c", { n: "42" })]).state, "grounded");
});

test("a boolean grounds against its string spelling in either direction", () => {
  assert.equal(resolveOne("true", [response("c", { ok: true })]).state, "grounded");
  assert.equal(resolveOne(true, [response("c", { ok: "true" })]).state, "grounded");
});

test("normalizations do not compose — one hop only", () => {
  // " ACME " -> "acme" needs trim AND case-fold. Chained normalization is where
  // a transformation becomes a computation (§11, single-hop by design), so this
  // stays `authored`. Over-reporting authored is the safe direction.
  assert.equal(resolveOne("acme", [response("c", { n: " ACME " })]).state, "authored");
});

// ---------------------------------------------------------------------------
// §7.2 / §1.1 — what is deliberately NOT a normalization
// ---------------------------------------------------------------------------

test("REGRESSION: a name is not grounded by the local part of an email", () => {
  // The third production failure. `John` is not `john@example.com`; the inference
  // that an email's local part is a given name is a semantic claim Reelier has no
  // standing to make, and a substring tier would stamp it as traceable.
  const row = resolveOne("John", [response("crm:1", { email: "john@example.com" })]);
  assert.equal(row.state, "authored");
});

test("field splitting is not a normalization", () => {
  assert.equal(resolveOne("John", [response("c", { full: "John Smith" })]).state, "authored");
});

test("arithmetic is not a normalization", () => {
  // §1.1 — the door business rules walk through. A price computed from an area
  // is authored, and stays authored.
  assert.equal(resolveOne(250, [response("c", { squareMetres: 100 })]).state, "authored");
});

test("format re-derivation is not a normalization", () => {
  assert.equal(resolveOne("5551234567", [response("c", { phone: "555-123-4567" })]).state, "authored");
});

// ---------------------------------------------------------------------------
// §5.1 — the source list is closed
// ---------------------------------------------------------------------------

test("a source of an unknown kind is refused, never indexed", () => {
  // Sources are things that came back, never things that went out. The kind set
  // is closed so a prior call's ARGS cannot be handed in as a source, which is
  // the laundering route that produced the second production failure.
  const rogue = { kind: "request", id: "call:1", value: { phone: "555" } } as unknown as ProvenanceSource;
  assert.throws(() => buildSourceIndex([rogue]), /source kind/);
});

// ---------------------------------------------------------------------------
// §2 / §4.2 — a gap never becomes an absence
// ---------------------------------------------------------------------------

test("a source that could not be addressed degrades a miss to unresolved, never authored", () => {
  // §6.1: a multi-block or unparseable response has no addressable leaves, so
  // the run no longer holds a complete source set and `authored` is unearned.
  const index = buildSourceIndex([response("call:1", undefined)]);
  const rows = resolveArgs({ v: "anything" }, index);
  const row = at(rows, "args.v");
  assert.equal(row?.state, "unresolved");
  assert.match(row?.state === "unresolved" ? row.reason : "", /call:1/);
});

test("a corpus gap does not invalidate a positive match", () => {
  // A found match is evidence standing on its own; a gap elsewhere cannot unfind it.
  const index = buildSourceIndex([response("call:1", undefined), response("call:2", { phone: "555" })]);
  const rows = resolveArgs({ v: "555" }, index);
  assert.equal(at(rows, "args.v")?.state, "grounded");
});

test("an explicitly incomplete corpus resolves every miss as unresolved, naming the reason", () => {
  // §4.2 item 1: outside a recording window there is no corpus, and `authored`
  // MUST NOT be inferred from an emptiness that was never established.
  const rows = resolveArgs({ v: "x" }, buildSourceIndex([]), { corpusGap: "not-recording" });
  const row = at(rows, "args.v");
  assert.equal(row?.state, "unresolved");
    assert.match(row?.state === "unresolved" ? row.reason : "", /not-recording/);
});

test("an empty corpus with no declared gap does resolve authored", () => {
  // The complement of the rule above: a run that genuinely observed nothing and
  // says so has established the absence, and `authored` is earned.
  assert.equal(resolveArgs({ v: "x" }, buildSourceIndex([])).length, 1);
  assert.equal(at(resolveArgs({ v: "x" }, buildSourceIndex([])), "args.v")?.state, "authored");
});

// ---------------------------------------------------------------------------
// §8.2 — the partition
// ---------------------------------------------------------------------------

test("the three states partition the addressed leaves exactly", () => {
  const index = buildSourceIndex([response("call:1", { phone: "555" })]);
  const rows = resolveArgs({ phone: "555", name: "not provided", note: { nested: {} } }, index);
  assert.equal(rows.length, 2, "only scalar leaves are addressed");
  assert.deepEqual(
    rows.map((r) => [r.path, r.state]),
    [["args.phone", "grounded"], ["args.name", "authored"]]
  );
});

// ---------------------------------------------------------------------------
// §6 — the shared name-list caps
// ---------------------------------------------------------------------------

test("a name list longer than the cap is truncated and says how many it dropped", () => {
  const names = Array.from({ length: 40 }, (_, i) => `args.f${i}`);
  const capped = capNameList(names);
  assert.equal(capped.names.length, 32);
  assert.equal(capped.truncated, 8);
});

test("a name list at or under the cap carries no truncation marker", () => {
  const capped = capNameList(["args.a", "args.b"]);
  assert.deepEqual(capped.names, ["args.a", "args.b"]);
  assert.equal(capped.truncated, undefined);
});

test("an over-long name is clipped to the shared per-name cap", () => {
  const capped = capNameList([`args.${"x".repeat(400)}`]);
  assert.equal(capped.names[0].length, 120);
});

test("live index resolves against prior sources without retaining source values", () => {
  const live = new LiveProvenanceIndex(8);
  live.addSource("#0", { customer: { phone: "+15551234567" } });

  assert.deepEqual(live.resolve({ phone: "+15551234567", name: "Jane" }), [
    {
      path: "args.phone",
      state: "grounded",
      via: "exact",
      from: { source: "#0", at: "body.customer.phone" },
    },
    { path: "args.name", state: "authored" },
  ]);
  assert.equal(JSON.stringify(live).includes("+15551234567"), false, "the live index must retain hashes, never values");
});

test("live index saturation is bounded and turns misses into unresolved", () => {
  const live = new LiveProvenanceIndex(1);
  live.addSource("#0", { first: "held", second: "dropped" });

  assert.equal(live.size, 1);
  assert.equal(live.saturated, true);
  assert.equal(live.resolve({ v: "held" })[0].state, "grounded", "retained hits stay factual");
  assert.deepEqual(live.resolve({ v: "absent" }), [
    { path: "args.v", state: "unresolved", reason: "source-index-cap: 1 leaves" },
  ]);
});

test("live index records an unaddressable response as a corpus gap", () => {
  const live = new LiveProvenanceIndex(8);
  live.addGap("#0");
  assert.deepEqual(live.resolve({ v: "anything" }), [
    { path: "args.v", state: "unresolved", reason: "source-unaddressable: #0" },
  ]);
});
