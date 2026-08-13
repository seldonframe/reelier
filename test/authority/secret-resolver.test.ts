import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createSecretResolver, describeSecretLease } from "../../src/authority/host/secret-resolver.js";

test("credential slots issue one-use non-secret leases", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-secret-slot-"));
  await writeFile(path.join(root, "token"), "CANARY_SLOT_VALUE\n");
  const resolver = createSecretResolver({ fileRoot: root, slots: { "github.tracer": { kind: "file", path: "token" } }, env: Object.freeze({}) });
  const lease = await resolver.acquireSlot("github.tracer");
  const description = describeSecretLease(lease);
  assert.equal(description.slotId, "github.tracer");
  assert.match(description.v, /secret-lease-description\/v1/);
  assert.equal(typeof description.instanceId, "string");
  assert.equal(typeof description.version, "string");
  assert.match(description.expiresAt, /^20/);
  assert.equal(lease.readOnce(), "CANARY_SLOT_VALUE");
  assert.throws(() => lease.readOnce(), /unavailable|used|expired/i);
  assert.equal(JSON.stringify(description).includes("CANARY_SLOT_VALUE"), false);
  assert.equal(JSON.stringify(lease).includes("token"), false);
});

test("credential slot inspection is status-only and confinement rejects unsafe files", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-secret-slot-"));
  await writeFile(path.join(root, "token"), "value");
  const outside = path.join(path.dirname(root), "outside-secret");
  await writeFile(outside, "outside");
  await symlink(outside, path.join(root, "link"));
  const resolver = createSecretResolver({ fileRoot: root, slots: {
    present: { kind: "file", path: "token" },
    missing: { kind: "file", path: "missing" },
    escaped: { kind: "file", path: "../outside-secret" },
    linked: { kind: "file", path: "link" },
  }, env: Object.freeze({}) });
  assert.deepEqual(resolver.inspectSlot("present"), { slotId: "present", status: "configured" });
  assert.deepEqual(resolver.inspectSlot("missing"), { slotId: "missing", status: "missing" });
  await assert.rejects(() => resolver.acquireSlot("escaped"), /confin|root/i);
  await assert.rejects(() => resolver.acquireSlot("linked"), /link|reparse|confin/i);
  await assert.rejects(() => resolver.acquireSlot("missing"), /unavailable|missing/i);
});

test("credential slot values reject NUL and oversized files", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-secret-slot-"));
  await writeFile(path.join(root, "nul"), "bad\0value");
  await writeFile(path.join(root, "large"), Buffer.alloc(64 * 1024 + 1, 65));
  const resolver = createSecretResolver({ fileRoot: root, slots: { nul: { kind: "file", path: "nul" }, large: { kind: "file", path: "large" } }, env: Object.freeze({}) });
  await assert.rejects(() => resolver.acquireSlot("nul"), /NUL|invalid/i);
  await assert.rejects(() => resolver.acquireSlot("large"), /64|large|limit/i);
});
