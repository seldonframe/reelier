import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { cmdManifest, type ParsedArgs } from "../src/cli.js";
import type { DownstreamConnection } from "../src/mcp-client.js";

// Exercises cmdManifest's console output + file write directly, with an
// injected fake downstream instead of spawning a real --wrap subprocess —
// same reasoning as cmdPush's fetch override (test/push-cli.test.ts).

const SKILL_SOURCE = `---
name: manifest-cli-fixture
description: a skill used to exercise cmdManifest
---

### Step 1 — create a contact
- intent: create a contact
- action: create_contact {"email": "a@example.com"}
- assert: status == 200
- effect: idempotent-write
`;

function fakeArgs(positional: string[], wraps: string[] = []): ParsedArgs {
  return { positional, flags: new Set(), vars: {}, wraps, opts: {} };
}

function fakeConnection(name: string, tools: DownstreamConnection["tools"]): DownstreamConnection {
  return {
    name,
    tools,
    async call() {
      throw new Error("not called in this test");
    },
    async close() {},
  };
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-manifest-cli-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("cmdManifest: requires --wrap to reach live servers", async () => {
  await withTempDir(async (dir) => {
    const skillPath = path.join(dir, "s.skill.md");
    await writeFile(skillPath, SKILL_SOURCE, "utf8");
    const logs: string[] = [];
    const origError = console.error;
    console.error = (msg: string) => logs.push(msg);
    try {
      const code = await cmdManifest(fakeArgs([skillPath]));
      assert.equal(code, 1);
      assert.ok(logs.some((l) => /needs --wrap/.test(l)));
    } finally {
      console.error = origError;
    }
  });
});

test("cmdManifest: stamps a manifest onto a skill with none, printing 'added' for each tool", async () => {
  await withTempDir(async (dir) => {
    const skillPath = path.join(dir, "s.skill.md");
    await writeFile(skillPath, SKILL_SOURCE, "utf8");

    const fake = fakeConnection("seldonframe", [{ name: "create_contact", inputSchema: { type: "object" } }]);
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => logs.push(msg);
    try {
      const code = await cmdManifest(fakeArgs([skillPath], ["fake-wrap-spec"]), async () => fake);
      assert.equal(code, 0);
      assert.ok(logs.some((l) => /added\s+create_contact/.test(l)));
    } finally {
      console.log = origLog;
    }

    const written = await readFile(skillPath, "utf8");
    assert.match(written, /^manifest: /m);
  });
});

test("cmdManifest: re-running against the same live schema prints 'unchanged'", async () => {
  await withTempDir(async (dir) => {
    const skillPath = path.join(dir, "s.skill.md");
    await writeFile(skillPath, SKILL_SOURCE, "utf8");
    const fake = fakeConnection("seldonframe", [{ name: "create_contact", inputSchema: { type: "object" } }]);

    await cmdManifest(fakeArgs([skillPath], ["fake-wrap-spec"]), async () => fake);

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => logs.push(msg);
    try {
      const code = await cmdManifest(fakeArgs([skillPath], ["fake-wrap-spec"]), async () => fake);
      assert.equal(code, 0);
      assert.ok(logs.some((l) => /unchanged\s+create_contact/.test(l)));
    } finally {
      console.log = origLog;
    }
  });
});

test("cmdManifest: a schema change prints 'updated' with old -> new digest", async () => {
  await withTempDir(async (dir) => {
    const skillPath = path.join(dir, "s.skill.md");
    await writeFile(skillPath, SKILL_SOURCE, "utf8");
    const before = fakeConnection("seldonframe", [{ name: "create_contact", inputSchema: { type: "object" } }]);
    await cmdManifest(fakeArgs([skillPath], ["fake-wrap-spec"]), async () => before);

    const after = fakeConnection("seldonframe", [
      { name: "create_contact", inputSchema: { type: "object", properties: { phone: {} } } },
    ]);
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => logs.push(msg);
    try {
      const code = await cmdManifest(fakeArgs([skillPath], ["fake-wrap-spec"]), async () => after);
      assert.equal(code, 0);
      assert.ok(logs.some((l) => /updated\s+create_contact/.test(l)));
    } finally {
      console.log = origLog;
    }
  });
});
