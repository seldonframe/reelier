import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runAuthorityCommand } from "../../src/authority/cli.js";

const digest = "sha256:7f46242b26d9c921f4e1ec9de6418ac5fc8c03d70c4415c25e799ae0e73a1512";

test("authority connect writes only a normalized opaque client connection", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-authority-cell-client-"));
  const file = path.join(root, "authority-cell-connection.json");
  const output: string[] = [];
  const original = console.log;
  console.log = (...values: unknown[]) => output.push(values.join(" "));
  try {
    const exitCode = await runAuthorityCommand({ positional: ["connect"], flags: new Set(), opts: {
      endpoint: "https://CELL.EXAMPLE:443/api/",
      "token-ref": "env:REELIER_CELL_TOKEN",
      "cell-id": "cell_linux_1",
      "adapter-contract-digest": digest,
      path: file,
    } });

    assert.equal(exitCode, 0);
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), {
      v: "reelier.authority-cell-connection/v1",
      endpoint: "https://cell.example/api",
      transport: "http",
      bearerTokenRef: "env:REELIER_CELL_TOKEN",
      expectedCellId: "cell_linux_1",
      adapterContractDigest: digest,
    });
    assert.equal(output.join("\n").includes("REELIER_CELL_TOKEN"), false);
  } finally {
    console.log = original;
    await rm(root, { recursive: true, force: true });
  }
});
