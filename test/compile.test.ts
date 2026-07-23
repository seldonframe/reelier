import { test } from "node:test";
import assert from "node:assert/strict";
import { compile, renderSkillMd, classifyEffect } from "../src/compile.js";
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

test("dataflow: an array-element bind asks whether the position is stable and suggests a field match from the element's own scalar fields", () => {
  const records: TraceRecord[] = [
    meta(),
    call(1, 0, "list_notes", {}),
    result(
      2,
      0,
      true,
      mcpJsonResult({
        items: [
          { id: "note_a001", name: "alpha", meta: { nested: true } },
          { id: "note_b002", name: "beta", meta: { nested: true } },
          { id: "note_c003", name: "gamma", meta: { nested: true } },
        ],
      })
    ),
    call(3, 1, "get_note", { id: "note_c003" }),
    result(4, 1, true, mcpJsonResult({ found: true })),
  ];

  const compiled = compile(records);
  assert.deepEqual(compiled.steps[0].binds, ["id = json.items.2.id"]);
  assert.deepEqual(compiled.steps[1].args, { id: "{{id}}" });
  const oq = compiled.openQuestions.find((o) => o.stepN === 1 && /index-based path/.test(o.text));
  assert.ok(oq, "expected an index-based-path open question on step 1");
  // The question names the concrete index, asks the stability question, and
  // suggests selecting by a field match using the element's own SCALAR fields
  // (identifying names like id/name first; the non-scalar `meta` never suggested).
  assert.match(oq!.text, /element \[2\] positionally stable/);
  assert.match(oq!.text, /field match/);
  assert.match(oq!.text, /id\/name/);
  assert.doesNotMatch(oq!.text, /meta/);
});

test("dataflow: a bind into an array of scalars asks the stability question without a field-match suggestion", () => {
  const records: TraceRecord[] = [
    meta(),
    call(1, 0, "list_tags", {}),
    result(2, 0, true, mcpJsonResult({ tags: ["tag-alpha", "tag-beta", "tag-gamma"] })),
    call(3, 1, "get_tag", { tag: "tag-beta" }),
    result(4, 1, true, mcpJsonResult({ found: true })),
  ];

  const compiled = compile(records);
  assert.deepEqual(compiled.steps[0].binds, ["tags_1 = json.tags.1"]);
  const oq = compiled.openQuestions.find((o) => o.stepN === 1 && /index-based path/.test(o.text));
  assert.ok(oq, "expected an index-based-path open question on step 1");
  assert.match(oq!.text, /element \[1\] positionally stable/);
  assert.match(oq!.text, /matching its value/); // scalar element: no fields to match on
  assert.doesNotMatch(oq!.text, /field match/);
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
    // 2026-07 empirical-audit verbs (see effect-verbs.ts)
    ["take_screenshot", "read"],
    ["preview_logs", "read"],
    ["tail_logs", "read"],
    ["count_rows", "read"],
    ["stat_file", "read"],
    ["ping_server", "read"],
    ["retrieve_document", "read"],
    ["mark_chapter", "idempotent-write"],
    ["upload_screenshot", "idempotent-write"], // upload (write) beats screenshot (read)
    ["sync_contacts", "idempotent-write"],
    ["patch_record", "idempotent-write"],
    ["spawn_task", "destructive"],
    ["exec_command", "destructive"],
    ["browser_evaluate", "destructive"],
    ["preview_start", "destructive"], // start (destructive) beats preview (read)
    ["clear_logs", "destructive"], // clear (destructive) beats logs (read)
    ["push_context", "destructive"],
    ["rotate_secret", "destructive"],
    ["finalize_workspace", "destructive"],
    // deliberately-left-out verbs stay unknown -> destructive (write sense exists)
    ["resolve_incident", "destructive"],
    ["watch_repo", "destructive"],
    ["take_snapshot", "destructive"],
  ];

  for (const [tool, expected] of cases) {
    const records: TraceRecord[] = [meta(), call(1, 0, tool, {}), result(2, 0, true, mcpJsonResult({ ok: true }))];
    const compiled = compile(records);
    assert.equal(compiled.steps[0].effect, expected, `${tool} -> expected ${expected}`);
  }
});

