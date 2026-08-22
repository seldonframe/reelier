import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createOperatorSessionStoreV1 } from "../../src/operator/session-store.js";

test("operator session store persists only redacted lifecycle metadata and reopens it", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-operator-session-"));
  try {
    const store = createOperatorSessionStoreV1({ root, now: () => "2026-08-21T00:00:00.000Z" });
    const state = {
      v: "reelier.operator-session/v1" as const,
      sessionId: "session-1",
      harness: "codex" as const,
      requestId: "request-1",
      promptDigest: "sha256:" + "a".repeat(64),
      harnessLifecycle: "running" as const,
      cellVerdict: "accepted" as const,
      cellLifecycle: "pending",
      updatedAt: "2026-08-21T00:00:00.000Z",
    };
    await store.save(state);
    assert.deepEqual(await store.load("session-1"), state);
    const serialized = await readFile(path.join(root, ".reelier", "operator-sessions", "session-1.json"), "utf8");
    assert.equal(serialized.includes("secret prompt"), false);
    assert.equal(serialized.includes("access_token"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("operator session store refuses unknown fields and path traversal", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-operator-session-"));
  try {
    const store = createOperatorSessionStoreV1({ root });
    await assert.rejects(() => store.load("../outside"), /session id|invalid/i);
    await assert.rejects(() => store.save({ v: "reelier.operator-session/v1", sessionId: "bad", harness: "codex", requestId: "r", promptDigest: "sha256:" + "a".repeat(64), harnessLifecycle: "running", cellVerdict: "unchecked", cellLifecycle: "unchecked", updatedAt: "2026-08-21T00:00:00.000Z", extra: "refuse" } as never), /unknown|shape|invalid/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

