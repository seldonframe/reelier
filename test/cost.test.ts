import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  costStep,
  costRun,
  loadPriceTable,
  parsePricesYaml,
  PricesFileParseError,
  formatUsd,
  parseSinceFlag,
  withinSince,
  defaultPricesFilePath,
  type PriceTable,
} from "../src/cost.js";
import { BUNDLED_PRICES, BUNDLED_PRICES_RETRIEVED_AT } from "../src/prices.js";
import type { RunRecord, StepRecord } from "../src/runner.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-cost-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function bareTable(models: PriceTable["models"] = BUNDLED_PRICES): PriceTable {
  return {
    bundledRetrievedAt: BUNDLED_PRICES_RETRIEVED_AT,
    models,
    overriddenModels: [],
    userFilePath: "/dev/null",
    userFileLoaded: false,
  };
}

function step(over: Partial<StepRecord>): StepRecord {
  return { n: 1, title: "step", level: 0, outcome: "passed", ms: 1, failures: [], ...over };
}

// ---------------------------------------------------------------------------
// costStep / costRun — the cost math itself
// ---------------------------------------------------------------------------

test("costStep: a step with zero tokens costs nothing and carries no model verdict", () => {
  const result = costStep(step({}), bareTable());
  assert.equal(result.usd, undefined);
  assert.equal(result.unknownModel, undefined);
  assert.equal(result.inputTokens, 0);
  assert.equal(result.outputTokens, 0);
});

test("costStep: a known model computes exact $ from the bundled table", () => {
  const s = step({ llm: { inputTokens: 1_000_000, outputTokens: 500_000, model: "claude-sonnet-5" } });
  const result = costStep(s, bareTable());
  // sonnet-5 bundled: $2/Mtok in, $10/Mtok out -> 1M*$2 + 0.5M*$10 = $2 + $5 = $7
  assert.equal(result.usd, 7);
  assert.equal(result.unknownModel, undefined);
});

test("costStep: an unknown model NEVER guesses a price — reports unknownModel instead", () => {
  const s = step({ llm: { inputTokens: 1000, outputTokens: 500, model: "totally-made-up-model-9000" } });
  const result = costStep(s, bareTable());
  assert.equal(result.usd, undefined);
  assert.equal(result.unknownModel, "totally-made-up-model-9000");
});

test("costStep: tokens present but no model recorded at all is also unknown, never a guess", () => {
  const s = step({ llm: { inputTokens: 1000, outputTokens: 500 } });
  const result = costStep(s, bareTable());
  assert.equal(result.usd, undefined);
  assert.equal(result.unknownModel, "(model not recorded)");
});

test("costRun: mixed run (one known step, one unknown-model step) sums the known cost and flags the unknown model separately", () => {
  const record: RunRecord = {
    skill: "mixed",
    startedAt: "2026-07-20T00:00:00.000Z",
    finishedAt: "2026-07-20T00:00:01.000Z",
    passed: true,
    steps: [
      step({ n: 1, llm: { inputTokens: 1_000_000, outputTokens: 0, model: "claude-haiku-4-5" } }),
      step({ n: 2, llm: { inputTokens: 1000, outputTokens: 1000, model: "nonexistent-model" } }),
    ],
    totals: { steps: 2, passed: 2, unchecked: 0, skipped: 0, failed: 0, ms: 2, llmInputTokens: 1001000, llmOutputTokens: 1000 },
  };
  const cost = costRun(record, bareTable());
  // haiku-4-5 bundled: $1/Mtok in -> 1M * $1 = $1 exactly for step 1's priced portion
  assert.equal(cost.pricedUsd, 1);
  assert.deepEqual(cost.unpriceableModels, ["nonexistent-model"]);
  assert.equal(cost.isZeroTokenReplay, false);
});

test("costRun: a pure deterministic replay (zero tokens across every step) is isZeroTokenReplay with $0 cost and no unpriceable models", () => {
  const record: RunRecord = {
    skill: "replay-only",
    startedAt: "2026-07-20T00:00:00.000Z",
    finishedAt: "2026-07-20T00:00:01.000Z",
    passed: true,
    steps: [step({ n: 1 }), step({ n: 2 })],
    totals: { steps: 2, passed: 2, unchecked: 0, skipped: 0, failed: 0, ms: 2, llmInputTokens: 0, llmOutputTokens: 0 },
  };
  const cost = costRun(record, bareTable());
  assert.equal(cost.isZeroTokenReplay, true);
  assert.equal(cost.pricedUsd, 0);
  assert.deepEqual(cost.unpriceableModels, []);
});

// ---------------------------------------------------------------------------
// formatUsd
// ---------------------------------------------------------------------------

