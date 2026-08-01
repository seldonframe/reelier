import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Recorder } from "../src/recorder.js";
import { parseTraceLines, formatTrace } from "../src/trace.js";
import type { PolicyRecord } from "../src/policy.js";

// ---------------------------------------------------------------------------
// docs/specs/policy-attestation-v1.md §2/§3.1 — the wrap path.
//
// `TraceRecord.meta.policy` describes THE RECORDING. It supersedes
// `policyGap`, which was set on exactly one condition of four, carried no
// digest, no source and no counts, and reached exactly one consumer.
// ---------------------------------------------------------------------------

async function readMeta(tracePath: string): Promise<Record<string, unknown>> {
  const source = await readFile(tracePath, "utf8");
  const first = parseTraceLines(source)[0];
  return first as unknown as Record<string, unknown>;
}

const VERIFIED: PolicyRecord = {
  status: "verified",
  digest: "sha256:" + "a".repeat(64),
  sourcePath: "project",
  rules: { deny: 2, dryRun: 1, toolScoped: 2 },
};

test("trace meta: a policy record is written to the meta line verbatim", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-trace-pol-"));
  try {
    const recorder = new Recorder(dir);
    const started = await recorder.start("withpolicy", ["fake"], undefined, VERIFIED);
    assert.equal(started.ok, true);
    if (!started.ok) return;

    const meta = await readMeta(started.path);
    assert.equal(meta.t, "meta");
    assert.deepEqual(meta.policy, VERIFIED);
    assert.equal("policyGap" in meta, false, "policyGap is superseded — never written alongside policy");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("trace meta: no policy record -> the key is omitted entirely (pre-policy traces stay byte-identical)", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-trace-pol-"));
  try {
    const recorder = new Recorder(dir);
    const started = await recorder.start("nopolicy", ["fake"]);
    assert.equal(started.ok, true);
    if (!started.ok) return;

    const meta = await readMeta(started.path);
    assert.equal("policy" in meta, false);
    assert.equal("policyGap" in meta, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("trace meta: every one of the four states round-trips through the trace file", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-trace-pol-"));
  try {
    const states: PolicyRecord[] = [
      VERIFIED,
      { status: "failed", digest: "sha256:" + "b".repeat(64), sourcePath: "project" },
      { status: "unchecked", sourcePath: "global" },
      { status: "absent" },
    ];
    for (const [i, rec] of states.entries()) {
      const recorder = new Recorder(dir);
      const started = await recorder.start(`state-${i}`, ["fake"], undefined, rec);
      assert.equal(started.ok, true);
      if (!started.ok) return;
      assert.deepEqual((await readMeta(started.path)).policy, rec);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// --- the legacy mapping ----------------------------------------------------

test("legacy trace: a bare policyGap normalizes to status 'failed' on read", () => {
  // Traces on operators' disks predate this. The condition policyGap was set
  // on is exactly the `failed` condition, so the mapping is total.
  const legacy = JSON.stringify({
    t: "meta",
    seq: 0,
    name: "old",
    startedAt: "2026-01-01T00:00:00.000Z",
    wrapped: ["fake"],
    policyGap: "/x/.reelier/policy.yml is malformed (1 error(s)): bad indent",
  });
  const [rec] = parseTraceLines(legacy);
  assert.equal(rec.t, "meta");
  if (rec.t !== "meta") return;

  assert.equal(rec.policy?.status, "failed");
  // Nothing hashed the file at record time and re-deriving one now is
  // impossible. A missing digest here does NOT mean "no file was found" —
  // `absent` is the state that means that.
  assert.equal(rec.policy?.digest, undefined);
  assert.equal(rec.policy?.rules, undefined);
});

test("legacy trace: a record carrying BOTH policy and policyGap prefers policy", () => {
  const both = JSON.stringify({
    t: "meta",
    seq: 0,
    name: "both",
    startedAt: "2026-01-01T00:00:00.000Z",
    wrapped: [],
    policy: { status: "verified", digest: "sha256:" + "c".repeat(64), sourcePath: "project" },
    policyGap: "stale marker",
  });
  const [rec] = parseTraceLines(both);
  if (rec.t !== "meta") return assert.fail("expected meta");
  assert.equal(rec.policy?.status, "verified");
});

test("legacy trace: a meta with neither field gets no policy at all (absence != absent)", () => {
  const bare = JSON.stringify({ t: "meta", seq: 0, name: "bare", startedAt: "2026-01-01T00:00:00.000Z", wrapped: [] });
  const [rec] = parseTraceLines(bare);
  if (rec.t !== "meta") return assert.fail("expected meta");
  // Absence means "written by a version that predates the field" — never
  // `absent`, which is a positive claim that a version capable of looking
  // did look and found nothing.
  assert.equal(rec.policy, undefined);
});

// --- rendering -------------------------------------------------------------

test("formatTrace: renders the policy state, and reports unreadable as unknown rather than as a pass", () => {
  const verified = formatTrace([
    { t: "meta", seq: 0, name: "n", startedAt: "2026-01-01T00:00:00.000Z", wrapped: [], policy: VERIFIED },
  ]).join("\n");
  assert.match(verified, /policy/i);
  assert.match(verified, /verified/);
  assert.match(verified, /project/);

  const absent = formatTrace([
    { t: "meta", seq: 0, name: "n", startedAt: "2026-01-01T00:00:00.000Z", wrapped: [], policy: { status: "absent" } },
  ]).join("\n");
  assert.match(absent, /absent/);

  const unchecked = formatTrace([
    {
      t: "meta",
      seq: 0,
      name: "n",
      startedAt: "2026-01-01T00:00:00.000Z",
      wrapped: [],
      policy: { status: "unchecked", sourcePath: "project" },
    },
  ]).join("\n");
  assert.match(unchecked, /unchecked/);
  assert.match(unchecked, /unknown/i);
});

test("formatTrace: a meta with no policy renders exactly as before (no added line)", () => {
  const lines = formatTrace([{ t: "meta", seq: 0, name: "n", startedAt: "2026-01-01T00:00:00.000Z", wrapped: ["a"] }]);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^\[meta\] n started/);
});
