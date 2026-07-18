import { test } from "node:test";
import assert from "node:assert/strict";
import { compile, renderSkillMd } from "../src/compile.js";
import { parseSkill } from "../src/skill.js";
import type { TraceRecord } from "../src/recorder.js";

function meta(name = "demo"): TraceRecord {
  return { t: "meta", seq: 0, name, startedAt: "2026-01-01T00:00:00.000Z", wrapped: ["demo-downstream"] };
}

function note(seq: number, text: string): TraceRecord {
  return { t: "note", seq, ts: "2026-01-01T00:00:00.000Z", text };
}

function call(seq: number, i: number, tool: string, args: unknown): TraceRecord {
  return { t: "call", seq, i, ts: "2026-01-01T00:00:00.000Z", tool, args };
}

function result(seq: number, i: number, ok: boolean, body: unknown, ms = 5): TraceRecord {
  return { t: "result", seq, i, ok, ms, body };
}

function mcpJsonResult(json: unknown): unknown {
  return { content: [{ type: "text", text: JSON.stringify(json) }] };
}

// ---------------------------------------------------------------------------
// Dataflow recovery
// ---------------------------------------------------------------------------

test("dataflow: a value in call 2's args equal to a value in call 1's result binds on step 1 and templates step 2", () => {
  const records: TraceRecord[] = [
    meta(),
    note(1, "create a note"),
    call(2, 0, "create_note", { text: "hello world" }),
    result(3, 0, true, mcpJsonResult({ id: "note_ab12", text: "hello world" })),
    note(4, "fetch it back"),
    call(5, 1, "get_note", { id: "note_ab12" }),
    result(6, 1, true, mcpJsonResult({ id: "note_ab12", text: "hello world", found: true })),
  ];

  const compiled = compile(records);
  assert.equal(compiled.steps.length, 2);

  const step1 = compiled.steps[0];
  assert.deepEqual(step1.binds, ["id = json.id"]);
  assert.ok(step1.asserts.includes("json.id is set"));
  assert.ok(step1.asserts.includes("status == 200"));

  const step2 = compiled.steps[1];
  assert.deepEqual(step2.args, { id: "{{id}}" });
});

test("dataflow: three-step chain threads a bind from step 1 through step 3", () => {
  const records: TraceRecord[] = [
    meta(),
    call(1, 0, "create_note", { text: "chain-value-xyz" }),
    result(2, 0, true, mcpJsonResult({ id: "note_chain1" })),
    call(3, 1, "get_note", { id: "note_chain1" }),
    // Step 2's own result deliberately does NOT echo the id back, so step 3's
    // search still finds step 1 as the (only) prior source — most-recent-wins
    // is exercised separately below.
    result(4, 1, true, mcpJsonResult({ found: true })),
    call(5, 2, "get_note", { id: "note_chain1" }),
    result(6, 2, true, mcpJsonResult({ found: true })),
  ];

  const compiled = compile(records);
  assert.equal(compiled.steps.length, 3);
  assert.deepEqual(compiled.steps[0].binds, ["id = json.id"]);
  // Both step 2 and step 3 consume the same bind from step 1 (most-recent-prior-result-wins
  // does not apply here since only step 1 ever produced "note_chain1").
  assert.deepEqual(compiled.steps[1].args, { id: "{{id}}" });
  assert.deepEqual(compiled.steps[2].args, { id: "{{id}}" });
});

test("dataflow: dedupe — two consumers of the same source path produce exactly one bind", () => {
  const records: TraceRecord[] = [
    meta(),
    call(1, 0, "create_note", { text: "dedupe-value-1" }),
    result(2, 0, true, mcpJsonResult({ id: "note_dedupe" })),
    call(3, 1, "get_note", { id: "note_dedupe" }),
    result(4, 1, true, mcpJsonResult({ id: "note_dedupe", found: true })),
    call(5, 2, "get_note", { id: "note_dedupe" }),
    result(6, 2, true, mcpJsonResult({ id: "note_dedupe", found: true })),
  ];

  const compiled = compile(records);
  assert.equal(compiled.steps[0].binds.length, 1);
  assert.equal(compiled.steps[0].asserts.filter((a) => a.startsWith("json.")).length, 1);
});