test("formatUsd: zero, whole-cent, and sub-cent amounts format sensibly", () => {
  assert.equal(formatUsd(0), "$0.00");
  assert.equal(formatUsd(7), "$7.00");
  assert.equal(formatUsd(0.005), "$0.005");
  assert.equal(formatUsd(1.2345), "$1.2345");
});

// ---------------------------------------------------------------------------
// --since filtering
// ---------------------------------------------------------------------------

test("parseSinceFlag: accepts 7d/30d/all, defaults to all when omitted, rejects garbage", () => {
  assert.equal(parseSinceFlag(undefined), "all");
  assert.equal(parseSinceFlag("7d"), "7d");
  assert.equal(parseSinceFlag("30d"), "30d");
  assert.equal(parseSinceFlag("all"), "all");
  assert.throws(() => parseSinceFlag("60d"), /--since must be one of/);
});

test("withinSince: 7d window includes recent, excludes old", () => {
  const now = new Date("2026-07-22T00:00:00.000Z").getTime();
  assert.equal(withinSince("2026-07-20T00:00:00.000Z", "7d", now), true);
  assert.equal(withinSince("2026-07-01T00:00:00.000Z", "7d", now), false);
  assert.equal(withinSince("2020-01-01T00:00:00.000Z", "all", now), true);
});

// ---------------------------------------------------------------------------
// prices.yml parsing + merge
// ---------------------------------------------------------------------------

test("parsePricesYaml: parses the documented two-level shape", () => {
  const models = parsePricesYaml(`version: 1
models:
  my-custom-model:
    inputPerMtok: 1.5
    outputPerMtok: 6
  claude-sonnet-5:
    inputPerMtok: 3.0
    outputPerMtok: 15.0
`);
  assert.deepEqual(models, {
    "my-custom-model": { inputPerMtok: 1.5, outputPerMtok: 6 },
    "claude-sonnet-5": { inputPerMtok: 3.0, outputPerMtok: 15.0 },
  });
});

test("parsePricesYaml: rejects a malformed file loudly rather than silently misparsing", () => {
  assert.throws(() => parsePricesYaml("models:\n  broken\n"), PricesFileParseError);
  assert.throws(
    () => parsePricesYaml("models:\n  m:\n    inputPerMtok: 1\n"),
    /missing inputPerMtok and\/or outputPerMtok/
  );
  assert.throws(() => parsePricesYaml("not_a_real_key: 1\n"), /unrecognized top-level key/);
});

test("loadPriceTable: a missing override file is normal — bundled-only, no throw", async () => {
  await withTempDir(async (dir) => {
    const table = await loadPriceTable({ filePath: path.join(dir, "does-not-exist.yml") });
    assert.equal(table.userFileLoaded, false);
    assert.deepEqual(table.overriddenModels, []);
    assert.equal(table.models["claude-sonnet-5"].inputPerMtok, 2);
  });
});

test("loadPriceTable: a user override for an EXISTING model wins over the bundled default", async () => {
  await withTempDir(async (dir) => {
    const filePath = path.join(dir, "prices.yml");
    await writeFile(
      filePath,
      "version: 1\nmodels:\n  claude-sonnet-5:\n    inputPerMtok: 999\n    outputPerMtok: 999\n",
      "utf8"
    );
    const table = await loadPriceTable({ filePath });
    assert.equal(table.userFileLoaded, true);
    assert.deepEqual(table.overriddenModels, ["claude-sonnet-5"]);
    assert.equal(table.models["claude-sonnet-5"].inputPerMtok, 999);
    // Untouched bundled entries survive the merge.
    assert.equal(table.models["claude-haiku-4-5"].inputPerMtok, 1);
  });
});

test("loadPriceTable: a user override can ADD a brand-new model the bundled table doesn't know", async () => {
  await withTempDir(async (dir) => {
    const filePath = path.join(dir, "prices.yml");
    await writeFile(filePath, "models:\n  my-local-model:\n    inputPerMtok: 0.1\n    outputPerMtok: 0.2\n", "utf8");
    const table = await loadPriceTable({ filePath });
    assert.equal(table.models["my-local-model"].inputPerMtok, 0.1);
  });
});

test("loadPriceTable: a present-but-corrupt override file throws rather than silently falling back", async () => {
  await withTempDir(async (dir) => {
    const filePath = path.join(dir, "prices.yml");
    await writeFile(filePath, "this is not valid\n  :: yaml at all ][\n", "utf8");
    await assert.rejects(() => loadPriceTable({ filePath }), PricesFileParseError);
  });
});

test("defaultPricesFilePath: resolves under the given home dir's .reelier/prices.yml", () => {
  assert.equal(defaultPricesFilePath("/home/max"), path.join("/home/max", ".reelier", "prices.yml"));
});