// ---------------------------------------------------------------------------
// Annotation trust ladder (classifyEffect): destructiveHint > destructive
// verb match > idempotent-write verb match > read verb match (idempotentHint
// may tighten it) > readOnlyHint/idempotentHint refining unrecognized verbs
// > unknown->destructive. A hint can only tighten, never downgrade a
// verb-list match.
// ---------------------------------------------------------------------------

test("trust ladder: destructiveHint:true always classifies destructive — over read verbs and over readOnlyHint", () => {
  assert.deepEqual(classifyEffect("get_note", { destructiveHint: true }), { effect: "destructive", unknown: false });
  assert.deepEqual(classifyEffect("frobnicate", { destructiveHint: true, readOnlyHint: true }), {
    effect: "destructive",
    unknown: false,
  });
});

test("trust ladder: an annotation NEVER downgrades a destructive verb-match", () => {
  // The invariant: a server's own readOnly/idempotent hints carry no authority
  // over a destructive verb anywhere in the tool name.
  assert.deepEqual(classifyEffect("delete_note", { readOnlyHint: true }), { effect: "destructive", unknown: false });
  assert.deepEqual(classifyEffect("send_email", { idempotentHint: true }), { effect: "destructive", unknown: false });
  assert.deepEqual(classifyEffect("search_and_purge", { readOnlyHint: true, idempotentHint: true }), {
    effect: "destructive",
    unknown: false,
  });
});

test("trust ladder: readOnlyHint:true classifies an unknown-verb tool read (and clears the review flag)", () => {
  assert.deepEqual(classifyEffect("frobnicate", { readOnlyHint: true }), { effect: "read", unknown: false });
});

test("trust ladder: idempotentHint:true classifies an unknown-verb tool idempotent-write", () => {
  assert.deepEqual(classifyEffect("frobnicate", { idempotentHint: true }), { effect: "idempotent-write", unknown: false });
});

test("trust ladder: readOnlyHint outranks idempotentHint on an unknown-verb tool", () => {
  assert.deepEqual(classifyEffect("frobnicate", { readOnlyHint: true, idempotentHint: true }), {
    effect: "read",
    unknown: false,
  });
});

test("trust ladder: a readOnlyHint NEVER downgrades an idempotent-write verb-match", () => {
  // The write gate would never fire on a `read` step, so one sloppy boolean in
  // a server's tools/list must not exempt a verb-recognized write from
  // --allow-writes.
  assert.deepEqual(classifyEffect("create_note", { readOnlyHint: true }), {
    effect: "idempotent-write",
    unknown: false,
  });
  assert.deepEqual(classifyEffect("upload_file", { readOnlyHint: true, idempotentHint: true }), {
    effect: "idempotent-write",
    unknown: false,
  });
});

test("trust ladder: idempotentHint tightens a read verb-match to idempotent-write; readOnlyHint just agrees", () => {
  assert.deepEqual(classifyEffect("fetch_data", { idempotentHint: true }), {
    effect: "idempotent-write",
    unknown: false,
  });
  assert.deepEqual(classifyEffect("get_note", { readOnlyHint: true, idempotentHint: true }), {
    effect: "read",
    unknown: false,
  });
});

test("trust ladder: hints set to false carry no authority — verb lists and the unknown default still apply", () => {
  assert.deepEqual(classifyEffect("get_note", { readOnlyHint: false }), { effect: "read", unknown: false });
  assert.deepEqual(classifyEffect("frobnicate", { readOnlyHint: false, destructiveHint: false }), {
    effect: "destructive",
    unknown: true,
  });
});

test("trust ladder: no annotations at all — unchanged unknown->destructive + review flag", () => {
  assert.deepEqual(classifyEffect("frobnicate"), { effect: "destructive", unknown: true });
});

test("compile: meta.toolAnnotations feed the classifier — readOnlyHint converts an unknown-verb step to read, without an open question", () => {
  const records: TraceRecord[] = [
    {
      t: "meta",
      seq: 0,
      name: "annotated",
      startedAt: "2026-01-01T00:00:00.000Z",
      wrapped: ["demo-downstream"],
      toolAnnotations: { frobnicate: { readOnlyHint: true } },
    },
    call(1, 0, "frobnicate", {}),
    result(2, 0, true, mcpJsonResult({ ok: true })),
  ];
  const compiled = compile(records);
  assert.equal(compiled.steps[0].effect, "read");
  assert.ok(!compiled.openQuestions.some((oq) => /verb unrecognized/.test(oq.text)));
});

