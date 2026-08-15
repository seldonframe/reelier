import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgv } from "../src/cli.js";

const execFileAsync = promisify(execFile);

// Same convention as compile-cli.test.ts: dist-test/src/cli.js is the
// freshly-compiled CLI under test.
const CLI_DIR = fileURLToPath(new URL("../src", import.meta.url));

// Regression test for the entrypoint guard (cli.ts's isMainModule check):
// Node resolves import.meta.url to the REAL path of the running module but
// leaves process.argv[1] as whatever path the process was invoked through.
// Every symlinked invocation (npm global bin, `npx reelier`, a local
// node_modules/.bin shim) puts a symlinked *directory* segment ahead of
// cli.js on the argv[1] path, so comparing the two unresolved always
// mismatched — main() silently never ran, exit 0, nothing printed. This
// reproduces that shape with a directory junction (works on Windows without
// admin) pointing at dist-test/src, then invokes cli.js through the
// junction the way a real symlinked bin would be invoked.
test("cli.ts's entrypoint guard still runs main() when invoked through a symlinked/junctioned directory (Unix bin-symlink regression)", async () => {
  const workDir = await mkdtemp(path.join(tmpdir(), "reelier-cli-entrypoint-"));
  const linkDir = path.join(workDir, "linked-src");

  try {
    // 'junction' is Windows-only and needs no admin/Developer-Mode privilege;
    // elsewhere (POSIX), a plain directory symlink reproduces the same
    // "argv[1] points through a symlinked dir" shape. If neither can be
    // created in this environment (e.g. a locked-down CI sandbox), skip
    // rather than fail — the fix itself is still covered by the direct
    // `node dist/cli.js --version` sanity check done manually.
    try {
      await symlink(CLI_DIR, linkDir, process.platform === "win32" ? "junction" : "dir");
    } catch (err) {
      console.log(`  (skipped: could not create a symlink/junction in this environment: ${(err as Error).message})`);
      return;
    }

    const linkedCliPath = path.join(linkDir, "cli.js");
    // --help rather than --version: --version reads package.json via a
    // path relative to import.meta.url, which resolves differently between
    // the dist-test tree this test runs against and the shipped dist/
    // layout — irrelevant to what THIS test checks. --help only prints the
    // static USAGE string, so it isolates the one thing under test: did
    // main() actually run through the symlinked/junctioned path at all?
    // Before the realpathSync fix, it silently didn't (empty stdout, exit 0).
    const { stdout, stderr } = await execFileAsync(process.execPath, [linkedCliPath, "--help"]);

    assert.match(stdout, /^Usage: reelier /, `expected the USAGE banner on stdout, got: ${JSON.stringify(stdout)}`);
    assert.equal(stderr, "");
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});

test("root parser retains authority connection values required by the existing connection contract", () => {
  const parsed = parseArgv(["--endpoint", "https://cell.example", "--token-ref", "env:CELL_TOKEN", "--cell-id", "cell_1", "--adapter-contract-digest", `sha256:${"a".repeat(64)}`]);
  assert.deepEqual(parsed.opts, {
    endpoint: "https://cell.example", "token-ref": "env:CELL_TOKEN", "cell-id": "cell_1", "adapter-contract-digest": `sha256:${"a".repeat(64)}`,
  });
});
