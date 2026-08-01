import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { cmdManifest, cmdRun, type ParsedArgs } from "../src/cli.js";
import type { DownstreamConnection } from "../src/mcp-client.js";
import { digestSha256 } from "../src/canonical-json.js";

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
  return { positional, flags: new Set(), vars: {}, wraps, opts: {}, fails: [] };
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

// ---------------------------------------------------------------------------
// cmdRun's fail-closed manifest preflight (docs/specs/flight-recorder-v2.md
// §1, Task 5). `fake` below always exposes `get_status` with TOOL_SCHEMA,
// digest TOOL_DIGEST — tests mutate copies of it to simulate drift.
// ---------------------------------------------------------------------------

const TOOL_SCHEMA = { type: "object" as const };
const TOOL_DIGEST = digestSha256(TOOL_SCHEMA);

function fakeStatusConnection(schema: unknown = TOOL_SCHEMA): DownstreamConnection {
  return {
    name: "fake",
    tools: [{ name: "get_status", inputSchema: schema }],
    async call() {
      return { content: [{ type: "text", text: "{}" }] };
    },
    async close() {},
  };
}

const NO_MANIFEST_SKILL = `---
name: run-cli-no-manifest
description: exercises cmdRun's manifest preflight (no manifest present)
---

### Step 1 — unknown tool (no I/O, fails fast — outcome doesn't matter for this test)
- intent: check status
- action: nonexistent_tool {}
- effect: read
`;

function manifestSkillSource(name: string, digest: string): string {
  return `---
name: ${name}
description: exercises cmdRun's manifest preflight
manifest: {"tools":[{"digest":"${digest}","name":"get_status","server":"fake"}],"v":1}
---

### Step 1 — check status
- intent: check status
- action: get_status {}
- effect: read
`;
}

function runArgs(positional: string[], wraps: string[] = [], flags: string[] = []): ParsedArgs {
  return { positional, flags: new Set(flags), vars: {}, wraps, opts: {}, fails: [] };
}

async function captureConsoleError<T>(fn: () => Promise<T>): Promise<{ result: T; logs: string[] }> {
  const logs: string[] = [];
  const orig = console.error;
  console.error = (msg: string) => logs.push(msg);
  try {
    const result = await fn();
    return { result, logs };
  } finally {
    console.error = orig;
  }
}

test("cmdRun: skill with no manifest prints an advisory note and proceeds", async () => {
  await withTempDir(async (dir) => {
    const skillPath = path.join(dir, "s.skill.md");
    await writeFile(skillPath, NO_MANIFEST_SKILL, "utf8");
    const { logs } = await captureConsoleError(() => cmdRun(runArgs([skillPath])));
    assert.ok(logs.some((l) => /has no manifest/.test(l)));
  });
});

test("cmdRun: manifest present but no --wrap given fails closed, exit 1", async () => {
  await withTempDir(async (dir) => {
    const skillPath = path.join(dir, "s.skill.md");
    await writeFile(skillPath, manifestSkillSource("run-cli-no-wrap", TOOL_DIGEST), "utf8");
    const { result: code, logs } = await captureConsoleError(() => cmdRun(runArgs([skillPath])));
    assert.equal(code, 1);
    assert.ok(logs.some((l) => /no --wrap given/.test(l)));
  });
});

test("cmdRun: manifest matches live schema -> proceeds silently (no drift message), run executes", async () => {
  await withTempDir(async (dir) => {
    const skillPath = path.join(dir, "s.skill.md");
    await writeFile(skillPath, manifestSkillSource("run-cli-match", TOOL_DIGEST), "utf8");
    let called = false;
    const fake: DownstreamConnection = {
      ...fakeStatusConnection(),
      async call() {
        called = true;
        return { content: [{ type: "text", text: "{}" }] };
      },
    };
    const { result: code, logs } = await captureConsoleError(() =>
      cmdRun(runArgs([skillPath], ["fake-wrap-spec"]), async () => fake)
    );
    assert.equal(code, 0);
    assert.ok(!logs.some((l) => /MANIFEST DRIFT/.test(l)));
    assert.ok(called, "the step's tool should have been dispatched once preflight passed");
  });
});

