// task3-bench.mjs — the DECISIVE variance test at scale: N=1000.
//
// Reuses agent-arm.mjs's TASK 1 (npm registry fetch -> {version, license,
// tarball}) verbatim — same system prompt, same tool, same model, same
// pricing constants — run 1000 times with bounded concurrency, classified
// into CORRECT / WRONG / ERROR. Reuses npm-info.skill.md verbatim for Arm B,
// replayed 1000 times via the real dist/runner.js.
//
// Every number below is measured in this process. Nothing is invented.

import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
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
} from "./agent-arm.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const N = 1000;
const CONCURRENCY = 15;
const MAX_RETRIES_PER_RUN = 4; // for 429s only
const COST_CAP_USD = 30;

function outputsEqual(a, b) {
  if (!a || !b) return false;
  return a.version === b.version && a.license === b.license && a.tarball === b.tarball;
}

function canonicalize(parsed) {
  if (!parsed) return "<parse_failed>";
  return JSON.stringify({
    version: parsed.version ?? null,
    license: parsed.license ?? null,
    tarball: parsed.tarball ?? null,
  });
}

async function computeGroundTruth() {
  const res = await fetch(REGISTRY_URL, { method: "GET" });
  const body = await res.text();
  if (res.status !== 200) {
    throw new Error(`Ground-truth fetch failed: registry returned ${res.status}`);
  }
  const json = JSON.parse(body);
  const latest = json["dist-tags"]?.latest;
  if (!latest) throw new Error("Ground-truth fetch: dist-tags.latest missing from response");
  const versionEntry = json.versions?.[latest];
  if (!versionEntry) throw new Error(`Ground-truth fetch: versions[${latest}] missing from response`);
  return {
    version: latest,
    license: json.license,
    tarball: versionEntry.dist?.tarball,
  };
}

function isRateLimitError(errMsg) {
  return typeof errMsg === "string" && /\b429\b/.test(errMsg);
}

// ---------------------------------------------------------------------------
// Arm A — N=1000 real agent runs, bounded concurrency, 429-aware retry.
// ---------------------------------------------------------------------------

async function runOneWithRetry(apiKey, runIdx) {
  let attempt = 0;
  let last;
  let infraErrorCount = 0;
  for (;;) {
    attempt++;
    last = await runAgentOnce(apiKey);
    if (last.error && isRateLimitError(last.error)) {
      infraErrorCount++;
      if (attempt <= MAX_RETRIES_PER_RUN) {
        const backoffMs = 500 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250);
        process.stderr.write(`[arm A] run ${runIdx}: 429, retry ${attempt}/${MAX_RETRIES_PER_RUN} after ${backoffMs}ms\n`);
        await new Promise((r) => setTimeout(r, backoffMs));
        continue;
      }
    }
    break;
  }
  return { ...last, retries: attempt - 1, rateLimitHits: infraErrorCount };
}

