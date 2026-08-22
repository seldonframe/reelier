import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { initializeOperatorV1 } from "../../src/init.js";
import type { OperatorHarnessRegistryV1 } from "../../src/operator/harness.js";

function fakeRegistry(installed: readonly string[]): OperatorHarnessRegistryV1 {
  const ids = ["codex", "claude-code", "grok-build"] as const;
  const probes = ids.map((id) => Object.freeze({
    descriptor: Object.freeze({ v: "reelier.operator-harness/v1" as const, id, displayName: id, executable: id, resumeSupported: true, jsonEventsSupported: true }),
    installed: installed.includes(id), version: installed.includes(id) ? "fixture" : null,
    authMode: installed.includes(id) ? "installed-session" as const : "unavailable" as const,
    reason: installed.includes(id) ? null : "executable-unavailable",
  }));
  return { async probeAll() { return probes; }, async probe(id) {
    const result = probes.find((probe) => probe.descriptor.id === id);
    if (!result) throw new Error("missing fixture");
    return result;
  } };
}

test("operator init selects installed harnesses and defaults to the local Cell", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-operator-init-"));
  try {
    const summary = await initializeOperatorV1({ cwd: root, home: root, now: "2026-08-21T00:00:00.000Z", registry: fakeRegistry(["codex", "claude-code"]) });
    assert.deepEqual(summary.workspace.selectedHarnesses, ["claude-code", "codex"]);
    assert.equal(summary.workspace.mode, "local-cell");
    assert.equal(summary.workspace.authorityCell, "local");
    assert.deepEqual(summary.next, ["run-local-cell", "review-authority"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("operator init reports installation as the next action when no harness is present", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-operator-init-"));
  try {
    const summary = await initializeOperatorV1({ cwd: root, home: root, registry: fakeRegistry([]) });
    assert.deepEqual(summary.workspace.selectedHarnesses, []);
    assert.deepEqual(summary.next, ["install-harness", "review-authority"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
