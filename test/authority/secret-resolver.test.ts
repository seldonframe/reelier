import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, symlink, writeFile } from "node:fs/promises";
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
  let hasLink = true;
  try { await symlink(outside, path.join(root, "link")); } catch { hasLink = false; }
  const resolver = createSecretResolver({ fileRoot: root, slots: {
    present: { kind: "file", path: "token" },
    missing: { kind: "file", path: "missing" },
    escaped: { kind: "file", path: "../outside-secret" },
    ...(hasLink ? { linked: { kind: "file" as const, path: "link" } } : {}),
  }, env: Object.freeze({}) });
  assert.deepEqual(resolver.inspectSlot("present"), { slotId: "present", status: "configured" });
  assert.deepEqual(resolver.inspectSlot("missing"), { slotId: "missing", status: "missing" });
  await assert.rejects(() => resolver.acquireSlot("escaped"), /confin|root|unavailable/i);
  if (hasLink) await assert.rejects(() => resolver.acquireSlot("linked"), /link|reparse|confin|unavailable/i);
  await assert.rejects(() => resolver.acquireSlot("missing"), /unavailable|missing/i);
});

test("credential slot values reject NUL and oversized files", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-secret-slot-"));
  await writeFile(path.join(root, "nul"), "bad\0value");
  await writeFile(path.join(root, "large"), Buffer.alloc(64 * 1024 + 1, 65));
  const resolver = createSecretResolver({ fileRoot: root, slots: { nul: { kind: "file", path: "nul" }, large: { kind: "file", path: "large" } }, env: Object.freeze({}) });
  await assert.rejects(() => resolver.acquireSlot("nul"), /NUL|invalid|unavailable/i);
  await assert.rejects(() => resolver.acquireSlot("large"), /64|large|limit|unavailable/i);
});

test("credential leases expire and remain one-use", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-secret-slot-"));
  await writeFile(path.join(root, "token"), "value");
  const resolver = createSecretResolver({ fileRoot: root, slots: { token: { kind: "file", path: "token" } }, env: Object.freeze({}) });
  const lease = await resolver.acquireSlot("token");
  assert.equal(lease.readOnce(), "value");
  assert.throws(() => lease.readOnce(), /unavailable/i);
  const expired = await resolver.acquireSlot("token");
  const originalNow = Date.now;
  try { Date.now = () => Date.parse(expired.description.expiresAt) + 1; assert.throws(() => expired.readOnce(), /unavailable/i); } finally { Date.now = originalNow; }
});

test("credential slot maps and definitions reject accessors and non-plain prototypes", () => {
  const root = path.join(tmpdir(), "reelier-secret-slot-invalid");
  const accessorSlots = {} as Record<string, unknown>;
  Object.defineProperty(accessorSlots, "token", { enumerable: true, get() { throw new Error("canary getter"); } });
  assert.throws(() => createSecretResolver({ fileRoot: root, slots: accessorSlots as never, env: Object.freeze({}) }), /accessor|invalid/i);
  assert.throws(() => createSecretResolver({ fileRoot: root, slots: Object.create(null) as never, env: Object.freeze({}) }), /prototype|invalid/i);
  const accessorDefinition = {} as Record<string, unknown>;
  Object.defineProperty(accessorDefinition, "path", { enumerable: true, get() { throw new Error("canary getter"); } });
  accessorDefinition.kind = "file";
  assert.throws(() => createSecretResolver({ fileRoot: root, slots: { token: accessorDefinition as never }, env: Object.freeze({}) }), /accessor|invalid/i);
});

test("credential slots reject linked and non-directory roots", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-secret-slot-"));
  await writeFile(path.join(root, "token"), "value");
  const fileRoot = path.join(root, "root-file");
  await writeFile(fileRoot, "not a directory");
  const resolver = createSecretResolver({ fileRoot: fileRoot, slots: { token: { kind: "file", path: "token" } }, env: Object.freeze({}) });
  await assert.rejects(() => resolver.acquireSlot("token"), /unavailable|root/i);
});

test("credential env slots reject empty and NUL values", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-secret-slot-"));
  const resolver = createSecretResolver({ fileRoot: root, slots: { empty: { kind: "env", name: "EMPTY" }, nul: { kind: "env", name: "NUL" } }, env: Object.freeze({ EMPTY: "", NUL: "bad\0value" }) });
  await assert.rejects(() => resolver.acquireSlot("empty"), /unavailable/i);
  await assert.rejects(() => resolver.acquireSlot("nul"), /unavailable/i);
});
