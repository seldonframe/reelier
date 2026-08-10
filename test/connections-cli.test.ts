import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { cmdConnections, type ParsedArgs } from "../src/cli.js";

test("connections reports non-secret adopted metadata and honest default coverage", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-connections-"));
  const lines: string[] = [];
  const original = console.log;
  console.log = (...values: unknown[]) => lines.push(values.join(" "));
  try {
    await mkdir(path.join(root, "connectors"));
    await writeFile(path.join(root, "connectors", "gmail.json"), JSON.stringify({ provider: "gmail", status: "adopted", accountId: "acct_1", callableTools: ["send", "get"], secret: "must-not-appear" }));
    await writeFile(path.join(root, "connectors", "bad.json"), "{");
    const args = { positional: [], flags: new Set<string>(), opts: { path: root } } as unknown as ParsedArgs;
    assert.equal(await cmdConnections(args), 0);
    const output = JSON.parse(lines[0]) as { connections: Array<Record<string, unknown>> };
    assert.deepEqual(output.connections, [{ provider: "gmail", status: "adopted", accountId: "acct_1", callableTools: ["get", "send"], enforcement: "unchecked" }]);
    assert.doesNotMatch(lines[0], /must-not-appear/);
  } finally { console.log = original; await rm(root, { recursive: true, force: true }); }
});
