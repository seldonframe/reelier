import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createPublicKey } from "node:crypto";
import { loadExistingLocalGateSigner, loadOrCreateLocalGateSigner } from "../../src/authority/host/gate-signer.js";
import { profileGovernanceFixture } from "./profile-governance-fixture.js";

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

test("simultaneous first starts converge on the one durably persisted gate identity", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-gate-signer-race-"));
  try {
    const file = path.join(root, "keys", "local-gate.pem");
    const starts = await Promise.all(Array.from({ length: 32 }, () => loadOrCreateLocalGateSigner(file)));
    const durable = await loadExistingLocalGateSigner(file);
    const identities = starts.map(item => item.publicKey.export({ type: "spki", format: "der" }).toString("base64"));
    assert.equal(new Set(identities).size, 1, "all concurrent creators must return the published key");
    assert.equal(identities[0], durable.publicKey.export({ type: "spki", format: "der" }).toString("base64"));
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

test("read-only governed gate key loading never creates a missing parent", async () => {
  profileGovernanceFixture();
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-existing-gate-missing-"));
  try {
    const parent = path.join(root, "absent");
    await assert.rejects(() => loadExistingLocalGateSigner(path.join(parent, "gate.pem")), error => (error as NodeJS.ErrnoException).code === "ENOENT");
    await assert.rejects(() => stat(parent), error => (error as NodeJS.ErrnoException).code === "ENOENT");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("read-only governed gate key loading preserves successful and malformed bytes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-existing-gate-stable-"));
  try {
    const file = path.join(root, "gate.pem");
    await loadOrCreateLocalGateSigner(file);
    const before = await readFile(file);
    const beforeStat = await stat(file);
    const loaded = await loadExistingLocalGateSigner(file);
    assert.equal(loaded.publicKey.asymmetricKeyType, "ed25519");
    assert.deepEqual(await readFile(file), before);
    assert.equal((await stat(file)).size, beforeStat.size);
    await writeFile(file, "malformed", "utf8");
    await assert.rejects(() => loadExistingLocalGateSigner(file), /private key|ed25519|gate/i);
    assert.equal(await readFile(file, "utf8"), "malformed");
  } finally { await rm(root, { recursive: true, force: true }); }
});
