import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runReplayTool } from "../src/serve.js";

async function withTmpDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-serve-preflight-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function withFetch<T>(fn: typeof fetch, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = fn;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

function fakeOkFetch(): typeof fetch {
  return (async () =>
    ({
      status: 200,
      ok: true,
      headers: new Headers(),
      text: async () => "ok-body",
    }) as unknown as Response) as typeof fetch;
}

const FAKE_DIGEST = `sha256:${"0".repeat(64)}`;

const MANIFEST_SKILL_SOURCE = `---
name: serve-replay-manifest-fixture
description: a skill used to exercise the reelier_replay manifest preflight
manifest: {"v":1,"tools":[{"name":"fake.t","digest":"${FAKE_DIGEST}"}]}
---

### Step 1 — one
- intent: first step
- action: http.get {"url": "https://example.com/1"}
- assert: status == 200
- effect: read
`;

const NO_MANIFEST_SKILL_SOURCE = `---
name: serve-replay-no-manifest-fixture
description: a skill with no manifest — unaffected by the preflight
---

### Step 1 — one
- intent: first step
- action: http.get {"url": "https://example.com/1"}
- assert: status == 200
- effect: read
`;

test("runReplayTool: manifest present but no wrap given — fails closed with a manifest error (no step executes)", async () => {
  await withTmpDir(async (dir) => {
    const skillPath = path.join(dir, "serve-replay-manifest-fixture.skill.md");
    await writeFile(skillPath, MANIFEST_SKILL_SOURCE, "utf8");

    // No fetch stub installed at all: if a step executed, an unstubbed
    // fetch would throw a distinct (non-manifest) error, exposing a
    // fail-closed violation immediately.
    await assert.rejects(runReplayTool({ skillPath, cwd: dir }), /manifest/i);
  });
});

test("runReplayTool: ignoreManifest true is a break-glass — resolves and threads manifestIgnored onto the record", async () => {
  await withTmpDir(async (dir) => {
    const skillPath = path.join(dir, "serve-replay-manifest-fixture.skill.md");
    await writeFile(skillPath, MANIFEST_SKILL_SOURCE, "utf8");

    const record = await withFetch(fakeOkFetch(), () =>
      runReplayTool({ skillPath, cwd: dir, ignoreManifest: true })
    );
    assert.equal(record.passed, true);
    assert.equal(record.manifestIgnored, true);
  });
});

test("runReplayTool: a manifest-less skill replays exactly as before — unaffected by the preflight", async () => {
  await withTmpDir(async (dir) => {
    const skillPath = path.join(dir, "serve-replay-no-manifest-fixture.skill.md");
    await writeFile(skillPath, NO_MANIFEST_SKILL_SOURCE, "utf8");

    const record = await withFetch(fakeOkFetch(), () => runReplayTool({ skillPath, cwd: dir }));
    assert.equal(record.passed, true);
    assert.equal(record.manifestIgnored, undefined);
  });
});
