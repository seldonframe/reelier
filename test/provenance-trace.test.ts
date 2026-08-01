// Argument provenance over a RECORDED trace. Spec: docs/specs/argument-provenance-v1.md.
//
// Read-only and after the fact: this analyses a trace already on disk, so it
// needs no retained corpus in the wrap and writes nothing back. It gates
// nothing and changes no exit code (spec §2, rule 4).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { analyzeTrace } from "../src/provenance-trace.js";
import { parseTraceLines } from "../src/trace.js";
import type { TraceRecord } from "../src/recorder.js";
import type { LeafResolution } from "../src/provenance.js";

// ---------------------------------------------------------------------------
// fixtures — file order IS the association (src/recorder.ts's write queue)
// ---------------------------------------------------------------------------

let seq = 0;
function meta(): TraceRecord {
  return { t: "meta", seq: seq++, name: "fixture", startedAt: "2026-08-01T00:00:00.000Z", wrapped: ["s"] };
}
function call(i: number, tool: string, args: unknown): TraceRecord {
  return { t: "call", seq: seq++, i, ts: "2026-08-01T00:00:00.000Z", tool, args };
}
function textBody(...texts: string[]): unknown {
  return { content: texts.map((text) => ({ type: "text", text })) };
}
function jsonBody(value: unknown): unknown {
  return textBody(JSON.stringify(value));
}
function result(i: number, body: unknown, extra: Record<string, unknown> = {}): TraceRecord {
  return { t: "result", seq: seq++, i, ok: true, ms: 1, body, ...extra } as TraceRecord;
}

/** The resolution for one path of one call. */
function leaf(records: TraceRecord[], callIndex: number, path: string): LeafResolution | undefined {
  const c = analyzeTrace(records).calls.find((x) => x.i === callIndex);
  return c?.resolutions.find((r) => r.path === path);
}

// ---------------------------------------------------------------------------
// the basic direction
// ---------------------------------------------------------------------------

test("a value that came back from an earlier call is grounded, naming that call", () => {
  const records = [
    meta(),
    call(0, "crm.get", { id: "c1" }),
    result(0, jsonBody({ email: "john@example.com" })),
    call(1, "booking.create", { email: "john@example.com" }),
  ];
  const row = leaf(records, 1, "args.email");
  assert.equal(row?.state, "grounded");
  assert.deepEqual(row?.state === "grounded" && row.from, { source: "#0", at: "body.email" });
});

test("a value in no response is authored", () => {
  const records = [
    meta(),
    call(0, "crm.get", { id: "c1" }),
    result(0, jsonBody({ email: "john@example.com" })),
    call(1, "booking.create", { name: "not provided" }),
  ];
  assert.equal(leaf(records, 1, "args.name")?.state, "authored");
});

test("REGRESSION: a name is not grounded by the local part of an email in the trace", () => {
  const records = [
    meta(),
    call(0, "crm.get", { id: "c1" }),
    result(0, jsonBody({ email: "john@example.com" })),
    call(1, "booking.create", { name: "John" }),
  ];
  assert.equal(leaf(records, 1, "args.name")?.state, "authored");
});

// ---------------------------------------------------------------------------
// §5.1 — what is never a source
// ---------------------------------------------------------------------------

test("a response that arrives AFTER a call cannot ground that call's own arguments", () => {
  // The self-grounding loop: a tool that echoes its input back would otherwise
  // retroactively ground every argument it was given. Sources are strictly prior.
  const records = [meta(), call(0, "create", { name: "John" }), result(0, jsonBody({ name: "John", id: 7 }))];
  assert.equal(leaf(records, 0, "args.name")?.state, "authored");
});

test("a prior call's ARGUMENTS are never a source", () => {
  // The second production failure: the agent read back a phone number it had
  // written itself. Sources are things that came back, never things that went out.
  const records = [
    meta(),
    call(0, "chat.say", { text: "555-0100" }),
    result(0, jsonBody({ delivered: true })),
    call(1, "booking.create", { phone: "555-0100" }),
  ];
  assert.equal(leaf(records, 1, "args.phone")?.state, "authored");
});

