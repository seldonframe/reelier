import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { cmdOperator, type ParsedArgs } from "../../src/cli.js";
import { initializeOperatorWorkspaceV1 } from "../../src/operator/workspace.js";

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
