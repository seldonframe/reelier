import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

// The test project (tsconfig.test.json) compiles src/ + test/ together into
// dist-test/{src,test}, so dist-test/test/compile-cli.test.js's "../src/cli.js"
// resolves to the freshly-compiled dist-test/src/cli.js — exercise the CLI as
// a real subprocess the way a user would, always reflecting the code under test.
const CLI_PATH = fileURLToPath(new URL("../src/cli.js", import.meta.url));

const SAMPLE_TRACE = [
  JSON.stringify({ t: "meta", seq: 0, name: "cli-demo", startedAt: "2026-01-01T00:00:00.000Z", wrapped: ["demo"] }),
  JSON.stringify({ t: "note", seq: 1, ts: "2026-01-01T00:00:00.000Z", text: "add two numbers" }),
  JSON.stringify({ t: "call", seq: 2, i: 0, ts: "2026-01-01T00:00:00.000Z", tool: "add", args: { a: 1, b: 2 } }),
  JSON.stringify({
    t: "result",
    seq: 3,
    i: 0,
    ok: true,
    ms: 3,
    body: { content: [{ type: "text", text: JSON.stringify({ result: 3 }) }] },
  }),
].join("\n") + "\n";

test("cli compile: writes a skill, refuses to overwrite without --force, and --force allows it", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-compile-cli-"));
  try {
    const tracePath = path.join(dir, "trace.jsonl");
    await writeFile(tracePath, SAMPLE_TRACE, "utf8");
    const outPath = path.join(dir, "out.skill.md");

    const first = await execFileAsync("node", [CLI_PATH, "compile", tracePath, "-o", outPath]);
    assert.match(first.stdout, /Wrote /);
    assert.match(first.stdout, /steps:\s+1/);

    const rendered = await readFile(outPath, "utf8");
    assert.match(rendered, /name: cli-demo/);

    // Second compile without --force must refuse and leave the file untouched.
    await assert.rejects(execFileAsync("node", [CLI_PATH, "compile", tracePath, "-o", outPath]), (err: unknown) => {
      const e = err as { code?: number; stderr?: string };
      assert.equal(e.code, 1);
      assert.match(e.stderr ?? "", /Refusing to overwrite/);
      return true;
    });

    // With --force it succeeds.
    const forced = await execFileAsync("node", [CLI_PATH, "compile", tracePath, "-o", outPath, "--force"]);
    assert.match(forced.stdout, /Wrote /);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
