import { test } from "node:test";
import assert from "node:assert/strict";
import { createOperatorHarnessRegistryV1, type OperatorHarnessIdV1 } from "../../src/operator/harness.js";
import { resolveOperatorHarnessCommandV1 } from "../../src/operator/harness-executable.js";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const ids: OperatorHarnessIdV1[] = ["codex", "claude-code", "grok-build"];

test("operator harness registry exposes the stable three-harness contract", async () => {
  const registry = createOperatorHarnessRegistryV1({
    commandExists: async (executable) => executable !== "grok",
    runVersion: async (executable) => `${executable} 1.2.3\nsecret-token-must-not-escape`,
  });

  const probes = await registry.probeAll();
  assert.deepEqual(probes.map((probe) => probe.descriptor.id), ids);
  assert.deepEqual(probes.map((probe) => probe.descriptor.executable), ["codex", "claude", "grok"]);
  assert.equal(probes[0].installed, true);
  assert.equal(probes[0].version, "codex 1.2.3");
  assert.equal(probes[0].authMode, "installed-session");
  assert.equal(probes[2].installed, false);
  assert.equal(probes[2].authMode, "unavailable");
  assert.equal(probes[2].reason, "executable-unavailable");
  assert.ok(Object.isFrozen(probes));
  assert.ok(Object.isFrozen(probes[0]));
  assert.ok(Object.isFrozen(probes[0].descriptor));
  assert.equal(JSON.stringify(probes).includes("secret-token"), false);
});

test("an installed harness with hostile version output is still represented honestly", async () => {
  const registry = createOperatorHarnessRegistryV1({
    commandExists: async () => true,
    runVersion: async () => "\u0000\u0001".repeat(200),
  });

  const probe = await registry.probe("codex");
  assert.equal(probe.installed, true);
  assert.equal(probe.authMode, "installed-session");
  assert.equal(probe.version, null);
  assert.equal(probe.reason, "version-unavailable");
});

test("registry rejects unknown harness ids before probing", async () => {
  const registry = createOperatorHarnessRegistryV1({
    commandExists: async () => true,
    runVersion: async () => "ok",
  });

  await assert.rejects(() => registry.probe("cursor" as never), /unknown harness/);
});

test("Windows npm shims resolve to direct Codex and Claude entrypoints without a command shell", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-harness-bin-"));
  try {
    const claude = path.join(root, "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe");
    const codex = path.join(root, "node_modules", "@openai", "codex", "bin", "codex.js");
    await mkdir(path.dirname(claude), { recursive: true });
    await mkdir(path.dirname(codex), { recursive: true });
    await writeFile(claude, "native");
    await writeFile(codex, "javascript");
    assert.deepEqual(await resolveOperatorHarnessCommandV1({ executable: "claude", platform: "win32", pathValue: root }), { executable: claude, argsPrefix: [] });
    assert.deepEqual(await resolveOperatorHarnessCommandV1({ executable: "codex", platform: "win32", pathValue: root }), { executable: process.execPath, argsPrefix: [codex] });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
