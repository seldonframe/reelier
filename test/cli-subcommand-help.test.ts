import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Keep this list in lockstep with main()'s dispatch switch. A missing command
// here leaves a route free to run its handler before showing help.
const DISPATCH_COMMANDS = [
  "run", "bench", "baseline", "cost", "prices", "mcp", "serve", "trace",
  "compile", "manifest", "resolve", "approve", "push", "get", "verify", "diff",
  "ci", "policy", "authority", "init", "up", "discover", "connections", "connect",
  "deploy", "doctor", "bridge", "coverage", "from-session", "scan", "install", "uninstall",
  "login", "logout", "whoami",
] as const;

const cliPath = fileURLToPath(new URL("../src/cli.js", import.meta.url));

test("every dispatched subcommand exits read-only for --help and -h", async () => {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), "reelier-cli-help-"));
  const home = path.join(sandbox, "home");
  try {
    for (const command of DISPATCH_COMMANDS) {
      for (const helpFlag of ["--help", "-h"] as const) {
        const before = await readdir(sandbox, { recursive: true });
        const result = spawnSync(process.execPath, ["--max-old-space-size=64", cliPath, command, helpFlag], {
          cwd: sandbox,
          env: { ...process.env, HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home },
          encoding: "utf8",
          timeout: 1_500,
          windowsHide: true,
        });
        const after = await readdir(sandbox, { recursive: true });
        const output = `${result.stdout}${result.stderr}`;

        assert.equal(result.error, undefined, `${command} ${helpFlag} timed out or failed to start: ${result.error?.message}`);
        assert.equal(result.signal, null, `${command} ${helpFlag} was terminated by ${result.signal}`);
        assert.equal(result.status, 0, `${command} ${helpFlag} exited non-zero:\n${output}`);
        assert.match(output, /Usage: reelier/, `${command} ${helpFlag} did not print usage:\n${output}`);
        assert.deepEqual(after, before, `${command} ${helpFlag} mutated its isolated home or workspace`);
      }
    }
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});
