// F5 local run-shape priors on the two CLI surfaces
// (docs/specs/run-shape-priors.md §6, §7):
//
//   reelier baseline <skill.md>  — read-only, executes nothing, always exits 0
//   reelier run <skill.md>       — prints the block ONLY on a deviation
//
// The load-bearing test in this file is the zero-touch pin: a repo with no
// history, and a repo whose latest run matches its history, must produce
// byte-identical `reelier run` output. A repo that never opted into anything
// cannot be made to notice that this feature shipped.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cmdRun, type ParsedArgs } from "../src/cli.js";
import type { DownstreamConnection } from "../src/mcp-client.js";

const execFileAsync = promisify(execFile);

// Same convention as bench-cli.test.ts: exercise the CLI as a real
// subprocess against dist-test's compiled output.
const CLI_PATH = fileURLToPath(new URL("../src/cli.js", import.meta.url));

const SKILL_NAME = "priors-cli-fixture";
const SKILL_SOURCE = `---
name: ${SKILL_NAME}
description: a one-step skill used to exercise run-shape priors
---

### Step 1 — check status
- intent: check status
- action: get_status {}
- effect: read
`;

const DAY = 24 * 3_600_000;
const T0 = Date.parse("2026-03-01T00:00:00.000Z");

interface FixtureSpec {
  /** Steps carrying a dispatched write. */
  writes?: number;
  /** Sum of steps[].ms for this run. */
  ms?: number;
  day: number;
  /** A `reelier run --fail 1` record — excluded from the sample and from being the subject. */
  mock?: boolean;
}

/**
 * A single-step run record matching what the fixture skill actually
 * produces: one step, no assertions, so outcome "unchecked".
 */
function fixtureRecord(spec: FixtureSpec): unknown {
  const startedAt = new Date(T0 + spec.day * DAY).toISOString();
  const ms = spec.ms ?? 0;
  return {
    skill: SKILL_NAME,
    startedAt,
    finishedAt: new Date(T0 + spec.day * DAY + ms).toISOString(),
    passed: true,
    ...(spec.mock ? { mockFailures: [1] } : {}),
    steps: [
      {
        n: 1,
        title: "check status",
        level: 0,
        outcome: "unchecked",
        ms,
        failures: [],
        ...((spec.writes ?? 0) > 0 ? { write: { idempotencyKey: "k0", approved: true } } : {}),
      },
    ],
    totals: { steps: 1, passed: 0, unchecked: 1, skipped: 0, failed: 0, ms, llmInputTokens: 0, llmOutputTokens: 0 },
  };
}

async function seedRuns(dir: string, records: unknown[]): Promise<void> {
  await mkdir(path.join(dir, ".reelier", "runs"), { recursive: true });
  await writeFile(
    path.join(dir, ".reelier", "runs", `${SKILL_NAME}.jsonl`),
    records.map((r) => JSON.stringify(r)).join("\n") + (records.length > 0 ? "\n" : ""),
    "utf8"
  );
}

