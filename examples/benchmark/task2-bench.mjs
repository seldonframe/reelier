// task2-bench.mjs — Task 2: variance-surfacing agent-vs-reelier benchmark
// (npm registry versions/aggregation). Same head-to-head shape as bench.mjs
// (task 1): Arm A = N real LLM tool-use runs, Arm B = 1 record + N-1
// deterministic replays. This task adds SURFACE where agents genuinely
// drift (counting + long-list enumeration) while staying deterministic in
// principle (ground truth is computable from the live registry response)
// and in Reelier's domain (deterministic extraction, not generative work).
//
// Every number in the output is MEASURED from a real run in this process —
// nothing here is invented. Reelier's grammar cannot express 3 of the 4
// target fields (see npm-versions.skill.md's header comment) — that gap is
// reported prominently, not hidden or worked around outside the grammar.

import { readFile, writeFile, mkdir, rm, appendFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseSkill } from "../../dist/skill.js";
import { runSkill, builtinTools } from "../../dist/runner.js";
import { evalBind } from "../../dist/assert.js";

import { getAnthropicApiKey } from "./env.mjs";
import {
  runAgentOnce,
  MODEL,
  INPUT_PRICE_PER_MTOK,
  OUTPUT_PRICE_PER_MTOK,
  REGISTRY_URL,
} from "./task2-agent-arm.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const N = 10;

// ---------------------------------------------------------------------------
// Ground truth — computed once from the live registry response, independent
// of both arms.
// ---------------------------------------------------------------------------

async function computeGroundTruth() {
  const res = await fetch(REGISTRY_URL, { method: "GET" });
  const body = await res.text();
  if (res.status !== 200) {
    throw new Error(`Ground-truth fetch failed: registry returned ${res.status}`);
  }
  const json = JSON.parse(body);
  const latest = json["dist-tags"]?.latest;
  if (!latest) throw new Error("Ground-truth fetch: dist-tags.latest missing from response");
  const versionKeys = Object.keys(json.versions ?? {});
  if (versionKeys.length === 0) throw new Error("Ground-truth fetch: versions object empty/missing");
  const allVersions = [...versionKeys].sort();
  const prerelease = versionKeys.filter((v) => v.includes("-"));
  return {
    latest,
    total_versions: versionKeys.length,
    prerelease_count: prerelease.length,
    all_versions: allVersions,
  };
}

// ---------------------------------------------------------------------------
// Field-by-field + overall correctness
// ---------------------------------------------------------------------------

function normalizeVersionArray(arr) {
  if (!Array.isArray(arr)) return null;
  return [...arr].map(String).sort();
}

function fieldCorrectness(parsed, groundTruth) {
  if (!parsed) {
    return { latest: false, total_versions: false, prerelease_count: false, all_versions: false, all: false };
  }
  const latestOk = parsed.latest === groundTruth.latest;
  const totalOk = parsed.total_versions === groundTruth.total_versions;
  const preOk = parsed.prerelease_count === groundTruth.prerelease_count;
  const normalized = normalizeVersionArray(parsed.all_versions);
  const allVersionsOk =
    normalized !== null &&
    normalized.length === groundTruth.all_versions.length &&
    normalized.every((v, i) => v === groundTruth.all_versions[i]);
  return {
    latest: latestOk,
    total_versions: totalOk,
    prerelease_count: preOk,
    all_versions: allVersionsOk,
    all: latestOk && totalOk && preOk && allVersionsOk,
  };
}

// Canonical string for distinct-output counting: sort object keys, sort
// all_versions array, so key-order/array-order differences don't inflate
// the distinct count beyond what actually matters.
function canonicalize(parsed) {
  if (!parsed) return "<parse_failed>";
  return JSON.stringify({
    latest: parsed.latest ?? null,
    total_versions: parsed.total_versions ?? null,
    prerelease_count: parsed.prerelease_count ?? null,
    all_versions: normalizeVersionArray(parsed.all_versions),
  });
}

// ---------------------------------------------------------------------------
// Arm A — N real agent runs
// ---------------------------------------------------------------------------

async function runArmA(apiKey, groundTruth) {
  const runs = [];
  for (let i = 1; i <= N; i++) {
    process.stderr.write(`[task2 arm A] run ${i}/${N}...\n`);
    const result = await runAgentOnce(apiKey);
    const correctness = fieldCorrectness(result.parsed, groundTruth);
    runs.push({ run: i, ...result, correctness });
    process.stderr.write(
      `[task2 arm A] run ${i}/${N} done: tokensIn=${result.tokensIn} tokensOut=${result.tokensOut} ` +
        `ms=${result.ms} correct=${correctness.all} error=${result.error ?? "none"}\n`
    );
  }
  return runs;
}