test("compile: meta.toolAnnotations can never downgrade a destructive verb-match", () => {
  const records: TraceRecord[] = [
    {
      t: "meta",
      seq: 0,
      name: "annotated",
      startedAt: "2026-01-01T00:00:00.000Z",
      wrapped: ["demo-downstream"],
      toolAnnotations: { delete_note: { readOnlyHint: true } },
    },
    call(1, 0, "delete_note", { id: "n1" }),
    result(2, 0, true, mcpJsonResult({ ok: true })),
  ];
  const compiled = compile(records);
  assert.equal(compiled.steps[0].effect, "destructive");
});

test("compile: meta.toolAnnotations can never downgrade an idempotent-write verb-match to read", () => {
  const records: TraceRecord[] = [
    {
      t: "meta",
      seq: 0,
      name: "annotated",
      startedAt: "2026-01-01T00:00:00.000Z",
      wrapped: ["demo-downstream"],
      toolAnnotations: { create_note: { readOnlyHint: true } },
    },
    call(1, 0, "create_note", { text: "hi" }),
    result(2, 0, true, mcpJsonResult({ ok: true })),
  ];
  const compiled = compile(records);
  // Stays gated behind --allow-writes at replay; a wrong hint can't exempt it.
  assert.equal(compiled.steps[0].effect, "idempotent-write");
});

// ---------------------------------------------------------------------------
// Manifest threading (docs/specs/flight-recorder-v2.md §1) — compile() reads
// meta.toolManifest and CompileResult carries only the tools this trace's
// OWN steps use; renderSkillMd emits it as a `manifest:` frontmatter line.
// ---------------------------------------------------------------------------

test("compile: threads meta.toolManifest into CompileResult.manifest, filtered to tools the steps actually use", () => {
  const records: TraceRecord[] = [
    {
      t: "meta",
      seq: 0,
      name: "manifested",
      startedAt: "2026-01-01T00:00:00.000Z",
      wrapped: ["demo-downstream"],
      toolManifest: [
        { name: "create_note", server: "demo-downstream", digest: "sha256:" + "1".repeat(64) },
        { name: "unused_tool", server: "demo-downstream", digest: "sha256:" + "2".repeat(64) },
      ],
    },
    call(1, 0, "create_note", { text: "hi" }),
    result(2, 0, true, mcpJsonResult({ ok: true })),
  ];
  const compiled = compile(records);
  assert.deepEqual(compiled.manifest, {
    v: 1,
    tools: [{ name: "create_note", server: "demo-downstream", digest: "sha256:" + "1".repeat(64) }],
  });
});

test("compile: no meta.toolManifest -> CompileResult.manifest is undefined (no manifest fabricated)", () => {
  const records: TraceRecord[] = [meta(), call(1, 0, "create_note", { text: "hi" }), result(2, 0, true, mcpJsonResult({ ok: true }))];
  const compiled = compile(records);
  assert.equal(compiled.manifest, undefined);
});

test("renderSkillMd: emits a manifest: frontmatter line when CompileResult.manifest is present, round-trips through parseSkill", () => {
  const records: TraceRecord[] = [
    {
      t: "meta",
      seq: 0,
      name: "manifested",
      startedAt: "2026-01-01T00:00:00.000Z",
      wrapped: ["demo-downstream"],
      toolManifest: [{ name: "create_note", server: "demo-downstream", digest: "sha256:" + "1".repeat(64) }],
    },
    call(1, 0, "create_note", { text: "hi" }),
    result(2, 0, true, mcpJsonResult({ ok: true })),
  ];
  const compiled = compile(records);
  const rendered = renderSkillMd(compiled, "trace.jsonl");
  assert.match(rendered, /^manifest: /m);
  const reparsed = parseSkill(rendered);
  assert.deepEqual(reparsed.manifest, compiled.manifest);
});

