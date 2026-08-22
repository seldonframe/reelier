import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { cmdOperator, type ParsedArgs } from "../../src/cli.js";
import { initializeOperatorWorkspaceV1 } from "../../src/operator/workspace.js";
import { createOperatorSessionStoreV1 } from "../../src/operator/session-store.js";

const args = (subcommand: string): ParsedArgs => ({ positional: [subcommand], flags: new Set(), vars: {}, wraps: [], opts: {}, fails: [] });

test("operator status is explicit before initialization and succeeds after local state exists", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-operator-cli-"));
  const previous = process.cwd();
  try {
    process.chdir(root);
    assert.equal(await cmdOperator(args("status")), 1);
    await initializeOperatorWorkspaceV1({ root, selectedHarnesses: ["codex"], now: "2026-08-21T00:00:00.000Z" });
    assert.equal(await cmdOperator(args("status")), 0);
  } finally {
    process.chdir(previous);
    await rm(root, { recursive: true, force: true });
  }
});

test("operator status reads a persisted session and operator list exposes redacted sessions", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-operator-cli-sessions-"));
  const previous = process.cwd();
  const originalLog = console.log;
  const output: string[] = [];
  try {
    process.chdir(root);
    const store = createOperatorSessionStoreV1({ root, now: () => "2026-08-21T00:00:00.000Z" });
    await store.save({
      v: "reelier.operator-session/v1",
      sessionId: "session-cli",
      harness: "codex",
      requestId: "request-cli",
      promptDigest: `sha256:${"b".repeat(64)}`,
      harnessLifecycle: "completed",
      cellVerdict: "accepted",
      cellLifecycle: "reconciled",
      receiptRef: "receipt-cli",
      updatedAt: "2026-08-21T00:00:00.000Z",
    });
    console.log = (...args: unknown[]) => output.push(args.join(" "));
    assert.equal(await cmdOperator({ positional: ["status", "session-cli"], flags: new Set(), vars: {}, wraps: [], opts: {}, fails: [] }), 0);
    assert.equal(await cmdOperator({ positional: ["list"], flags: new Set(), vars: {}, wraps: [], opts: {}, fails: [] }), 0);
    assert.match(output.join("\n"), /session-cli/);
    assert.doesNotMatch(output.join("\n"), /prompt|request-cli/);
  } finally {
    console.log = originalLog;
    process.chdir(previous);
    await rm(root, { recursive: true, force: true });
  }
});

test("operator review prints the Cloud review surface without exposing local prompts", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-operator-review-"));
  const previous = process.cwd();
  const originalLog = console.log;
  const output: string[] = [];
  try {
    process.chdir(root);
    console.log = (...args: unknown[]) => output.push(args.join(" "));
    assert.equal(await cmdOperator({ positional: ["review"], flags: new Set(), vars: {}, wraps: [], opts: {}, fails: [] }), 0);
    assert.match(output.join("\n"), /dashboard\/outcomes/);
    assert.match(output.join("\n"), /Verified means reconciled/);
    assert.doesNotMatch(output.join("\n"), /prompt|request-cli/);
  } finally {
    console.log = originalLog;
    process.chdir(previous);
    await rm(root, { recursive: true, force: true });
  }
});
