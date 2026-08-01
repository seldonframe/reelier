// The `reelier trace --provenance` surface (docs/specs/argument-provenance-v1.md §2).
//
// The load-bearing tests here are the two honesty pins: `reelier trace` without
// the flag must be byte-identical to the release before this existed, and the
// rendered block must carry no verdict vocabulary and no score. A recorder that
// starts sounding like a judge has stopped being a recorder.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeTrace, formatProvenance } from "../src/provenance-trace.js";
import { parseTraceLines, formatTrace } from "../src/trace.js";

const execFileAsync = promisify(execFile);
const CLI_PATH = fileURLToPath(new URL("../src/cli.js", import.meta.url));

const TRACE_LINES = [
  { t: "meta", seq: 0, name: "fixture", startedAt: "2026-08-01T00:00:00.000Z", wrapped: ["crm"] },
  { t: "call", seq: 1, i: 0, ts: "2026-08-01T00:00:00.000Z", tool: "crm.get", args: { id: "c1" } },
  {
    t: "result",
    seq: 2,
    i: 0,
    ok: true,
    ms: 3,
    body: { content: [{ type: "text", text: JSON.stringify({ email: "john@example.com" }) }] },
  },
  {
    t: "call",
    seq: 3,
    i: 1,
    ts: "2026-08-01T00:00:00.000Z",
    tool: "booking.create",
    args: { email: "john@example.com", name: "John", phone: "not provided" },
  },
  { t: "result", seq: 4, i: 1, ok: true, ms: 5, body: { content: [{ type: "text", text: "{\"id\":9}" }] } },
];

async function withTrace<T>(fn: (tracePath: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-prov-cli-"));
  try {
    const tracePath = path.join(dir, "fixture-1.jsonl");
    await writeFile(tracePath, TRACE_LINES.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
    return await fn(tracePath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function render(): string[] {
  const records = parseTraceLines(TRACE_LINES.map((r) => JSON.stringify(r)).join("\n"));
  return formatProvenance(analyzeTrace(records));
}

// ---------------------------------------------------------------------------
// the renderer
// ---------------------------------------------------------------------------

test("a grounded value is rendered with the call and path it came from", () => {
  const text = render().join("\n");
  assert.match(text, /args\.email\s+grounded\s+#0 body\.email/);
});

test("an authored value is rendered as itself, with no source and no marker of fault", () => {
  const text = render().join("\n");
  assert.match(text, /args\.name\s+authored\s*$/m);
});

test("counts are rendered per state", () => {
  const text = render().join("\n");
  // 4 addressed leaves: call 0's `id` (nothing precedes it), and call 1's
  // `email` (grounded), `name` and `phone`.
  assert.match(text, /1 grounded/);
  assert.match(text, /3 authored/);
});

test("HONESTY: no verdict vocabulary appears anywhere in the rendered block", () => {
  // Spec §2 rule 1. `authored` is the word, and `authored` is not an accusation.
  // Precedent for a test-pinned banned list: test/priors-render.test.ts.
  const BANNED = [
    "fabricat",
    "hallucinat",
    "suspicious",
    "unsafe",
    "invalid",
    "violation",
    "verified",
    "failed",
    "error",
    "warning",
  ];
  const text = render().join("\n").toLowerCase();
  for (const word of BANNED) {
    assert.equal(text.includes(word), false, `rendered provenance must not contain ${JSON.stringify(word)}`);
  }
});

test("HONESTY: no ratio, percentage or score is rendered", () => {
  // Counting is permitted on this surface; a ratio is a score, and never-list #3
  // forbids gating on one (spec §2 rule 2). The number must never exist.
  const text = render().join("\n").toLowerCase();
  assert.equal(/%/.test(text), false);
  assert.equal(/\bscore\b/.test(text), false);
  assert.equal(/\d+\s*\/\s*\d+/.test(text), false);
});

test("HONESTY: the block says lineage is not correctness", () => {
  // §9.3 — a fully grounded argument set can be the wrong customer's real phone
  // number. If the surface does not say so, someone will read it as a pass.
  assert.match(render().join("\n").toLowerCase(), /never correctness|not correctness/);
});

// ---------------------------------------------------------------------------
// the CLI
// ---------------------------------------------------------------------------

test("ZERO-TOUCH: `reelier trace` without the flag is byte-identical to formatTrace", async () => {
  await withTrace(async (tracePath) => {
    const { stdout } = await execFileAsync(process.execPath, [CLI_PATH, "trace", tracePath]);
    const expected = formatTrace(parseTraceLines(TRACE_LINES.map((r) => JSON.stringify(r)).join("\n")));
    assert.equal(stdout.trimEnd(), expected.join("\n"));
  });
});

test("`reelier trace --provenance` prints the block and exits 0", async () => {
  await withTrace(async (tracePath) => {
    const { stdout } = await execFileAsync(process.execPath, [CLI_PATH, "trace", tracePath, "--provenance"]);
    assert.match(stdout, /args\.email\s+grounded/);
    assert.match(stdout, /args\.name\s+authored/);
  });
});

test("`reelier trace --provenance` still prints the trace itself", async () => {
  // The flag ADDS a block; it does not replace the command's existing output.
  await withTrace(async (tracePath) => {
    const { stdout } = await execFileAsync(process.execPath, [CLI_PATH, "trace", tracePath, "--provenance"]);
    assert.match(stdout, /\[call #0\]/);
  });
});

test("GATES NOTHING: a trace whose every value is authored still exits 0", async () => {
  // Spec §2 rule 4. This is a recorder; there is no outcome it may change.
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-prov-exit-"));
  try {
    const tracePath = path.join(dir, "all-authored-1.jsonl");
    const lines = [
      { t: "meta", seq: 0, name: "x", startedAt: "2026-08-01T00:00:00.000Z", wrapped: ["s"] },
      { t: "call", seq: 1, i: 0, ts: "2026-08-01T00:00:00.000Z", tool: "s.put", args: { a: "invented" } },
    ];
    await writeFile(tracePath, lines.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
    const { stdout } = await execFileAsync(process.execPath, [CLI_PATH, "trace", tracePath, "--provenance"]);
    assert.match(stdout, /args\.a\s+authored/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
