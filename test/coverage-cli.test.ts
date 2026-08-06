import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cmdCoverage } from "../src/cli.js";

const execFileAsync = promisify(execFile);
const CLI_PATH = fileURLToPath(new URL("../src/cli.js", import.meta.url));

function parsedArgs(opts: Record<string, string> = {}, flags: string[] = []) {
  return { positional: [], opts, flags: new Set(flags), vars: {}, wraps: [], fails: [] };
}

function captureConsole(): { lines: string[]; errors: string[]; restore: () => void } {
  const lines: string[] = [];
  const errors: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...parts: unknown[]) => void lines.push(parts.join(" "));
  console.error = (...parts: unknown[]) => void errors.push(parts.join(" "));
  return { lines, errors, restore: () => { console.log = origLog; console.error = origErr; } };
}

test("cmdCoverage without --host fails and names the supported host", async () => {
  const captured = captureConsole();
  try {
    const exit = await cmdCoverage(parsedArgs() as never);
    assert.equal(exit, 1);
    assert.match(captured.errors.join("\n"), /--host/);
    assert.match(captured.errors.join("\n"), /codex/);
  } finally {
    captured.restore();
  }
});

test("cmdCoverage with an unsupported host fails and names the supported host", async () => {
  const captured = captureConsole();
  try {
    const exit = await cmdCoverage(parsedArgs({ host: "cursor" }) as never);
    assert.equal(exit, 1);
    assert.match(captured.errors.join("\n"), /codex/);
  } finally {
    captured.restore();
  }
});

// End-to-end through the real argv parser — a direct-ParsedArgs test cannot
// catch `--host` failing to register as a value-taking option in parseArgv.
test("the real CLI accepts `coverage --host codex` and reports against the invoking user's home", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "reelier-coverage-e2e-"));
  const codexDir = path.join(home, ".codex");
  await mkdir(codexDir, { recursive: true });
  await writeFile(path.join(codexDir, "config.toml"), ['[mcp_servers.demo]', 'command = "node"'].join("\n"), "utf8");
  try {
    const { stdout } = await execFileAsync(process.execPath, [CLI_PATH, "coverage", "--host", "codex"], {
      env: { ...process.env, USERPROFILE: home, HOME: home },
    });
    const lines = stdout.trimEnd().split(/\r?\n/);
    assert.equal(lines[lines.length - 1], "Observed inventory only; this is not proof of completeness.");
    assert.match(stdout, /config\.toml/);
    assert.match(stdout, /demo\s+stdio\s+unwrapped/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("cmdCoverage --host codex is read-only reporting: exits 0 and ends with the inventory line", async () => {
  const captured = captureConsole();
  try {
    const exit = await cmdCoverage(parsedArgs({ host: "codex" }) as never);
    assert.equal(exit, 0);
    const last = captured.lines[captured.lines.length - 1];
    assert.equal(last, "Observed inventory only; this is not proof of completeness.");
  } finally {
    captured.restore();
  }
});
