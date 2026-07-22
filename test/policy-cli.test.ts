// `reelier policy check` as a real subprocess — same pattern as
// effect-ranking-cli.test.ts. Exercises exactly what a user sees: every
// schema error reported, exit code, and the OK summary line.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const CLI_PATH = fileURLToPath(new URL("../src/cli.js", import.meta.url));

async function runCli(args: string[], cwd: string): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execFileAsync("node", [CLI_PATH, ...args], { cwd });
    return { stdout, stderr, code: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", code: e.code ?? 1 };
  }
}

test("reelier policy check: a valid policy.yml prints OK + rule counts, exit 0", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "reelier-policy-cli-"));
  try {
    await mkdir(path.join(cwd, ".reelier"), { recursive: true });
    await writeFile(
      path.join(cwd, ".reelier", "policy.yml"),
      'version: 1\ndeny:\n  - tool: "*.delete_*"\n  - endpoint: "*.stripe.com"\ndry_run:\n  - tool: "crm.*"\n',
      "utf8"
    );

    const result = await runCli(["policy", "check"], cwd);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /OK — 2 deny rule\(s\), 1 dry-run rule\(s\)/);
    // B1: the file has an endpoint rule -> the URL-only honesty note is printed.
    assert.match(
      result.stdout,
      /note: endpoint rules match literal URLs in tool arguments only — structured tools without URLs in args are not covered; use tool rules for those\./
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("reelier policy check: no endpoint rules -> no B1 note printed", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "reelier-policy-cli-"));
  try {
    await mkdir(path.join(cwd, ".reelier"), { recursive: true });
    await writeFile(path.join(cwd, ".reelier", "policy.yml"), 'version: 1\ndeny:\n  - tool: "*.delete_*"\n', "utf8");

    const result = await runCli(["policy", "check"], cwd);
    assert.equal(result.code, 0);
    assert.doesNotMatch(result.stdout, /endpoint rules match literal URLs/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("reelier policy check: reports every error and exits 1 for a bad policy.yml", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "reelier-policy-cli-"));
  try {
    await mkdir(path.join(cwd, ".reelier"), { recursive: true });
    await writeFile(
      path.join(cwd, ".reelier", "policy.yml"),
      'version: 1\nremote: true\ndeny:\n  - tool: ""\n  - unless: "--nope"\n',
      "utf8"
    );

    const result = await runCli(["policy", "check"], cwd);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /unknown top-level key "remote"/);
    assert.match(result.stderr, /"tool" glob is empty/);
    assert.match(result.stderr, /empty rule/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("reelier policy check: no policy file anywhere -> clear error, exit 1", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "reelier-policy-cli-"));
  try {
    const result = await runCli(["policy", "check"], cwd);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /No policy file at/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("reelier policy check <path>: an explicit path overrides project/global resolution", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "reelier-policy-cli-"));
  try {
    const explicitPath = path.join(cwd, "custom-policy.yml");
    await writeFile(explicitPath, 'version: 1\ndeny:\n  - tool: "x.*"\n', "utf8");

    const result = await runCli(["policy", "check", explicitPath], cwd);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /OK — 1 deny rule\(s\), 0 dry-run rule\(s\)/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