test("a denied result is never a source — its body is Reelier's own refusal text", () => {
  const records = [
    meta(),
    call(0, "x.get", {}),
    result(0, jsonBody({ secretish: "abc123" }), { ok: false, denied: true, rule: "deny x.*" }),
    call(1, "y.put", { v: "abc123" }),
  ];
  assert.equal(leaf(records, 1, "args.v")?.state, "authored");
});

test("a dry-run result is never a source — its body is a Reelier-synthesized stub", () => {
  const records = [
    meta(),
    call(0, "x.put", {}),
    result(0, jsonBody({ synthetic: "zz" }), { dryRun: true, rule: "dry_run x.*" }),
    call(1, "y.put", { v: "zz" }),
  ];
  assert.equal(leaf(records, 1, "args.v")?.state, "authored");
});

test("a failed result is never a source", () => {
  const records = [
    meta(),
    call(0, "x.get", {}),
    result(0, jsonBody({ error: "boom" }), { ok: false }),
    call(1, "y.put", { v: "boom" }),
  ];
  assert.equal(leaf(records, 1, "args.v")?.state, "authored");
});

test("a NON-SOURCE and a GAP are different, and only the gap suppresses authored", () => {
  // The distinction this whole surface turns on. A denied call produced no
  // observation, so nothing is MISSING from the corpus and `authored` is earned.
  // An unaddressable response is data that came back and could not be read —
  // that is a hole, and `authored` is unearned beside it.
  //
  // Getting this backwards would make one deny rule in a repo's policy.yml
  // report `unresolved` for every value forever: noise, and noise on this
  // surface is worse than silence.
  const denied = [
    meta(),
    call(0, "x.get", {}),
    result(0, jsonBody({ a: 1 }), { ok: false, denied: true, rule: "r" }),
    call(1, "y.put", { v: "q" }),
  ];
  const unreadable = [meta(), call(0, "x.get", {}), result(0, textBody("prose")), call(1, "y.put", { v: "q" })];
  assert.equal(leaf(denied, 1, "args.v")?.state, "authored");
  assert.equal(leaf(unreadable, 1, "args.v")?.state, "unresolved");
});

// ---------------------------------------------------------------------------
// §8.2 — a call that never dispatched has no provenance
// ---------------------------------------------------------------------------

test("a denied call carries no provenance at all — nothing went out", () => {
  const records = [meta(), call(0, "x.put", { v: "q" }), result(0, jsonBody({}), { ok: false, denied: true, rule: "r" })];
  assert.deepEqual(analyzeTrace(records).calls, []);
});

test("a dry-run call carries no provenance at all", () => {
  const records = [meta(), call(0, "x.put", { v: "q" }), result(0, jsonBody({}), { dryRun: true, rule: "r" })];
  assert.deepEqual(analyzeTrace(records).calls, []);
});

// ---------------------------------------------------------------------------
// §6.1 — an unaddressable response is a gap, never an absence
// ---------------------------------------------------------------------------