test("dataflow: most-recent prior result wins when the same value appears in two prior results", () => {
  const records: TraceRecord[] = [
    meta(),
    call(1, 0, "create_note", { text: "aaaa" }),
    result(2, 0, true, mcpJsonResult({ id: "shared_val" })),
    call(3, 1, "create_note", { text: "bbbb" }),
    result(4, 1, true, mcpJsonResult({ id: "shared_val" })),
    call(5, 2, "get_note", { id: "shared_val" }),
    result(6, 2, true, mcpJsonResult({ id: "shared_val", found: true })),
  ];

  const compiled = compile(records);
  // Step 2 (i=1, most recent prior to step 3) is the source, not step 1.
  assert.deepEqual(compiled.steps[1].binds, ["id = json.id"]);
  assert.deepEqual(compiled.steps[0].binds, []);
});

test("dataflow: a value sitting inside an array element uses an index-based path and flags an open question", () => {
  const records: TraceRecord[] = [
    meta(),
    call(1, 0, "list_notes", {}),
    result(2, 0, true, mcpJsonResult({ items: [{ id: "note_arr1" }, { id: "note_arr2" }] })),
    call(3, 1, "get_note", { id: "note_arr2" }),
    result(4, 1, true, mcpJsonResult({ id: "note_arr2", found: true })),
  ];

  const compiled = compile(records);
  assert.deepEqual(compiled.steps[0].binds, ["id = json.items.1.id"]);
  assert.deepEqual(compiled.steps[1].args, { id: "{{id}}" });
  assert.ok(
    compiled.openQuestions.some((oq) => oq.stepN === 1 && /index-based path/.test(oq.text)),
    "expected an index-based-path open question on step 1"
  );
});

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

test("notes: a note claims the next call as its title and intent", () => {
  const records: TraceRecord[] = [
    meta(),
    note(1, "I'm about to add two numbers"),
    call(2, 0, "add", { a: 1, b: 2 }),
    result(3, 0, true, mcpJsonResult({ result: 3 })),
  ];
  const compiled = compile(records);
  assert.equal(compiled.steps[0].title, "I'm about to add two numbers");
  assert.equal(compiled.steps[0].intent, "I'm about to add two numbers");
  assert.ok(!compiled.openQuestions.some((oq) => oq.stepN === 1 && /no narration/.test(oq.text)));
});

test("notes: consecutive notes before a call join with '; '", () => {
  const records: TraceRecord[] = [
    meta(),
    note(1, "first thought"),
    note(2, "second thought"),
    call(3, 0, "add", { a: 1, b: 2 }),
    result(4, 0, true, mcpJsonResult({ result: 3 })),
  ];
  const compiled = compile(records);
  assert.equal(compiled.steps[0].title, "first thought; second thought");
});

test("notes: a call with no preceding note gets an auto-generated title/intent and an open question", () => {
  const records: TraceRecord[] = [meta(), call(1, 0, "add", { a: 1, b: 2 }), result(2, 0, true, mcpJsonResult({ result: 3 }))];
  const compiled = compile(records);
  assert.equal(compiled.steps[0].title, "Call add");
  assert.match(compiled.steps[0].intent, /add/);
  assert.ok(compiled.openQuestions.some((oq) => oq.stepN === 1 && /no narration/.test(oq.text)));
});

test("notes: an unclaimed trailing note produces a global open question, not a crash", () => {
  const records: TraceRecord[] = [
    meta(),
    call(1, 0, "add", { a: 1, b: 2 }),
    result(2, 0, true, mcpJsonResult({ result: 3 })),
    note(3, "a thought that never became a call"),
  ];
  assert.doesNotThrow(() => compile(records));
  const compiled = compile(records);
  assert.ok(compiled.openQuestions.some((oq) => oq.stepN === undefined && /never became a call/.test(oq.text)));
});

// ---------------------------------------------------------------------------
// Effect classes
// ---------------------------------------------------------------------------

