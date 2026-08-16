import test from "node:test";
import assert from "node:assert/strict";
import { createBoundSourceReadAdapter } from "../../src/authority/host/source-read-adapter.js";

const plan = { index: 0, planDigest: "sha256:" + "a".repeat(64), endpointId: "github.issue.labels.read", opaqueHandle: "issue_1" } as const;

test("bound source reader resolves an opaque handle to a host-owned exact read", async () => {
  const seen: unknown[] = [];
  const adapter = createBoundSourceReadAdapter({
    bindings: [{ opaqueHandle: "issue_1", endpointId: "github.issue.labels.read", accountIdentity: "owner/repo", path: "/repos/owner/repo/issues/1/labels", query: "per_page=100", headers: { Accept: "application/vnd.github+json" } }],
    async read(input) { seen.push(input); return Uint8Array.from(Buffer.from('[{"name":"bug"}]')); },
  });
  const result = await adapter.execute([plan]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.observations[0].planDigest, plan.planDigest);
  assert.equal(Buffer.from(result.observations[0].rawBytes).toString("utf8"), '[{"name":"bug"}]');
  assert.deepEqual(seen, [{ endpointId: "github.issue.labels.read", accountIdentity: "owner/repo", path: "/repos/owner/repo/issues/1/labels", query: "per_page=100", headers: { Accept: "application/vnd.github+json" } }]);
});

test("bound source reader fails closed for unknown, mismatched, duplicate, or leaking bindings", async () => {
  const read = async () => new Uint8Array();
  const adapter = createBoundSourceReadAdapter({ bindings: [{ opaqueHandle: "issue_1", endpointId: "github.issue.labels.read", accountIdentity: "owner/repo", path: "/repos/owner/repo/issues/1/labels", query: "", headers: {} }], read });
  assert.deepEqual(await adapter.execute([{ ...plan, opaqueHandle: "unknown" }]), { ok: false, reason: "refused" });
  assert.deepEqual(await adapter.execute([{ ...plan, endpointId: "other" }]), { ok: false, reason: "refused" });
  assert.throws(() => createBoundSourceReadAdapter({ bindings: [
    { opaqueHandle: "issue_1", endpointId: "github.issue.labels.read", accountIdentity: "a", path: "/x", query: "", headers: {} },
    { opaqueHandle: "issue_1", endpointId: "github.issue.labels.read", accountIdentity: "a", path: "/x", query: "", headers: {} },
  ], read }), /duplicate/);
  assert.throws(() => createBoundSourceReadAdapter({ bindings: [{ opaqueHandle: "issue_1", endpointId: "github.issue.labels.read", accountIdentity: "a", path: "/x", query: "", headers: { Authorization: "secret" } }], read }), /header|authorization/i);
});

