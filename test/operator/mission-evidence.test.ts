import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createMissionEvidenceStoreV1 } from "../../src/operator/mission-evidence.js";

test("local evidence is content-addressed, closed, and stable across reopen", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-mission-evidence-"));
  try {
    const store = await createMissionEvidenceStoreV1({ root });
    const input = {
      kind: "git-head" as const,
      subjectDigest: `sha256:${"a".repeat(64)}`,
      resultDigest: `sha256:${"b".repeat(64)}`,
      status: "observed" as const,
      observedAt: "2026-08-24T12:00:00.000Z",
    };
    const first = await store.publish(input);
    const second = await store.publish(input);
    assert.deepEqual(second, first);
    assert.match(first.evidenceRef, /^sha256:[0-9a-f]{64}$/);
    assert.deepEqual(await (await createMissionEvidenceStoreV1({ root })).load(first.evidenceRef), first);
    const bytes = await readFile(path.join(root, ".reelier", "operator", "evidence", `${first.evidenceRef.slice(7)}.json`), "utf8");
    assert.doesNotMatch(bytes, /prompt|reasoning|token|credential|providerBody/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("tampered evidence and arbitrary fields fail closed", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-mission-evidence-tamper-"));
  try {
    const store = await createMissionEvidenceStoreV1({ root });
    await assert.rejects(() => store.publish({ kind: "agent-claim", subjectDigest: `sha256:${"a".repeat(64)}`, resultDigest: `sha256:${"b".repeat(64)}`, status: "verified", observedAt: "2026-08-24T12:00:00.000Z" } as never), /kind|status|invalid/i);
    const evidence = await store.publish({ kind: "test", subjectDigest: `sha256:${"a".repeat(64)}`, resultDigest: `sha256:${"b".repeat(64)}`, status: "passed", observedAt: "2026-08-24T12:00:00.000Z" });
    const target = path.join(root, ".reelier", "operator", "evidence", `${evidence.evidenceRef.slice(7)}.json`);
    const parsed = JSON.parse(await readFile(target, "utf8"));
    parsed.resultDigest = `sha256:${"c".repeat(64)}`;
    await writeFile(target, `${JSON.stringify(parsed)}\n`, "utf8");
    await assert.rejects(() => store.load(evidence.evidenceRef), /digest|tamper/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