// ---------------------------------------------------------------------------
// Arm B — record (= Arm A's run 1) + N-1 replays. The skill extracts only
// `latest` — the grammar cannot express the other 3 fields (documented in
// npm-versions.skill.md's header comment).
// ---------------------------------------------------------------------------

async function runArmBReplays(groundTruth) {
  const skillPath = path.join(__dirname, "npm-versions.skill.md");
  const skillSrc = await readFile(skillPath, "utf8");
  const skill = parseSkill(skillSrc);

  const runCwd = __dirname;
  await rm(path.join(runCwd, ".reelier"), { recursive: true, force: true });

  const replays = [];
  for (let i = 1; i <= N - 1; i++) {
    process.stderr.write(`[task2 arm B] replay ${i}/${N - 1}...\n`);

    let capturedObs;
    const tools = {
      "http.get": {
        effect: builtinTools["http.get"].effect,
        async run(args, ctx) {
          const obs = await builtinTools["http.get"].run(args, ctx);
          capturedObs = obs;
          return obs;
        },
      },
    };

    const startedAt = Date.now();
    const record = await runSkill(skill, { maxLevel: 0, tools, cwd: runCwd });
    const ms = Date.now() - startedAt;

    const llmTokensZero =
      record.totals.llmInputTokens === 0 && record.totals.llmOutputTokens === 0;

    let parsed = null;
    if (capturedObs) {
      const step = skill.steps[0];
      const binds = {};
      for (const line of step.binds) {
        const r = evalBind(line, capturedObs);
        if (r.ok) binds[r.name] = r.value;
      }
      parsed = binds;
    }

    const latestCorrect = parsed?.latest === groundTruth.latest;
    replays.push({
      replay: i,
      ms,
      passed: record.passed,
      llmInputTokens: record.totals.llmInputTokens,
      llmOutputTokens: record.totals.llmOutputTokens,
      llmTokensZero,
      parsed,
      latestCorrect,
    });
    process.stderr.write(
      `[task2 arm B] replay ${i}/${N - 1} done: ms=${ms} passed=${record.passed} ` +
        `llmTokensZero=${llmTokensZero} latest=${parsed?.latest} correct=${latestCorrect}\n`
    );
  }
  return replays;
}

// ---------------------------------------------------------------------------
// KPI computation
// ---------------------------------------------------------------------------

