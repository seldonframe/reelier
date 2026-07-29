import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runReplayTool } from "../src/serve.js";
import type { DownstreamConnection } from "../src/mcp-client.js";
import { digestSha256 } from "../src/canonical-json.js";

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

// The matching-manifest case needs a live downstream to preflight against —
// an in-process fake injected via runReplayTool's connect override, same
// reasoning as cmdRun's/cmdManifest's injectable connect (test/manifest-cli.test.ts).
const TOOL_SCHEMA = { type: "object" as const };
const TOOL_DIGEST = digestSha256(TOOL_SCHEMA);

function fakeStatusConnection(): DownstreamConnection {
  return {
    name: "fake",
    tools: [{ name: "get_status", inputSchema: TOOL_SCHEMA }],
    async call() {
      return { content: [{ type: "text", text: "{}" }] };
    },
    async close() {},
  };
}

const CHECKED_MANIFEST_SKILL_SOURCE = `---
name: serve-replay-checked-fixture
description: a skill whose manifest matches the live fake downstream
manifest: {"v":1,"tools":[{"name":"get_status","server":"fake","digest":"${TOOL_DIGEST}"}]}
---

### Step 1 — check status
- intent: check status
- action: get_status {}
- effect: read
`;

test("runReplayTool: a passing manifest preflight stamps manifestChecked on the record (never manifestIgnored)", async () => {
  await withTmpDir(async (dir) => {
    const skillPath = path.join(dir, "serve-replay-checked-fixture.skill.md");
    await writeFile(skillPath, CHECKED_MANIFEST_SKILL_SOURCE, "utf8");

    const record = await runReplayTool(
      { skillPath, cwd: dir, wrap: ["fake-wrap-spec"] },
      async () => fakeStatusConnection()
    );
    assert.equal(record.passed, true);
    assert.equal(record.manifestChecked, true);
    assert.equal(record.manifestIgnored, undefined);
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
    assert.equal(record.manifestChecked, undefined);
  });
});

test("runReplayTool: a manifest-less skill replays exactly as before — unaffected by the preflight", async () => {
  await withTmpDir(async (dir) => {
    const skillPath = path.join(dir, "serve-replay-no-manifest-fixture.skill.md");
    await writeFile(skillPath, NO_MANIFEST_SKILL_SOURCE, "utf8");

    const record = await withFetch(fakeOkFetch(), () => runReplayTool({ skillPath, cwd: dir }));
    assert.equal(record.passed, true);
    assert.equal(record.manifestIgnored, undefined);
    assert.equal(record.manifestChecked, undefined);
  });
});
