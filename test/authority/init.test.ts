import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runAuthorityCommand } from "../../src/authority/cli.js";

test("authority init writes explicit unsigned contract templates rather than lossy executable definitions", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-authority-init-"));
  try {
    assert.equal(await runAuthorityCommand({ positional: ["init"], flags: new Set(), opts: { path: root } }), 0);
    const template = JSON.parse(await readFile(path.join(root, "contracts", "gmail_reply_send_v1.template.json"), "utf8")) as Record<string, unknown>;
    assert.equal(template.v, "reelier.outcome-contract-template/v1");
    assert.equal(template.alias, "gmail_reply_send_v1");
    assert.equal(template.status, "unsigned-template");
    assert.equal("compile" in template, false);
    assert.equal("signature" in template, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