test("a multi-block response is unaddressable, and its gap forbids authored", () => {
  const records = [
    meta(),
    call(0, "x.get", {}),
    result(0, textBody("first", "second")),
    call(1, "y.put", { v: "anything" }),
  ];
  const row = leaf(records, 1, "args.v");
  assert.equal(row?.state, "unresolved");
  assert.match(row?.state === "unresolved" ? row.reason : "", /#0/);
});

test("a response whose text is not JSON is unaddressable", () => {
  const records = [meta(), call(0, "x.get", {}), result(0, textBody("plain prose")), call(1, "y.put", { v: "x" })];
  assert.equal(leaf(records, 1, "args.v")?.state, "unresolved");
});

test("an unaddressable response does not stop a later addressable one from grounding", () => {
  const records = [
    meta(),
    call(0, "x.get", {}),
    result(0, textBody("plain prose")),
    call(1, "y.get", {}),
    result(1, jsonBody({ slug: "abc" })),
    call(2, "z.put", { slug: "abc" }),
  ];
  assert.equal(leaf(records, 2, "args.slug")?.state, "grounded");
});

// ---------------------------------------------------------------------------
// redaction — the trace on disk is not the bytes that went over the wire
// ---------------------------------------------------------------------------

test("a redacted response value never grounds a redacted argument", () => {
  // Both sides pass through redact() on the way to disk, so two unrelated
  // secrets both read `«redacted»`. Matching them would be a false GROUNDED —
  // the one direction this must never produce.
  const records = [
    meta(),
    call(0, "auth.get", {}),
    result(0, jsonBody({ token: "«redacted»" })),
    call(1, "api.call", { token: "«redacted»" }),
  ];
  const row = leaf(records, 1, "args.token");
  assert.notEqual(row?.state, "grounded");
  assert.equal(row?.state, "unresolved");
});

test("a redacted argument resolves unresolved, never authored", () => {
  const records = [meta(), call(0, "x.get", {}), result(0, jsonBody({ a: 1 })), call(1, "y.put", { k: "«redacted:MY_KEY»" })];
  const row = leaf(records, 1, "args.k");
  assert.equal(row?.state, "unresolved");
  assert.match(row?.state === "unresolved" ? row.reason : "", /redacted/);
});

test("an env-masked response value is a gap, so a miss beside it is not called authored", () => {
  const records = [
    meta(),
    call(0, "x.get", {}),
    result(0, jsonBody({ password: "«redacted:PGPASS»", user: "ana" })),
    call(1, "y.put", { who: "someone-else" }),
  ];
  assert.equal(leaf(records, 1, "args.who")?.state, "unresolved");
});

// ---------------------------------------------------------------------------
// shape of the whole analysis
// ---------------------------------------------------------------------------

test("counts are reported per state, and are counts rather than a ratio", () => {
  const records = [
    meta(),
    call(0, "crm.get", { id: "c1" }),
    result(0, jsonBody({ email: "a@b.c", slug: "s1" })),
    call(1, "put", { email: "a@b.c", slug: "s1", note: "hand-written" }),
  ];
  const out = analyzeTrace(records);
  assert.deepEqual(out.counts, { grounded: 2, authored: 2, unresolved: 0 });
});

test("meta and note records contribute nothing", () => {
  const records: TraceRecord[] = [
    meta(),
    { t: "note", seq: seq++, ts: "2026-08-01T00:00:00.000Z", text: "about to book" },
    call(0, "x.put", { v: "q" }),
  ];
  assert.equal(analyzeTrace(records).calls.length, 1);
});

test("a call whose args carry no scalar leaves resolves nothing", () => {
  const records = [meta(), call(0, "x.put", { empty: {}, list: [] })];
  assert.deepEqual(analyzeTrace(records).calls[0].resolutions, []);
});

test("an empty trace analyses to nothing", () => {
  assert.deepEqual(analyzeTrace([]), { calls: [], counts: { grounded: 0, authored: 0, unresolved: 0 } });
});

// ---------------------------------------------------------------------------
// the shipped trace — proof this runs on a real file, not only on fixtures
// ---------------------------------------------------------------------------

test("the repo's own recorded trace analyses without throwing", async () => {
  const source = await readFile(".reelier/traces/reelier-init-demo-1.jsonl", "utf8");
  const out = analyzeTrace(parseTraceLines(source));
  assert.ok(out.calls.length > 0, "the demo trace has calls");
  // The first call's URL is agent-supplied with nothing before it to come from.
  const first = out.calls[0];
  assert.equal(first.resolutions.every((r) => r.state === "authored"), true);
});
