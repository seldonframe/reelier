import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

const CLI_PATH = fileURLToPath(new URL("../src/cli.js", import.meta.url));

const NOW = new Date();
const RECENT = new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(); // 2 days ago
const OLD = new Date(NOW.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString(); // 60 days ago

function recordLine(startedAt: string, opts: { model?: string; inputTokens?: number; outputTokens?: number } = {}): string {
  const hasLlm = opts.inputTokens !== undefined || opts.outputTokens !== undefined;
  const steps = [
    { n: 1, title: "one", level: 0, outcome: "passed", ms: 5, failures: [] },
    hasLlm
      ? {
          n: 2,
          title: "two",
          level: 1,
          outcome: "passed",
          ms: 5,
          failures: [],
          llm: { inputTokens: opts.inputTokens ?? 0, outputTokens: opts.outputTokens ?? 0, model: opts.model },
          escalationAttempted: 1,
        }
      : { n: 2, title: "two", level: 0, outcome: "passed", ms: 5, failures: [] },
  ];
  return JSON.stringify({
    skill: "cost-fixture",
    startedAt,
    finishedAt: startedAt,
    passed: true,
    steps,
    totals: {
      steps: 2,
      passed: 2,
      unchecked: 0,
      skipped: 0,
      failed: 0,
      ms: 10,
      llmInputTokens: opts.inputTokens ?? 0,
      llmOutputTokens: opts.outputTokens ?? 0,
    },
  });
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-cost-cli-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function writeRuns(dir: string, skillName: string, lines: string[]): Promise<void> {
  const runsDir = path.join(dir, ".reelier", "runs");
  await mkdir(runsDir, { recursive: true });
  await writeFile(path.join(runsDir, `${skillName}.jsonl`), lines.join("\n") + "\n", "utf8");
}

test("cost: known-model run prices exactly, zero-token run shows the honest $0.00 replay line", async () => {
  await withTempDir(async (dir) => {
    await writeRuns(dir, "cost-fixture", [
      recordLine(RECENT, { model: "claude-sonnet-5", inputTokens: 1_000_000, outputTokens: 500_000 }),
      recordLine(RECENT, {}),
    ]);
    const result = await execFileAsync("node", [CLI_PATH, "cost", "cost-fixture"], { cwd: dir, env: { ...process.env, HOME: dir, USERPROFILE: dir } });
    assert.match(result.stdout, /Cost: cost-fixture/);
    // sonnet-5: 1M*$2 + 0.5M*$10 = $7.00
    assert.match(result.stdout, /\$7\.00/);
    assert.match(result.stdout, /1 of 2 run\(s\) replayed at \$0\.00 — pure deterministic replay, no LLM tokens\./);
  });
});

test("cost: unknown model never guesses — reports n/a with the model id, and flags the total as partial", async () => {
  await withTempDir(async (dir) => {
    await writeRuns(dir, "cost-fixture", [recordLine(RECENT, { model: "made-up-model-xyz", inputTokens: 1000, outputTokens: 1000 })]);
    const result = await execFileAsync("node", [CLI_PATH, "cost", "cost-fixture"], { cwd: dir, env: { ...process.env, HOME: dir, USERPROFILE: dir } });
    assert.match(result.stdout, /n\/a \(unknown model: made-up-model-xyz\)/);
    assert.match(result.stdout, /total is PARTIAL/);
  });
});

test("cost: --since 7d excludes an old run and includes a recent one", async () => {
  await withTempDir(async (dir) => {
    await writeRuns(dir, "cost-fixture", [
      recordLine(RECENT, { model: "claude-sonnet-5", inputTokens: 1000, outputTokens: 1000 }),
      recordLine(OLD, { model: "claude-sonnet-5", inputTokens: 999_999_999, outputTokens: 0 }),
    ]);
    const result = await execFileAsync("node", [CLI_PATH, "cost", "cost-fixture", "--since", "7d"], {
      cwd: dir,
      env: { ...process.env, HOME: dir, USERPROFILE: dir },
    });
    assert.match(result.stdout, /TOTAL\s+2\s+1000\s+1000/);
    assert.doesNotMatch(result.stdout, /999999999/);
  });
});

test("cost: with no skill argument, reports across every skill under .reelier/runs", async () => {
  await withTempDir(async (dir) => {
    await writeRuns(dir, "skill-a", [recordLine(RECENT, { model: "claude-sonnet-5", inputTokens: 1000, outputTokens: 0 })]);
    await writeRuns(dir, "skill-b", [recordLine(RECENT, { model: "claude-haiku-4-5", inputTokens: 1000, outputTokens: 0 })]);
    const result = await execFileAsync("node", [CLI_PATH, "cost"], { cwd: dir, env: { ...process.env, HOME: dir, USERPROFILE: dir } });
    assert.match(result.stdout, /Cost: \(all skills\)/);
    assert.match(result.stdout, /skill-a/);
    assert.match(result.stdout, /skill-b/);
  });
});

test("cost: a user prices.yml override changes the computed cost for that model", async () => {
  await withTempDir(async (dir) => {
    await mkdir(path.join(dir, ".reelier"), { recursive: true });
    await writeFile(
      path.join(dir, ".reelier", "prices.yml"),
      "version: 1\nmodels:\n  claude-sonnet-5:\n    inputPerMtok: 100\n    outputPerMtok: 100\n",
      "utf8"
    );
    await writeRuns(dir, "cost-fixture", [recordLine(RECENT, { model: "claude-sonnet-5", inputTokens: 1_000_000, outputTokens: 0 })]);
    const result = await execFileAsync("node", [CLI_PATH, "cost", "cost-fixture"], {
      cwd: dir,
      env: { ...process.env, HOME: dir, USERPROFILE: dir },
    });
    // Override price ($100/Mtok in) beats the bundled $2/Mtok default.
    assert.match(result.stdout, /\$100\.00/);
  });
});

test("prices: lists the merged table with a bundled/override source tag per model", async () => {
  await withTempDir(async (dir) => {
    await mkdir(path.join(dir, ".reelier"), { recursive: true });
    await writeFile(
      path.join(dir, ".reelier", "prices.yml"),
      "version: 1\nmodels:\n  claude-sonnet-5:\n    inputPerMtok: 100\n    outputPerMtok: 100\n",
      "utf8"
    );
    const result = await execFileAsync("node", [CLI_PATH, "prices"], { cwd: dir, env: { ...process.env, HOME: dir, USERPROFILE: dir } });
    assert.match(result.stdout, /claude-sonnet-5\s+100\s+100\s+override/);
    assert.match(result.stdout, /claude-haiku-4-5\s+1\s+5\s+bundled/);
  });
});

test("prices update: prints the bundled table's retrieval date and never touches the network or filesystem", async () => {
  await withTempDir(async (dir) => {
    const result = await execFileAsync("node", [CLI_PATH, "prices", "update"], { cwd: dir, env: { ...process.env, HOME: dir, USERPROFILE: dir } });
    assert.match(result.stdout, /Bundled price table: retrieved \d{4}-\d{2}-\d{2}/);
    assert.match(result.stdout, /never auto-fetches prices/);
  });
});
