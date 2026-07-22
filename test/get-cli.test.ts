import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { cmdGet, type ParsedArgs } from "../src/cli.js";

// Exercises cmdGet's console output directly, mirroring push-cli.test.ts's
// approach for cmdPush: a fake fetch + monkeypatched globalThis.fetch rather
// than a real subprocess/HTTP server.

const READ_ONLY_SKILL_MD = `---
name: read-only-fixture
description: a read-only registry skill
---

### Step 1 — check status
- intent: check the status endpoint
- action: http.get {"url": "https://example.com/status"}
- assert: status == 200
- effect: read
`;
const READ_ONLY_SHA = createHash("sha256").update(READ_ONLY_SKILL_MD, "utf8").digest("hex");

const WRITES_SKILL_MD = `---
name: writes-fixture
description: a registry skill that performs a write
---

### Step 1 — create record
- intent: create a record
- action: create_record {"name": "x"}
- assert: status == 200
- effect: idempotent-write
`;
const WRITES_SHA = createHash("sha256").update(WRITES_SKILL_MD, "utf8").digest("hex");

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-get-cli-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

type FakeResponseSpec = { status: number; body?: unknown };

function fakeFetch(responses: FakeResponseSpec[]): typeof fetch {
  let i = 0;
  return (async () => {
    const spec = responses[i++];
    if (!spec) throw new Error(`fetch called more times than expected (call #${i})`);
    return {
      status: spec.status,
      ok: spec.status >= 200 && spec.status < 300,
      text: async () => JSON.stringify(spec.body ?? {}),
    } as unknown as Response;
  }) as typeof fetch;
}

async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) saved[k] = process.env[k];
  try {
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
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

async function withCwd<T>(dir: string, run: () => Promise<T>): Promise<T> {
  const original = process.cwd();
  process.chdir(dir);
  try {
    return await run();
  } finally {
    process.chdir(original);
  }
}

async function withCapturedLogs<T>(run: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const originalLog = console.log;
  const originalError = console.error;
  const lines: string[] = [];
  console.log = ((...args: unknown[]) => {
    lines.push(args.map((a) => String(a)).join(" "));
  }) as typeof console.log;
  console.error = console.log;
  try {
    const result = await run();
    return { result, lines };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

function makeArgs(ref: string, flags: string[] = [], opts: Record<string, string> = {}): ParsedArgs {
  return { positional: [ref], flags: new Set(flags), vars: {}, wraps: [], opts };
}

test("cmdGet: READ-ONLY fixture prints the full trust block, no writes warning", async () => {
  await withTempDir(async (dir) => {
    await withEnv({ REELIER_CLOUD_URL: "https://cloud.example" }, async () => {
      const fn = fakeFetch([
        {
          status: 200,
          body: {
            skillMd: READ_ONLY_SKILL_MD,
            version: 1,
            contentSha256: READ_ONLY_SHA,
            effectGrade: "read_only",
            license: "MIT",
            endpoints: ["https://example.com"],
          },
        },
      ]);
      const { result: exitCode, lines } = await withCapturedLogs(() =>
        withCwd(dir, () => withFetch(fn, () => cmdGet(makeArgs("acme/read-only-fixture"))))
      );

      assert.equal(exitCode, 0);
      const outPath = path.join(dir, "skills", "read-only-fixture.skill.md");
      assert.ok(lines.some((l) => l === `Wrote ${outPath} (v1).`));
      assert.ok(lines.some((l) => l === "Effect grade: READ-ONLY"));
      assert.ok(lines.some((l) => l === "Per-step effects:"));
      assert.ok(lines.some((l) => l === "  Step 1 — check status [read]"));
      assert.ok(lines.some((l) => l === "Endpoints: https://example.com"));
      assert.ok(lines.some((l) => l === "License: MIT"));
      assert.ok(lines.some((l) => l === `Content hash: sha256:${READ_ONLY_SHA}`));
      assert.ok(lines.some((l) => l === `Next: reelier run ${outPath}`));
      assert.ok(!lines.some((l) => l.includes("Replay re-executes")));

      const written = await readFile(outPath, "utf8");
      assert.equal(written, READ_ONLY_SKILL_MD);
    });
  });
});

test("cmdGet: WRITES fixture prints the amber warning + replay-re-executes line", async () => {
  await withTempDir(async (dir) => {
    await withEnv({ REELIER_CLOUD_URL: "https://cloud.example" }, async () => {
      const fn = fakeFetch([
        {
          status: 200,
          body: {
            skillMd: WRITES_SKILL_MD,
            version: 2,
            contentSha256: WRITES_SHA,
            effectGrade: "writes",
            license: "Apache-2.0",
            endpoints: [],
          },
        },
      ]);
      const { result: exitCode, lines } = await withCapturedLogs(() =>
        withCwd(dir, () => withFetch(fn, () => cmdGet(makeArgs("acme/writes-fixture"))))
      );

      assert.equal(exitCode, 0);
      assert.ok(lines.some((l) => l === "Effect grade: WRITES"));
      assert.ok(lines.some((l) => l === "  Step 1 — create record [idempotent-write]"));
      assert.ok(lines.some((l) => l === "Endpoints: (none)"));
      assert.ok(lines.some((l) => l === "License: Apache-2.0"));
      assert.ok(
        lines.some(
          (l) => l === "Replay re-executes. This skill performs writes; `reelier run` will require --allow-writes."
        )
      );
    });
  });
});

test("cmdGet: missing ref prints usage and exits 1", async () => {
  const argsNoPositional: ParsedArgs = { positional: [], flags: new Set(), vars: {}, wraps: [], opts: {} };
  const { result: exitCode, lines } = await withCapturedLogs(() => cmdGet(argsNoPositional));
  assert.equal(exitCode, 1);
  assert.ok(lines.some((l) => l.startsWith("Usage: reelier get ")));
});
