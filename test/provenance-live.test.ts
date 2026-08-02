import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Recorder, type TraceRecord } from "../src/recorder.js";
import { formatTrace } from "../src/trace.js";

async function readTrace(filePath: string): Promise<TraceRecord[]> {
  const raw = await readFile(filePath, "utf8");
  return raw.trim().split("\n").map((line) => JSON.parse(line) as TraceRecord);
}

test("live recorder writes provenance before dispatch and grounds only from prior successful results", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-prov-live-"));
  try {
    const recorder = new Recorder(dir);
    const started = await recorder.start("demo", ["fake"]);
    assert.equal(started.ok, true);
    if (!started.ok) return;

    const first = recorder.recordCall("lookup", { query: "customer-7" });
    recorder.recordProvenance(first, { query: "customer-7" });
    recorder.recordResult(first, true, 1, {
      content: [{ type: "text", text: JSON.stringify({ phone: "+15551234567" }) }],
    });

    const second = recorder.recordCall("book", { phone: "+15551234567", name: "not provided" });
    recorder.recordProvenance(second, { phone: "+15551234567", name: "not provided" });
    await recorder.stop();

    const records = await readTrace(started.path);
    assert.deepEqual(records.map((r) => r.t), ["meta", "call", "prov", "result", "call", "prov"]);
    const prov = records[5];
    assert.equal(prov.t, "prov");
    if (prov.t !== "prov") return;
    assert.deepEqual(prov.resolved, [
      { path: "args.phone", via: "exact", from: { call: 0, at: "body.phone" } },
    ]);
    assert.deepEqual(prov.authored, ["args.name"]);
    assert.equal("unresolved" in prov, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("live recorder persists the normalized tier instead of fabricating an exact match", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-prov-live-"));
  try {
    const recorder = new Recorder(dir);
    const started = await recorder.start("demo", ["fake"]);
    assert.equal(started.ok, true);
    if (!started.ok) return;
    const first = recorder.recordCall("read", {});
    recorder.recordProvenance(first, {});
    recorder.recordResult(first, true, 0, {
      content: [{ type: "text", text: JSON.stringify({ company: "ACME" }) }],
    });
    const second = recorder.recordCall("write", { company: "acme" });
    recorder.recordProvenance(second, { company: "acme" });
    await recorder.stop();
    const records = await readTrace(started.path);
    const prov = records.find((r) => r.t === "prov" && r.i === second);
    assert.ok(prov && prov.t === "prov");
    if (!prov || prov.t !== "prov") return;
    assert.equal(prov.resolved?.[0]?.via, "normalized");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("live recorder never emits provenance for a policy-denied call", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-prov-live-"));
  try {
    const recorder = new Recorder(dir);
    const started = await recorder.start("demo", ["fake"]);
    assert.equal(started.ok, true);
    if (!started.ok) return;
    const i = recorder.recordCall("send", { to: "person@example.com" });
    recorder.recordDenied(i, 0, { content: [] }, "deny send");
    await recorder.stop();
    const records = await readTrace(started.path);
    assert.equal(records.some((r) => r.t === "prov"), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("unaddressable successful results make later misses unresolved", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-prov-live-"));
  try {
    const recorder = new Recorder(dir);
    const started = await recorder.start("demo", ["fake"]);
    assert.equal(started.ok, true);
    if (!started.ok) return;
    const first = recorder.recordCall("read", {});
    recorder.recordProvenance(first, {});
    recorder.recordResult(first, true, 0, { content: [{ type: "text", text: "not-json" }] });
    const second = recorder.recordCall("write", { value: "new" });
    recorder.recordProvenance(second, { value: "new" });
    await recorder.stop();
    const records = await readTrace(started.path);
    const prov = records.find((r) => r.t === "prov" && r.i === second);
    assert.ok(prov && prov.t === "prov");
    if (!prov || prov.t !== "prov") return;
    assert.deepEqual(prov.unresolved, [
      { path: "args.value", reason: "source-unaddressable: #0" },
    ]);
    assert.equal("authored" in prov, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the ordinary trace renderer names a provenance record neutrally", () => {
  const lines = formatTrace([
    { t: "prov", seq: 1, i: 2, authored: ["args.subject"], unresolved: [{ path: "args.to", reason: "gap" }] },
  ]);
  assert.deepEqual(lines, ["[prov #2] 0 grounded, 1 authored, 1 unresolved"]);
});

test("the ordinary trace renderer makes provenance truncation visible", () => {
  const lines = formatTrace([
    { t: "prov", seq: 1, i: 2, authored: ["args.a"], truncated: { authored: 4 } },
  ]);
  assert.deepEqual(lines, ["[prov #2] 0 grounded, 1 authored (+4 truncated), 0 unresolved"]);
});

test("a provenance measurement error degrades to unresolved and never throws at the live boundary", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-prov-live-"));
  try {
    const recorder = new Recorder(dir);
    const started = await recorder.start("demo", ["fake"]);
    assert.equal(started.ok, true);
    if (!started.ok) return;
    const hostile: Record<string, unknown> = { safe: "still dispatch this" };
    Object.defineProperty(hostile, "__proto__", { value: { poisoned: true }, enumerable: true });
    const i = recorder.recordCall("tool", hostile);
    assert.doesNotThrow(() => recorder.recordProvenance(i, hostile));
    await recorder.stop();
    const records = await readTrace(started.path);
    const prov = records.find((r) => r.t === "prov");
    assert.ok(prov && prov.t === "prov");
    if (!prov || prov.t !== "prov") return;
    assert.deepEqual(prov.unresolved, [{ path: "args", reason: "measurement-failed" }]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an unindexable successful result becomes a source gap and never changes the returned result path", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-prov-live-"));
  try {
    const recorder = new Recorder(dir);
    const started = await recorder.start("demo", ["fake"]);
    assert.equal(started.ok, true);
    if (!started.ok) return;
    const parsed: Record<string, unknown> = {};
    Object.defineProperty(parsed, "__proto__", { value: { poisoned: true }, enumerable: true });
    const i = recorder.recordCall("read", {});
    recorder.recordProvenance(i, {});
    assert.doesNotThrow(() => recorder.recordResult(i, true, 0, {
      content: [{ type: "text", text: JSON.stringify(parsed) }],
    }));
    const next = recorder.recordCall("write", { value: "new" });
    recorder.recordProvenance(next, { value: "new" });
    await recorder.stop();
    const records = await readTrace(started.path);
    const prov = records.find((r) => r.t === "prov" && r.i === next);
    assert.ok(prov && prov.t === "prov");
    if (!prov || prov.t !== "prov") return;
    assert.deepEqual(prov.unresolved, [{ path: "args.value", reason: "source-unaddressable: #0" }]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
