import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Recorder, collectToolAnnotations, type TraceRecord } from "../src/recorder.js";
import { buildToolRoutes, type DownstreamConnection } from "../src/mcp-client.js";

async function readTrace(filePath: string): Promise<TraceRecord[]> {
  const raw = await readFile(filePath, "utf8");
  return raw
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as TraceRecord);
}

test("recorder: meta is always the first record, seq is monotonic, note ordering is preserved", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-recorder-"));
  try {
    const recorder = new Recorder(dir);
    const started = await recorder.start("demo", ["fake-downstream"]);
    assert.equal(started.ok, true);
    if (!started.ok) return;

    recorder.note("first note");
    const callIdx = recorder.recordCall("add", { a: 1, b: 2 });
    recorder.recordResult(callIdx, true, 12, { result: 3 });
    recorder.note("second note");

    const stopped = await recorder.stop();
    assert.equal(stopped.ok, true);
    if (!stopped.ok) return;
    assert.equal(stopped.callCount, 1);

    const records = await readTrace(started.path);
    assert.equal(records.length, 5);
    assert.equal(records[0].t, "meta");
    assert.equal((records[0] as { name: string }).name, "demo");

    const seqs = records.map((r) => r.seq);
    assert.deepEqual(seqs, [0, 1, 2, 3, 4]);

    assert.equal(records[1].t, "note");
    assert.equal((records[1] as { text: string }).text, "first note");
    assert.equal(records[2].t, "call");
    assert.equal(records[3].t, "result");
    assert.equal(records[4].t, "note");
    assert.equal((records[4] as { text: string }).text, "second note");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("recorder: meta carries toolAnnotations when provided, and omits the key entirely when absent/empty", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-recorder-"));
  try {
    const withAnnotations = new Recorder(dir);
    const s1 = await withAnnotations.start("annotated", ["fake"], { list_widgets: { readOnlyHint: true } });
    assert.equal(s1.ok, true);
    if (!s1.ok) return;
    await withAnnotations.stop();
    const t1 = await readTrace(s1.path);
    assert.equal(t1[0].t, "meta");
    if (t1[0].t === "meta") {
      assert.deepEqual(t1[0].toolAnnotations, { list_widgets: { readOnlyHint: true } });
    }

    // No annotations (and an empty map) -> the key is absent from the JSON
    // line, so annotation-free traces stay byte-identical to older ones.
    const without = new Recorder(dir);
    const s2 = await without.start("plain", ["fake"], {});
    assert.equal(s2.ok, true);
    if (!s2.ok) return;
    await without.stop();
    const raw = await readFile(s2.path, "utf8");
    assert.ok(!raw.includes("toolAnnotations"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function fakeConnection(name: string, tools: DownstreamConnection["tools"]): DownstreamConnection {
  return {
    name,
    tools,
    async call() {
      throw new Error("not called in this test");
    },
    async close() {},
  };
}

test("collectToolAnnotations: keeps only declared hints, keyed by EXPOSED (collision-prefixed) name, skipping annotation-less tools", () => {
  const a = fakeConnection("server-a", [
    { name: "list_widgets", inputSchema: {}, annotations: { readOnlyHint: true } },
    { name: "plain_tool", inputSchema: {} }, // no annotations -> not captured
  ]);
  const b = fakeConnection("server-b", [
    // Collides with server-a's list_widgets -> exposed as 1_list_widgets.
    { name: "list_widgets", inputSchema: {}, annotations: { destructiveHint: true, idempotentHint: false } },
  ]);
  const routes = buildToolRoutes([a, b]);
  assert.deepEqual(collectToolAnnotations(routes), {
    list_widgets: { readOnlyHint: true },
    "1_list_widgets": { destructiveHint: true, idempotentHint: false },
  });
});

test("recorder: note is a friendly no-op (not written) when not recording", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-recorder-"));
  try {
    const recorder = new Recorder(dir);
    const result = recorder.note("ignored");
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.message, /Not recording/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("recorder: stopping when not recording is a friendly no-op", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-recorder-"));
  try {
    const recorder = new Recorder(dir);
    const result = await recorder.stop();
    assert.equal(result.ok, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("recorder: starting while already recording does not clobber the active trace", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-recorder-"));
  try {
    const recorder = new Recorder(dir);
    const first = await recorder.start("demo", []);
    assert.equal(first.ok, true);
    const second = await recorder.start("demo", []);
    assert.equal(second.ok, false);
    if (second.ok) return;
    assert.match(second.message, /Already recording/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("recorder: file numbering increments so an existing trace is never overwritten", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-recorder-"));
  try {
    const r1 = new Recorder(dir);
    const s1 = await r1.start("demo", []);
    assert.equal(s1.ok, true);
    if (!s1.ok) return;
    await r1.stop();

    const r2 = new Recorder(dir);
    const s2 = await r2.start("demo", []);
    assert.equal(s2.ok, true);
    if (!s2.ok) return;
    await r2.stop();

    assert.notEqual(s1.path, s2.path);
    assert.match(path.basename(s1.path), /^demo-1\.jsonl$/);
    assert.match(path.basename(s2.path), /^demo-2\.jsonl$/);

    // Both files still exist and are readable — the first was not clobbered.
    const t1 = await readTrace(s1.path);
    const t2 = await readTrace(s2.path);
    assert.equal(t1[0].t, "meta");
    assert.equal(t2[0].t, "meta");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
