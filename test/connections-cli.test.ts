import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { cmdConnections, type ParsedArgs } from "../src/cli.js";

test("connections refuses malformed inventory honestly without disclosing file contents", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-connections-"));
  const lines: string[] = [];
  const original = console.log;
  console.log = (...values: unknown[]) => lines.push(values.join(" "));
  try {
    await mkdir(path.join(root, "connectors"));
    await writeFile(path.join(root, "connectors", "bad.json"), '{"accessToken":"must-not-appear"');
    const args = { positional: [], flags: new Set<string>(), opts: { path: root } } as unknown as ParsedArgs;
    assert.equal(await cmdConnections(args), 1);
    const output = JSON.parse(lines[0]) as { entries: Array<Record<string, unknown>>; issues: Array<Record<string, unknown>> };
    assert.deepEqual(output.entries, []);
    assert.deepEqual(output.issues, [{ file: "bad.json", reasonCode: "malformed-inventory-entry" }]);
    assert.doesNotMatch(lines[0], /must-not-appear/);
  } finally { console.log = original; await rm(root, { recursive: true, force: true }); }
});