test("effects: verb heuristic matrix", () => {
  const cases: Array<[string, string]> = [
    ["get_note", "read"],
    ["list_notes", "read"],
    ["search_things", "read"],
    ["create_note", "idempotent-write"],
    ["update_note", "idempotent-write"],
    ["delete_note", "destructive"],
    ["send_email", "destructive"],
    ["http.get", "read"],
    ["http.post", "idempotent-write"],
    ["archive_note", "destructive"], // unknown verb
    // MCP-server namespace prefixes are stripped before classification
    ["composio__GMAIL_FETCH_EMAILS", "read"],
    ["composio__GMAIL_LIST_LABELS", "read"],
    ["composio__GMAIL_SEND_EMAIL", "destructive"],
    ["composio__GMAIL_ADD_LABEL_TO_EMAIL", "idempotent-write"],
    ["composio__GMAIL_MODIFY_THREAD_LABELS", "idempotent-write"],
    ["a__b__double_prefixed_fetch", "read"],
    // destructive verbs win regardless of position — never read by prefix
    ["search_and_purge", "destructive"],
    ["get_and_delete_note", "destructive"],
    ["fetch_then_send_report", "destructive"],
    // write beats read when both present
    ["get_or_create_note", "idempotent-write"],
    // reviewer P1 regressions: execution/mutation verbs must win over read tokens
    ["execute_query", "destructive"],
    ["run_query", "destructive"],
    ["check_and_transfer", "destructive"],
    ["view_and_approve", "destructive"],
    ["get_and_revoke", "destructive"],
    ["list_and_terminate", "destructive"],
    ["move_to_trash", "destructive"],
    ["find_and_merge", "destructive"],
  ];

  for (const [tool, expected] of cases) {
    const records: TraceRecord[] = [meta(), call(1, 0, tool, {}), result(2, 0, true, mcpJsonResult({ ok: true }))];
    const compiled = compile(records);
    assert.equal(compiled.steps[0].effect, expected, `${tool} -> expected ${expected}`);
  }
});

test("effects: an unrecognized verb is downgraded to destructive with an open question", () => {
  const records: TraceRecord[] = [meta(), call(1, 0, "archive_note", {}), result(2, 0, true, mcpJsonResult({ ok: true }))];
  const compiled = compile(records);
  assert.equal(compiled.steps[0].effect, "destructive");
  assert.ok(compiled.openQuestions.some((oq) => oq.stepN === 1 && /verb unrecognized/.test(oq.text)));
});

test("effects: a new verb from the shipped data table is classified without an open question", () => {
  const records: TraceRecord[] = [meta(), call(1, 0, "inspect_schema", {}), result(2, 0, true, mcpJsonResult({ ok: true }))];
  const compiled = compile(records);
  assert.equal(compiled.steps[0].effect, "read");
  assert.ok(!compiled.openQuestions.some((oq) => oq.stepN === 1 && /verb unrecognized/.test(oq.text)));
});

// ---------------------------------------------------------------------------
// Honest gaps
// ---------------------------------------------------------------------------

test("honest gaps: a call with no matching result gets no fabricated asserts and an open question", () => {
  const records: TraceRecord[] = [meta(), call(1, 0, "add", { a: 1, b: 2 })];
  const compiled = compile(records);
  assert.equal(compiled.steps.length, 1);
  assert.deepEqual(compiled.steps[0].asserts, []);
  assert.ok(compiled.openQuestions.some((oq) => oq.stepN === 1 && /no result was recorded/.test(oq.text)));
});

test("honest gaps: a call whose result was not ok gets no success assert and an open question", () => {
  const records: TraceRecord[] = [meta(), call(1, 0, "add", { a: 1, b: 2 }), result(2, 0, false, mcpJsonResult({ error: "boom" }))];
  const compiled = compile(records);
  assert.deepEqual(compiled.steps[0].asserts, []);
  assert.ok(compiled.openQuestions.some((oq) => oq.stepN === 1 && /failed during recording/.test(oq.text)));
});

// ---------------------------------------------------------------------------
// Promote-to-input suggestion
// ---------------------------------------------------------------------------

test("promote-to-input: a literal repeated across steps that never appears in a prior result gets an open question", () => {
  const records: TraceRecord[] = [
    meta(),
    call(1, 0, "get_note", { id: "fixed-slug-123" }),
    result(2, 0, true, mcpJsonResult({ found: false })),
    call(3, 1, "get_note", { id: "fixed-slug-123" }),
    result(4, 1, true, mcpJsonResult({ found: false })),
  ];
  const compiled = compile(records);
  // Never dataflow-derived (no prior result ever contained it), so it stays literal in both steps.
  assert.deepEqual(compiled.steps[0].args, { id: "fixed-slug-123" });
  assert.deepEqual(compiled.steps[1].args, { id: "fixed-slug-123" });
  assert.ok(compiled.openQuestions.some((oq) => /promoting it to an \{\{input\}\}/.test(oq.text)));
});

