import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { initializeOperatorWorkspaceV1, readOperatorWorkspaceV1 } from "../../src/operator/workspace.js";

async function tempRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "reelier-operator-workspace-"));
}

test("workspace initialization is idempotent and persists no secrets", async () => {
  const root = await tempRoot();
  try {
    const first = await initializeOperatorWorkspaceV1({ root, selectedHarnesses: ["claude-code", "codex"], now: "2026-08-21T00:00:00.000Z" });
    const before = await readFile(path.join(root, ".reelier", "operator.json"), "utf8");
    const second = await initializeOperatorWorkspaceV1({ root, selectedHarnesses: ["codex", "claude-code"], now: "2026-08-21T01:00:00.000Z" });
    const after = await readFile(path.join(root, ".reelier", "operator.json"), "utf8");

    assert.deepEqual(second, first);
    assert.equal(after, before);
    assert.equal(after.includes("token"), false);
    assert.equal(after.includes("prompt"), false);
    assert.equal(after.includes("secret"), false);
    assert.deepEqual(await readOperatorWorkspaceV1(root), first);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("workspace parser rejects unknown keys and duplicate harnesses", async () => {
  const root = await tempRoot();
  try {
    await assert.rejects(
      () => initializeOperatorWorkspaceV1({ root, selectedHarnesses: ["codex", "codex"] }),
      /duplicate harness/,
    );
    await initializeOperatorWorkspaceV1({ root, selectedHarnesses: ["codex"] });
    const statePath = path.join(root, ".reelier", "operator.json");
    const value = JSON.parse(await readFile(statePath, "utf8")) as Record<string, unknown>;
    value.extra = true;
    await (await import("node:fs/promises")).writeFile(statePath, JSON.stringify(value), "utf8");
    await assert.rejects(() => readOperatorWorkspaceV1(root), /unknown key/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a symlinked workspace root is refused before state creation", async (t) => {
  const actual = await tempRoot();
  const parent = await tempRoot();
  const link = path.join(parent, "linked");
  try {
    try {
      await symlink(actual, link, process.platform === "win32" ? "junction" : "dir");
    } catch {
      t.skip("symlink creation is unavailable on this host");
      return;
    }
    await assert.rejects(() => initializeOperatorWorkspaceV1({ root: link, selectedHarnesses: [] }), /symlinked workspace root/);
  } finally {
    await rm(actual, { recursive: true, force: true });
    await rm(parent, { recursive: true, force: true });
  }
});