async function withRepo<T>(fn: (dir: string, skillPath: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-priors-cli-"));
  try {
    const skillPath = path.join(dir, "s.skill.md");
    await writeFile(skillPath, SKILL_SOURCE, "utf8");
    return await fn(dir, skillPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** `reelier baseline …` as a subprocess; never throws on a non-zero exit. */
async function runBaseline(dir: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync("node", [CLI_PATH, "baseline", ...args], { cwd: dir });
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

// --------------------------------------------------------------------------
// reelier baseline — the standalone, read-only surface
// --------------------------------------------------------------------------

test("reelier --help lists baseline", async () => {
  const { stdout } = await execFileAsync("node", [CLI_PATH, "--help"]);
  assert.match(stdout, /\bbaseline\b/);
});

test("baseline with no skill argument prints usage, exit 1", async () => {
  await withRepo(async (dir) => {
    const { code, stderr } = await runBaseline(dir, []);
    assert.equal(code, 1);
    assert.match(stderr, /Usage: reelier baseline <skill\.md>/);
  });
});

test("baseline with no run-record file exits 1 and names the path it looked at", async () => {
  await withRepo(async (dir, skillPath) => {
    const { code, stderr } = await runBaseline(dir, [skillPath]);
    assert.equal(code, 1);
    assert.match(stderr, /No run records found at /);
    assert.match(stderr, new RegExp(`${SKILL_NAME}\\.jsonl`));
  });
});

test("baseline with an empty run-record file exits 1", async () => {
  await withRepo(async (dir, skillPath) => {
    await seedRuns(dir, []);
    const { code, stderr } = await runBaseline(dir, [skillPath]);
    assert.equal(code, 1);
    assert.match(stderr, /is empty/);
  });
});

test("baseline with too little history says exactly that and still exits 0", async () => {
  await withRepo(async (dir, skillPath) => {
    await seedRuns(dir, [fixtureRecord({ day: 0 }), fixtureRecord({ day: 1 }), fixtureRecord({ day: 2 })]);
    const { code, stdout } = await runBaseline(dir, [skillPath]);
    assert.equal(code, 0);
    assert.match(stdout, /Not enough history for a baseline: 2 prior run\(s\), 3 required\. No baseline computed\./);
  });
});

test("baseline reports a write spike as a deviation — and STILL exits 0", async () => {
  await withRepo(async (dir, skillPath) => {
    await seedRuns(dir, [
      fixtureRecord({ day: 0, writes: 1 }),
      fixtureRecord({ day: 1, writes: 1 }),
      fixtureRecord({ day: 2, writes: 1 }),
      fixtureRecord({ day: 3, writes: 1 }),
      fixtureRecord({ day: 4, writes: 0 }),
    ]);
    const { code, stdout } = await runBaseline(dir, [skillPath]);
    // A deviation is not a failure: never-list #5. If this ever exits 1,
    // someone has turned a recorder into a gate.
    assert.equal(code, 0);
    assert.equal(stdout.split("\n")[0], `Run shape: ${SKILL_NAME}`);
    assert.match(stdout, /^ {2}! writes {6}0 {10}previous 4 runs: median 1, min 1, max 1$/m);
    assert.match(stdout, /always exits 0/);
  });
});

// --------------------------------------------------------------------------
// reelier run — the zero-touch guarantee
// --------------------------------------------------------------------------

function runArgs(positional: string[], fails: string[] = []): ParsedArgs {
  return { positional, flags: new Set<string>(), vars: {}, wraps: ["fake-wrap-spec"], opts: {}, fails };
}

function fakeConnection(): DownstreamConnection {
  return {
    name: "fake",
    tools: [{ name: "get_status", inputSchema: { type: "object" } }],
    async call() {
      return { content: [{ type: "text", text: "{}" }] };
    },
    async close() {},
  };
}

async function captureRun(dir: string, skillPath: string, fails: string[] = []): Promise<{ code: number; stdout: string }> {
  const logs: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (msg?: unknown) => logs.push(String(msg ?? ""));
  console.error = () => {};
  try {
    const code = await cmdRun(runArgs([skillPath], fails), async () => fakeConnection(), { cwd: dir });
    return { code, stdout: logs.join("\n") };
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
}

/** Durations are wall-clock and differ every run; nothing else may. */
function normalize(stdout: string): string {
  return stdout.replace(/\d+ms/g, "Nms");
}

/**
 * A history whose shape the fixture skill's real run matches exactly: one
 * step, no writes, and a duration window wide enough that a few real
 * milliseconds land inside it. Three priors, so gap/silence stay below their
 * own minimum and cannot fire either.
 */
const MATCHING_HISTORY = [
  fixtureRecord({ day: 0, ms: 0 }),
  fixtureRecord({ day: 1, ms: 5_000 }),
  fixtureRecord({ day: 2, ms: 10_000 }),
];

test("reelier run in a repo with no .reelier/runs prints no run-shape block at all", async () => {
  await withRepo(async (dir, skillPath) => {
    const { code, stdout } = await captureRun(dir, skillPath);
    assert.equal(code, 0);
    assert.equal(stdout.includes("Run shape"), false, stdout);
  });
});

test("zero-touch: no history and matched history produce BYTE-IDENTICAL run output", async () => {
  const virgin = await withRepo(async (dir, skillPath) => normalize((await captureRun(dir, skillPath)).stdout));
  const matched = await withRepo(async (dir, skillPath) => {
    await seedRuns(dir, MATCHING_HISTORY);
    return normalize((await captureRun(dir, skillPath)).stdout);
  });
  assert.equal(matched, virgin);
  // And that shared output is exactly what the run printed before any of
  // this existed — pinned as a literal so a future edit to the block cannot
  // quietly widen into the ordinary run summary.
  assert.equal(
    virgin,
    [
      "✓ Step 1 — check status [unchecked (unchecked: no assertions)] Nms",
      "",
      "PASSED: 1/1 steps ok (1 unchecked), 0 failed, Nms total",
    ].join("\n")
  );
});

test("reelier run prints the deviation block when the latest run departs — exit code unchanged", async () => {
  await withRepo(async (dir, skillPath) => {
    await seedRuns(dir, [
      fixtureRecord({ day: 0, writes: 1, ms: 0 }),
      fixtureRecord({ day: 1, writes: 1, ms: 5_000 }),
      fixtureRecord({ day: 2, writes: 1, ms: 10_000 }),
    ]);
    const { code, stdout } = await captureRun(dir, skillPath);
    // The read step dispatches no write, against three priors that each did.
    assert.equal(code, 0, "a deviation must never move the exit code");
    assert.ok(stdout.includes("Run shape — this run vs this skill's own previous 3 runs:"), stdout);
    assert.ok(stdout.includes("  ! writes: 0 (previous 3 runs: median 1, min 1, max 1)"), stdout);
    assert.ok(stdout.includes("It changes no outcome and no exit code."), stdout);
  });
});

// --------------------------------------------------------------------------
// A mock run is not "this run"
// --------------------------------------------------------------------------

/** Four flat priors and then one real run that dispatched a write: a deviation sitting on disk, one record deep. */
const DEVIATING_HISTORY = [
  fixtureRecord({ day: 0 }),
  fixtureRecord({ day: 1 }),
  fixtureRecord({ day: 2 }),
  fixtureRecord({ day: 3 }),
  fixtureRecord({ day: 4, writes: 1 }),
];

test("reelier run --fail after a deviating real run prints NO run-shape block — byte-identical to a mock run with no history", async () => {
  // The mock run this test performs dispatches nothing at all, so a "writes:
  // 1" line under the heading "this run" would be a number belonging to a run
  // five days earlier. The mock is excluded from the sample and from being
  // the subject, so the subject is that older run — and this surface, whose
  // entire claim is the words "this run", must then say nothing.
  const virgin = await withRepo(async (dir, skillPath) => normalize((await captureRun(dir, skillPath, ["1"])).stdout));

  const afterDeviation = await withRepo(async (dir, skillPath) => {
    await seedRuns(dir, DEVIATING_HISTORY);
    const { stdout } = await captureRun(dir, skillPath, ["1"]);
    // The run that just happened really is a mock run and really is the last
    // record in the file — without this the silence below could be vacuous.
    const appended = await readFile(path.join(dir, ".reelier", "runs", `${SKILL_NAME}.jsonl`), "utf8");
    const newest = JSON.parse(appended.trim().split("\n").at(-1) as string) as { mockFailures?: number[] };
    assert.deepEqual(newest.mockFailures, [1]);

    assert.equal(stdout.includes("Run shape"), false, stdout);
    return normalize(stdout);
  });

  assert.equal(afterDeviation, virgin);
});

test("baseline on that same file names the excluded newest record instead of pretending it isn't there", async () => {
  await withRepo(async (dir, skillPath) => {
    await seedRuns(dir, [...DEVIATING_HISTORY, fixtureRecord({ day: 5, mock: true })]);
    const { code, stdout } = await runBaseline(dir, [skillPath]);
    assert.equal(code, 0);
    // The whole picture is this surface's job, so it reports the day-4 run —
    // and says out loud that the newest thing on disk is not that run.
    assert.match(stdout, new RegExp(`^ {2}latest run: ${new Date(T0 + 4 * DAY).toISOString()}$`, "m"));
    assert.match(stdout, /newest record in this file/);
    assert.match(stdout, /--fail N/);
    assert.match(stdout, /^ {2}! writes {6}1 {10}previous 4 runs: median 0, min 0, max 0$/m);
  });
});

test("a corrupt run-record line leaves reelier run byte-identical — the report fails open", async () => {
  const virgin = await withRepo(async (dir, skillPath) => normalize((await captureRun(dir, skillPath)).stdout));
  const corrupt = await withRepo(async (dir, skillPath) => {
    await mkdir(path.join(dir, ".reelier", "runs"), { recursive: true });
    await writeFile(path.join(dir, ".reelier", "runs", `${SKILL_NAME}.jsonl`), "{not json at all\n", "utf8");
    const { code, stdout } = await captureRun(dir, skillPath);
    assert.equal(code, 0, "an unreadable prior must never break a run that already happened");
    return normalize(stdout);
  });
  assert.equal(corrupt, virgin);
});