// ---------------------------------------------------------------------------
// Date-literal detection — flag (never auto-substitute) ISO-date-shaped arg
// literals with a concrete {{today±Nd}} suggestion computed from the
// trace's own meta.startedAt.
// ---------------------------------------------------------------------------

function metaAt(startedAt: string, name = "demo"): TraceRecord {
  return { t: "meta", seq: 0, name, startedAt, wrapped: ["demo-downstream"] };
}

test("date-literal: a date before the recording date suggests {{today-Nd}} with the correct offset", () => {
  const records: TraceRecord[] = [
    metaAt("2026-07-18T14:00:00.000Z"),
    call(1, 0, "list_bookings", { from: "2026-07-11" }),
    result(2, 0, true, mcpJsonResult({ bookings: [] })),
  ];
  const compiled = compile(records);
  assert.deepEqual(compiled.steps[0].args, { from: "2026-07-11" }); // never auto-substituted
  const oq = compiled.openQuestions.find((o) => o.stepN === 1);
  assert.ok(oq, "expected an open question on step 1");
  assert.match(oq!.text, /literal date "2026-07-11"/);
  assert.match(oq!.text, /7 days before run time/);
  assert.match(oq!.text, /\{\{today-7d\}\}/);
  assert.match(oq!.text, /recording date 2026-07-18/);
});

test("date-literal: a date after the recording date suggests {{today+Nd}}", () => {
  const records: TraceRecord[] = [
    metaAt("2026-07-18T14:00:00.000Z"),
    call(1, 0, "create_appointment", { date: "2026-07-28" }),
    result(2, 0, true, mcpJsonResult({ ok: true })),
  ];
  const compiled = compile(records);
  const oq = compiled.openQuestions.find((o) => o.stepN === 1);
  assert.ok(oq);
  assert.match(oq!.text, /10 days after run time/);
  assert.match(oq!.text, /\{\{today\+10d\}\}/);
});

test("date-literal: a date equal to the recording date suggests {{today}}", () => {
  const records: TraceRecord[] = [
    metaAt("2026-07-18T14:00:00.000Z"),
    call(1, 0, "create_appointment", { date: "2026-07-18" }),
    result(2, 0, true, mcpJsonResult({ ok: true })),
  ];
  const compiled = compile(records);
  const oq = compiled.openQuestions.find((o) => o.stepN === 1);
  assert.ok(oq);
  assert.match(oq!.text, /\{\{today\}\}/);
});

