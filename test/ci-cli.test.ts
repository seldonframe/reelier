import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

// Same reasoning as compile-cli.test.ts: spawn the freshly-compiled CLI as a
// real subprocess so this always exercises the code under test, not a stale
// import.
const CLI_PATH = fileURLToPath(new URL("../src/cli.js", import.meta.url));

test("cli --help / --version usage line lists ci", async () => {
  const result = await execFileAsync("node", [CLI_PATH, "--help"]);
  assert.match(result.stdout, /\bci\b/);
  assert.match(result.stdout, /reelier ci \[--force\] \[--path <dir>\]/);
});

test("cli ci: writes the workflow, discovers a skill, refuses to overwrite without --force, --force allows it", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-ci-cli-"));
  try {
    await mkdir(path.join(dir, "examples"), { recursive: true });
    await writeFile(path.join(dir, "examples", "demo.skill.md"), "---\nname: demo\n---\n");

    const first = await execFileAsync("node", [CLI_PATH, "ci"], { cwd: dir });
    assert.match(first.stdout, /Wrote /);
    assert.match(first.stdout, /discovered 1 skill\(s\)/);
    assert.match(first.stdout, /examples\/demo\.skill\.md/);

    const workflowPath = path.join(dir, ".github", "workflows", "reelier-replay.yml");
    const written = await readFile(workflowPath, "utf8");
    assert.match(written, /examples\/demo\.skill\.md/);
    assert.match(written, /pull_request: \{\}/);
    assert.match(written, /pull-requests: write/);

    // Second run without --force refuses and leaves the file untouched.
    await assert.rejects(execFileAsync("node", [CLI_PATH, "ci"], { cwd: dir }), (err: unknown) => {
      const e = err as { code?: number; stderr?: string };
      assert.equal(e.code, 1);
      assert.match(e.stderr ?? "", /already exists — refusing to overwrite/);
      return true;
    });
    const untouched = await readFile(workflowPath, "utf8");
    assert.equal(untouched, written);

    // --force regenerates.
    const forced = await execFileAsync("node", [CLI_PATH, "ci", "--force"], { cwd: dir });
    assert.match(forced.stdout, /Wrote /);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cli ci: zero skills discovered writes an honest placeholder, never invents a path", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-ci-cli-empty-"));
  try {
    const result = await execFileAsync("node", [CLI_PATH, "ci"], { cwd: dir });
    assert.match(result.stdout, /no \*\.skill\.md files found/);
    assert.match(result.stdout, /reelier init/);

    const workflowPath = path.join(dir, ".github", "workflows", "reelier-replay.yml");
    const written = await readFile(workflowPath, "utf8");
    assert.match(written, /REPLACE-ME\/your-skill\.skill\.md/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cli ci --path <dir>: overrides the discovery root, workflow still lands under cwd's .github/", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-ci-cli-path-"));
  try {
    const skillsDir = path.join(dir, "elsewhere");
    await mkdir(skillsDir, { recursive: true });
    await writeFile(path.join(skillsDir, "remote.skill.md"), "---\nname: remote\n---\n");

    const result = await execFileAsync("node", [CLI_PATH, "ci", "--path", skillsDir], { cwd: dir });
    assert.match(result.stdout, /remote\.skill\.md/);

    const workflowPath = path.join(dir, ".github", "workflows", "reelier-replay.yml");
    const written = await readFile(workflowPath, "utf8");
    assert.match(written, /remote\.skill\.md/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
