import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createAutonomyBenchmarkStoreV1 } from "../../src/operator/autonomy-benchmark-store.js";

const digest = (character: string): string => `sha256:${character.repeat(64)}`;
const run = (mode: "native" | "reelier", milliseconds: number) => ({
  version: "reelier.autonomy-benchmark-run/v1" as const,
  benchmarkId: `proof-${mode}`,
  workloadDigest: digest("a"),
  mode,
  harness: "codex" as const,
  reconciledOutcomeRefs: [`outcome-${mode}-1`, `outcome-${mode}-2`],
  attentionEvents: [{
    version: "reelier.human-attention-event/v1" as const,
    eventId: `attention-${mode}`,
    benchmarkId: `proof-${mode}`,
    kind: "review" as const,
    startedAt: "2026-08-24T12:00:00.000Z",
    endedAt: new Date(Date.parse("2026-08-24T12:00:00.000Z") + milliseconds).toISOString(),
    activeMilliseconds: milliseconds,
    source: mode === "native" ? "baseline-observer" as const : "operator" as const,
  }],
  duplicateWrites: 0,
  credentialDisclosures: 0,
  falseVerifiedOutcomes: 0,
  unresolvedOutcomes: 0,
  startedAt: "2026-08-24T12:00:00.000Z",
  endedAt: "2026-08-24T13:00:00.000Z",
});

test("benchmark runs persist locally and export a signed redacted matched bundle", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-benchmark-store-"));
  try {
    const store = await createAutonomyBenchmarkStoreV1({ root });
    await store.record(run("native", 600_000));
    await store.record(run("reelier", 60_000));
    await store.record(run("reelier", 60_000));

    const bundle = await store.exportMatched({ nativeBenchmarkId: "proof-native", reelierBenchmarkId: "proof-reelier" });
    assert.equal(bundle.comparison.improvement, 10);
    assert.match(bundle.signature, /^[A-Za-z0-9_-]{80,128}$/);
    assert.equal("attentionEvents" in bundle, false);
    assert.equal("reconciledOutcomeRefs" in bundle, false);

    const directory = path.join(root, ".reelier", "operator", "benchmarks");
    const files = await readdir(directory);
    assert.equal(files.length, 2);
    const bytes = (await Promise.all(files.map((file) => readFile(path.join(directory, file), "utf8")))).join("\n");
    assert.doesNotMatch(bytes, /SECRET|rawPrompt|reasoningText|providerBody|accessToken/i);
    await assert.rejects(() => store.record({ ...run("native", 600_000), prompt: "secret" } as never), /shape/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("benchmark storage refuses linked roots before creating durable state", async (t) => {
  if (process.platform === "win32") { t.skip("directory symlink creation requires optional Windows privilege"); return; }
  const parent = await mkdtemp(path.join(tmpdir(), "reelier-benchmark-link-"));
  const target = path.join(parent, "target");
  const linked = path.join(parent, "linked");
  try {
    await mkdir(target);
    await symlink(target, linked, "dir");
    await assert.rejects(() => createAutonomyBenchmarkStoreV1({ root: linked }), /linked|symlink/i);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