test("date-literal: a date more than 365 days away gets an explanatory open question, no {{today±Nd}} suggestion", () => {
  const records: TraceRecord[] = [
    metaAt("2026-07-18T14:00:00.000Z"),
    call(1, 0, "create_appointment", { date: "2020-01-01" }),
    result(2, 0, true, mcpJsonResult({ ok: true })),
  ];
  const compiled = compile(records);
  const oq = compiled.openQuestions.find((o) => o.stepN === 1);
  assert.ok(oq);
  assert.match(oq!.text, /more than 365 days/);
  // No concrete computed-var suggestion (only the generic "no {{today±Nd}} form applies" wording).
  assert.doesNotMatch(oq!.text, /\{\{today\}\}/);
  assert.doesNotMatch(oq!.text, /\{\{today[+-]\d/);
});

test("date-literal: detects a literal nested inside an object/array arg", () => {
  const records: TraceRecord[] = [
    metaAt("2026-07-18T14:00:00.000Z"),
    call(1, 0, "bulk_update", { filters: { range: { from: "2026-07-11", to: "2026-07-15" } }, ids: ["a", "2026-07-16"] }),
    result(2, 0, true, mcpJsonResult({ ok: true })),
  ];
  const compiled = compile(records);
  const texts = compiled.openQuestions.filter((o) => o.stepN === 1).map((o) => o.text);
  assert.ok(texts.some((t) => /"2026-07-11"/.test(t)));
  assert.ok(texts.some((t) => /"2026-07-15"/.test(t)));
  assert.ok(texts.some((t) => /"2026-07-16"/.test(t)));
});

test("date-literal: no false positive on a version string like '1.2.3'", () => {
  const records: TraceRecord[] = [
    metaAt("2026-07-18T14:00:00.000Z"),
    note(1, "install the package"),
    call(2, 0, "get_package_version", { version: "1.2.3" }), // known "get" verb + narrated, so the only open question that could appear is a date-literal one
    result(3, 0, true, mcpJsonResult({ ok: true })),
  ];
  const compiled = compile(records);
  assert.equal(compiled.openQuestions.filter((o) => o.stepN === 1).length, 0);
});

test("date-literal: no false positive on ids/tokens containing digits (not dash-shaped like a date)", () => {
  const records: TraceRecord[] = [
    metaAt("2026-07-18T14:00:00.000Z"),
    note(1, "look up the order"),
    call(2, 0, "get_order", { orderId: "order_20260711123045", uuid: "12345678-1234-1234-1234-123456789012" }),
    result(3, 0, true, mcpJsonResult({ ok: true })),
  ];
  const compiled = compile(records);
  assert.equal(compiled.openQuestions.filter((o) => o.stepN === 1).length, 0);
});

test("date-literal: a value already dataflow-recovered into {{var}} is never also flagged as a date literal", () => {
  const records: TraceRecord[] = [
    metaAt("2026-07-18T14:00:00.000Z"),
    call(1, 0, "create_booking", { date: "2026-07-11" }),
    result(2, 0, true, mcpJsonResult({ id: "b1", date: "2026-07-11" })),
    call(3, 1, "get_booking", { date: "2026-07-11" }), // matches prior result -> becomes {{date}}, not a literal anymore
    result(4, 1, true, mcpJsonResult({ found: true })),
  ];
  const compiled = compile(records);
  assert.deepEqual(compiled.steps[1].args, { date: "{{date}}" });
  // Step 1 still gets flagged (its own value was never a dataflow target), step 2 must not be (its literal was substituted away).
  assert.ok(compiled.openQuestions.some((o) => o.stepN === 1 && /literal date/.test(o.text)));
  assert.ok(!compiled.openQuestions.some((o) => o.stepN === 2 && /literal date/.test(o.text)));
});

test("date-literal: no crash / no detection when the trace has no meta startedAt captured (defensive)", () => {
  const records: TraceRecord[] = [
    call(1, 0, "get_thing", { date: "2026-07-11" }),
    result(2, 0, true, mcpJsonResult({ ok: true })),
  ];
  const compiled = compile(records);
  assert.equal(compiled.openQuestions.filter((o) => /literal date/.test(o.text)).length, 0);
});

// ---------------------------------------------------------------------------
// Round-trip through the skill parser
// ---------------------------------------------------------------------------

test("round-trip: compiled output (including Open questions + Changelog) parses cleanly", () => {
  const records: TraceRecord[] = [
    meta("roundtrip-skill"),
    note(1, "create a note"),
    call(2, 0, "create_note", { text: "hello world" }),
    result(3, 0, true, mcpJsonResult({ id: "note_rt1", text: "hello world" })),
    call(4, 1, "get_note", { id: "note_rt1" }), // no note -> open question path
    result(5, 1, false, mcpJsonResult({ error: "not found" })), // not-ok -> open question path
  ];
  const compiled = compile(records);
  const rendered = renderSkillMd(compiled, "roundtrip.jsonl");

  const parsed = parseSkill(rendered);
  assert.equal(parsed.name, "roundtrip-skill");
  assert.equal(parsed.steps.length, 2);
  assert.equal(parsed.steps[1].actionTool, "get_note");
  assert.deepEqual(parsed.steps[1].actionArgs, { id: "{{id}}" });
});

test("round-trip: an empty open-questions skill still renders and parses (no questions section body issue)", () => {
  const records: TraceRecord[] = [
    meta("clean-skill"),
    note(1, "add two numbers"),
    call(2, 0, "add", { a: 1, b: 2 }),
    result(3, 0, true, mcpJsonResult({ result: 3 })),
  ];
  const compiled = compile(records);
  assert.equal(compiled.openQuestions.length, 0);
  const rendered = renderSkillMd(compiled, "clean.jsonl");
  const parsed = parseSkill(rendered);
  assert.equal(parsed.steps.length, 1);
});