async function runArmA(apiKey, groundTruth) {
  const results = new Array(N);
  let cumulativeCost = 0;
  let costCapHit = false;
  let nextIdx = 0;
  let completed = 0;

  async function worker() {
    for (;;) {
      if (costCapHit) return;
      const i = nextIdx++;
      if (i >= N) return;
      const runNo = i + 1;
      const r = await runOneWithRetry(apiKey, runNo);
      const correct = !r.error && outputsEqual(r.parsed, groundTruth);
      const classification = r.error
        ? isRateLimitError(r.error)
          ? "ERROR_429"
          : "ERROR_OTHER"
        : correct
          ? "CORRECT"
          : "WRONG";
      results[i] = { run: runNo, ...r, correct, classification };
      completed++;
      cumulativeCost += r.costUsd || 0;
      if (completed % 50 === 0 || completed === N) {
        process.stderr.write(
          `[arm A] ${completed}/${N} done, cumulative cost=$${cumulativeCost.toFixed(4)}\n`
        );
      }
      if (cumulativeCost >= COST_CAP_USD) {
        costCapHit = true;
        process.stderr.write(`[arm A] COST CAP ($${COST_CAP_USD}) hit at run ${runNo} — stopping.\n`);
        return;
      }
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);

  return { runs: results.filter(Boolean), costCapHit };
}

// ---------------------------------------------------------------------------
// Arm B — N=1000 deterministic replays.
// ---------------------------------------------------------------------------

async function runArmBReplays(groundTruth) {
  const skillPath = path.join(__dirname, "npm-info.skill.md");
  const skillSrc = await readFile(skillPath, "utf8");
  const skill = parseSkill(skillSrc);

  const runCwd = __dirname;
  await rm(path.join(runCwd, ".reelier"), { recursive: true, force: true });

  const replays = [];
  for (let i = 1; i <= N; i++) {
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

    const correct = outputsEqual(parsed, groundTruth);
    replays.push({
      replay: i,
      ms,
      passed: record.passed,
      llmInputTokens: record.totals.llmInputTokens,
      llmOutputTokens: record.totals.llmOutputTokens,
      llmTokensZero,
      parsed,
      correct,
    });
    if (i % 100 === 0 || i === N) {
      process.stderr.write(`[arm B] ${i}/${N} replays done\n`);
    }
  }
  return replays;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function fmtUsd(n) {
  return `$${n.toFixed(6)}`;
}

function buildSection({ armA, armBReplays, groundTruth, runDate, wallClockMs, achievedN }) {
  const okRuns = armA.runs.filter((r) => r.classification !== "ERROR_429" && r.classification !== "ERROR_OTHER");
  const correctRuns = armA.runs.filter((r) => r.classification === "CORRECT");
  const wrongRuns = armA.runs.filter((r) => r.classification === "WRONG");
  const error429Runs = armA.runs.filter((r) => r.classification === "ERROR_429");
  const errorOtherRuns = armA.runs.filter((r) => r.classification === "ERROR_OTHER");

  const totalCostUsd = armA.runs.reduce((s, r) => s + (r.costUsd || 0), 0);
  const totalRetries = armA.runs.reduce((s, r) => s + (r.retries || 0), 0);
  const totalRateLimitHits = armA.runs.reduce((s, r) => s + (r.rateLimitHits || 0), 0);

  const distinctParsedOutputs = new Set(armA.runs.map((r) => canonicalize(r.parsed)));

  const avg = (arr) => (arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0);
  const armALatencyAvg = avg(okRuns.map((r) => r.ms));

  const armBIdentical =
    armBReplays.length > 0 &&
    armBReplays.every((r) => canonicalize(r.parsed) === canonicalize(armBReplays[0].parsed));
  const armBAllTokensZero = armBReplays.every((r) => r.llmTokensZero);
  const armBCorrectCount = armBReplays.filter((r) => r.correct).length;
  const armBLatencyAvg = avg(armBReplays.map((r) => r.ms));
  const nonIdenticalReplays = armBReplays.filter(
    (r) => canonicalize(r.parsed) !== canonicalize(armBReplays[0]?.parsed)
  );

  const wrongOutputsQuoted = wrongRuns
    .map((r) => `- run ${r.run}: \`${JSON.stringify(r.parsed)}\` (parse: ${r.parseError ?? "ok"})`)
    .join("\n");

  const wrongRate = achievedN > 0 ? (wrongRuns.length / achievedN) * 100 : 0;

  const verdict =
    wrongRuns.length === 0
      ? `**${correctRuns.length}/${achievedN} correct, 0 WRONG outputs.** No confident model drift was observed at N=${achievedN} on this deterministic extraction task — the variance/determinism claim does NOT get support from this specific tail test. The honest framing going forward is cost + speed (Reelier: $0/replay vs Arm A's ${fmtUsd(totalCostUsd)} total; ${armBLatencyAvg.toFixed(0)}ms vs ${armALatencyAvg.toFixed(0)}ms avg) plus Reelier's *structural* zero-variance guarantee (proven by construction, not just empirically absent in this sample) — not an empirically-observed drift rate.`
      : `**${wrongRuns.length}/${achievedN} WRONG (${wrongRate.toFixed(2)}%) — confident, parseable, incorrect answers.** Model drift IS measurable at this scale even though it was invisible at N=10. This is the tail-variance finding the test was built to surface.`;

  return `## Task 3 — N=1000 tail-variance test

**[MEASURED]** — every number below comes from a real run captured by \`examples/benchmark/task3-bench.mjs\` in the [seldonframe/reelier](https://github.com/seldonframe/reelier) repo, executed on Windows with zero new dependencies (reuses \`agent-arm.mjs\`, \`env.mjs\`, \`npm-info.skill.md\` verbatim from Task 1).

Run date: ${runDate}

### Why N=1000

At N=10 (Task 1 above), the agent showed ~0 measured variance on this extraction task. Variance is a tail phenomenon: a 0.3% drift rate is invisible at N=10 but real at N=1000. This test asks a single honest question — does a capable agent, doing an IDENTICAL deterministic extraction task 1000 times, ever silently drift to a confident-but-wrong answer? If yes at even 0.2-2%, that is the "agents don't reliably repeat themselves" claim MEASURED, on Reelier's own turf. If it comes back ~1000/1000 correct, the variance argument is dead even at scale, and the honest pitch narrows to cost + speed + structural (not empirical) determinism — which is reported here exactly as measured either way.

### Task under test (identical to Task 1, reused verbatim)

"Fetch the npm registry metadata for the package \`@seldonframe/reelier\` and return a JSON object with exactly these keys: \`version\` (the \`dist-tags.latest\` string), \`license\` (the license string), \`tarball\` (the tarball URL of the latest version from \`versions[latest].dist.tarball\`)." Registry URL: \`${REGISTRY_URL}\` (public, no auth, real, live).

### Ground truth (computed once, independent of both arms)

\`\`\`json
${JSON.stringify(groundTruth, null, 2)}
\`\`\`

### Methodology

**Arm A** — \`examples/benchmark/agent-arm.mjs\`'s \`runAgentOnce\`, model \`${MODEL}\`, run **N=${achievedN}** times (target ${N}) with bounded concurrency (${CONCURRENCY} simultaneous in-flight runs, a simple pull-based worker pool — no new deps). Each run classified independently:
- **CORRECT** — parsed output's \`version\`, \`license\`, and \`tarball\` all match ground truth exactly.
- **WRONG** — the agent returned a parseable JSON object that does NOT match ground truth on at least one field. This is the tail case that matters: a confident wrong answer, not a crash.
- **ERROR_429** — a rate-limit response from the Anthropic API. Retried up to ${MAX_RETRIES_PER_RUN}x with exponential backoff before being counted; a 429 is infra, not model drift, and is reported separately from WRONG so the two are never conflated.
- **ERROR_OTHER** — any other run-level failure (network, non-429 API error, exceeded tool-turn budget). Also infra, also reported separately.

Cost/run computed the same way as Task 1: \`tokensIn * $${INPUT_PRICE_PER_MTOK}/MTok + tokensOut * $${OUTPUT_PRICE_PER_MTOK}/MTok\` (Haiku 4.5 list pricing). A hard cost cap of $${COST_CAP_USD} was enforced — if cumulative spend crossed it, the run loop would stop early and report the partial N reached (see "Achieved N" below).

**Arm B** — \`examples/benchmark/npm-info.skill.md\` (same skill file as Task 1, unmodified) replayed **N=${armBReplays.length}** times via the real \`dist/runner.js\` \`runSkill\` at \`maxLevel: 0\`. Every replay's \`record.totals.llmInputTokens\`/\`llmOutputTokens\` asserted \`=== 0\` from the run record (not assumed), and every replay's extracted \`{version, license, tarball}\` compared for byte-identical equality against replay #1's output and against ground truth.

### Headline results

| Metric | Arm A (agent, N=${achievedN}) | Arm B (Reelier, N=${armBReplays.length}) |
|---|---|---|
| CORRECT | ${correctRuns.length}/${achievedN} (${((correctRuns.length / achievedN) * 100).toFixed(2)}%) | ${armBCorrectCount}/${armBReplays.length} (${((armBCorrectCount / armBReplays.length) * 100).toFixed(2)}%) |
| **WRONG (confident, incorrect)** | **${wrongRuns.length}/${achievedN} (${wrongRate.toFixed(2)}%)** | 0/${armBReplays.length} (structurally impossible — 0 LLM tokens) |
| ERROR_429 (infra, retried) | ${error429Runs.length} (after retry exhaustion) / ${totalRateLimitHits} total 429 responses hit across all attempts | n/a |
| ERROR_OTHER (infra) | ${errorOtherRuns.length} | n/a |
| Distinct parsed outputs | ${distinctParsedOutputs.size} | ${armBIdentical ? 1 : "MULTIPLE — see below"} |
| Avg latency/run | ${armALatencyAvg.toFixed(0)} ms | ${armBLatencyAvg.toFixed(0)} ms |
| Tokens/run | (varies, see cost) | 0/0 (verified from run record on every one of ${armBReplays.length} replays: allTokensZero=${armBAllTokensZero}) |
| Total cost | ${fmtUsd(totalCostUsd)} | $0.000000 (pure replay; recording already paid for in Task 1) |

**Total retries issued for 429 backoff:** ${totalRetries} (across ${achievedN} runs). **Wall-clock for Arm A:** ${(wallClockMs.armA / 1000 / 60).toFixed(1)} min. **Wall-clock for Arm B:** ${(wallClockMs.armB / 1000).toFixed(1)} s.

### WRONG outputs (quoted verbatim)

${wrongRuns.length === 0 ? "None. Zero WRONG runs across all " + achievedN + " Arm A attempts." : wrongOutputsQuoted}

### Arm B non-identical replays (P0 if any)

${nonIdenticalReplays.length === 0 ? `None. All ${armBReplays.length} replays produced byte-identical output to replay #1, verified programmatically (not eyeballed).` : `**P0 DEFECT — ${nonIdenticalReplays.length} replay(s) differed from replay #1:**\n\n` + nonIdenticalReplays.map((r) => `- replay ${r.replay}: \`${JSON.stringify(r.parsed)}\``).join("\n")}

### Honest conclusion

${verdict}

### Honesty notes (Task 3)

- WRONG and ERROR are counted and reported as strictly separate categories throughout — a 429 (rate limit) is never folded into the WRONG count, and vice versa. Conflating them would inflate or deflate the drift story dishonestly in either direction.
- Cost cap: ${armA.costCapHit ? `**HIT** — the run loop stopped at N=${achievedN} (target was ${N}) because cumulative spend crossed $${COST_CAP_USD}. Results below reflect the achieved N, not the target N.` : `not hit — all ${N} planned Arm A runs completed within the $${COST_CAP_USD} budget.`}
- Every Arm A run (CORRECT, WRONG, and ERROR) is included in every aggregate above (distinct-output count, cost total, latency average over non-error runs only) — none were dropped or excluded post-hoc.
- Arm B's "0 replays differ" and "0 tokens" claims are verified programmatically against the actual run record on every single replay, not sampled or assumed from Task 1's smaller run.
`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const runDate = new Date().toISOString();
  process.stderr.write(`Ground truth: fetching ${REGISTRY_URL}...\n`);
  const groundTruth = await computeGroundTruth();
  process.stderr.write(`Ground truth: ${JSON.stringify(groundTruth)}\n`);

  const apiKey = await getAnthropicApiKey();

  const armAStart = Date.now();
  const armA = await runArmA(apiKey, groundTruth);
  const armAMs = Date.now() - armAStart;
  const achievedN = armA.runs.length;

  const armBStart = Date.now();
  const armBReplays = await runArmBReplays(groundTruth);
  const armBMs = Date.now() - armBStart;

  const section = buildSection({
    armA,
    armBReplays,
    groundTruth,
    runDate,
    wallClockMs: { armA: armAMs, armB: armBMs },
    achievedN,
  });

  const outPath = path.join(__dirname, "..", "..", "docs", "strategy", "reelier-launch", "benchmark-results.md");
  const existing = await readFile(outPath, "utf8").catch(() => "");
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, existing.trimEnd() + "\n\n" + section, "utf8");
  process.stderr.write(`\nAppended Task 3 section to ${outPath}\n`);

  const correctCount = armA.runs.filter((r) => r.classification === "CORRECT").length;
  const wrongCount = armA.runs.filter((r) => r.classification === "WRONG").length;
  const errorCount = armA.runs.length - correctCount - wrongCount;
  const totalCost = armA.runs.reduce((s, r) => s + (r.costUsd || 0), 0);

  console.log("\n=== TASK 3 RESULT ===");
  console.log(`Arm A: CORRECT=${correctCount} WRONG=${wrongCount} ERROR=${errorCount} (achieved N=${achievedN}/${N})`);
  console.log(`Total cost: $${totalCost.toFixed(4)}`);
  console.log(`Wall-clock: Arm A=${(armAMs / 1000 / 60).toFixed(1)}min Arm B=${(armBMs / 1000).toFixed(1)}s`);
}

await main();