test("cmdRun: a passing manifest preflight stamps manifestChecked on the run record (never manifestIgnored)", async () => {
  await withTempDir(async (dir) => {
    const skillPath = path.join(dir, "s.skill.md");
    await writeFile(skillPath, manifestSkillSource("run-cli-checked", TOOL_DIGEST), "utf8");
    const fake = fakeStatusConnection();
    const originalCwd = process.cwd();
    process.chdir(dir);
    let code: number;
    try {
      ({ result: code } = await captureConsoleError(() =>
        cmdRun(runArgs([skillPath], ["fake-wrap-spec"]), async () => fake)
      ));
    } finally {
      process.chdir(originalCwd);
    }
    assert.equal(code, 0);

    const runLog = await readFile(path.join(dir, ".reelier", "runs", "run-cli-checked.jsonl"), "utf8");
    const record = JSON.parse(runLog.trim().split("\n").pop()!);
    assert.equal(record.manifestChecked, true);
    assert.equal(record.manifestIgnored, undefined);
  });
});

test("cmdRun: a manifest-less run stamps neither manifestChecked nor manifestIgnored", async () => {
  await withTempDir(async (dir) => {
    const skillPath = path.join(dir, "s.skill.md");
    await writeFile(skillPath, NO_MANIFEST_SKILL, "utf8");
    const originalCwd = process.cwd();
    process.chdir(dir);
    try {
      await captureConsoleError(() => cmdRun(runArgs([skillPath])));
    } finally {
      process.chdir(originalCwd);
    }

    const runLog = await readFile(path.join(dir, ".reelier", "runs", "run-cli-no-manifest.jsonl"), "utf8");
    const record = JSON.parse(runLog.trim().split("\n").pop()!);
    assert.equal(record.manifestChecked, undefined);
    assert.equal(record.manifestIgnored, undefined);
  });
});

test("cmdRun: manifest drift refuses to replay, exit 1, BEFORE the tool is ever dispatched", async () => {
  await withTempDir(async (dir) => {
    const skillPath = path.join(dir, "s.skill.md");
    await writeFile(skillPath, manifestSkillSource("run-cli-drift", TOOL_DIGEST), "utf8");
    let called = false;
    const driftedFake: DownstreamConnection = {
      name: "fake",
      tools: [{ name: "get_status", inputSchema: { type: "object", properties: { extra: {} } } }],
      async call() {
        called = true;
        return { content: [{ type: "text", text: "{}" }] };
      },
      async close() {},
    };
    const { result: code, logs } = await captureConsoleError(() =>
      cmdRun(runArgs([skillPath], ["fake-wrap-spec"]), async () => driftedFake)
    );
    assert.equal(code, 1);
    assert.ok(logs.some((l) => /MANIFEST DRIFT — refusing to replay/.test(l)));
    assert.ok(logs.some((l) => /get_status/.test(l) && /schema drifted since recording/.test(l)));
    assert.ok(!called, "the tool must never be dispatched when the manifest preflight fails closed");
  });
});

test("cmdRun: --ignore-manifest bypasses drift, warns, and stamps manifestIgnored on the run record", async () => {
  await withTempDir(async (dir) => {
    const skillPath = path.join(dir, "s.skill.md");
    await writeFile(skillPath, manifestSkillSource("run-cli-ignore", TOOL_DIGEST), "utf8");
    const driftedFake: DownstreamConnection = {
      name: "fake",
      tools: [{ name: "get_status", inputSchema: { type: "object", properties: { extra: {} } } }],
      async call() {
        return { content: [{ type: "text", text: "{}" }] };
      },
      async close() {},
    };
    const originalCwd = process.cwd();
    process.chdir(dir);
    let code: number;
    let logs: string[];
    try {
      ({ result: code, logs } = await captureConsoleError(() =>
        cmdRun(runArgs([skillPath], ["fake-wrap-spec"], ["ignore-manifest"]), async () => driftedFake)
      ));
    } finally {
      process.chdir(originalCwd);
    }
    assert.equal(code, 0);
    assert.ok(logs.some((l) => /WARNING: --ignore-manifest/.test(l)));
    assert.ok(!logs.some((l) => /MANIFEST DRIFT/.test(l)));

    const runLog = await readFile(path.join(dir, ".reelier", "runs", "run-cli-ignore.jsonl"), "utf8");
    const record = JSON.parse(runLog.trim().split("\n").pop()!);
    assert.equal(record.manifestIgnored, true);
    assert.equal(record.manifestChecked, undefined);
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
