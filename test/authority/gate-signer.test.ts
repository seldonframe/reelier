import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createPublicKey } from "node:crypto";
import { loadOrCreateLocalGateSigner } from "../../src/authority/host/gate-signer.js";

test("local gate signer persists the same Ed25519 identity across runtime restarts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-gate-signer-"));
  try {
    const file = path.join(root, "keys", "local-gate.pem");
    await mkdir(path.dirname(file), { recursive: true });
    const first = await loadOrCreateLocalGateSigner(file);
    const second = await loadOrCreateLocalGateSigner(file);
    assert.equal(first.privateKey.type, "private");
    assert.equal(first.privateKey.asymmetricKeyType, "ed25519");
    assert.equal(first.publicKey.export({ type: "spki", format: "der" }).toString("base64"), second.publicKey.export({ type: "spki", format: "der" }).toString("base64"));
    assert.equal(createPublicKey(first.privateKey).export({ type: "spki", format: "der" }).toString("base64"), second.publicKey.export({ type: "spki", format: "der" }).toString("base64"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("local gate signer refuses a malformed existing key instead of replacing it", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-gate-signer-invalid-"));
  try {
    const file = path.join(root, "keys", "local-gate.pem");
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, "not a private key", "utf8");
    await assert.rejects(() => loadOrCreateLocalGateSigner(file), /local gate key|private key|ed25519/i);
    assert.equal(await (await import("node:fs/promises")).readFile(file, "utf8"), "not a private key");
  } finally { await rm(root, { recursive: true, force: true }); }
});