function summarize(armARuns, armBReplays, groundTruth) {
  const okRuns = armARuns.filter((r) => !r.error);
  const avg = (arr) => (arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0);

  const armATokensInAvg = avg(okRuns.map((r) => r.tokensIn));
  const armATokensOutAvg = avg(okRuns.map((r) => r.tokensOut));
  const armACostAvg = avg(okRuns.map((r) => r.costUsd));
  const armALatencyAvg = avg(okRuns.map((r) => r.ms));
  const armAFullyCorrectCount = armARuns.filter((r) => r.correctness.all).length;

  const distinctOutputs = new Set(armARuns.map((r) => canonicalize(r.parsed)));

  // Per-field distinct-value counts (variance surface).
  const distinctLatest = new Set(armARuns.map((r) => JSON.stringify(r.parsed?.latest ?? null)));
  const distinctTotal = new Set(armARuns.map((r) => JSON.stringify(r.parsed?.total_versions ?? null)));
  const distinctPrerelease = new Set(armARuns.map((r) => JSON.stringify(r.parsed?.prerelease_count ?? null)));
  const distinctAllVersions = new Set(
    armARuns.map((r) => JSON.stringify(normalizeVersionArray(r.parsed?.all_versions)))
  );

  const perFieldCorrectCount = {
    latest: armARuns.filter((r) => r.correctness.latest).length,
    total_versions: armARuns.filter((r) => r.correctness.total_versions).length,
    prerelease_count: armARuns.filter((r) => r.correctness.prerelease_count).length,
    all_versions: armARuns.filter((r) => r.correctness.all_versions).length,
  };

  const armBLatencyAvg = avg(armBReplays.map((r) => r.ms));
  const armBAllTokensZero = armBReplays.every((r) => r.llmTokensZero);
  const armBAllIdentical =
    armBReplays.length > 0 &&
    armBReplays.every((r) => JSON.stringify(r.parsed) === JSON.stringify(armBReplays[0].parsed));
  const armBLatestCorrectCount = armBReplays.filter((r) => r.latestCorrect).length;

  const armATotalCostAtN = armACostAvg * N;
  const armATotalCostAt50 = armACostAvg * 50;
  const recordCostUsd = armARuns[0]?.costUsd ?? 0;
  const armBTotalCostAtN = recordCostUsd;
  const armBTotalCostAt50 = recordCostUsd;

  return {
    groundTruth,
    armA: {
      tokensInAvg: armATokensInAvg,
      tokensOutAvg: armATokensOutAvg,
      costAvgUsd: armACostAvg,
      latencyAvgMs: armALatencyAvg,
      fullyCorrectCount: armAFullyCorrectCount,
      distinctOutputCount: distinctOutputs.size,
      perField: {
        latest: { correctCount: perFieldCorrectCount.latest, distinctValues: distinctLatest.size },
        total_versions: { correctCount: perFieldCorrectCount.total_versions, distinctValues: distinctTotal.size },
        prerelease_count: { correctCount: perFieldCorrectCount.prerelease_count, distinctValues: distinctPrerelease.size },
        all_versions: { correctCount: perFieldCorrectCount.all_versions, distinctValues: distinctAllVersions.size },
      },
      totalCostAtN: armATotalCostAtN,
      totalCostAt50: armATotalCostAt50,
      errorCount: armARuns.filter((r) => r.error).length,
    },
    armB: {
      latencyAvgMs: armBLatencyAvg,
      allTokensZeroVerified: armBAllTokensZero,
      allIdentical: armBAllIdentical,
      latestCorrectCount: armBLatestCorrectCount,
      recordCostUsd,
      totalCostAtN: armBTotalCostAtN,
      totalCostAt50: armBTotalCostAt50,
      recordTokensIn: armARuns[0]?.tokensIn ?? 0,
      recordTokensOut: armARuns[0]?.tokensOut ?? 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function fmtUsd(n) {
  return `$${n.toFixed(6)}`;
}

function printSummaryTable(summary) {
  const { armA, armB } = summary;
  const lines = [];
  lines.push("");
  lines.push("=== TASK 2 SUMMARY KPI TABLE (N=10, MEASURED) ===");
  lines.push("");
  lines.push(`Model (Arm A): ${MODEL}  ($${INPUT_PRICE_PER_MTOK}/MTok in, $${OUTPUT_PRICE_PER_MTOK}/MTok out)`);
  lines.push("");
  lines.push(`Arm A fully-correct (all 4 fields): ${armA.fullyCorrectCount}/${N}`);
  lines.push(`Arm A distinct outputs (normalized): ${armA.distinctOutputCount}/${N}`);
  lines.push(`Arm A per-field distinct values: latest=${armA.perField.latest.distinctValues} total_versions=${armA.perField.total_versions.distinctValues} prerelease_count=${armA.perField.prerelease_count.distinctValues} all_versions=${armA.perField.all_versions.distinctValues}`);
  lines.push(`Arm A per-field correct/N: latest=${armA.perField.latest.correctCount}/${N} total_versions=${armA.perField.total_versions.correctCount}/${N} prerelease_count=${armA.perField.prerelease_count.correctCount}/${N} all_versions=${armA.perField.all_versions.correctCount}/${N}`);
  lines.push(`Arm A cost/run avg: ${fmtUsd(armA.costAvgUsd)}   latency/run avg: ${armA.latencyAvgMs.toFixed(0)} ms`);
  lines.push("");
  lines.push(`Arm B (Reelier, latest-only — grammar gap on the other 3 fields): identical replays verified=${armB.allIdentical}, tokens-zero verified=${armB.allTokensZeroVerified}, latest correct ${armB.latestCorrectCount}/${N - 1}`);
  lines.push(`Arm B latency/run avg: ${armB.latencyAvgMs.toFixed(0)} ms   total cost @N=${N}: ${fmtUsd(armB.totalCostAtN)}`);
  lines.push("");
  const text = lines.join("\n");
  console.log(text);
  return text;
}

// ---------------------------------------------------------------------------
// Markdown report section (appended to benchmark-results.md)
// ---------------------------------------------------------------------------

function buildMarkdownSection({ armARuns, armBReplays, summary, runDate }) {
  const { groundTruth, armA, armB } = summary;

  const rawTableRows = armARuns
    .map((r) => {
      const p = r.parsed;
      const latestStr = r.error ? `<error>` : p ? JSON.stringify(p.latest) : "<parse_failed>";
      const totalStr = r.error ? "-" : p ? JSON.stringify(p.total_versions) : "-";
      const preStr = r.error ? "-" : p ? JSON.stringify(p.prerelease_count) : "-";
      const allStr = r.error
        ? "-"
        : p
          ? JSON.stringify(p.all_versions).replace(/\|/g, "\\|")
          : `<parse_failed: ${r.parseError}>`;
      const c = r.correctness;
      return `| ${r.run} | ${latestStr} | ${totalStr} | ${preStr} | \`${allStr}\` | ${c.latest ? "y" : "n"}/${c.total_versions ? "y" : "n"}/${c.prerelease_count ? "y" : "n"}/${c.all_versions ? "y" : "n"} | ${c.all ? "**yes**" : "no"} |`;
    })
    .join("\n");

  const replayTableRows = armBReplays
    .map((r) => {
      return `| ${r.replay} | ${r.ms} | ${r.llmInputTokens}/${r.llmOutputTokens} | ${r.llmTokensZero ? "yes" : "NO"} | \`${JSON.stringify(r.parsed)}\` | ${r.latestCorrect ? "yes" : "no"} |`;
    })
    .join("\n");

  return `
## Task 2 — variance-surfacing (npm versions/aggregation)

**[MEASURED]** — every number below comes from a real run captured by \`examples/benchmark/task2-bench.mjs\`. Run date: ${runDate}.

### Why this task exists

Task 1 (single-field fetch: version/license/tarball) showed 0 measured variance — a capable model reliably copies 3 scalar fields from a small JSON blob. Task 2 adds SURFACE where an agent genuinely has to *reason* (counting, filtering) and *enumerate* (a full list it might truncate or reorder), while staying (a) deterministic in principle — one correct answer exists, computed straight from the live registry's \`versions\` object — and (b) inside Reelier's actual domain: deterministic extraction, **not generative work**. This scoping is stated explicitly because the task's aggregation fields turned out to expose a real limitation in the *extraction* engine, not a generative-vs-deterministic mismatch.

### Task (identical both arms)

"Fetch npm registry metadata for @seldonframe/reelier (${REGISTRY_URL}). Return ONLY JSON: {latest: string, total_versions: number, prerelease_count: number (count of published versions whose string contains a hyphen, e.g. -beta/-rc), all_versions: string[] (every published version string)}."

### Ground truth (computed once from the live \`versions\` object, independent of both arms)

\`\`\`json
${JSON.stringify(groundTruth, null, 2)}
\`\`\`

Note: at the time this benchmark ran, \`@seldonframe/reelier\` had only ${groundTruth.total_versions} published versions and ${groundTruth.prerelease_count} prereleases — a short list. This is an honest constraint of using a real, live registry as ground truth (not a synthetic long-list fixture); the raw per-run table below shows whether even a short list still produces measurable drift.

### Arm A — agent WITHOUT Reelier

Same tool-use loop shape as task 1 (\`examples/benchmark/task2-agent-arm.mjs\`, one \`http_get\` tool, model \`${MODEL}\`), with a system/user prompt asking for the 4-field JSON above. Run **N=${N}** times.

**Headline variance numbers:**
- Fully correct (all 4 fields exact match vs. ground truth): **${armA.fullyCorrectCount}/${N}**
- Distinct outputs across ${N} runs (normalized — sorted keys, sorted \`all_versions\`): **${armA.distinctOutputCount}**
- Per-field distinct values seen: \`latest\`=${armA.perField.latest.distinctValues}, \`total_versions\`=${armA.perField.total_versions.distinctValues}, \`prerelease_count\`=${armA.perField.prerelease_count.distinctValues}, \`all_versions\`=${armA.perField.all_versions.distinctValues}
- Per-field correct/N: \`latest\`=${armA.perField.latest.correctCount}/${N}, \`total_versions\`=${armA.perField.total_versions.correctCount}/${N}, \`prerelease_count\`=${armA.perField.prerelease_count.correctCount}/${N}, \`all_versions\`=${armA.perField.all_versions.correctCount}/${N}
- Cost/run avg: ${fmtUsd(armA.costAvgUsd)}, latency/run avg: ${armA.latencyAvgMs.toFixed(0)} ms
- Errors: ${armA.errorCount}/${N}

### Raw per-run table — Arm A

| run# | latest | total_versions | prerelease_count | all_versions | field correct (latest/total/prerelease/all_versions) | fully correct? |
|---|---|---|---|---|---|---|
${rawTableRows}

### Arm B — Reelier: the grammar-gap finding

**Reelier's bind grammar (\`src/assert.ts\`) cannot express \`total_versions\`, \`prerelease_count\`, or \`all_versions\`.** It supports exactly two bind forms — a static \`json.<dotpath>\` scalar lookup, and a single-capture-group \`body match /regex/\` — and neither can count object keys, filter them, or enumerate them into an array. This is a genuine, reported product gap (backlog item: the engine needs an aggregation/enumeration bind, e.g. \`name = json.<path> keys\` plus a \`count\`/\`filter\` combinator), not a limitation worked around outside the grammar. The full reasoning is documented in \`examples/benchmark/npm-versions.skill.md\`'s header comment.

The skill (\`examples/benchmark/npm-versions.skill.md\`) therefore extracts only what the current grammar CAN express: \`latest\`, via a first-match regex against the raw response body (\`dist-tags.latest\` is a dashed JSON key, so the json-path form can't reach it either — regex was the only expressible option, and it's unambiguous since \`"latest":"..."\` appears exactly once in the response).

**Reframed, honest claim for Arm B:** Reelier deterministically replays the FETCH and the one field it can extract (\`latest\`); the aggregation/counting/enumeration fields are a grammar gap, not a fabricated result. On the field it does replay, variance is 0 by construction (verified from the run record on every replay, not assumed); the agent's variance on that SAME field, measured in Arm A above, is \`latest\`: ${armA.perField.latest.distinctValues} distinct value(s) across ${N} runs, ${armA.perField.latest.correctCount}/${N} correct.

Replayed **N-1=${N - 1}** times.

- All replays identical (verified): **${armB.allIdentical}**
- All replays' LLM tokens verified 0 (read from the run record's \`totals\`, not assumed): **${armB.allTokensZeroVerified}**
- \`latest\` correct vs. ground truth: **${armB.latestCorrectCount}/${N - 1}**
- Latency/replay avg: ${armB.latencyAvgMs.toFixed(0)} ms
- Total cost @ N=${N}: ${fmtUsd(armB.totalCostAtN)} (1 record @ ${fmtUsd(armB.recordCostUsd)} + ${N - 1} × $0)

### Raw per-replay table — Arm B

| replay# | ms | llmInputTokens/llmOutputTokens | tokens verified 0? | extracted (latest only) | correct? |
|---|---|---|---|---|---|
${replayTableRows}

### Honesty notes (Task 2)

- Token counts come **only** from the Anthropic API's \`usage\` field on each response — never estimated.
- If Arm A's variance on \`latest\` (the one field both arms can be compared on) is LOW, that is reported as-is above — the cost/latency/determinism-proof story for that field stands regardless of whether the agent happened to drift in this sample.
- The aggregation-field results in Arm A (\`total_versions\`/\`prerelease_count\`/\`all_versions\`) have **no Reelier counterpart to compare against** — Arm B does not attempt them. Reporting Arm A's numbers for those fields alone, without a "Reelier wins" framing, is the honest thing to do here: the finding is the grammar gap, not a fabricated Reelier score on fields it structurally cannot produce.
- Scoping: this task is deterministic extraction (fetch a JSON document, count/filter/enumerate its keys) — explicitly NOT generative work. Reelier's design target is deterministic extraction; a gap here is a gap in the extraction language's expressiveness, not evidence the domain choice was wrong.
`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const runDate = new Date().toISOString();
  process.stderr.write(`[task2] Ground truth: fetching ${REGISTRY_URL}...\n`);
  const groundTruth = await computeGroundTruth();
  process.stderr.write(`[task2] Ground truth: ${JSON.stringify(groundTruth)}\n`);

  const apiKey = await getAnthropicApiKey();

  const armARuns = await runArmA(apiKey, groundTruth);
  const armBReplays = await runArmBReplays(groundTruth);

  const summary = summarize(armARuns, armBReplays, groundTruth);
  printSummaryTable(summary);

  const section = buildMarkdownSection({ armARuns, armBReplays, summary, runDate });
  const outPath = path.join(__dirname, "..", "..", "docs", "strategy", "reelier-launch", "benchmark-results.md");
  await mkdir(path.dirname(outPath), { recursive: true });
  await appendFile(outPath, section, "utf8");
  process.stderr.write(`\nAppended Task 2 section to ${outPath}\n`);
}

await main();
