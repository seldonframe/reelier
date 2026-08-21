import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createGitHubLinearMissionRuntimeV1 } from "../../src/authority/host/index.js";

test("legacy raw authority and generic provider runtime options refuse before filesystem or provider access", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "reelier-genuine-runtime-refusal-")), rootDir = path.join(parent, "not-created");
  let providerCalls = 0, bindingCalls = 0;
  try {
    await assert.rejects(() => createGitHubLinearMissionRuntimeV1({
      rootDir,
      authority: Object.freeze({ raw: true }),
      provider: { async dispatch() { providerCalls += 1; return { outcome: "applied", data: {} }; }, async readback() { providerCalls += 1; return { outcome: "applied", data: {} }; } },
      async resolveHostBindings() { bindingCalls += 1; return { credential: "must-not-read", account: "a", destination: "d", limit: "l" }; },
      now: () => Date.now(),
    }), /legacy|raw|prohibited|genuine/i);
    await assert.rejects(() => access(rootDir), /ENOENT/);
    assert.deepEqual({ providerCalls, bindingCalls }, { providerCalls: 0, bindingCalls: 0 });
  } finally { await rm(parent, { recursive: true, force: true }); }
});
