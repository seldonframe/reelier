import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildToolServer, runDiffTool, runFromSessionTool, runReplayTool } from "../src/serve.js";
import { cmdServe } from "../src/cli.js";

const execFileAsync = promisify(execFile);
const CLI_PATH = fileURLToPath(new URL("../src/cli.js", import.meta.url));

async function withTmpDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-serve-ws-"));
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

const SKILL_SOURCE = `---
name: serve-workspace-fixture
description: a skill used to exercise the serve workspace default
---

### Step 1 — one
- intent: first step
- action: http.get {"url": "https://example.com/1"}
- assert: status == 200
- effect: read
`;

function transcriptLine(kind: "use" | "result", payload: Record<string, unknown>): string {
  if (kind === "use") return JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", ...payload }] } });
  return JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", ...payload }] } });
}

function parsedArgs(opts: Record<string, string> = {}) {
  return { positional: [], opts, flags: new Set<string>(), vars: {}, wraps: [], fails: [] };
}

test("runReplayTool writes the run record under the workspace root when no cwd is given", async () => {
  await withTmpDir(async (ws) => {
    await withTmpDir(async (elsewhere) => {
      const skillPath = path.join(elsewhere, "fixture.skill.md");
      await writeFile(skillPath, SKILL_SOURCE, "utf8");
      await withFetch(fakeOkFetch(), async () => {
        await runReplayTool({ skillPath }, undefined, { workspaceRoot: ws });
      });
      const recordFile = path.join(ws, ".reelier", "runs", "serve-workspace-fixture.jsonl");
      assert.ok(fs.existsSync(recordFile), `expected run record under the workspace: ${recordFile}`);
    });
  });
});

test("runReplayTool: an explicit cwd argument still wins over the workspace root", async () => {
  await withTmpDir(async (ws) => {
    await withTmpDir(async (explicit) => {
      const skillPath = path.join(explicit, "fixture.skill.md");
      await writeFile(skillPath, SKILL_SOURCE, "utf8");
      await withFetch(fakeOkFetch(), async () => {
        await runReplayTool({ skillPath, cwd: explicit }, undefined, { workspaceRoot: ws });
      });
      assert.ok(fs.existsSync(path.join(explicit, ".reelier", "runs", "serve-workspace-fixture.jsonl")));
      assert.ok(!fs.existsSync(path.join(ws, ".reelier", "runs", "serve-workspace-fixture.jsonl")));
    });
  });
});

test("runFromSessionTool defaults the compiled skill's output into the workspace root", async () => {
  await withTmpDir(async (ws) => {
    await withTmpDir(async (elsewhere) => {
      const transcriptPath = path.join(elsewhere, "session.jsonl");
      await writeFile(
        transcriptPath,
        [
          transcriptLine("use", { id: "t0", name: "mcp__demo__get_item", input: { id: "one" } }),
          transcriptLine("result", { tool_use_id: "t0", content: "ok" }),
        ].join("\n"),
        "utf8",
      );
      const result = await runFromSessionTool({ transcriptPath, name: "ws-out" }, { workspaceRoot: ws });
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.ok(result.skillPath.startsWith(ws), `expected ${result.skillPath} under ${ws}`);
      }
    });
  });
});

test("runDiffTool resolves .reelier state under the workspace root and names it honestly", async () => {
  await withTmpDir(async (ws) => {
    const result = await runDiffTool({ skill: "nope" }, { workspaceRoot: ws });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.reason.includes(path.join(ws, ".reelier")), result.reason);
    }
  });
});

test("buildToolServer threads the workspace root through to tool calls", async () => {
  await withTmpDir(async (ws) => {
    const server = buildToolServer({ workspaceRoot: ws });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: "reelier-serve-ws-test", version: "0.0.1" }, { capabilities: {} });
    await client.connect(clientSide);
    const response = (await client.callTool({ name: "reelier_diff", arguments: { skill: "nope" } })) as {
      content: Array<{ type: string; text: string }>;
    };
    const parsed = JSON.parse(response.content[0]?.text ?? "{}") as { ok: boolean; reason?: string };
    assert.equal(parsed.ok, false);
    assert.ok(parsed.reason?.includes(path.join(ws, ".reelier")), parsed.reason);
    await client.close();
    await server.close();
  });
});

test("cmdServe refuses a relative --workspace before any server starts", async () => {
  const errors: string[] = [];
  const origErr = console.error;
  console.error = (...parts: unknown[]) => void errors.push(parts.join(" "));
  try {
    const exit = await cmdServe(parsedArgs({ workspace: "relative/dir" }) as never);
    assert.equal(exit, 1);
    assert.match(errors.join("\n"), /absolute/);
  } finally {
    console.error = origErr;
  }
});

test("cmdServe refuses a nonexistent --workspace directory", async () => {
  const errors: string[] = [];
  const origErr = console.error;
  console.error = (...parts: unknown[]) => void errors.push(parts.join(" "));
  try {
    const missing = path.join(tmpdir(), "reelier-serve-ws-definitely-missing-4712");
    const exit = await cmdServe(parsedArgs({ workspace: missing }) as never);
    assert.equal(exit, 1);
    assert.match(errors.join("\n"), /not an existing directory/);
  } finally {
    console.error = origErr;
  }
});

// End-to-end through the real argv parser — catches --workspace missing from
// parseArgv's value-option allowlist (the exact gap `coverage --host` had).
test("the real CLI rejects `serve --workspace relative` with exit 1 before serving", async () => {
  await assert.rejects(
    execFileAsync(process.execPath, [CLI_PATH, "serve", "--workspace", "relative/dir"]),
    (err: Error & { code?: number; stderr?: string }) => err.code === 1 && /absolute/.test(err.stderr ?? ""),
  );
});
