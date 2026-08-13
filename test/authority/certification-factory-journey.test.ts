import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runAuthorityCommand } from "../../src/authority/cli.js";
import { authorityDigest } from "../../src/authority/wire.js";
import { verifyCertificationTaskReceiptGraph } from "../../src/authority/certification/task-receipt-graph.js";
import { __testSetAuthorityCellHostPlatform } from "../../src/authority/host/platform.js";

test("factory journey atomically publishes a verified graph and non-authorizing summary", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-factory-journey-"));
  const out = path.join(root, "evidence");
  const restore = __testSetAuthorityCellHostPlatform("linux");
  const stdout: string[] = [], stderr: string[] = [];
  const log = console.log, error = console.error;
  console.log = (...values: unknown[]) => { stdout.push(values.join(" ")); };
  console.error = (...values: unknown[]) => { stderr.push(values.join(" ")); };
  try {
    const code = await runAuthorityCommand({ positional: ["certify", "factory-journey"], flags: new Set(), opts: { out } });
    assert.equal(code, 0);
    assert.deepEqual(stderr, []);
    assert.equal(stdout.length, 1);
    const result = JSON.parse(stdout[0]!) as Record<string, string>;
    assert.deepEqual(Object.keys(result).sort(), ["graphDigest", "graphPath", "journey", "status", "summaryDigest", "summaryPath", "trustPath"]);
    assert.equal(result.status, "verified");
    assert.equal(result.journey, "github-issue-labels");
    assert.equal(result.graphPath, path.join(out, "graph.json"));
    assert.equal(result.trustPath, path.join(out, "trust-pin.json"));
    assert.equal(result.summaryPath, path.join(out, "factory-journey-summary.json"));
    const graph = JSON.parse(readFileSync(result.graphPath, "utf8"));
    const trustPin = JSON.parse(readFileSync(result.trustPath, "utf8"));
    const summary = JSON.parse(readFileSync(result.summaryPath, "utf8"));
    assert.equal(verifyCertificationTaskReceiptGraph(graph, { trustPin }).status, "verified");
    assert.equal(result.graphDigest, authorityDigest(graph));
    assert.equal(result.summaryDigest, authorityDigest(summary));
    assert.equal(summary.graphDigest, result.graphDigest);
    assert.equal(summary.authorityBoundaryCeremonies, 1);
    assert.equal(summary.providerSdkCalls, 0);
  } finally {
    console.log = log; console.error = error; restore(); await rm(root, { recursive: true, force: true });
  }
});

test("factory journey refuses existing output without mutating it", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-factory-journey-"));
  const out = path.join(root, "existing");
  await (await import("node:fs/promises")).mkdir(out);
  const restore = __testSetAuthorityCellHostPlatform("linux");
  const stdout: string[] = [], stderr: string[] = [];
  const log = console.log, error = console.error;
  console.log = (...values: unknown[]) => { stdout.push(values.join(" ")); };
  console.error = (...values: unknown[]) => { stderr.push(values.join(" ")); };
  try {
    assert.equal(await runAuthorityCommand({ positional: ["certify", "factory-journey"], flags: new Set(), opts: { out } }), 1);
    assert.deepEqual(stdout, []);
    assert.deepEqual(stderr, [JSON.stringify({ status: "refused", reasonCode: "factory-journey-refused" })]);
    assert.equal(existsSync(out), true);
  } finally { console.log = log; console.error = error; restore(); await rm(root, { recursive: true, force: true }); }
});