test("renderSkillMd: no manifest -> no manifest: line (byte-identical to pre-manifest skills)", () => {
  const records: TraceRecord[] = [meta(), call(1, 0, "create_note", { text: "hi" }), result(2, 0, true, mcpJsonResult({ ok: true }))];
  const compiled = compile(records);
  const rendered = renderSkillMd(compiled, "trace.jsonl");
  assert.doesNotMatch(rendered, /manifest:/);
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

test("param-lint: no DATE false positive on ids/tokens; a bare UUID gets the id-lint, a prefixed id does not", () => {
  const records: TraceRecord[] = [
    metaAt("2026-07-18T14:00:00.000Z"),
    note(1, "look up the order"),
    call(2, 0, "get_order", { orderId: "order_20260711123045", uuid: "12345678-1234-1234-1234-123456789012" }),
    result(3, 0, true, mcpJsonResult({ ok: true })),
  ];
  const compiled = compile(records);
  const step1 = compiled.openQuestions.filter((o) => o.stepN === 1);
  // No DATE false positive on either literal (neither is YYYY-MM-DD shaped).
  assert.equal(step1.filter((o) => /literal date/.test(o.text)).length, 0);
  // A prefixed id is NOT flagged (not a bare UUID / timestamp).
  assert.equal(step1.filter((o) => o.text.includes("order_20260711123045")).length, 0);
  // A bare UUID IS flagged by the new id-lint (advisory — "if it changes per run…").
  assert.equal(step1.filter((o) => o.text.includes("looks like a UUID")).length, 1);
});

test("param-lint: a standalone Unix-timestamp literal is flagged (advisory)", () => {
  const records: TraceRecord[] = [
    metaAt("2026-07-18T14:00:00.000Z"),
    note(1, "fetch events since a time"),
    call(2, 0, "get_events", { since: "1720000000" }),
    result(3, 0, true, mcpJsonResult({ ok: true })),
  ];
  const compiled = compile(records);
  const step1 = compiled.openQuestions.filter((o) => o.stepN === 1);
  assert.equal(step1.filter((o) => o.text.includes("Unix timestamp")).length, 1);
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
// Date-heuristic hardening — end-of-month, leap days, impossible dates,
// the 365-day boundary, and datetime literals (Z / offset / date-only).
// ---------------------------------------------------------------------------

test("date-literal: end-of-month boundary — the day after Jan 31 is exactly {{today+1d}} (singular 'day')", () => {
  const records: TraceRecord[] = [
    metaAt("2026-01-31T12:00:00.000Z"),
    call(1, 0, "create_appointment", { date: "2026-02-01" }),
    result(2, 0, true, mcpJsonResult({ ok: true })),
  ];
  const compiled = compile(records);
  const oq = compiled.openQuestions.find((o) => o.stepN === 1 && /literal date/.test(o.text));
  assert.ok(oq);
  assert.match(oq!.text, /1 day after run time/);
  assert.match(oq!.text, /\{\{today\+1d\}\}/);
});

test("date-literal: a real leap day gets correct offset math", () => {
  const records: TraceRecord[] = [
    metaAt("2028-02-28T09:00:00.000Z"), // 2028 is a leap year
    call(1, 0, "create_appointment", { date: "2028-02-29" }),
    result(2, 0, true, mcpJsonResult({ ok: true })),
  ];
  const compiled = compile(records);
  const oq = compiled.openQuestions.find((o) => o.stepN === 1 && /literal date/.test(o.text));
  assert.ok(oq);
  assert.match(oq!.text, /1 day after run time/);
  assert.match(oq!.text, /\{\{today\+1d\}\}/);
});

test("date-literal: impossible calendar dates are flagged as such, never given fabricated roll-over offset math", () => {
  // Date.UTC would silently roll "2026-02-30" to March 2 and a non-leap
  // "2026-02-29" to March 1 — an offset computed from those would be a lie.
  const records: TraceRecord[] = [
    metaAt("2026-07-18T14:00:00.000Z"),
    note(1, "impossible dates"),
    call(2, 0, "get_report", { a: "2026-02-30", b: "2026-02-29", c: "2026-13-40" }),
    result(3, 0, true, mcpJsonResult({ ok: true })),
  ];
  const compiled = compile(records);
  const step1 = compiled.openQuestions.filter((o) => o.stepN === 1);
  for (const v of ["2026-02-30", "2026-02-29", "2026-13-40"]) {
    const qs = step1.filter((o) => o.text.includes(`"${v}"`));
    assert.equal(qs.length, 1, `expected exactly one flag for ${v}`);
    assert.match(qs[0].text, /not a real calendar date/);
    assert.doesNotMatch(qs[0].text, /\{\{today/);
  }
});

test("date-literal: 365-day boundary — exactly 365 days away still gets a concrete suggestion; 366 does not", () => {
  const records: TraceRecord[] = [
    metaAt("2026-07-18T14:00:00.000Z"),
    call(1, 0, "create_appointment", { at: "2027-07-18" }), // +365
    result(2, 0, true, mcpJsonResult({ ok: true })),
    call(3, 1, "create_appointment", { at: "2027-07-19" }), // +366
    result(4, 1, true, mcpJsonResult({ ok: true })),
  ];
  const compiled = compile(records);
  const q365 = compiled.openQuestions.find((o) => o.stepN === 1 && /literal date/.test(o.text));
  assert.ok(q365);
  assert.match(q365!.text, /365 days after run time/);
  assert.match(q365!.text, /\{\{today\+365d\}\}/);
  const q366 = compiled.openQuestions.find((o) => o.stepN === 2 && /literal date/.test(o.text));
  assert.ok(q366);
  assert.match(q366!.text, /more than 365 days/);
  assert.doesNotMatch(q366!.text, /\{\{today[+-]\d/);
});

test("date-literal: a datetime literal's suggestion keeps the recorded time suffix verbatim ({{today±Nd}} is date-only)", () => {
  const records: TraceRecord[] = [
    metaAt("2026-07-18T14:00:00.000Z"),
    call(1, 0, "list_events", { since: "2026-07-11T09:30:00Z" }),
    result(2, 0, true, mcpJsonResult({ ok: true })),
  ];
  const compiled = compile(records);
  const oq = compiled.openQuestions.find((o) => o.stepN === 1 && /literal date/.test(o.text));
  assert.ok(oq);
  assert.match(oq!.text, /replace the date part with \{\{today-7d\}\}/);
  assert.match(oq!.text, /"\{\{today-7d\}\}T09:30:00Z"/); // concrete, runnable substitution
  // Z means the written date IS the UTC date — no ambiguity note.
  assert.doesNotMatch(oq!.text, /different UTC calendar day/);
});

test("date-literal: a non-UTC offset that crosses UTC midnight gets an explicit which-day note", () => {
  // 2026-07-11T23:30-05:00 == 2026-07-12T04:30Z — the written calendar day
  // and the UTC day {{today±Nd}} resolves to are different days.
  const records: TraceRecord[] = [
    metaAt("2026-07-18T14:00:00.000Z"),
    call(1, 0, "list_events", { since: "2026-07-11T23:30:00-05:00" }),
    result(2, 0, true, mcpJsonResult({ ok: true })),
  ];
  const compiled = compile(records);
  const oq = compiled.openQuestions.find((o) => o.stepN === 1 && /literal date/.test(o.text));
  assert.ok(oq);
  assert.match(oq!.text, /different UTC calendar day \(2026-07-12\)/);
  // The offset math itself still uses the date as written (flag-only honesty).
  assert.match(oq!.text, /\{\{today-7d\}\}/);
});

test("date-literal: a non-UTC offset that stays on the same calendar day gets no which-day note", () => {
  const records: TraceRecord[] = [
    metaAt("2026-07-18T14:00:00.000Z"),
    call(1, 0, "list_events", { since: "2026-07-11T09:30:00+02:00" }),
    result(2, 0, true, mcpJsonResult({ ok: true })),
  ];
  const compiled = compile(records);
  const oq = compiled.openQuestions.find((o) => o.stepN === 1 && /literal date/.test(o.text));
  assert.ok(oq);
  assert.doesNotMatch(oq!.text, /different UTC calendar day/);
});

// ---------------------------------------------------------------------------
// Lint consolidation — the same literal in 3+ steps flags ONCE with the step
// list instead of producing per-step duplicates.
// ---------------------------------------------------------------------------

test("consolidation: the same date literal across 3 steps produces exactly ONE open question listing every step", () => {
  const records: TraceRecord[] = [
    metaAt("2026-07-18T14:00:00.000Z"),
    call(1, 0, "list_bookings", { from: "2026-07-11" }),
    result(2, 0, true, mcpJsonResult({ bookings: [] })),
    call(3, 1, "list_invoices", { from: "2026-07-11" }),
    result(4, 1, true, mcpJsonResult({ invoices: [] })),
    call(5, 2, "list_payments", { from: "2026-07-11" }),
    result(6, 2, true, mcpJsonResult({ payments: [] })),
  ];
  const compiled = compile(records);
  const dateQs = compiled.openQuestions.filter((o) => /literal date "2026-07-11"/.test(o.text));
  assert.equal(dateQs.length, 1, "expected one consolidated flag, not per-step duplicates");
  assert.equal(dateQs[0].stepN, 1);
  assert.match(dateQs[0].text, /appears in steps 1, 2, 3 — one variable\?/);
  // The offset suggestion itself survives consolidation.
  assert.match(dateQs[0].text, /\{\{today-7d\}\}/);
});

test("consolidation: the same UUID across 3 steps produces exactly ONE flag; 2 steps stays per-step", () => {
  const uuid = "12345678-1234-1234-1234-123456789012";
  const threeSteps: TraceRecord[] = [
    metaAt("2026-07-18T14:00:00.000Z"),
    call(1, 0, "get_order", { id: uuid }),
    result(2, 0, true, mcpJsonResult({ found: false })),
    call(3, 1, "get_refund", { id: uuid }),
    result(4, 1, true, mcpJsonResult({ found: false })),
    call(5, 2, "get_shipment", { id: uuid }),
    result(6, 2, true, mcpJsonResult({ found: false })),
  ];
  const compiledThree = compile(threeSteps);
  const uuidQsThree = compiledThree.openQuestions.filter((o) => o.text.includes("looks like a UUID"));
  assert.equal(uuidQsThree.length, 1);
  assert.match(uuidQsThree[0].text, /appears in steps 1, 2, 3 — one variable\?/);

  const twoSteps: TraceRecord[] = [
    metaAt("2026-07-18T14:00:00.000Z"),
    call(1, 0, "get_order", { id: uuid }),
    result(2, 0, true, mcpJsonResult({ found: false })),
    call(3, 1, "get_refund", { id: uuid }),
    result(4, 1, true, mcpJsonResult({ found: false })),
  ];
  const compiledTwo = compile(twoSteps);
  const uuidQsTwo = compiledTwo.openQuestions.filter((o) => o.text.includes("looks like a UUID"));
  assert.equal(uuidQsTwo.length, 2, "below the 3-step threshold the per-step flags are kept");
  assert.ok(uuidQsTwo.every((o) => !/appears in steps/.test(o.text)));
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

test("round-trip: --from-skill provenance rendering (carried description + provenance lines) parses cleanly", () => {
  const records: TraceRecord[] = [
    meta("trace-meta-name"),
    note(1, "add two numbers"),
    call(2, 0, "add", { a: 1, b: 2 }),
    result(3, 0, true, mcpJsonResult({ result: 3 })),
  ];
  const compiled = compile(records);
  const rendered = renderSkillMd({ ...compiled, name: "carried-name" }, "t.jsonl", {
    sourceFileName: "SKILL.md",
    description: "Carried description.",
  });

  const parsed = parseSkill(rendered);
  assert.equal(parsed.name, "carried-name");
  assert.equal(parsed.description, "Carried description.");
  assert.match(parsed.preamble, /Compiled from SKILL\.md \+ t\.jsonl — every step below comes from that recorded trace; none were generated from the instruction text\./);
  assert.match(parsed.trailing, /compiled from SKILL\.md \+ t\.jsonl \(1 calls, 1 steps\)/);
  // Steps are untouched by provenance: still exactly the trace's calls.
  assert.equal(parsed.steps.length, 1);
  assert.equal(parsed.steps[0].actionTool, "add");
});

test("renderSkillMd: emits recorded_with frontmatter + a single Reelier provenance footer line", () => {
  const records: TraceRecord[] = [
    meta("provenance-skill"),
    note(1, "add two numbers"),
    call(2, 0, "add", { a: 1, b: 2 }),
    result(3, 0, true, mcpJsonResult({ result: 3 })),
  ];
  const compiled = compile(records);
  const rendered = renderSkillMd(compiled, "provenance.jsonl");

  assert.match(rendered, /^recorded_with: reelier v\S+$/m);

  const footerLines = rendered
    .split("\n")
    .filter((line) => line.includes("Recorded with") && line.includes("reelier.com"));
  assert.equal(footerLines.length, 1, "exactly one provenance footer line");
  assert.match(
    footerLines[0],
    /^_Recorded with \[Reelier\]\(https:\/\/reelier\.com\/\?utm_source=skill-md\) — replay: `npx -y reelier run provenance-skill\.skill\.md`_$/
  );

  // Still parses cleanly — the new frontmatter key and trailing footer line
  // don't break the SKILL.md grammar.
  const parsed = parseSkill(rendered);
  assert.equal(parsed.name, "provenance-skill");
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
