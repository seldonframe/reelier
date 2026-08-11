#!/usr/bin/env node
// Hand-rolled argv parsing (no commander). Two subcommands: run, bench.

import { readFile, writeFile, appendFile, access, readdir, realpath, stat, mkdir } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline/promises";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { parseSkill, SkillParseError, type Skill, type Step } from "./skill.js";
import { runSkill, dryRunSkill, readRunRecords, executionRecords, runProbe, fillTemplate, DEFAULT_PROBE_TIMEOUT_MS, type RunRecord, type StepAttest } from "./runner.js";
import { buildResolutionRecord, resolveDeferred, selectUnresolved, type PendingAttestation } from "./defer.js";
import {
  mintExpectKey,
  expectMac,
  expectFieldMac,
  probeArgsMac,
  STATUS_CODE_ENTRY,
  projectObservationTyped,
  projectionMisses,
  typedKeyFor,
  ABSENT_FIELDS_MAX,
  ABSENT_FIELD_NAME_MAX,
  resolveKeystorePath,
  macEquals,
  readKeystore,
  writeKeystoreEntry,
  removeKeystoreEntries,
  loadExpectKey,
} from "./expect-mac.js";
import { pushSkill, resolvePushConfig, PublicSubmissionError, type PushRecordResult } from "./push.js";
import { getSkill, getMineSkill, type GetOutcome, type GetMineOutcome } from "./get.js";
import { DEFAULT_CLOUD_URL, readCliConfig, writeCliConfig, clearCliCredentials } from "./cloud-config.js";
import { startLogin, pollForToken, openBrowser } from "./login.js";
import type { spawn } from "node:child_process";
import { builtinTools, type Tool, type ToolContext } from "./tools.js";
import { connectDownstream, type DownstreamConnection } from "./mcp-client.js";
import { loadConnectionInventory } from "./connections.js";
import { buildMcpTools } from "./mcp-tool.js";
import { buildProxyServer, Recorder } from "./recorder.js";
import { parseTraceLines, formatTrace } from "./trace.js";
import { analyzeTrace, formatProvenance } from "./provenance-trace.js";
import { compile, renderSkillMd, type CompileResult, type FromSkillProvenance } from "./compile.js";
import { buildManifestForSkill, preflightManifest, addProbeToolsToManifest } from "./manifest.js";
import { serializeSkill, writeFileAtomic, appendChangelogLine } from "./writeback.js";
import { computeApprovalHash } from "./approval.js";
import { parseDuration, MAX_APPROVAL_TTL_MS } from "./duration.js";
import { canonicalJson } from "./canonical-json.js";
import { parseInstructionSkillFrontmatter } from "./from-skill.js";
import { createLlmClient, resolveLlmConfig } from "./llm.js";
import { renderAttestLines, renderStateCheckLines, findingsSummaryTag } from "./attest-render.js";
import { computeRunShape } from "./priors.js";
import { renderRunShapeDeviationLines, renderRunShapeReportLines } from "./priors-render.js";
import {
  detectAgentConfig,
  detectMcpConfigs,
  knownMcpConfigPaths,
  type KnownMcpConfig,
  reelierProxyCommandLine,
  planMcpConfigWrite,
  applyMcpConfigWrite,
  findNewestTraceFile,
  parseMcpConfig,
  runDemoRecording,
  compileDemoTrace,
  formatReceipt,
  formatNextSteps,
  LAUNCH_BENCHMARK_COMPARISON,
  type DemoBenchmarkComparison,
} from "./init.js";
import { compileSessionTranscript, detectSessionFormat, SESSION_FORMAT_LABELS, type SessionSkip, type SessionFormatId } from "./session.js";
import {
  scanTranscripts,
  scanAgentSessions,
  agentSources,
  replayableRateStats,
  formatReplayableRate,
  stubAgentSources,
  probeStubSource,
  type ScannedSession,
  type StubAgentId,
} from "./scan.js";
import {
  planInstall,
  applyInstall,
  planUninstall,
  applyUninstall,
  agentGuardMessage,
  planWrapOffer,
  type InstallResult,
  type InstallPlan,
  type UninstallPlanEntry,
} from "./wrap.js";
import { buildToolServer, runDiffTool } from "./serve.js";
import { recordTotals } from "./footprint.js";
import {
  costRun,
  loadPriceTable,
  formatUsd,
  parseSinceFlag,
  withinSince,
  defaultPricesFilePath,
  type SinceFilter,
} from "./cost.js";
import { BUNDLED_PRICES_RETRIEVED_AT } from "./prices.js";
import {
  loadPolicyForWrap,
  policyRecordFromLoad,
  summarizePolicyForWrapStart,
  parsePolicyStrict,
  hasEndpointRules,
  ENDPOINT_RULE_NOTE,
  resolveStateGateForRun,
} from "./policy.js";
import { generateSigningKeypair, loadSigningKey, signRecordDigest, verifyRecordSignature, signingKeyDir } from "./signing.js";
import { resolveVerifyPayload, evaluateVerifyClaims } from "./verify.js";
import { writeCiWorkflow, PLACEHOLDER_SKILL_PATH } from "./ci-scaffold.js";
import { buildDiscoveryBundle, discoverOpportunities, formatDiscoveryPreview, signDiscoveryBundle, type AgentOpportunity, type DiscoverySessionInput } from "./discovery.js";
import { collectClaudeCodeCoverage, collectCodexCoverage, renderCoverageReport, renderCoverageView } from "./coverage.js";
import { uploadDiscoveryBundle } from "./discovery-client.js";
import { createBridgeServer } from "./bridge.js";
import { runAuthorityCommand } from "./authority/cli.js";
import { buildAuthorityDeployment } from "./authority/host/deploy.js";
import {
  initializeInspection,
  renderInitializationReport,
  type InitializationDependencies,
} from "./initialization.js";

// Exported (alongside cmdPush below) so test/push-cli.test.ts can drive
// cmdPush's console output directly with a fake ParsedArgs + monkeypatched
// fetch, instead of spawning a real subprocess against a real HTTP server —
// same reasoning as computeBenchSummary's export just below.
export interface ParsedArgs {
  positional: string[];
  flags: Set<string>;
  vars: Record<string, string>;
  wraps: string[];
  opts: Record<string, string>;
  /** Raw `--fail N` / `--fail N=status` values, in the order given — repeatable, mirrors `wraps`. Parsed/validated by cmdRun (see parseMockFailures). */
  fails: string[];
}

export function parseArgv(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags = new Set<string>();
  const vars: Record<string, string> = {};
  const wraps: string[] = [];
  const opts: Record<string, string> = {};
  const fails: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--var") {
      const kv = argv[++i];
      if (!kv || !kv.includes("=")) {
        throw new Error(`--var requires name=value, got: ${JSON.stringify(kv)}`);
      }
      const eq = kv.indexOf("=");
      vars[kv.slice(0, eq)] = kv.slice(eq + 1);
    } else if (arg === "--wrap") {
      const val = argv[++i];
      if (!val) {
        throw new Error("--wrap requires a command-line string");
      }
      wraps.push(val);
    } else if (arg === "--fail") {
      const val = argv[++i];
      if (!val) {
        throw new Error("--fail requires a value (N or N=status), e.g. --fail 3 or --fail 3=429");
      }
      fails.push(val);
    } else if (arg === "--trace-dir") {
      const val = argv[++i];
      if (!val) {
        throw new Error("--trace-dir requires a path");
      }
      opts["trace-dir"] = val;
    } else if (arg === "-o") {
      const val = argv[++i];
      if (!val) {
        throw new Error("-o requires an output path");
      }
      opts.o = val;
    } else if (
      arg === "--max-level" ||
      arg === "--llm-base-url" ||
      arg === "--llm-api-key" ||
      arg === "--llm-model" ||
      arg === "--llm-l2-model" ||
      arg === "--out" ||
      arg === "--name" ||
      arg === "--dir" ||
      arg === "--out-dir" ||
      arg === "--agent" ||
      arg === "--host" ||
      arg === "--workspace" ||
      arg === "--from-skill" ||
      arg === "--since" ||
      arg === "--select" ||
      arg === "--expires" ||
      arg === "--key" ||
      arg === "--path"
      || arg === "--input"
      || arg === "--pack"
      || arg === "--tenant"
      || arg === "--signer"
      || arg === "--adapter"
      || arg === "--transport"
      || arg === "--port"
      || arg === "--certification-config"
      || arg === "--config"
      || arg === "--scenario"
    ) {
      const val = argv[++i];
      if (!val || (arg === "--scenario" && val.startsWith("--"))) {
        throw new Error(`${arg} requires a value`);
      }
      if (arg === "--scenario" && opts.scenario !== undefined) throw new Error("duplicate --scenario option");
      opts[arg.slice(2)] = val;
    } else if (arg.startsWith("--")) {
      flags.add(arg.slice(2));
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags, vars, wraps, opts, fails };
}

/**
 * Parse `--fail` values (`N` or `N=status`) into a step-number -> injected-
 * HTTP-status map. `N` alone defaults to status 500. Throws a plain `Error`
 * (caught by cmdRun as a usage error, exit 1) on anything that doesn't match
 * — never silently ignored.
 */
function parseMockFailures(raw: string[]): Record<number, number> {
  const result: Record<number, number> = {};
  for (const spec of raw) {
    const m = spec.match(/^(\d+)(?:=(\d+))?$/);
    if (!m) {
      throw new Error(`--fail requires N or N=status (e.g. --fail 3 or --fail 3=429), got: ${JSON.stringify(spec)}`);
    }
    const n = parseInt(m[1], 10);
    const status = m[2] !== undefined ? parseInt(m[2], 10) : 500;
    result[n] = status;
  }
  return result;
}

function fmtDuration(ms: number): string {
  return `${ms}ms`;
}

function parseMaxLevel(raw: string | undefined): 0 | 1 | 2 {
  if (raw === undefined) return 0;
  if (raw === "0") return 0;
  if (raw === "1") return 1;
  if (raw === "2") return 2;
  throw new Error(`--max-level must be 0, 1, or 2, got: ${JSON.stringify(raw)}`);
}

/**
 * Shared downstream/tool-registry construction, factored from cmdRun for
 * `reelier approve --probe` (state-conditioned approval §4.2 — the one
 * refactor that flow needs): connect every `--wrap` spec in order. On a
 * partial connect failure the already-opened downstreams are closed before
 * the error propagates, so a caller's `finally` never leaks the survivors.
 */
async function wireDownstreams(
  wraps: string[],
  connect: (spec: string) => Promise<DownstreamConnection>
): Promise<DownstreamConnection[]> {
  const downstreams: DownstreamConnection[] = [];
  try {
    for (const spec of wraps) {
      downstreams.push(await connect(spec));
    }
  } catch (err) {
    await Promise.all(downstreams.map((d) => d.close().catch(() => {})));
    throw err;
  }
  return downstreams;
}

/** Builtins overlaid with the wrapped MCP downstreams' tools; `undefined` when nothing is wrapped (runSkill then falls back to builtins itself). */
function buildWrappedToolRegistry(downstreams: DownstreamConnection[]): Record<string, Tool> | undefined {
  return downstreams.length > 0 ? { ...builtinTools, ...buildMcpTools(downstreams) } : undefined;
}

/** `.reelier/runs/<skill>.jsonl` under `cwd` — the exact path runSkill appends to (src/runner.ts's runRecordPath). */
function runRecordPathFor(cwd: string, skillName: string): string {
  return path.join(cwd, ".reelier", "runs", `${skillName}.jsonl`);
}

/**
 * F5 local run-shape priors on the `reelier run` surface
 * (docs/specs/run-shape-priors.md §6): print the deviation block, or print
 * nothing at all.
 *
 * Every failure mode is swallowed on purpose. A missing, unreadable or
 * corrupt run-record file must never affect a run that already happened —
 * fail open at the recorder (never-list #5). There is also nothing honest to
 * SAY about the failure on this surface: the report is advisory, and an
 * advisory that cannot be computed is simply absent.
 *
 * No `now` is supplied: at the end of a run there is no silence to measure,
 * so the silence signal is not emitted here (it is `reelier baseline`'s).
 */
async function printRunShapeDeviations(cwd: string, skillName: string): Promise<void> {
  try {
    const records = await readRunRecords(runRecordPathFor(cwd, skillName));
    const lines = renderRunShapeDeviationLines(computeRunShape(records));
    if (lines.length === 0) return;
    console.log("");
    for (const line of lines) {
      console.log(line);
    }
  } catch {
    // Intentionally silent — see above.
  }
}

/**
 * `connect` is injectable (defaults to the real `connectDownstream`, which
 * spawns a subprocess) so tests can drive the manifest preflight against an
 * in-process fake DownstreamConnection instead — same reasoning as
 * cmdManifest's and cmdPush's overrides.
 */
export async function cmdRun(
  args: ParsedArgs,
  connect: (spec: string) => Promise<DownstreamConnection> = connectDownstream,
  deps: { cwd?: string; homedir?: string } = {}
): Promise<number> {
  const skillPath = args.positional[0];
  if (!skillPath) {
    console.error(
      "Usage: reelier run <skill.md> [--dry-run] [--allow-writes] [--yes] [--ignore-manifest] [--var name=value ...] " +
        "[--max-level 0|1|2] [--llm-base-url ...] [--llm-api-key ...] [--llm-model ...] [--llm-l2-model ...] " +
        "[--fail N[=status] ...]"
    );
    return 1;
  }

  // S8 (§5.5): resolve the state-gate opt-in FIRST — a malformed file that
  // DECLARES `state_gate` refuses the run before anything else happens
  // (silently ignoring it would fail open against a declared operator
  // intent, the one direction an opt-in gate must never fail). Repos
  // without the key keep today's behavior on this path — a malformed
  // policy without it warns (the warning line is the gap marker; the run
  // record is never mutated for a repo that did not opt in).
  const stateGate = await resolveStateGateForRun(deps.cwd ?? process.cwd(), deps.homedir ?? os.homedir());
  if (stateGate.mode === "refuse-run") {
    console.error(
      `Refusing to run: ${stateGate.sourcePath} declares 'state_gate' but is malformed (${stateGate.errors.length} error(s)): ${stateGate.errors.join("; ")}`
    );
    console.error(
      "A malformed state-gate opt-in fails closed. Fix the file ('reelier policy check') or remove the state_gate key for recorder mode."
    );
    return 1;
  }
  if (stateGate.mode === "off" && stateGate.warning !== undefined) {
    console.error(stateGate.warning);
  }

  let maxLevel: 0 | 1 | 2;
  try {
    maxLevel = parseMaxLevel(args.opts["max-level"]);
  } catch (err) {
    console.error((err as Error).message);
    return 1;
  }

  // `--fail N[=status]` (docs/specs/flight-recorder-v2.md §3): validated up
  // front, before even reading the skill file — a malformed --fail is a
  // usage error, not something that should depend on the skill existing.
  let mockFailures: Record<number, number>;
  try {
    mockFailures = parseMockFailures(args.fails);
  } catch (err) {
    console.error((err as Error).message);
    return 1;
  }

  let source: string;
  try {
    source = await readFile(skillPath, "utf8");
  } catch (err) {
    console.error(`Could not read skill file ${skillPath}: ${(err as Error).message}`);
    return 1;
  }

  let skill;
  try {
    skill = parseSkill(source);
  } catch (err) {
    if (err instanceof SkillParseError) {
      console.error(`Malformed skill in ${skillPath}: ${err.message}`);
      return 1;
    }
    throw err;
  }

  if (args.flags.has("dry-run")) {
    const filled = dryRunSkill(skill, args.vars);
    console.log(`Dry run: ${skill.name} (${filled.length} steps)`);
    for (const step of filled) {
      console.log(`  Step ${step.n} — ${step.title} [${step.effect}]`);
      console.log(`    ${step.tool} ${JSON.stringify(step.args)}`);
    }
    return 0;
  }

  let downstreams: DownstreamConnection[] = [];
  try {
    downstreams = await wireDownstreams(args.wraps, connect);

    // Fail-closed manifest preflight (docs/specs/flight-recorder-v2.md §1):
    // prove the tools this skill was recorded/stamped against are still the
    // tools present — schema-identical — BEFORE step 1 executes. A skill
    // with no manifest is unaffected (additive; every pre-v2 skill stays
    // valid) beyond a one-line advisory note.
    const ignoreManifest = args.flags.has("ignore-manifest");
    let manifestIgnored = false;
    let manifestChecked = false;
    if (skill.manifest) {
      if (ignoreManifest) {
        console.error("WARNING: --ignore-manifest — replaying despite unverified tool schemas");
        manifestIgnored = true;
      } else if (args.wraps.length === 0) {
        console.error("manifest present but no --wrap given — cannot verify tools against live servers");
        return 1;
      } else {
        const { ok, drifts } = preflightManifest(skill.manifest, downstreams);
        if (!ok) {
          console.error("MANIFEST DRIFT — refusing to replay (fail closed):");
          for (const d of drifts) {
            const liveTag = d.live !== undefined ? ` live ${d.live}` : "";
            console.error(`  ✗ ${d.name} — recorded ${d.recorded}${liveTag} (${d.note})`);
          }
          console.error(
            `If the change is intentional: reelier manifest ${skillPath} --wrap …  |  break-glass: --ignore-manifest`
          );
          return 1;
        }
        manifestChecked = true;
      }
    } else {
      console.error(
        `note: ${skillPath} has no manifest — replay cannot detect tool-schema drift. Stamp one: reelier manifest ${skillPath} --wrap …`
      );
    }

    const tools = buildWrappedToolRegistry(downstreams);

    if (args.fails.length > 0) {
      const stepNums = Object.keys(mockFailures)
        .map(Number)
        .sort((a, b) => a - b);
      console.log(`MOCK RUN — injected failures at step(s): ${stepNums.join(", ")}`);
    }

    // Rule: at --max-level 0 (default) the LLM is never constructed or
    // called. Only build it when escalation was actually requested.
    const llmConfig =
      maxLevel >= 1
        ? resolveLlmConfig({
            baseUrl: args.opts["llm-base-url"],
            apiKey: args.opts["llm-api-key"],
            model: args.opts["llm-model"],
            l2Model: args.opts["llm-l2-model"],
          })
        : undefined;

    const record = await runSkill(skill, {
      vars: args.vars,
      allowDestructive: args.flags.has("yes"),
      allowWrites: args.flags.has("allow-writes") || args.flags.has("yes"),
      tools,
      maxLevel,
      llm: llmConfig ? createLlmClient(llmConfig) : undefined,
      llmModel: llmConfig?.model,
      llmL2Model: llmConfig?.l2Model,
      skillPath,
      // The exact bytes just read off disk to parse `skill` for this run —
      // stamped verbatim onto the RunRecord (see RunRecord.skillContentSha256).
      skillContentSha256: createHash("sha256").update(source, "utf8").digest("hex"),
      manifestIgnored,
      manifestChecked,
      // The directory whose policy governed the gate MUST be the directory
      // that receives the run record (review finding): otherwise a
      // programmatic caller passing deps.cwd gates on repo A and records
      // into repo B. Same value, by construction.
      ...(deps.cwd !== undefined ? { cwd: deps.cwd } : {}),
      ...(stateGate.mode === "refuse" ? { stateGate: "refuse" as const } : {}),
      // The policy in force for THIS run, from the same resolution that
      // decided the gate — so the digest names the bytes that actually
      // governed it. Never inherited from the trace this skill was compiled
      // from (policy-attestation-v1 §3).
      policy: stateGate.policy,
      ...(args.fails.length > 0 ? { mockFailures } : {}),
      onStep: (rec) => {
        const unresolvedAttest = rec.attest?.confidence === "pending" || rec.attest?.confidence === "absent";
        const icon = unresolvedAttest
          ? "◇"
          : rec.outcome === "passed" || rec.outcome === "unchecked" ? "✓" : rec.outcome === "skipped" ? "○" : "✗";
        const tag = rec.outcome === "unchecked" ? " (unchecked: no assertions)" : "";
        const levelTag = rec.level > 0 ? ` [healed L${rec.level}]` : "";
        // Shown only for `external-visible` (SPEC §3.7): internal is the
        // overwhelming majority and the absent case, so tagging it would be
        // noise. Plain text, no warning glyph and no error colour — it is a
        // classification the author wrote down, not a finding.
        const exposureTag = rec.exposure === "external-visible" ? " [external-visible]" : "";
        console.log(
          `${icon} Step ${rec.n} — ${rec.title} [${rec.outcome}${tag}]${levelTag}${exposureTag} ${fmtDuration(rec.ms)}`
        );
        if (rec.mocked) {
          console.log(`    ⚡ INJECTED failure (--fail ${rec.n})`);
        }
        for (const f of rec.failures) {
          console.log(`    - ${f}`);
        }
        if (rec.write?.duplicateOf !== undefined) {
          console.log(`    ! duplicate write (same idempotency key as step ${rec.write.duplicateOf})`);
        }
        if (rec.attest) {
          for (const line of renderAttestLines(rec.attest)) {
            console.log(`   ${line}`);
          }
        }
        if (rec.stateCheck) {
          for (const line of renderStateCheckLines(rec.stateCheck, rec.write?.dispatchedAt)) {
            console.log(`   ${line}`);
          }
        }
      },
    });

    console.log("");
    const okCount = record.totals.passed + record.totals.unchecked;
    const uncheckedTag = record.totals.unchecked > 0 ? ` (${record.totals.unchecked} unchecked)` : "";
    // §5.4: the summary gains `· N finding(s)` when any step stamped a
    // pre-state mismatch (stamped in recorder mode, or refused under the
    // S8 state gate). The stamp never flips PASSED/FAILED or the exit code
    // (I-9) — a finding is about the world, not the run. In gate mode the
    // REFUSAL flips the outcome (it lands in failures[]), so a refused run
    // prints FAILED *and* a finding tag: two honest facts, not one signal
    // leaking into the other.
    console.log(
      `${runDisplayVerdict(record)}: ${okCount}/${record.totals.steps} steps ok${uncheckedTag}, ${
        record.totals.failed
      } failed, ${fmtDuration(record.totals.ms)} total${findingsSummaryTag(record.steps)}`
    );
    if (record.totals.llmInputTokens > 0 || record.totals.llmOutputTokens > 0) {
      console.log(`LLM tokens: ${record.totals.llmInputTokens} in / ${record.totals.llmOutputTokens} out`);
    }
    // Deprecation nudge (docs/specs/flight-recorder-v2.md §2): any write that
    // executed via the legacy --allow-writes/--yes flags rather than a
    // matching per-step approval gets one summary note, not one per step.
    if (record.steps.some((s) => s.write?.approved === false)) {
      console.log(
        "note: write steps executed via --allow-writes/--yes without per-step approval — approve them: reelier approve <skill.md>"
      );
    }

    // F5 local run-shape priors (docs/specs/run-shape-priors.md §6): an
    // EXCEPTION report over this repo's own .reelier/runs/<skill>.jsonl,
    // printed only when the run that just happened departed from that
    // skill's own recent history. It is computed after the record is
    // appended, so the run being reported on is in the file. It never
    // touches the exit code below — a deviation is a difference, not a fault.
    await printRunShapeDeviations(deps.cwd ?? process.cwd(), skill.name);

    return record.passed ? 0 : 1;
  } catch (err) {
    console.error(`Failed to connect --wrap downstream: ${(err as Error).message}`);
    return 1;
  } finally {
    await Promise.all(downstreams.map((d) => d.close().catch(() => {})));
  }
}

export interface BenchSummary {
  runs: number;
  passCount: number;
  passRate: string;
  firstMs: number;
  firstStartedAt: string;
  latestMs: number;
  latestStartedAt: string;
  totals: { passed: number; unchecked: number; skipped: number; failed: number };
  levelCounts: { 0: number; 1: number; 2: number };
  escalation: { l1Attempted: number; l1Healed: number; l2Attempted: number; l2Healed: number };
  llmInputTokens: number;
  llmOutputTokens: number;
  failureCounts: Map<string, number>;
}

/** CLI verdict vocabulary: unresolved attestation is a state, never a pass. */
export function runDisplayVerdict(record: RunRecord): "PASSED" | "FAILED" | "ATTESTATION PENDING" | "ATTESTATION ABSENT" {
  if (!record.passed) return "FAILED";
  const confidences = record.steps.map((step) => step.attest?.confidence);
  if (confidences.includes("pending")) return "ATTESTATION PENDING";
  if (confidences.includes("absent")) return "ATTESTATION ABSENT";
  return "PASSED";
}

export function computeBenchSummary(records: RunRecord[]): BenchSummary {
  records = executionRecords(records);
  const first = records[0];
  const latest = records[records.length - 1];
  const passCount = records.filter((r) => r.passed).length;
  const passRate = ((passCount / records.length) * 100).toFixed(1);

  const failureCounts = new Map<string, number>();
  const levelCounts = { 0: 0, 1: 0, 2: 0 };
  const escalation = { l1Attempted: 0, l1Healed: 0, l2Attempted: 0, l2Healed: 0 };
  const totals = { passed: 0, unchecked: 0, skipped: 0, failed: 0 };
  let llmInputTokens = 0;
  let llmOutputTokens = 0;

  for (const r of records) {
    llmInputTokens += r.totals.llmInputTokens ?? 0;
    llmOutputTokens += r.totals.llmOutputTokens ?? 0;

    const t = recordTotals(r);
    totals.passed += t.passed;
    totals.unchecked += t.unchecked;
    totals.skipped += t.skipped;
    totals.failed += t.failed;

    for (const s of r.steps) {
      // Defensive against run records written before the escalation ladder
      // existed at all (no `level` field).
      levelCounts[s.level ?? 0]++;
      if (s.escalationAttempted !== undefined) {
        escalation.l1Attempted++;
        if (s.escalationAttempted === 2) escalation.l2Attempted++;
      }
      if (s.level === 1) escalation.l1Healed++;
      if (s.level === 2) escalation.l2Healed++;
      if (s.outcome === "failed") {
        const key = `Step ${s.n} — ${s.title}`;
        failureCounts.set(key, (failureCounts.get(key) ?? 0) + 1);
      }
    }
  }

  return {
    runs: records.length,
    passCount,
    passRate,
    firstMs: first.totals.ms,
    firstStartedAt: first.startedAt,
    latestMs: latest.totals.ms,
    latestStartedAt: latest.startedAt,
    totals,
    levelCounts,
    escalation,
    llmInputTokens,
    llmOutputTokens,
    failureCounts,
  };
}

async function cmdBench(args: ParsedArgs): Promise<number> {
  const skillPath = args.positional[0];
  if (!skillPath) {
    console.error("Usage: reelier bench <skill.md>");
    return 1;
  }

  let source: string;
  try {
    source = await readFile(skillPath, "utf8");
  } catch (err) {
    console.error(`Could not read skill file ${skillPath}: ${(err as Error).message}`);
    return 1;
  }

  let skill;
  try {
    skill = parseSkill(source);
  } catch (err) {
    if (err instanceof SkillParseError) {
      console.error(`Malformed skill in ${skillPath}: ${err.message}`);
      return 1;
    }
    throw err;
  }

  const recordPath = runRecordPathFor(process.cwd(), skill.name);
  let records: RunRecord[];
  try {
    records = await readRunRecords(recordPath);
  } catch (err) {
    console.error(`No run records found at ${recordPath}: ${(err as Error).message}`);
    return 1;
  }

  records = executionRecords(records);
  if (records.length === 0) {
    console.error(`Run record file ${recordPath} is empty`);
    return 1;
  }

  const summary = computeBenchSummary(records);

  console.log(`Bench: ${skill.name}`);
  console.log(`  runs:        ${summary.runs}`);
  console.log(`  pass rate:   ${summary.passRate}% (${summary.passCount}/${summary.runs})`);
  console.log(`  first run:   ${fmtDuration(summary.firstMs)} (${summary.firstStartedAt})`);
  console.log(`  latest run:  ${fmtDuration(summary.latestMs)} (${summary.latestStartedAt})`);
  // Honesty rule: "passed" here is ONLY steps that actually verified an
  // assertion — never lump unchecked in with it (that's the whole point of
  // the totals-honesty fix; see runner.ts StepOutcome/RunRecord.totals).
  console.log(
    `  steps:       passed=${summary.totals.passed} unchecked=${summary.totals.unchecked} skipped=${summary.totals.skipped} failed=${summary.totals.failed} (across all runs)`
  );
  console.log(
    `  step levels: L0=${summary.levelCounts[0]} L1=${summary.levelCounts[1]} L2=${summary.levelCounts[2]} (across all runs)`
  );
  console.log(
    `  escalation:  L1 attempted=${summary.escalation.l1Attempted} healed=${summary.escalation.l1Healed}  L2 attempted=${summary.escalation.l2Attempted} healed=${summary.escalation.l2Healed} (a step that burned tokens and still failed shows here)`
  );
  console.log(`  LLM tokens:  ${summary.llmInputTokens} in / ${summary.llmOutputTokens} out (no cost math — tokens only)`);
  if (summary.failureCounts.size > 0) {
    console.log(`  per-step failure counts:`);
    for (const [step, count] of summary.failureCounts) {
      console.log(`    ${step}: ${count}`);
    }
  } else {
    console.log(`  per-step failure counts: none`);
  }

  return 0;
}

/**
 * `reelier baseline <skill.md>` — F5 local run-shape priors, standalone and
 * read-only (docs/specs/run-shape-priors.md §6). Executes nothing, connects
 * to nothing, transmits nothing: it reads this repo's own
 * `.reelier/runs/<skill>.jsonl` and reports how the latest run sits against
 * the previous ones. Suitable for a cron, which is why it prints the whole
 * picture (a cron reading only exceptions cannot tell "nothing departed"
 * from "this never ran") and why a deviation exits 0 like everything else —
 * turning one into a non-zero exit would make it a gate, and this is a
 * recorder.
 *
 * Exit 1 is reserved for what the operator must fix: no skill argument, an
 * unreadable or malformed skill file, a missing or empty run-record file.
 */
async function cmdBaseline(args: ParsedArgs): Promise<number> {
  const skillPath = args.positional[0];
  if (!skillPath) {
    console.error("Usage: reelier baseline <skill.md>");
    return 1;
  }

  let source: string;
  try {
    source = await readFile(skillPath, "utf8");
  } catch (err) {
    console.error(`Could not read skill file ${skillPath}: ${(err as Error).message}`);
    return 1;
  }

  let skill;
  try {
    skill = parseSkill(source);
  } catch (err) {
    if (err instanceof SkillParseError) {
      console.error(`Malformed skill in ${skillPath}: ${err.message}`);
      return 1;
    }
    throw err;
  }

  const recordPath = runRecordPathFor(process.cwd(), skill.name);
  let records: RunRecord[];
  try {
    records = await readRunRecords(recordPath);
  } catch (err) {
    console.error(`No run records found at ${recordPath}: ${(err as Error).message}`);
    return 1;
  }
  if (records.length === 0) {
    console.error(`Run record file ${recordPath} is empty`);
    return 1;
  }

  // The real clock: this is the only surface where `silence` (time since the
  // latest run started) is a question anyone can meaningfully ask.
  for (const line of renderRunShapeReportLines(computeRunShape(records, { now: Date.now() }), skill.name)) {
    console.log(line);
  }
  return 0;
}

/** Skill names (run-record file stems) present under `.reelier/runs/` — used by `reelier cost` when no skill is named on the command line. Absent/empty directory is not an error (just no runs yet). */
async function listRunFileSkillNames(cwd: string): Promise<string[]> {
  const dir = path.join(cwd, ".reelier", "runs");
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  return entries.filter((f) => f.endsWith(".jsonl")).map((f) => f.slice(0, -".jsonl".length));
}

async function cmdCost(args: ParsedArgs): Promise<number> {
  const cwd = process.cwd();
  const skillArg = args.positional[0];

  let since: SinceFilter;
  try {
    since = parseSinceFlag(args.opts.since);
  } catch (err) {
    console.error((err as Error).message);
    return 1;
  }

  const skillNames = skillArg ? [skillArg] : await listRunFileSkillNames(cwd);
  if (skillNames.length === 0) {
    console.error(
      skillArg
        ? `No run records found for skill '${skillArg}' at ${path.join(cwd, ".reelier", "runs", `${skillArg}.jsonl`)}`
        : `No run records found under ${path.join(cwd, ".reelier", "runs")} — run 'reelier run <skill.md>' at least once first.`
    );
    return 1;
  }

  let table;
  try {
    table = await loadPriceTable();
  } catch (err) {
    console.error(`Could not load price table: ${(err as Error).message}`);
    return 1;
  }

  const rows: { skill: string; cost: ReturnType<typeof costRun> }[] = [];
  for (const name of skillNames) {
    const filePath = path.join(cwd, ".reelier", "runs", `${name}.jsonl`);
    let records: RunRecord[];
    try {
      records = await readRunRecords(filePath);
    } catch (err) {
      if (skillArg) {
        console.error(`No run records found at ${filePath}: ${(err as Error).message}`);
        return 1;
      }
      continue; // listRunFileSkillNames already found the file; a race/removal here just skips it
    }
    for (const record of records) {
      if (!withinSince(record.startedAt, since)) continue;
      rows.push({ skill: name, cost: costRun(record, table) });
    }
  }

  if (rows.length === 0) {
    console.log(`No runs found${since !== "all" ? ` in the last ${since}` : ""}.`);
    return 0;
  }

  console.log(`Cost: ${skillArg ?? "(all skills)"}${since !== "all" ? ` — last ${since}` : ""}`);
  console.log(
    `  ${"STARTED".padEnd(24)} ${"SKILL".padEnd(20)} ${"STEPS".padStart(5)} ${"TOK IN".padStart(9)} ${"TOK OUT".padStart(9)} ${"MODEL".padEnd(24)} ${"COST".padStart(12)}`
  );

  let totalSteps = 0;
  let totalIn = 0;
  let totalOut = 0;
  let totalUsd = 0;
  let zeroTokenCount = 0;
  const unpriceableModels = new Set<string>();

  for (const { skill, cost } of rows) {
    const modelsUsed = [...new Set(cost.steps.map((s) => s.model).filter((m): m is string => Boolean(m)))];
    const modelLabel = modelsUsed.length === 0 ? "-" : modelsUsed.length === 1 ? modelsUsed[0] : "mixed";
    const costLabel =
      cost.unpriceableModels.length > 0
        ? `n/a (unknown model: ${cost.unpriceableModels.join(", ")})`
        : formatUsd(cost.pricedUsd);
    console.log(
      `  ${cost.startedAt.padEnd(24)} ${skill.padEnd(20)} ${String(cost.totalSteps).padStart(5)} ${String(
        cost.totalInputTokens
      ).padStart(9)} ${String(cost.totalOutputTokens).padStart(9)} ${modelLabel.padEnd(24)} ${costLabel.padStart(12)}`
    );
    totalSteps += cost.totalSteps;
    totalIn += cost.totalInputTokens;
    totalOut += cost.totalOutputTokens;
    totalUsd += cost.pricedUsd;
    if (cost.isZeroTokenReplay) zeroTokenCount++;
    for (const m of cost.unpriceableModels) unpriceableModels.add(m);
  }

  console.log(
    `  ${"TOTAL".padEnd(24)} ${"".padEnd(20)} ${String(totalSteps).padStart(5)} ${String(totalIn).padStart(
      9
    )} ${String(totalOut).padStart(9)} ${"".padEnd(24)} ${formatUsd(totalUsd).padStart(12)}`
  );
  if (unpriceableModels.size > 0) {
    console.log(
      `  (total is PARTIAL — excludes tokens from unpriced model(s): ${[...unpriceableModels].join(
        ", "
      )}; add them to ${defaultPricesFilePath()} to include)`
    );
  }
  // The honest marketing sentence: only ever printed against runs whose OWN
  // record shows zero LLM tokens (a true deterministic replay) — never a
  // guess about what a run "would have" cost by any other measure.
  console.log(`  ${zeroTokenCount} of ${rows.length} run(s) replayed at $0.00 — pure deterministic replay, no LLM tokens.`);
  console.log(
    `  price table: bundled ${table.bundledRetrievedAt}${
      table.userFileLoaded ? ` + overrides from ${table.userFilePath}` : ""
    }`
  );

  return 0;
}

async function cmdPrices(args: ParsedArgs): Promise<number> {
  const sub = args.positional[0];

  if (sub === "update") {
    // v1 is explicitly non-auto-fetching (SPEC.md non-goal) — a wrong
    // silent price is a lie. This just surfaces freshness + the override
    // path; refreshing the bundled table itself is a manual code change.
    console.log(`Bundled price table: retrieved ${BUNDLED_PRICES_RETRIEVED_AT}`);
    console.log(
      `reelier never auto-fetches prices — 'prices update' only reports the bundled table's freshness above.`
    );
    console.log(`To use different rates, create/edit ${defaultPricesFilePath()}:`);
    console.log(`  version: 1`);
    console.log(`  models:`);
    console.log(`    <model-id>:`);
    console.log(`      inputPerMtok: <number>`);
    console.log(`      outputPerMtok: <number>`);
    console.log(`Run 'reelier prices' (no subcommand) to see the current merged table.`);
    return 0;
  }

  let table;
  try {
    table = await loadPriceTable();
  } catch (err) {
    console.error(`Could not load price table: ${(err as Error).message}`);
    return 1;
  }

  console.log(`Prices — bundled table retrieved ${table.bundledRetrievedAt}`);
  console.log(
    table.userFileLoaded
      ? `  overrides loaded from ${table.userFilePath} (${table.overriddenModels.length} model(s))`
      : `  no override file at ${table.userFilePath} — bundled table only`
  );
  console.log("");
  console.log(`  ${"MODEL".padEnd(28)} ${"IN $/Mtok".padStart(10)} ${"OUT $/Mtok".padStart(11)}  SOURCE`);
  for (const id of Object.keys(table.models).sort()) {
    const entry = table.models[id];
    const source = table.overriddenModels.includes(id) ? "override" : "bundled";
    console.log(
      `  ${id.padEnd(28)} ${String(entry.inputPerMtok).padStart(10)} ${String(entry.outputPerMtok).padStart(
        11
      )}  ${source}`
    );
  }
  return 0;
}

async function cmdMcp(args: ParsedArgs): Promise<number> {
  if (args.wraps.length === 0) {
    console.error(
      'Usage: reelier mcp --wrap "<command line>" [--wrap "<another>"] [--trace-dir <dir>]\n' +
        "  (this is the RECORDER — it fronts your OWN MCP server(s) so their calls can be captured into a " +
        "trace. To expose Reelier's own commands as tools instead, use 'reelier serve'.)"
    );
    return 1;
  }
  const traceDir = args.opts["trace-dir"] ?? path.join(process.cwd(), ".reelier", "traces");

  const downstreams: DownstreamConnection[] = [];
  try {
    for (const spec of args.wraps) {
      downstreams.push(await connectDownstream(spec));
    }
  } catch (err) {
    console.error(`Failed to connect --wrap downstream: ${(err as Error).message}`);
    await Promise.all(downstreams.map((d) => d.close().catch(() => {})));
    return 1;
  }

  // The seatbelt (flight-recorder-v1 spec §1) — loaded once at wrap start.
  // A malformed policy.yml degrades to deny-nothing (never bricks the
  // agent); the WARN is printed exactly once here, not per call.
  const allowWrites = args.flags.has("allow-writes");
  const policyResult = await loadPolicyForWrap(process.cwd(), os.homedir());
  for (const line of summarizePolicyForWrapStart(policyResult)) {
    console.error(line);
  }

  const server = buildProxyServer(downstreams, {
    traceDir,
    policy: policyResult.policy,
    // The four-state claim, not just the malformed case the old policyGap
    // marked. Built from the load result — whose digest is bound to the read
    // that produced the policy — so nothing here can re-read the file and
    // claim `verified` over bytes that never enforced anything (§2.1).
    policyRecord: policyRecordFromLoad(policyResult),
    allowWrites,
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await server.close().catch(() => {});
    await Promise.all(downstreams.map((d) => d.close().catch(() => {})));
  };

  await new Promise<void>((resolve) => {
    process.stdin.on("close", resolve);
    process.stdin.on("end", resolve);
    process.on("SIGINT", () => resolve());
    process.on("SIGTERM", () => resolve());
  });
  await shutdown();

  return 0;
}

/**
 * `reelier policy check [path]` — lint a policy.yml WITHOUT the wrap-time
 * fail-safe: every error is reported (unknown keys, bad globs, empty
 * rules, unknown `unless` flags), and a bad file exits 1. This is where
 * strictness lives (per the Prime Directive's split: wrap runtime fails
 * open, `policy check` is deliberately picky). Defaults to the project
 * path; falls back to the global path if the project file doesn't exist;
 * an explicit path argument overrides both.
 */
async function cmdPolicyCheck(args: ParsedArgs): Promise<number> {
  const explicit = args.positional[1];
  let targetPath: string;
  if (explicit) {
    targetPath = explicit;
  } else {
    const projectPath = path.join(process.cwd(), ".reelier", "policy.yml");
    if (await fileExists(projectPath)) {
      targetPath = projectPath;
    } else {
      targetPath = path.join(os.homedir(), ".reelier", "policy.yml");
    }
  }

  let source: string;
  try {
    source = await readFile(targetPath, "utf8");
  } catch (err) {
    console.error(`No policy file at ${targetPath} (${(err as Error).message})`);
    return 1;
  }

  const validation = parsePolicyStrict(source);
  if (validation.errors.length > 0) {
    console.error(`${targetPath}: ${validation.errors.length} error(s):`);
    for (const e of validation.errors) console.error(`  - ${e}`);
    return 1;
  }

  const policy = validation.policy!;
  const gateNote = policy.stateGate === "refuse" ? ", state_gate: refuse (run-path gate — fail-closed on pre-state mismatch/unevaluated)" : "";
  console.log(`${targetPath}: OK — ${policy.deny.length} deny rule(s), ${policy.dryRun.length} dry-run rule(s)${gateNote}`);
  if (hasEndpointRules(policy)) {
    console.log(ENDPOINT_RULE_NOTE);
  }
  return 0;
}

async function cmdPolicy(args: ParsedArgs): Promise<number> {
  const sub = args.positional[0];
  if (sub === "check") {
    return cmdPolicyCheck(args);
  }
  console.error('Usage: reelier policy check [path]  (defaults to .reelier/policy.yml, falling back to ~/.reelier/policy.yml)');
  return 1;
}

/**
 * `reelier serve` — the AGENT-NATIVE tool-server. Exposes Reelier's OWN
 * commands (scan, from-session, replay, push) as MCP tools an agent can
 * call mid-session. This is the OPPOSITE of `reelier mcp`: that command is
 * the recorder — it fronts *other* MCP servers (via --wrap) to capture
 * their calls. `reelier serve` takes no --wrap; it's Reelier fronting
 * itself. See src/serve.ts for the tool list + schemas.
 */
export async function cmdServe(args: ParsedArgs): Promise<number> {
  const workspace = args.opts.workspace;
  let workspaceRoot: string | undefined;
  if (workspace !== undefined) {
    if (!path.isAbsolute(workspace)) {
      console.error(
        `--workspace must be an absolute path, got '${workspace}' — a relative workspace re-introduces the ` +
          `cwd ambiguity the flag exists to remove (a plugin host launches this server with the PLUGIN directory as cwd).`
      );
      return 1;
    }
    let isDirectory = false;
    try {
      isDirectory = (await stat(workspace)).isDirectory();
    } catch {
      // fall through — reported below
    }
    if (!isDirectory) {
      console.error(`--workspace '${workspace}' is not an existing directory.`);
      return 1;
    }
    workspaceRoot = workspace;
  }
  const server = buildToolServer({ workspaceRoot });
  const transport = new StdioServerTransport();
  await server.connect(transport);

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await server.close().catch(() => {});
  };

  await new Promise<void>((resolve) => {
    process.stdin.on("close", resolve);
    process.stdin.on("end", resolve);
    process.on("SIGINT", () => resolve());
    process.on("SIGTERM", () => resolve());
  });
  await shutdown();

  return 0;
}

/**
 * `reelier ci [--force] [--path <dir>]` — writes
 * `.github/workflows/reelier-replay.yml` so a repo gets drift-CI (replay
 * every discovered skill on every PR + a daily schedule) and the sticky PR
 * receipt comment in one command. `--path` overrides the skill-discovery
 * root only — the workflow file itself always lands under the CURRENT
 * working directory's `.github/workflows/`, matching every other
 * repo-relative write this CLI does (compile, manifest, approve).
 */
async function cmdCi(args: ParsedArgs): Promise<number> {
  const cwd = process.cwd();
  const scanRoot = args.opts.path ? path.resolve(cwd, args.opts.path) : cwd;
  const force = args.flags.has("force");

  const result = await writeCiWorkflow(cwd, scanRoot, force);

  if (result.refused) {
    console.error(
      `${result.path} already exists — refusing to overwrite it without --force. ` +
        `Pass --force to regenerate it (this replaces the whole file, including any manual edits).`
    );
    return 1;
  }

  console.log(`Wrote ${result.path}`);
  if (result.skillPaths.length === 0) {
    console.log(`  no *.skill.md files found under ${scanRoot} — wrote a placeholder skill path (${PLACEHOLDER_SKILL_PATH}).`);
    console.log("  Record a skill first: reelier init  (or reelier mcp --wrap \"<your mcp server>\" + reelier compile)");
    console.log(`  then edit the workflow's matrix to point at it, and re-run 'reelier ci --force' to pick up more later.`);
  } else {
    console.log(`  discovered ${result.skillPaths.length} skill(s):`);
    for (const s of result.skillPaths) console.log(`    - ${s}`);
  }
  console.log("");
  console.log("Next steps:");
  console.log(`  1. Commit ${path.relative(cwd, result.path)}`);
  console.log("  2. (Optional) Add a REELIER_API_KEY secret in this repo's Settings > Secrets to push receipts to your ledger.");
  console.log("  3. Open a PR — it will get a Reelier receipt comment automatically.");

  return 0;
}

async function cmdDiff(args: ParsedArgs): Promise<number> {
  const skill = args.positional[0];
  if (!skill) {
    console.error(
      "Usage: reelier diff <skill-name> [--cwd <dir>]\n" +
        "  Compares the last two runs in .reelier/runs/<skill>.jsonl and reports SAME or DRIFTED.\n" +
        "  Exit code is 0 when it ran the same, 1 on drift — so it gates a scheduled replay."
    );
    return 1;
  }

  const result = await runDiffTool({ skill, cwd: args.opts.cwd });
  if (!result.ok) {
    console.error(result.reason);
    return 1;
  }

  const d = result.diff;
  if (d.verdict === "skill-mismatch") {
    console.error(d.summary);
    return 1;
  }

  for (const s of d.steps) {
    const mark = s.kind === "same" ? "  =" : s.kind === "healed-differently" ? "  ~" : "  ✗";
    console.log(`${mark} ${s.note}`);
  }
  console.log("");
  console.log(d.verdict === "same" ? `✓ ${d.summary}` : `⚠ ${d.summary}`);
  return d.verdict === "same" ? 0 : 1;
}

async function cmdTrace(args: ParsedArgs): Promise<number> {
  const tracePath = args.positional[0];
  if (!tracePath) {
    console.error("Usage: reelier trace <trace.jsonl>");
    return 1;
  }

  let source: string;
  try {
    source = await readFile(tracePath, "utf8");
  } catch (err) {
    console.error(`Could not read trace file ${tracePath}: ${(err as Error).message}`);
    return 1;
  }

  let records;
  try {
    records = parseTraceLines(source);
  } catch (err) {
    console.error(`Malformed trace file ${tracePath}: ${(err as Error).message}`);
    return 1;
  }

  for (const line of formatTrace(records)) {
    console.log(line);
  }

  // `--provenance` ADDS a block; it never replaces or reshapes the trace output
  // above, so `reelier trace` without the flag stays byte-identical to the
  // release before this existed (docs/specs/argument-provenance-v1.md; pinned by
  // test/provenance-cli.test.ts). It is read-only and gates nothing: this
  // command's exit code does not move for any provenance state (§2, rule 4).
  if (args.flags.has("provenance")) {
    console.log("");
    for (const line of formatProvenance(analyzeTrace(records))) {
      console.log(line);
    }
  }
  return 0;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * `--from-skill` never generates steps — that would be guessing, and a wrong
 * guess replayed deterministically is a lie with a receipt. So when there is
 * no recorded trace to compile from, the only honest answer is "record one",
 * with the exact commands to do it.
 */
const FROM_SKILL_NO_TRACE_HELP = [
  "--from-skill needs a recorded run to compile from — Reelier never generates steps from instruction text.",
  "Record one first:",
  '  1. Put the recorder in front of your agent\'s tools:  reelier mcp --wrap "<your mcp server command>"',
  "  2. Have the agent run the skill's task once — every tool call lands in a trace (.jsonl).",
  "  3. Compile it:  reelier compile <trace.jsonl> --from-skill <SKILL.md>",
  "Or start from a session you already recorded: `reelier scan` lists replayable ones.",
];

async function cmdCompile(args: ParsedArgs): Promise<number> {
  const fromSkillPath = args.opts["from-skill"];
  const tracePath = args.positional[0];
  if (!tracePath) {
    if (fromSkillPath) {
      for (const line of FROM_SKILL_NO_TRACE_HELP) console.error(line);
      return 1;
    }
    console.error("Usage: reelier compile <trace.jsonl> [-o <out.skill.md>] [--force] [--from-skill <SKILL.md>]");
    return 1;
  }

  let source: string;
  try {
    source = await readFile(tracePath, "utf8");
  } catch (err) {
    console.error(`Could not read trace file ${tracePath}: ${(err as Error).message}`);
    if (fromSkillPath) {
      for (const line of FROM_SKILL_NO_TRACE_HELP) console.error(line);
    }
    return 1;
  }

  let records;
  try {
    records = parseTraceLines(source);
  } catch (err) {
    console.error(`Malformed trace file ${tracePath}: ${(err as Error).message}`);
    return 1;
  }

  let result = compile(records);
  const traceFileName = path.basename(tracePath);

  let fromSkill: FromSkillProvenance | undefined;
  if (fromSkillPath) {
    let skillSource: string;
    try {
      skillSource = await readFile(fromSkillPath, "utf8");
    } catch (err) {
      console.error(`Could not read --from-skill file ${fromSkillPath}: ${(err as Error).message}`);
      return 1;
    }
    let fm;
    try {
      fm = parseInstructionSkillFrontmatter(skillSource);
    } catch (err) {
      console.error(`--from-skill ${fromSkillPath}: ${(err as Error).message}`);
      return 1;
    }
    if (args.opts.o && path.resolve(args.opts.o) === path.resolve(fromSkillPath)) {
      console.error(`Refusing to write the compiled skill over its own source ${fromSkillPath} — pass a different -o.`);
      return 1;
    }
    let name = fm.name;
    if (!args.opts.o) {
      // Default output is `<name>.skill.md` in cwd. Never overwrite an
      // existing file via the carried name — suffix the name instead
      // (-2, -3, ...), so the source instruction skill and any earlier
      // compile stay byte-identical.
      let candidate = name;
      let suffix = 2;
      while (await fileExists(path.join(process.cwd(), `${candidate}.skill.md`))) {
        if (suffix > 99) {
          console.error(
            `Could not find a free name for ${name}.skill.md after 99 suffix attempts — pass -o <out.skill.md> explicitly.`
          );
          return 1;
        }
        candidate = `${name}-${suffix++}`;
      }
      if (candidate !== name) {
        console.log(`Name '${name}' collides with existing ${name}.skill.md — compiled skill is named '${candidate}'.`);
      }
      name = candidate;
    }
    result = { ...result, name };
    fromSkill = { sourceFileName: path.basename(fromSkillPath), description: fm.description };
  }

  const rendered = renderSkillMd(result, traceFileName, fromSkill);

  // Sanity check: the compiler must always produce a skill its own parser accepts.
  try {
    parseSkill(rendered);
  } catch (err) {
    console.error(`Internal error: compiled skill failed to round-trip through the skill parser: ${(err as Error).message}`);
    return 1;
  }

  const outPath = args.opts.o ?? path.join(process.cwd(), `${result.name}.skill.md`);

  if (!args.flags.has("force") && (await fileExists(outPath))) {
    console.error(`Refusing to overwrite existing file ${outPath} — pass --force to overwrite.`);
    return 1;
  }

  await writeFile(outPath, rendered, "utf8");

  console.log(`Wrote ${outPath}`);
  if (fromSkill) {
    console.log(
      `  compiled from ${fromSkill.sourceFileName} + ${traceFileName} (name + description carried; steps from the trace only)`
    );
  }
  console.log(`  steps:   ${result.stats.steps}`);
  console.log(`  asserts: ${result.stats.asserts}`);
  console.log(`  binds:   ${result.stats.binds}`);
  console.log(
    `  effects: read=${result.stats.effects.read} idempotent-write=${result.stats.effects["idempotent-write"]} destructive=${result.stats.effects.destructive}`
  );
  console.log("");
  if (result.openQuestions.length === 0) {
    console.log("Open questions: (none)");
  } else {
    console.log(`Open questions (${result.openQuestions.length}):`);
    for (const oq of result.openQuestions) {
      const where = oq.stepN !== undefined ? `Step ${oq.stepN}` : "(trailing note)";
      console.log(`  - ${where}: ${oq.text}`);
    }
  }

  return 0;
}


/**
 * `reelier resolve <skill.md> --wrap "…"` — resolve deferred attestations
 * (docs/specs/artifact-attestation-v1.md §8).
 *
 * A deferred probe (`attest.defer`) records `confidence: "pending"` at dispatch
 * because the provider's record — a message-id row, an event API entry, a
 * bounce/delivery webhook landing — does not exist yet. This walks the ledger,
 * probes for the ones that may exist by now, and appends the answer.
 *
 * It is a POLLING command an operator or CI runs, never a listener: the CLI has
 * no inbound HTTP surface and no daemon, and pretending otherwise would be a
 * capability claim the package cannot honour.
 *
 * Two rules do the real work:
 *
 *  1. **A resolution is a SECOND record, never an amendment.** Run records
 *     carry no id, the ledger has one append-only writer, and the cloud exposes
 *     only POST over hash-chained rows. The original stays byte-identical.
 *  2. **Nothing is written for an attestation that did not move.** A probe that
 *     has not resolved and whose deadline has not passed appends NOTHING —
 *     otherwise the ledger grows a record per invocation and the next scan
 *     starts reading this command's own output.
 */
export async function cmdResolve(
  args: ParsedArgs,
  connect: (spec: string) => Promise<DownstreamConnection> = connectDownstream,
  deps: { cwd?: string; now?: number; env?: NodeJS.ProcessEnv; homedir?: string } = {}
): Promise<number> {
  const skillPath = args.positional[0];
  if (!skillPath) {
    console.error('Usage: reelier resolve <skill.md> --wrap "<command>" [--wrap ...] [--var name=value ...]');
    return 1;
  }
  let skill: Skill;
  try {
    skill = parseSkill(await readFile(skillPath, "utf8"));
  } catch (err) {
    console.error(`Could not read ${skillPath}: ${(err as Error).message}`);
    return 1;
  }

  const cwd = deps.cwd ?? process.cwd();
  const recordPath = runRecordPathFor(cwd, skill.name);
  let records: RunRecord[];
  try {
    records = await readRunRecords(recordPath);
  } catch (err) {
    console.error(`Could not read the run ledger at ${recordPath}: ${(err as Error).message}`);
    return 1;
  }

  const unresolved = selectUnresolved(records);
  if (unresolved.length === 0) {
    console.log(`${skill.name}: no deferred attestations awaiting resolution.`);
    return 0;
  }

  // --wrap is required for the same reason `reelier manifest` requires it: a
  // probe has to reach a live server, and there is nothing honest to do
  // without one. Checked AFTER the ledger scan so "nothing to resolve" never
  // reports as a usage error.
  if (args.wraps.length === 0) {
    console.error(
      `${skill.name}: ${unresolved.length} deferred attestation(s) awaiting resolution, but no --wrap was given.
` +
        'A probe needs a live server to reach. Usage: reelier resolve <skill.md> --wrap "<command>"'
    );
    return 1;
  }

  const downstreams: DownstreamConnection[] = [];
  try {
    for (const spec of args.wraps) downstreams.push(await connect(spec));
    if (skill.manifest) {
      const { ok, drifts } = preflightManifest(skill.manifest, downstreams);
      if (!ok) {
        console.error("MANIFEST DRIFT — refusing deferred resolution probe (fail closed):");
        for (const drift of drifts) {
          const liveTag = drift.live !== undefined ? ` live ${drift.live}` : "";
          console.error(`  ✗ ${drift.name} — recorded ${drift.recorded}${liveTag} (${drift.note})`);
        }
        return 1;
      }
    }
    const tools = buildWrappedToolRegistry(downstreams);
    if (tools === undefined) {
      console.error("No downstream tools available.");
      return 1;
    }
    // Probes are read-effect by construction (runProbe enforces it), so no
    // write permission is granted here and none is needed.
    const ctx: ToolContext = { allowDestructive: false };
    const now = deps.now ?? Date.now();
    const startedAt = now;
    const resolutions: { pending: PendingAttestation; attest: StepAttest }[] = [];
    let integrityFailures = 0;
    let expectStore: Awaited<ReturnType<typeof readKeystore>> | undefined;
    let expectStoreLoaded = false;

    for (const pending of unresolved) {
      const step = skill.steps.find((st: Step) => st.n === pending.step);
      const decl = step?.attest;
      if (step === undefined || decl === undefined) {
        // The skill no longer declares a probe for that step. Skipped rather
        // than guessed: the ledger names a tool, but the args and projection
        // that made the observation meaningful are gone.
        console.log(`  step ${pending.step}: skipped — the skill no longer declares an attest for it`);
        integrityFailures += 1;
        continue;
      }

      const currentApproval = computeApprovalHash({
        actionTool: step.actionTool,
        actionArgs: step.actionArgs,
        attest: step.attest,
        expect: step.expect,
        emit: step.emit,
      });
      if (step.approve !== pending.approvalHash || currentApproval !== pending.approvalHash) {
        console.error(
          `  step ${pending.step}: refused — the current skill no longer matches the approval recorded at dispatch; no probe ran and no resolution can be claimed`
        );
        integrityFailures += 1;
        continue;
      }

      const parameterized = collectPlaceholders(decl.args).length > 0;
      if (parameterized) {
        if (step.expect?.probeArgs === undefined) {
          console.error(
            `  step ${pending.step}: refused — parameterized deferred probe args have no expect.probeArgs commitment; no probe ran`
          );
          integrityFailures += 1;
          continue;
        }
        let filledProbeArgs: unknown;
        try {
          filledProbeArgs = fillTemplate(decl.args, args.vars, now);
          if (!expectStoreLoaded) {
            expectStoreLoaded = true;
            const keystorePath = resolveKeystorePath(deps.env ?? process.env, deps.homedir ?? os.homedir());
            expectStore = await readKeystore(keystorePath);
          }
          const key = expectStore === undefined ? undefined : loadExpectKey(expectStore, step.expect.keyId);
          if (key === undefined || probeArgsMac(key, decl.tool, filledProbeArgs) !== step.expect.probeArgs) {
            throw new Error("filled probe args do not match the approved commitment");
          }
        } catch (err) {
          console.error(`  step ${pending.step}: refused — ${(err as Error).message}; no probe ran`);
          integrityFailures += 1;
          continue;
        }
      }
      const probe = await runProbe(decl, tools, args.vars, ctx, now, DEFAULT_PROBE_TIMEOUT_MS);
      const attest = resolveDeferred(
        pending,
        probe.ok ? { ok: true, projected: probe.projected } : { ok: false, reason: probe.reason },
        now
      );
      // Rule 2: only an attestation that actually moved earns a record.
      if (attest.confidence === "pending") {
        console.log(`  step ${pending.step}: still pending (due ${pending.deferredUntil}) — nothing written`);
        continue;
      }
      console.log(`  step ${pending.step}: ${attest.confidence} (was due ${pending.deferredUntil})`);
      resolutions.push({ pending, attest });
    }

    const record = buildResolutionRecord(skill.name, resolutions, startedAt, deps.now ?? Date.now());
    if (record === undefined) {
      console.log(`${skill.name}: nothing resolved this pass.`);
      return integrityFailures > 0 ? 1 : 0;
    }
    await appendFile(recordPath, `${JSON.stringify(record)}
`, "utf8");
    console.log(`${skill.name}: appended ${resolutions.length} resolution(s) to ${recordPath}`);
    return integrityFailures > 0 ? 1 : 0;
  } finally {
    for (const d of downstreams) await d.close().catch(() => {});
  }
}

/**
 * `reelier manifest <skill.md> --wrap "…"` — stamp/refresh a skill's tool
 * manifest from LIVE downstreams (docs/specs/flight-recorder-v2.md §1).
 * Covers hand-authored skills (no trace to inherit a manifest from) and the
 * legitimate-upgrade path after an intentional tool change.
 *
 * `connect` is injectable (defaults to the real `connectDownstream`, which
 * spawns a subprocess) so tests can drive this against an in-process fake
 * DownstreamConnection instead — same reasoning as cmdPush's fetch override.
 */
export async function cmdManifest(
  args: ParsedArgs,
  connect: (spec: string) => Promise<DownstreamConnection> = connectDownstream
): Promise<number> {
  const skillPath = args.positional[0];
  if (!skillPath) {
    console.error("Usage: reelier manifest <skill.md> --wrap \"<command>\" [--wrap ...]");
    return 1;
  }
  if (args.wraps.length === 0) {
    console.error("reelier manifest needs --wrap to reach live servers");
    return 1;
  }

  let source: string;
  try {
    source = await readFile(skillPath, "utf8");
  } catch (err) {
    console.error(`Could not read skill file ${skillPath}: ${(err as Error).message}`);
    return 1;
  }

  let skill;
  try {
    skill = parseSkill(source);
  } catch (err) {
    if (err instanceof SkillParseError) {
      console.error(`Malformed skill in ${skillPath}: ${err.message}`);
      return 1;
    }
    throw err;
  }

  const downstreams: DownstreamConnection[] = [];
  try {
    for (const spec of args.wraps) {
      downstreams.push(await connect(spec));
    }

    const oldByName = new Map((skill.manifest?.tools ?? []).map((t) => [t.name, t.digest]));
    const newManifest = buildManifestForSkill(skill, downstreams);
    const newByName = new Map(newManifest.tools.map((t) => [t.name, t.digest]));

    const allNames = [...new Set([...oldByName.keys(), ...newByName.keys()])].sort();
    for (const name of allNames) {
      const oldDigest = oldByName.get(name);
      const newDigest = newByName.get(name);
      if (oldDigest === undefined && newDigest !== undefined) {
        console.log(`  added     ${name} ${newDigest}`);
      } else if (oldDigest !== undefined && newDigest === undefined) {
        console.log(`  removed   ${name} ${oldDigest}`);
      } else if (oldDigest === newDigest) {
        console.log(`  unchanged ${name} ${newDigest}`);
      } else {
        console.log(`  updated   ${name} ${oldDigest} -> ${newDigest}`);
      }
    }

    skill.manifest = newManifest;
    const rendered = serializeSkill(skill);
    await writeFileAtomic(skillPath, rendered);
    console.log(`Wrote manifest to ${skillPath} (${newManifest.tools.length} tool(s))`);
    return 0;
  } catch (err) {
    console.error(`Failed to connect --wrap downstream: ${(err as Error).message}`);
    return 1;
  } finally {
    await Promise.all(downstreams.map((d) => d.close().catch(() => {})));
  }
}

/**
 * A step whose effect requires the approval/legacy-flag gate at replay
 * (src/runner.ts's executeStep). Classifies on `step.effect` alone — the
 * runtime gate falls back to `tool.effect` when a step omits `effect`
 * (`step.effect ?? tool.effect`), but `parseSkill` currently REQUIRES an
 * explicit `effect:` on every step (src/skill.ts), so that fallback is
 * unreachable here. If `effect:` is ever made optional, this function would
 * need the same `?? tool.effect` fallback (a live DownstreamConnection/Tool
 * registry, not available offline) or it would silently skip approving a
 * tool-effect write (fr2-slice2-review.md #6, documented-only — no behavior
 * change).
 */
function isWriteEffectStep(step: Step): boolean {
  return step.effect === "idempotent-write" || step.effect === "destructive";
}

/**
 * `reelier approve <skill.md> [--all]` — hash-bind approval onto each
 * write/destructive step (docs/specs/flight-recorder-v2.md §2): the final
 * boundary a write crosses at replay, replacing the blanket
 * `--allow-writes`/`--yes` flags. Runs entirely offline (approval binds only
 * tool + args template — see src/approval.ts's doc comment on why `server`
 * is deliberately excluded).
 */
/** Projection fields that every write mutates (version-class). An expect binding over one self-invalidates after its own first run — warn-only lint, spec §6.1.2 (fixed-point rule). */
const EXPECT_VOLATILE_FIELDS = ["version", "etag", "revision", "sha", "updated_at"] as const;

/** Collect `{{placeholder}}` names from string leaves of a JSON-like value (the fillTemplate hole grammar, src/runner.ts). */
function collectPlaceholders(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    for (const m of value.matchAll(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*|today[+-]\d+d)\s*\}\}/g)) {
      out.push(m[1]);
    }
    return out;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectPlaceholders(v, out);
    return out;
  }
  if (value !== null && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) collectPlaceholders(v, out);
  }
  return out;
}

function isComputedDateName(name: string): boolean {
  return name === "today" || /^today[+-]\d+d$/.test(name);
}

/**
 * I-18 blocker 1 (wave-3 review — blocking): the downgrade to a shape-only
 * approval (dropping `expect`, whether via `--drop-expect` or the interactive
 * "Approve WITHOUT state binding?" prompt) must REFUSE outright on a step
 * whose `attest.args` are parameterized. The runner's probeArgs gate
 * (src/runner.ts's I-18) keys on `expect.probeArgs !== undefined` — strip
 * `expect` from a step whose attest is still armed (attest present, approved)
 * and the probe is left ungated: it fills from the WHOLE bindings map again,
 * the exact exfiltration channel W3-S4 closed. Never a new counter — this
 * reuses the existing `skippedStateBoundChanged` skip/count path so `--all`
 * degrades the same way every other never-silently-downgrade class does.
 */
const PARAMETERIZED_PROBE_DROP_REFUSAL =
  "refusing to drop the binding on a parameterized probe — its args fill from run-time bindings, and without expect.probeArgs nothing proves the filled args were approved. Re-approve with --probe --var, or make the probe args literal.";

/**
 * W3-S5's `status.code` + MCP refusal (A12): MCP has no HTTP status, so
 * `mcpResultToObservation` fabricates `isError ? 500 : 200`, and an isError
 * result flows through as a SUCCESSFUL observation — a binding stamped at
 * 500 would MATCH on every future error. THE SAME STRING everywhere this
 * predicate is checked (I-18 blocker 4, wave-3 review): first-time bind
 * (the structural-unbindability block below) AND re-verify/`--rebind` on an
 * already-bound step (hoisted ahead of that branch — see the call site).
 * Never forked; a second copy is how the two checks drift apart silently.
 */
function mcpStatusCodeRefusal(tool: string): string {
  return `'status.code' cannot be state-bound through the MCP tool '${tool}' — MCP has no HTTP status, so an isError result is fabricated as 500 and flows through as a successful observation (A12): a binding stamped at 500 would MATCH on every future error. Use a read that reifies absence into a body field, or probe over http`;
}

/** `hmac-sha256:9f31…77aa` — enough to eyeball, never needed for anything else (the full value lands in the file). */
function abbrevMac(mac: string): string {
  const hex = mac.slice("hmac-sha256:".length);
  return `hmac-sha256:${hex.slice(0, 4)}…${hex.slice(-4)}`;
}

/**
 * Projection field names are skill-author-controlled text that lands on the
 * consent transcript — a name embedding \n or ANSI escapes could forge the
 * very ceremony lines the approver reads before saying yes (review finding).
 * Clean names print bare; anything else prints JSON-escaped.
 */
function safeFieldName(name: string): string {
  return /^[\w.$-]+$/.test(name) ? name : JSON.stringify(name);
}

/**
 * W3-S3 (wave3 §3, P1.5 review N11 — "free diagnosis left on the table"):
 * when a `--probe` re-verify finds the world has moved, recompute the
 * per-field MACs it already holds and name what actually moved. Terminal
 * output only — no record, no receipt, no persisted claim.
 *
 * Two claims, deliberately distinct labels:
 *
 * - `fields changed since approval` — the phrase P1.5 already ships on the
 *   runner's mismatch render (src/attest-render.ts) and W3-S1 mirrors onto
 *   the cloud. Same label because it is the same claim, earned the same way:
 *   per-field MAC inequality under the held key proves the committed value
 *   differs. One claim, one label, wherever an operator meets it.
 * - `committed fields absent at re-verify` — its own label, because it is a
 *   DIFFERENT claim from the runner's `declared fields absent at execute`.
 *   A1 forbids the runner from asserting approve-time presence (the opaque
 *   whole MAC hides it). Here it is honest: `expect.fields`' key set IS the
 *   approve-time projected-field set, disclosed in the committed skill file
 *   by P1.5's accepted-disclosure record. Naming it "since approval" would
 *   quietly borrow the other claim's wording for a different fact.
 *
 * Silent on a fieldless (pre-P1.5) binding: there is no per-field evidence,
 * and a diagnosis nothing earned is exactly what this codebase must never
 * print. Each line prints only when non-empty, so an all-absence divergence
 * names no change (and vice versa) — never an empty claim.
 *
 * ABSENCE IS EARNED, NOT INFERRED (review finding — blocking). The projected
 * map drops present-but-unprojectable data: a `null`/object/array value, a
 * header present but empty, and — for EVERY body field at once — a body that
 * did not parse. Reading "missing from the projection" as "absent from the
 * world" asserts a fact the observation in hand disproves, and it asserts it
 * to an operator standing at a re-bind consent prompt. So the three outcomes
 * are separated against the RAW observation and worded for what each one
 * establishes: gone, not established, or not projected by this step at all.
 *
 * Stated limitation, and a product choice rather than a constraint (review
 * finding): a field present now but not committed at approve appears in no
 * line. `expect.fields`' key set is the disclosed approve-time projected set,
 * so naming such a field WOULD be earned — the same premise that licenses the
 * absence line. It is left unbuilt because it is new copy this slice did not
 * scope, not because A1 forbids it.
 */
function reportReVerifyDiagnosis(
  step: Step,
  key: Uint8Array,
  typed: Record<string, string | number | boolean>,
  obs: { body: string; headers: Record<string, string> }
): void {
  const committed = step.expect?.fields;
  if (committed === undefined) return;
  const projection = step.attest?.projection ?? [];
  // Only a name the declared projection actually addresses can have been
  // committed by any approve run. `expect.fields` is hand-editable and the
  // absent branch runs no MAC comparison, so without this intersection a
  // planted entry prints as a committed field on the consent transcript.
  const declared = new Set(projection.map(typedKeyFor));
  const { unprojectable } = projectionMisses(obs, projection);
  const changed: string[] = [];
  const absent: string[] = [];
  const notEstablished: string[] = [];
  const unbacked: string[] = [];
  // Object.entries reads own enumerable keys only; the `typed` lookup below
  // is an own-property read for the same reason the runner's is — a fields
  // entry named "constructor"/"toString" would otherwise read through
  // Object.prototype and land a fabricated name on the consent transcript.
  for (const [name, recorded] of Object.entries(committed)) {
    if (!declared.has(name)) {
      unbacked.push(name);
      continue;
    }
    const liveValue = Object.prototype.hasOwnProperty.call(typed, name) ? typed[name] : undefined;
    if (liveValue === undefined) {
      (unprojectable.has(name) ? notEstablished : absent).push(name);
      continue;
    }
    if (!macEquals(expectFieldMac(key, step.attest!.tool, name, liveValue), recorded)) changed.push(name);
  }
  const render = (names: string[]): string =>
    names
      .slice(0, ABSENT_FIELDS_MAX)
      .map((n) => safeFieldName(n.slice(0, ABSENT_FIELD_NAME_MAX)))
      .join(", ");
  if (changed.length > 0) {
    console.log(`  fields changed since approval: ${render(changed)}`);
  }
  if (absent.length > 0) {
    console.log(`  committed fields absent at re-verify: ${render(absent)}`);
  }
  if (notEstablished.length > 0) {
    console.log(`  committed fields the probe could not project at re-verify: ${render(notEstablished)}`);
  }
  if (unbacked.length > 0) {
    console.log(`  note: the binding commits fields this step never projects: ${render(unbacked)}`);
  }
}

/**
 * Injectable seams for cmdApprove — same reasoning as cmdRun's `connect`
 * override: tests drive the probe flow against in-process fakes, no
 * subprocess, no real stdin, no real home directory.
 */
export interface ApproveDeps {
  connect?: (spec: string) => Promise<DownstreamConnection>;
  /** Test override: the probe tool registry, bypassing --wrap wiring entirely. */
  tools?: Record<string, Tool>;
  env?: Record<string, string | undefined>;
  homedir?: string;
  /** Test override for interactive prompts; default builds a readline over stdin. */
  ask?: (question: string) => Promise<string>;
  /** A2: projected VALUES print only when stdout is a TTY and never under --all (CI logs are retained artifacts). */
  isTTY?: boolean;
  now?: () => number;
  /** --prune-keys scan root (defaults to process.cwd()). */
  cwd?: string;
}

/**
 * Recursively collect every 16-hex keyId referenced by any `expect:` line in
 * *.md files under `root`. Skips node_modules/.git/dist/dist-test/.stryker-tmp
 * trees; follows symlinks (visited-realpath set guards cycles — a symlinked
 * skills/ dir must still protect its keys); regex scan, not a full parse — a
 * half-broken skill file must still protect its keys. The scan must therefore
 * be at LEAST as forgiving as the parser (review finding): the parser accepts
 * any JSON spacing and the filesystem may be case-insensitive, so the regex
 * tolerates whitespace around the colon and the .md match ignores case —
 * missing a live reference here deletes an unrecoverable key.
 */
async function collectReferencedKeyIds(root: string): Promise<Set<string>> {
  const referenced = new Set<string>();
  const SKIP = new Set(["node_modules", ".git", "dist", "dist-test", ".stryker-tmp"]);
  const visited = new Set<string>();
  const scanFile = async (file: string): Promise<void> => {
    try {
      const text = await readFile(file, "utf8");
      for (const m of text.matchAll(/"keyId"\s*:\s*"([0-9a-f]{16})"/g)) referenced.add(m[1]);
    } catch {
      // unreadable file: skip — an unreadable skill must not orphan its key
    }
  };
  const walk = async (dir: string): Promise<void> => {
    let real: string;
    try {
      real = await realpath(dir);
    } catch {
      return;
    }
    if (visited.has(real)) return;
    visited.add(real);
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // unreadable dir: skip, never crash a prune over permissions
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      let isDir = entry.isDirectory();
      let isFile = entry.isFile();
      if (entry.isSymbolicLink()) {
        try {
          const st = await stat(full); // follows the link
          isDir = st.isDirectory();
          isFile = st.isFile();
        } catch {
          continue; // broken link: nothing to protect behind it
        }
      }
      if (isDir) {
        if (!SKIP.has(entry.name)) await walk(full);
      } else if (isFile && entry.name.toLowerCase().endsWith(".md")) {
        await scanFile(full);
      }
    }
  };
  await walk(root);
  return referenced;
}

/** `reelier approve --prune-keys [--all]` (P1.5, wave2 §3.4's named follow-up) — see the dispatch in cmdApprove. */
async function cmdPruneKeys(args: ParsedArgs, deps: ApproveDeps): Promise<number> {
  const now = deps.now ?? (() => Date.now());
  // Captured BEFORE the store read: the keystore mutation later refuses to
  // delete anything minted after this instant (review finding — a concurrent
  // approve's mint order is keystore-entry-then-skill-file, §4.2.4).
  const scanStart = new Date(now()).toISOString();
  const keystorePath = resolveKeystorePath(deps.env ?? process.env, deps.homedir ?? os.homedir());
  const store = await readKeystore(keystorePath);
  const keyIds = Object.keys(store.keys);
  if (keyIds.length === 0) {
    console.log(`no keys in ${keystorePath} — nothing to prune`);
    return 0;
  }
  const root = deps.cwd ?? process.cwd();
  const referenced = await collectReferencedKeyIds(root);
  const orphans = keyIds.filter((id) => !referenced.has(id));
  if (orphans.length === 0) {
    console.log(`${keyIds.length} key(s) in ${keystorePath}, all referenced by skills under ${root} — nothing to prune`);
    return 0;
  }
  console.log(`${orphans.length} of ${keyIds.length} key(s) in ${keystorePath} are referenced by no skill under ${root}:`);
  for (const id of orphans) {
    const entry = store.keys[id];
    const hint = entry.skill !== undefined ? ` (minted for ${entry.skill}${entry.step !== undefined ? ` step ${entry.step}` : ""})` : "";
    console.log(`  ${id} — created ${entry.createdAt}${hint}`);
  }
  let yes = args.flags.has("all");
  if (!yes) {
    const rl = deps.ask === undefined ? createInterface({ input: process.stdin, output: process.stdout }) : undefined;
    const ask = deps.ask ?? ((q: string) => rl!.question(q));
    try {
      // The prompt names what the scan could NOT see (review finding — spec
      // §3.4's primary reason keys are never auto-deleted is exactly the
      // out-of-scan-reach copies): other checkouts/branches/machines, plus
      // the skipped node_modules/.git/dist trees.
      const answer = (
        await ask(
          `Remove ${orphans.length} orphaned key(s)? Removal is revocation — a skill bound under one (a git revert, a parallel checkout or branch, anything outside ${root} or under node_modules/.git/dist, none of which this scan saw) degrades to 'unevaluated'. (y/N) `
        )
      )
        .trim()
        .toLowerCase();
      yes = answer === "y" || answer === "yes";
    } finally {
      rl?.close();
    }
  }
  if (!yes) {
    console.log("nothing removed");
    return 0;
  }
  // Re-scan AFTER consent (review finding): the prompt has human latency, and
  // a concurrent approve may have stamped its skill file inside that window.
  // Deletion is unrecoverable, so anything referenced by now is spared, and
  // the keystore mutation itself skips entries minted after scanStart.
  const stillReferenced = await collectReferencedKeyIds(root);
  const confirmed = orphans.filter((id) => !stillReferenced.has(id));
  if (confirmed.length < orphans.length) {
    console.log(`${orphans.length - confirmed.length} key(s) became referenced during confirmation — spared`);
  }
  if (confirmed.length === 0) {
    console.log("nothing removed");
    return 0;
  }
  await removeKeystoreEntries(keystorePath, confirmed, { mintedBefore: scanStart });
  console.log(`removed ${confirmed.length} key(s)`);
  return 0;
}

/**
 * The approval TTL this binding would carry, resolved ONCE (issue #77).
 *
 * `--expires 7d` resolves against the OBSERVATION's timestamp, not
 * wall-clock-now — arithmetic no operator does in their head, which is the
 * whole reason the resolved instant is shown before the y/N rather than after
 * it. The preview and the write therefore have to be the SAME value, not two
 * expressions that agree today and drift on the next edit; hence one function
 * with two call sites rather than a duplicated inline calculation.
 *
 * `source` and `elapsed` ride along so the preview and `bindStep`'s echo can
 * render the same three cases without re-deriving them from the instant.
 */
type ResolvedExpiry =
  | { expiresAt: string; source: "new"; elapsed: false }
  | { expiresAt: string; source: "carried"; elapsed: boolean }
  | { expiresAt: undefined; source: "none"; elapsed: false };

function resolveExpiresAt(step: Step, observedAtMs: number, expiresMs: number | undefined): ResolvedExpiry {
  // W5-T3 (§3.2): an ABSOLUTE instant, resolved once against THIS
  // observation's timestamp. Stamping the duration itself would re-arm the
  // approval on every read, which is the opposite of expiring.
  if (expiresMs !== undefined) return { expiresAt: new Date(observedAtMs + expiresMs).toISOString(), source: "new", elapsed: false };
  // Review finding (IMPORTANT): with no `--expires`, a prior TTL is CARRIED
  // FORWARD rather than dropped. `bindStep` is also the re-bind path, so
  // resolving from `expiresMs` alone meant a routine `approve --probe
  // --rebind` after benign drift silently deleted a TTL the operator set
  // weeks earlier — a downgrade, and §4.4 forbids silent downgrades of
  // exactly this kind.
  //
  // Carried VERBATIM, not re-resolved against this observation: the file
  // stores an instant, not the duration behind it, and re-resolving would
  // require guessing that duration. Verbatim is also the safe direction — a
  // re-bind extends nothing, and an already-elapsed TTL stays elapsed, so
  // re-binding state drift can never quietly renew a time-expired approval.
  const carried = step.expect?.expiresAt;
  if (carried !== undefined) return { expiresAt: carried, source: "carried", elapsed: Date.parse(carried) <= observedAtMs };
  // Brand invariant 1, one level down: no TTL prints NO line. "expires:
  // never" would render an absence as a deliberate choice.
  return { expiresAt: undefined, source: "none", elapsed: false };
}

/**
 * One sentence, rendered from one resolution — so the operator reads the same
 * words in the pre-prompt preview and in the echo of what was written, rather
 * than two phrasings of the same fact.
 */
function expiryConsentLine(resolved: ResolvedExpiry, expiresRaw: string | undefined): string | undefined {
  if (resolved.source === "new") {
    return `  expires: ${resolved.expiresAt} (--expires ${expiresRaw}) — past it this step's state check is 'unevaluated (approval-expired)', never a pass`;
  }
  if (resolved.source === "carried") {
    // Review finding (MINOR): a carried instant that has ALREADY elapsed
    // produces an approval that is dead on arrival — safe, because it fails
    // closed at the first run, but `expires: 2026-07-04T…` reads like a live
    // deadline to anyone scanning the output. Say which one it is.
    return (
      `  expires: ${resolved.expiresAt} (carried forward unchanged from the previous binding` +
      (resolved.elapsed
        ? " — ALREADY ELAPSED, so this binding is expired the moment it is written; pass --expires <duration> to set a new one)"
        : " — pass --expires <duration> to set a new one)")
    );
  }
  return undefined;
}

export async function cmdApprove(args: ParsedArgs, deps: ApproveDeps = {}): Promise<number> {
  // P1.5: `--prune-keys` takes no skill path — rotation leaves superseded
  // entries behind on purpose (parallel checkouts, git revert); pruning is
  // the explicit act, never a side effect. Same refusal standard as
  // --drop-expect/--probe below (review finding — blocking): silently
  // swallowing a skill path or approve flag would delete keys while the
  // operator believes they ran an approve.
  if (args.flags.has("prune-keys")) {
    // W5-T3 (review): the conflict list checked FLAGS only, so
    // `--prune-keys --expires 24h` pruned and dropped the TTL request on the
    // floor — the same silent-acceptance family as the re-verify bug below.
    // Value-taking options have to be checked by presence, not membership.
    const conflicts = ["probe", "rebind", "drop-expect"].filter((f) => args.flags.has(f));
    if (args.opts.expires !== undefined) conflicts.push("expires");
    if (args.positional.length > 0 || conflicts.length > 0 || args.wraps.length > 0) {
      const offender = args.positional.length > 0 ? `a skill path (${args.positional[0]})` : `--${conflicts[0] ?? "wrap"}`;
      console.error(
        `--prune-keys is a standalone command and cannot be combined with ${offender}. Run 'reelier approve --prune-keys [--all]' alone; --all skips the confirmation prompt.`
      );
      return 1;
    }
    return cmdPruneKeys(args, deps);
  }
  const skillPath = args.positional[0];
  if (!skillPath) {
    console.error(
      'Usage: reelier approve <skill.md> [--all] [--probe] [--expires <30m|24h|7d>] [--rebind] [--var name=value]... [--wrap "<cmd>"]... [--drop-expect] | reelier approve --prune-keys [--all]\n' +
        "  --expires <duration>  give the state binding a time-to-live: <positive integer><m|h|d>, at most 365d.\n" +
        "                        Resolved against approve time and stamped as an ABSOLUTE instant, so it cannot\n" +
        "                        re-arm itself. Past it the step's state check is 'unevaluated (approval-expired)',\n" +
        "                        which under 'state_gate: refuse' refuses the write before dispatch. Requires\n" +
        "                        --probe: a TTL lives on the state binding (expect:), which only --probe mints."
    );
    return 1;
  }

  let source: string;
  try {
    source = await readFile(skillPath, "utf8");
  } catch (err) {
    console.error(`Could not read skill file ${skillPath}: ${(err as Error).message}`);
    return 1;
  }

  let skill;
  try {
    skill = parseSkill(source);
  } catch (err) {
    if (err instanceof SkillParseError) {
      console.error(`Malformed skill in ${skillPath}: ${err.message}`);
      return 1;
    }
    throw err;
  }

  const writeSteps = skill.steps.filter(isWriteEffectStep);
  if (writeSteps.length === 0) {
    console.log("no write steps to approve");
    return 0;
  }

  const all = args.flags.has("all");
  const probe = args.flags.has("probe");
  const rebindFlag = args.flags.has("rebind");
  const dropExpect = args.flags.has("drop-expect");
  // Flag conflict (review finding — blocking): --drop-expect under --probe
  // would route a bound step AROUND the re-verify/world-moved consent gate
  // into the fresh-bind path, i.e. a machine-minted re-bind (the exact thing
  // A2 forbids) wearing a "dropping state binding" label. The two flags
  // answer opposite questions; refuse the combination outright.
  if (probe && dropExpect) {
    console.error(
      "--drop-expect cannot be combined with --probe: --probe (re)binds state. Drop the binding first with plain 'reelier approve --drop-expect', or re-approve with --probe alone."
    );
    return 1;
  }
  // W5-T3: `--expires` is a SIBLING of `--probe`, not a variant of it —
  // `--probe` makes an approval die when the world moves, `--expires` makes it
  // die when nobody answers. A step may carry both.
  //
  // It is refused without `--probe` rather than silently accepted, because the
  // TTL lives on `expect:` and only `--probe` mints one. A plain approved
  // write cannot expire; that is a real scope boundary (SPEC.md §6.1c) and an
  // operator meets it here, at the moment they ask for the thing, instead of
  // discovering months later that the TTL they thought they set never fired.
  const expiresRaw = args.opts.expires;
  let expiresMs: number | undefined;
  if (expiresRaw !== undefined) {
    if (!probe) {
      console.error(
        "--expires requires --probe: a TTL lives on the state binding (expect:), and only --probe mints one. " +
          "A plain approved write with no expect: cannot expire — re-approve with 'reelier approve --probe --expires " +
          `${expiresRaw}', or drop --expires.`
      );
      return 1;
    }
    const parsed = parseDuration(expiresRaw);
    if (parsed === null) {
      console.error(
        `Invalid --expires ${JSON.stringify(expiresRaw)} — expected a positive integer followed by m, h, or d ` +
          `(e.g. 30m, 24h, 7d), at most ${MAX_APPROVAL_TTL_MS / 86_400_000}d. Nothing was approved.`
      );
      return 1;
    }
    expiresMs = parsed;
  }
  const now = deps.now ?? (() => Date.now());
  const isTTY = deps.isTTY ?? process.stdout.isTTY === true;
  const keystorePath = resolveKeystorePath(deps.env ?? process.env, deps.homedir ?? os.homedir());

  const rl = !all && deps.ask === undefined ? createInterface({ input: process.stdin, output: process.stdout }) : undefined;
  const ask = deps.ask ?? (rl ? (q: string) => rl.question(q) : undefined);
  const askYes = async (question: string): Promise<boolean> => {
    const answer = (await ask!(question)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  };

  let approvedCount = 0;
  let skippedCount = 0;
  let unchangedCount = 0;
  let stateBoundCount = 0;
  // The never-silently-downgrade classes (§4.4 + A2): each drives a named
  // summary line and a non-zero exit — a scripted `approve --all --probe`
  // must not quietly mint weaker approvals than asked for. Re-verify
  // unavailability is its own class for the same reason (A6/B7: an induced
  // probe failure must never read as "unchanged" with a clean exit).
  let skippedProbeFailed = 0;
  let skippedWorldMoved = 0;
  let skippedStateBoundChanged = 0;
  let reVerifyUnavailable = 0;

  let downstreams: DownstreamConnection[] = [];
  let probeTools: Record<string, Tool> | undefined = deps.tools;

  /**
   * Mint-and-stamp, in the spec's §4.2.4 order: keystore entry BEFORE any
   * skill mutation — a crash between the two leaves an orphan key (harmless,
   * 32 bytes) and an unmodified skill, never a keyless `expect`.
   */
  /**
   * W3-S4: operator-supplied `--var` values for this invocation. Probe args
   * are filled from these and NOTHING else — at approve time there are no
   * step-output binds to confuse them with, and at run time the commitment
   * minted here is what forbids one from sneaking in.
   */
  const approveVars: Record<string, string> = args.vars ?? {};

  /**
   * The probe args this invocation would actually send, plus whether the
   * template was parameterized at all. Pure — no dispatch. `missing` names
   * the placeholders no `--var` supplied, which is a refusal class at bind
   * time and its own loud class at re-verify.
   */
  const resolveProbeArgs = (
    step: Step
  ): { filled: unknown; parameterized: boolean; missing: string[] } => {
    const names = [...new Set(step.attest ? collectPlaceholders(step.attest.args) : [])];
    const missing = names.filter((n) => !isComputedDateName(n) && !(n in approveVars));
    if (missing.length > 0) return { filled: undefined, parameterized: names.length > 0, missing };
    return { filled: fillTemplate(step.attest!.args, approveVars, now()), parameterized: names.length > 0, missing: [] };
  };

  /**
   * §4.2.3's disclosure rule, for INPUTS rather than observations. The filled
   * probe args print verbatim on EVERY path, `--all` and non-TTY included:
   * A2's gate governs projected VALUES (observed state, which CI logs must
   * not retain), and these are operator-supplied inputs the operator already
   * typed. Stated here so nobody later suppresses them citing A2.
   */
  const showProbeArgs = (filled: unknown): void => {
    console.log(`  probe args (filled): ${canonicalJson(filled)}`);
  };

  /**
   * Issue #77: the resolved deadline, printed immediately BEFORE the y/N so
   * the operator agrees to a date rather than to arithmetic. `--expires 7d`
   * resolves against the observation, not wall-clock-now, and a date shown
   * after consent is a date nobody had the chance to decline.
   *
   * Prints nothing when there is no TTL — never "expires: never", which would
   * render an absence as a deliberate setting.
   */
  const showExpiry = (step: Step, observedAtMs: number): void => {
    const line = expiryConsentLine(resolveExpiresAt(step, observedAtMs, expiresMs), expiresRaw);
    if (line !== undefined) console.log(line);
  };

  const bindStep = async (
    step: Step,
    typed: Record<string, string | number | boolean>,
    observedAtMs: number,
    probeArgs?: { filled: unknown }
  ): Promise<void> => {
    const at = new Date(observedAtMs).toISOString();
    const { key, keyId } = mintExpectKey();
    await writeKeystoreEntry(keystorePath, keyId, {
      key: key.toString("base64"),
      createdAt: at,
      skill: skill.name,
      step: step.n,
    });
    const mac = expectMac(key, step.attest!.tool, typed);
    console.log(
      `  pre-state commitment: ${abbrevMac(mac)} (key ${keyId} in ${keystorePath} — the key never enters the skill file or any record)`
    );
    // P1.5 (§3.5): per-field commitments ride along so a future mismatch
    // can name WHICH declared field moved — names only, same key, one MAC
    // per projected field. The whole-projection `pre` stays the verdict.
    const fieldMacs: Record<string, string> = {};
    for (const [name, value] of Object.entries(typed)) {
      fieldMacs[name] = expectFieldMac(key, step.attest!.tool, name, value);
    }
    // W5-T3, resolved by the shared `resolveExpiresAt` — which is also what
    // the pre-prompt preview calls (issue #77), so the instant the operator
    // agreed to and the instant written here are ONE value by construction
    // rather than two expressions that happen to agree today.
    //
    // This echo stays. The preview says what is about to be written; this is
    // the record of what was. Same sentence, two jobs.
    const resolved = resolveExpiresAt(step, observedAtMs, expiresMs);
    const { expiresAt } = resolved;
    const echo = expiryConsentLine(resolved, expiresRaw);
    if (echo !== undefined) console.log(echo);
    step.expect = {
      at,
      keyId,
      pre: mac,
      ...(expiresAt !== undefined ? { expiresAt } : {}),
      fields: fieldMacs,
      // W3-S4: commit the FILLED probe args only when the template was
      // parameterized. A literal probe needs no commitment — its execute-time
      // fill is the identity function, which is exactly why P1 could ship
      // literal-only probes with no second MAC at all (C4). Additive means a
      // literal binding stays byte-identical to 0.26.0.
      ...(probeArgs !== undefined ? { probeArgs: probeArgsMac(key, step.attest!.tool, probeArgs.filled) } : {}),
    };
    step.approve = computeApprovalHash({ actionTool: step.actionTool, actionArgs: step.actionArgs, attest: step.attest, expect: step.expect, emit: step.emit });
  };

  /**
   * §4.2.3, normative for EVERY binding (fresh or re-bind — review finding:
   * a consent taken without showing the observation is exactly the gap this
   * feature closes): projected names AND values on a TTY, names only under
   * --all/non-TTY (A2: CI logs are retained artifacts). Follows with the
   * §6.1.2 fixed-point lint or the §8.2.3 ABA note.
   */
  const showObservation = (typed: Record<string, string | number | boolean>, projection: string[]): void => {
    if (isTTY && !all) {
      for (const [field, value] of Object.entries(typed)) {
        console.log(`    ${safeFieldName(field)} = ${JSON.stringify(value)}`);
      }
      console.log("    (values shown for review only — never written to any file)");
    } else {
      console.log(`    projected fields: ${Object.keys(typed).map(safeFieldName).join(", ")}`);
    }
    // P1.5 (review finding): strip a `body.`/`header.` namespace before the
    // membership test — `header.etag` is the MOST version-class projection
    // expressible, and a prefix-blind lint would print the ABA note (an
    // affirmatively false line on the consent transcript) for exactly it.
    const volatile = projection.filter((f) =>
      (EXPECT_VOLATILE_FIELDS as readonly string[]).includes(f.replace(/^(?:body|header)\./, ""))
    );
    // W3-S5: `status.code` gets its OWN note, and it is deliberately NOT a
    // member of EXPECT_VOLATILE_FIELDS. That list's warning claims mutation
    // as FACT ("mutated by every write"), which is affirmatively false for a
    // guard probe of a resource the write never touches — the same
    // false-consent-transcript class the P1.5 review fixed for `header.etag`.
    // Conditional wording instead, and it REPLACES the other two branches:
    // one note per binding, or operators learn to read none of them.
    // Review finding (blocking, round 2): this note used to REPLACE both
    // branches below, so any projection merely CONTAINING `status.code`
    // withheld the version-class warning about its OTHER fields —
    // `["status.code","header.etag"]` said nothing about header.etag, which
    // really is mutated by every write. Suppressing a true warning is the
    // same false-consent-transcript class as printing a false note, with the
    // sign flipped, and the operator loses more by the omission.
    //
    // They are different claims about different fields, so both print. What
    // "one note per binding" actually forbids is the ABA note printing
    // alongside this one — those two are competing statements about the SAME
    // binding, and that suppression is preserved below.
    if (projection.includes(STATUS_CODE_ENTRY)) {
      console.log(
        "  note: binding on HTTP status — if the approved write creates or deletes the probed resource, this binding self-invalidates after its own first run (fixed-point rule); if the probe targets a resource the write leaves untouched, it is a fixed point"
      );
    }
    if (volatile.length > 0) {
      console.log(
        `  warning: projection field(s) ${volatile.map(safeFieldName).join(", ")} are version-class — mutated by every write; a standing approval here self-invalidates after its own first run (fixed-point rule)`
      );
    } else if (!projection.includes(STATUS_CODE_ENTRY)) {
      console.log(
        "  note: no version-class field in this projection — an excursion-and-return (ABA) between approval and execution is invisible; where the op permits, a monotonic version field resists it"
      );
    }
  };

  try {
    if (probe && probeTools === undefined) {
      try {
        downstreams = await wireDownstreams(args.wraps, deps.connect ?? connectDownstream);
      } catch (err) {
        console.error(`Failed to connect --wrap downstream: ${(err as Error).message}`);
        return 1;
      }
      // §4.2.2: --wrap for MCP downstreams, builtin http tools otherwise.
      probeTools = buildWrappedToolRegistry(downstreams) ?? builtinTools;
    }

    for (const step of writeSteps) {
      // --drop-expect (§4.4): the explicit, named downgrade. The strip is
      // computed here but only PERSISTED at stamp time — a declined prompt
      // must never leave a half-dropped binding in memory that a later
      // step's file write would silently persist.
      const dropping = dropExpect && step.expect !== undefined;
      const effectiveExpect = dropping ? undefined : step.expect;

      const expected = computeApprovalHash({ actionTool: step.actionTool, actionArgs: step.actionArgs, attest: step.attest, expect: effectiveExpect, emit: step.emit });
      const isCurrent = !dropping && step.approve !== undefined && step.approve === expected;
      // Under --drop-expect the hash moves because WE removed expect from the
      // input — labeling an untouched step STALE would be false (review
      // finding): distinguish "current, binding being dropped" from real drift.
      const originalCurrent =
        step.approve !== undefined &&
        step.approve === computeApprovalHash({ actionTool: step.actionTool, actionArgs: step.actionArgs, attest: step.attest, expect: step.expect, emit: step.emit });
      const state =
        step.approve === undefined
          ? "unapproved"
          : dropping
            ? originalCurrent
              ? "approved (current — binding will be dropped)"
              : "approved (STALE — tool/args/attest changed)"
            : isCurrent
              ? "approved (current)"
              : "approved (STALE — tool/args/attest changed)";

      console.log(`Step ${step.n} — ${step.title}`);
      console.log(`  ${step.actionTool} ${canonicalJson(step.actionArgs)}`);
      console.log(`  effect: ${step.effect}`);
      if (step.attest === undefined) {
        console.log(
          "  note: no 'attest:' declared — state attestation for this write is response-derived (partial) at best. " +
            "Exact pre/post attestation needs BOTH an attest: declaration AND this approval (the probe only runs on an approved step): " +
            '- attest: {"tool":"<read tool>","args":{...},"projection":["field",...]}'
        );
      } else if (probe) {
        const projLabel = step.attest.projection ? `projection [${step.attest.projection.join(", ")}]` : "projection (default)";
        console.log(`  attest: ${step.attest.tool} ${canonicalJson(step.attest.args)} → ${projLabel}`);
      }
      if (dropping) {
        console.log("  dropping state binding (--drop-expect)");
      }

      // I-18 blocker 1a (wave-3 review): refuse the downgrade outright on a
      // parameterized probe — never even ask. See PARAMETERIZED_PROBE_DROP_REFUSAL's
      // doc comment for why: stripping `expect` here would leave the probe
      // armed but ungated.
      if (dropping && step.attest !== undefined && collectPlaceholders(step.attest.args).length > 0) {
        console.log(`  ${PARAMETERIZED_PROBE_DROP_REFUSAL}`);
        skippedStateBoundChanged++;
        continue;
      }

      // §4.4: re-approving a changed step that carries expect, without
      // --probe — refused per step; silent removal of a condition a human
      // approved under is never available.
      if (!probe && !dropping && step.expect !== undefined && !isCurrent) {
        console.log("  state-bound step changed — re-approve with --probe, or pass --drop-expect to approve without state binding");
        skippedStateBoundChanged++;
        continue;
      }

      if (!probe) {
        console.log(`  ${state}`);
        // Idempotent — mirrors `reelier manifest`'s "unchanged" behavior
        // (fr2-slice2-review.md #5): an already-current step is a true no-op.
        if (isCurrent) {
          console.log("  unchanged");
          unchangedCount++;
          continue;
        }
        // Review finding (blocking, round 2): approving a parameterized probe
        // WITHOUT a probeArgs commitment leaves it filling from the whole
        // merged bindings map at run time, so an upstream `bind:` can reach a
        // dispatched probe arg. `--drop-expect` refuses this loudly; hand-
        // deleting the `expect` line and re-approving reached the same state
        // silently, at exit 0, because both guards above key on `expect` being
        // PRESENT. The state is legitimate for a never-bound skill and cannot
        // be distinguished from a laundered one in the file, so this warns
        // rather than refuses — but it is never silent again.
        if (step.attest !== undefined && step.expect?.probeArgs === undefined && collectPlaceholders(step.attest.args).length > 0) {
          console.log(
            "  warning: this step's probe args carry placeholders and no approved filled shape — at run time they fill from the whole bindings map, so an earlier step's bind: can reach a dispatched probe arg. Use --probe to commit the filled shape.",
          );
        }
        const yes = all || (await askYes("  Approve this step? (y/N) "));
        if (yes) {
          if (dropping) delete step.expect;
          step.approve = expected;
          approvedCount++;
        } else {
          skippedCount++;
        }
        continue;
      }

      // ---------------- probe mode (§4.2–§4.4) ----------------

      // I-18 blocker 4 (wave-3 review): the status.code + MCP refusal below
      // (structuralReason's last branch) sat AFTER this re-verify branch, so
      // a step bound over plain http could be re-verified — or, worse,
      // `--rebind`-ed — against a wrapped MCP tool resolved at THIS
      // invocation, the exact fail-open the refusal exists to prevent
      // (mcpStatusCodeRefusal's doc comment). Hoisted here, evaluated BEFORE
      // any probe dispatch or --rebind consent, so it can never be reached
      // by that path either. Same string, same predicate — never forked.
      if (
        isCurrent &&
        step.expect !== undefined &&
        step.attest !== undefined &&
        step.attest.projection?.includes(STATUS_CODE_ENTRY) &&
        probeTools?.[step.attest.tool]?.server !== undefined
      ) {
        console.log(`  approved (current) — re-verify unavailable (${mcpStatusCodeRefusal(step.attest.tool)}); binding left as-is`);
        reVerifyUnavailable++;
        continue;
      }

      // Already approved-current AND state-bound: report-only re-verify
      // (§4.3 as amended by A2/A14 — nothing is ever re-bound automatically).
      // Re-verify UNAVAILABILITY is its own loud, non-zero class: an induced
      // probe failure must never read as "unchanged" (A6/B7 in §8.1).
      if (isCurrent && step.expect !== undefined) {
        // The key is loaded FIRST since W3-S4: on a probeArgs-bearing binding
        // the filled-args comparison gates the probe DISPATCH, and it cannot
        // happen without the key. Nothing below this point dispatches until
        // the args are proven to be the approved ones.
        let key;
        try {
          const store = await readKeystore(keystorePath);
          key = loadExpectKey(store, step.expect.keyId);
        } catch (err) {
          console.log(`  approved (current) — re-verify unavailable (keystore-unavailable: ${(err as Error).message}); binding left as-is`);
          reVerifyUnavailable++;
          continue;
        }
        if (key === undefined) {
          console.log(`  approved (current) — re-verify unavailable (key-unavailable: keyId '${step.expect.keyId}'); binding left as-is`);
          reVerifyUnavailable++;
          continue;
        }
        // W3-S4: a missing `--var`, or filled args whose MAC differs from the
        // committed `probeArgs`, is its OWN loud class — never `unchanged`
        // (an induced difference must not read as a clean re-verify: the A6
        // suppression adversary applies at approve time too), and never "the
        // world has moved" (the ARGS differ, not the world). No probe fires.
        const reArgs = resolveProbeArgs(step);
        // Set when --rebind is re-pointing the probe at different args: the
        // whole-projection comparison below is then meaningless (it would
        // compare two DIFFERENT resources), so it is skipped rather than
        // reported as "the world has moved".
        let rebindingArgs = false;
        if (step.expect.probeArgs !== undefined) {
          const differ =
            reArgs.missing.length > 0 || probeArgsMac(key, step.attest!.tool, reArgs.filled) !== step.expect.probeArgs;
          if (differ) {
            // A missing var can never be rescued — there is nothing to fill,
            // so there is nothing to consent to. Otherwise `--rebind` is the
            // explicit act: "consent granted by whoever runs this command
            // against whatever the world is now" (A2), which is precisely
            // what re-committing probe args to this invocation's inputs is.
            // Without it this is its own loud class and NOTHING dispatches.
            if (reArgs.missing.length > 0 || !rebindFlag) {
              console.log(
                "  approved (current) — re-verify unavailable (probe-args-differ: filled probe args differ from the approved ones); binding left as-is"
              );
              reVerifyUnavailable++;
              continue;
            }
            rebindingArgs = true;
          }
          showProbeArgs(reArgs.filled);
        }
        const reVerify = await runProbe(
          step.attest!,
          probeTools!,
          approveVars,
          { allowDestructive: false },
          now(),
          DEFAULT_PROBE_TIMEOUT_MS
        );
        const reObservedAtMs = now();
        if (!reVerify.ok) {
          console.log(`  approved (current) — re-verify unavailable (${reVerify.reason}); binding left as-is`);
          reVerifyUnavailable++;
          continue;
        }
        const typed = projectObservationTyped(reVerify.obs, step.attest!.projection ?? []);
        if (Object.keys(typed).length === 0) {
          console.log("  approved (current) — re-verify unavailable (empty-projection: probe returned no declared fields); binding left as-is");
          reVerifyUnavailable++;
          continue;
        }
        // W5-T3 (review finding — CRITICAL): the state re-verified clean, so
        // this branch used to print "unchanged", write nothing and exit 0 —
        // INCLUDING when the operator passed `--expires`. That is the exact
        // moment someone decides to arm a TTL on a healthy binding, and the
        // command accepted the flag and armed nothing. A control whose whole
        // purpose is "expire as a no" must never report success having done
        // nothing; silently succeeding is the one outcome that is off the
        // table (the same rule that made `--expires` without `--probe` a
        // refusal rather than a no-op).
        //
        // Resolved against THIS observation, like every other stamp: asking
        // for `--expires 24h` today means 24h from today, so a re-run with the
        // same duration legitimately RENEWS the deadline rather than reporting
        // "unchanged". That is a deliberate re-approval cadence being reset by
        // hand, which is what the operator just typed.
        const stateUnchanged = !rebindingArgs && macEquals(expectMac(key, step.attest!.tool, typed), step.expect.pre);
        // Issue #77: through the SAME resolver `bindStep` writes from, so the
        // instant previewed on this path is the instant stamped rather than a
        // second expression that agrees by identical arithmetic. Narrowed to
        // `source === "new"` because `ttlMoves` below asks specifically
        // "did the operator request a deadline, and is it different?" — a
        // carried-forward instant is not a request and must not read as one.
        const requestedExpiry = resolveExpiresAt(step, reObservedAtMs, expiresMs);
        const requestedExpiresAt = requestedExpiry.source === "new" ? requestedExpiry.expiresAt : undefined;
        const ttlMoves = requestedExpiresAt !== undefined && requestedExpiresAt !== step.expect.expiresAt;
        if (stateUnchanged && !ttlMoves) {
          console.log("  unchanged (state re-verified against current binding)");
          unchangedCount++;
          continue;
        }
        if (stateUnchanged) {
          // State is fine; the TTL is the only thing moving. Re-stamping is a
          // hash change on an already-approved step, so it takes the same
          // shown-observation + consent ceremony a fresh bind takes (§4.2.3) —
          // never a machine-minted re-approval. It does NOT require --rebind:
          // --rebind is consent to a world that moved underneath the operator,
          // and nothing moved here except the deadline they just typed.
          console.log(
            step.expect.expiresAt === undefined
              ? `  approved (current) — state re-verified; arming an approval TTL (expires ${requestedExpiresAt})`
              : `  approved (current) — state re-verified; renewing the approval TTL (was ${step.expect.expiresAt}, now ${requestedExpiresAt})`
          );
          showObservation(typed, step.attest!.projection ?? []);
          const yes = all || (await askYes("  Re-stamp this approval with the new TTL? (y/N) "));
          if (!yes) {
            skippedCount++;
            continue;
          }
          try {
            await bindStep(
              step,
              typed,
              reObservedAtMs,
              reArgs.parameterized && reArgs.missing.length === 0 ? { filled: reArgs.filled } : undefined
            );
          } catch (err) {
            console.log(`  re-stamp failed (approve-probe-failed: keystore-unavailable: ${(err as Error).message}) — binding left as-is`);
            skippedProbeFailed++;
            continue;
          }
          console.log("  re-stamped with the new TTL");
          approvedCount++;
          stateBoundCount++;
          continue;
        }
        if (rebindingArgs) {
          // Not "the world has moved": these are different probe args, so the
          // old and new observations describe different resources. Comparing
          // them — or diagnosing which FIELD moved between them — would be a
          // claim about a change that never happened.
          console.log("  approved (current) — re-pointing this binding at different probe args (--rebind)");
        } else {
          console.log(`  approved (current) — but the world has moved since ${step.expect.at}`);
        }
        // W3-S3 (P1.5 review N11): the whole-projection MAC just told us THAT
        // the world moved; the per-field commitments already in hand tell us
        // WHICH field moved, for free — the diagnosis was being thrown away.
        // Same key, same probe tool, same MAC function the runner uses, so
        // the claim is exactly as earned here as it is there. Names only,
        // never values: this prints on every path including --all, because
        // A2's TTY gate governs projected VALUES, not field names.
        // Suppressed while re-pointing the args (W3-S4): "changed since
        // approval" would compare a field across two different resources.
        if (!rebindingArgs) reportReVerifyDiagnosis(step, key, typed, reVerify.obs);
        // §4.2.3 holds for a re-bind too (review finding — blocking): the
        // yes must be granted against a SHOWN observation, never blind.
        showObservation(typed, step.attest!.projection ?? []);
        // Re-binding is an act of consent (A2): interactive yes or the
        // explicit --rebind flag ("consent granted by whoever runs this
        // command against whatever the world is now") — never automatic.
        //
        // The --all-without---rebind refusal is hoisted ABOVE the expiry
        // preview (issue #77): nothing is written on that path, and "carried
        // forward unchanged from the previous binding" would assert a
        // carry-forward that never happens. Same three outcomes, same order
        // of precedence — only the skip moved earlier.
        if (!rebindFlag && all) {
          console.log("  skipped (world moved) — pass --rebind to re-bind to the current state");
          skippedWorldMoved++;
          continue;
        }
        // Issue #77: the yes is granted against a SHOWN deadline as well as a
        // shown observation. A re-bind with no `--expires` carries the old TTL
        // forward — including one that has already elapsed, which the operator
        // must learn before consenting to a binding that is dead on arrival,
        // not after.
        showExpiry(step, reObservedAtMs);
        const consent = rebindFlag || (await askYes("  Re-bind this approval to the current state? (y/N) "));
        if (!consent) {
          skippedCount++;
          continue;
        }
        // W3-S4: `--rebind` re-commits the probe args over THIS invocation's
        // `--var` values, so the consent copy has to say so — a re-bind that
        // silently moved what the probe addresses would be the machine-minted
        // consent A2 exists to forbid, one level down.
        if (reArgs.parameterized && reArgs.missing.length === 0) {
          console.log("  re-binding probe args to this invocation's --var values");
          showProbeArgs(reArgs.filled);
        }
        try {
          // reObservedAtMs, not consent time: `at` is the honest answer to
          // "when did the human look at the world" (§2.1, review finding).
          await bindStep(step, typed, reObservedAtMs, reArgs.parameterized && reArgs.missing.length === 0 ? { filled: reArgs.filled } : undefined);
        } catch (err) {
          console.log(`  re-bind failed (approve-probe-failed: keystore-unavailable: ${(err as Error).message}) — binding left as-is`);
          skippedProbeFailed++;
          continue;
        }
        console.log("  re-bound to current state");
        approvedCount++;
        stateBoundCount++;
        continue;
      }

      // (Re)approval path under --probe: check bindability, probe, then
      // mint + stamp — or degrade EXPLICITLY (§4.4: a silent downgrade to a
      // weaker approval than the human asked for is forbidden).
      let typed: Record<string, string | number | boolean> | undefined;
      let observedAtMs = 0;

      // STRUCTURAL unbindability — decidable from the file alone, before any
      // probe dispatch. Kept strictly separate from probe-time failures: the
      // no-op guard below may ONLY ever fire on this class (review finding —
      // treating a probe timeout as "not state-bindable" would hand the A6
      // evidence suppressor a clean exit code, and the printed verdict would
      // be a lie about a perfectly bindable step).
      const attestPlaceholders = step.attest ? collectPlaceholders(step.attest.args) : [];
      const actionPlaceholders = collectPlaceholders(step.actionArgs);
      let structuralReason: string | undefined;
      if (step.attest === undefined) {
        structuralReason = "no 'attest:' declared — a state binding needs a declared probe";
      } else if (attestPlaceholders.some(isComputedDateName)) {
        structuralReason = `attest args use computed date vars (${attestPlaceholders
          .filter(isComputedDateName)
          .map((n) => `{{${n}}}`)
          .join(", ")}) — approve-day and execute-day fills would target different observations (not state-bindable in v1)`;
      } else if (attestPlaceholders.length > 0 && resolveProbeArgs(step).missing.length > 0) {
        // W3-S4 relaxes P1's blanket literal-only rule (C4) exactly this far:
        // a placeholder is permitted when an operator-supplied `--var` fills
        // it AT APPROVE TIME, in the ceremony, where the filled args are
        // printed to the human whose yes they feed. Unfilled it stays
        // refused — there is nothing to show and nothing to commit to.
        const missing = resolveProbeArgs(step).missing;
        structuralReason = `attest args contain placeholders with no --var supplied (${missing
          .map((n) => `{{${n}}}`)
          .join(", ")}) — pass --var ${missing[0]}=value to bind a parameterized probe`;
      } else if (actionPlaceholders.length > 0) {
        // A7 (write-target honesty; pick recorded in the spec: refuse): the
        // check conditions the PROBE's fixed resource — with placeholders in
        // the action args the WRITTEN resource varies per run.
        structuralReason = `action args contain placeholders (${actionPlaceholders.map((n) => `{{${n}}}`).join(", ")}) — the written resource varies per run (write-target honesty, not state-bindable in v1)`;
      } else if (step.attest.projection === undefined) {
        structuralReason =
          "no explicit projection declared — a state binding requires an explicit projection (the default projection is version-class, volatile by design)";
      } else if (
        step.attest.projection.includes(STATUS_CODE_ENTRY) &&
        probeTools?.[step.attest.tool]?.server !== undefined
      ) {
        // W3-S5, and it is a REFUSAL, not a lint (A7's precedent for a
        // binding class that misleads about what is conditioned). On MCP
        // there is no HTTP status: mcpResultToObservation fabricates
        // `isError ? 500 : 200`, and an isError result flows through as a
        // SUCCESSFUL observation. A binding stamped at 500 would therefore
        // match on every future error of any kind — which in gate mode
        // converts exactly the classes A12 sends to grey (and the gate
        // refuses) into a match that DISPATCHES the write. That is a
        // fail-OPEN conversion of the one sanctioned fail-closed control,
        // triggered by error conditions; it also neutralizes B7 (an induced
        // isError would yield match, never unevaluated, so no alert fires).
        //
        // `attest.projection` is covered by the approval hash, so a
        // hand-added `status.code` after approval is an approval-hash
        // mismatch the existing gate already refuses. But WHICH tool `--wrap`
        // resolves `step.attest.tool` to at THIS invocation is NOT covered by
        // that hash — a step bound over plain http can be re-verified or
        // `--rebind`-ed against a wrapped MCP tool of the same name on a
        // later run (I-18 blocker 4, wave-3 review), so bind-time refusal
        // alone is not sufficient enforcement; this predicate is hoisted and
        // checked again ahead of the re-verify branch above (search
        // mcpStatusCodeRefusal's other call site). `status.code` stays fully
        // live on the http builtins, which carry real statuses. The
        // predicate is `server`, set by mcpTool for every wrapped tool and
        // absent on http builtins.
        structuralReason = mcpStatusCodeRefusal(step.attest.tool);
      }

      // A structurally-unbindable step that is ALREADY approved-current and
      // unbound: nothing to consent to and nothing minted weaker — a skip
      // here would make `approve --probe --all` on any mixed skill exit
      // non-zero forever (S7 integration finding), and an interactive yes
      // would restamp the identical hash with a duplicate changelog line
      // (§4.3's "safe to run repeatedly"). Probe-time failures NEVER take
      // this path, and the A2 never-silently-weaker rule still governs
      // unapproved unbindable steps below.
      if (structuralReason !== undefined && isCurrent && step.expect === undefined) {
        console.log(`  not state-bindable: ${structuralReason}`);
        console.log("  unchanged (already approved; not state-bindable)");
        unchangedCount++;
        continue;
      }

      let notBindable = structuralReason;
      const freshArgs = notBindable === undefined ? resolveProbeArgs(step) : undefined;
      if (notBindable === undefined) {
        if (freshArgs!.parameterized) showProbeArgs(freshArgs!.filled);
        process.stdout.write(`  probing pre-state (${step.attest!.tool})… `);
        const probeResult = await runProbe(
          step.attest!,
          probeTools!,
          approveVars,
          { allowDestructive: false },
          now(),
          DEFAULT_PROBE_TIMEOUT_MS
        );
        observedAtMs = now();
        if (!probeResult.ok) {
          console.log(`failed (${probeResult.reason})`);
          notBindable = probeResult.reason;
        } else {
          typed = projectObservationTyped(probeResult.obs, step.attest!.projection ?? []);
          if (Object.keys(typed).length === 0) {
            console.log("failed (empty-projection: probe returned no declared fields)");
            notBindable = "empty-projection: probe returned no declared fields";
          } else {
            console.log("ok");
            showObservation(typed, step.attest!.projection ?? []);
          }
        }
      }

      if (notBindable !== undefined) {
        if (all) {
          // --all never offers the downgrade in the first place (this
          // branch always `continue`s below) — every failure class,
          // parameterized or not, already refuses to mint anything here.
          console.log(`  skipped (probe failed): ${notBindable}`);
          skippedProbeFailed++;
          continue;
        }
        // §4.4: report the exact reason, THEN offer the downgrade explicitly.
        console.log(`  not state-bindable: ${notBindable}`);
        console.log(`  ${state}`);
        // I-18 blocker 1a: refuse the downgrade outright — never even ask —
        // on a parameterized attest.args. See PARAMETERIZED_PROBE_DROP_REFUSAL's
        // doc comment: dropping `expect` here would leave the probe armed
        // but ungated, for a structural reason (missing --var, a computed
        // date var) as much as a runtime probe failure — the shape of the
        // args is what matters, not why binding failed this time.
        if (attestPlaceholders.length > 0) {
          console.log(`  ${PARAMETERIZED_PROBE_DROP_REFUSAL}`);
          skippedStateBoundChanged++;
          continue;
        }
        const downgrade = await askYes("  Approve WITHOUT state binding? (y/N) ");
        if (!downgrade) {
          skippedCount++;
          continue;
        }
        // Explicit, named downgrade: today's shape-only approval semantics.
        if (step.expect !== undefined) delete step.expect;
        step.approve = computeApprovalHash({ actionTool: step.actionTool, actionArgs: step.actionArgs, attest: step.attest, expect: undefined, emit: step.emit });
        approvedCount++;
        continue;
      }

      console.log(`  ${state}`);
      // Issue #77: the deadline is part of what is being consented to, so it
      // precedes the question — same as the re-stamp path already did.
      showExpiry(step, observedAtMs);
      const yes = all || (await askYes("  Approve this step against this observed state? (y/N) "));
      if (!yes) {
        skippedCount++;
        continue;
      }
      try {
        await bindStep(step, typed!, observedAtMs, freshArgs!.parameterized ? { filled: freshArgs!.filled } : undefined);
      } catch (err) {
        // §4.4/§8.6: keystore unwritable is a degrade class, not a crash —
        // "approve-probe-failed: keystore-unavailable", loud, nothing minted
        // for this step (bindStep mutates the step only after the keystore
        // write succeeds), earlier consents in this sitting still persist.
        const reason = `approve-probe-failed: keystore-unavailable: ${(err as Error).message}`;
        // I-18 blocker 1a: same outright refusal — the probe already
        // succeeded above (this catch only fires on the keystore write), so
        // the observed values existed for a moment, but nothing was ever
        // persisted; downgrading now would still leave a parameterized probe
        // armed and ungated on every future run.
        if (attestPlaceholders.length > 0) {
          console.log(`  ${PARAMETERIZED_PROBE_DROP_REFUSAL}`);
          skippedStateBoundChanged++;
          continue;
        }
        if (all) {
          console.log(`  skipped (probe failed): ${reason}`);
          skippedProbeFailed++;
          continue;
        }
        console.log(`  not state-bindable: ${reason}`);
        const downgrade = await askYes("  Approve WITHOUT state binding? (y/N) ");
        if (!downgrade) {
          skippedCount++;
          continue;
        }
        if (step.expect !== undefined) delete step.expect;
        step.approve = computeApprovalHash({ actionTool: step.actionTool, actionArgs: step.actionArgs, attest: step.attest, expect: undefined, emit: step.emit });
        approvedCount++;
        continue;
      }
      approvedCount++;
      stateBoundCount++;
    }
  } finally {
    rl?.close();
    await Promise.all(downstreams.map((d) => d.close().catch(() => {})));
  }

  if (approvedCount > 0) {
    // §8.6 probe coverage at bind time (S5): a freshly-bound step's probe
    // tool joins an EXISTING manifest additively (existing entries never
    // re-digested — blessing unrelated drift is `reelier manifest`'s
    // explicit act, not a side effect of approve). Without a manifest or
    // without --wrap there is nothing to stamp against — advise instead:
    // probe-tool drift then only surfaces at run time as `unevaluated`.
    if (probe && stateBoundCount > 0) {
      if (skill.manifest && downstreams.length > 0) {
        const { manifest: updated, added } = addProbeToolsToManifest(skill.manifest, skill, downstreams);
        if (added.length > 0) {
          skill.manifest = updated;
          console.log(`manifest: added probe tool(s) ${added.join(", ")} — probe-tool drift now fails the preflight closed`);
        }
      } else {
        console.log(
          `note: probe-tool schema drift on state-bound steps is only detectable before step 1 via a manifest — stamp one: reelier manifest ${skillPath} --wrap …`
        );
      }
    }
    const changelogLine = probe
      ? `- approved ${approvedCount} write step(s), ${stateBoundCount} state-bound (reelier approve --probe)`
      : `- approved ${approvedCount} write step(s) (reelier approve)`;
    skill.trailing = appendChangelogLine(skill.trailing, changelogLine);
    const rendered = serializeSkill(skill);
    await writeFileAtomic(skillPath, rendered);
  }

  const summary = `approved ${approvedCount}, skipped ${skippedCount + skippedProbeFailed + skippedWorldMoved + skippedStateBoundChanged}, unchanged ${unchangedCount}`;
  console.log(probe ? `${summary} · state-bound ${stateBoundCount}` : summary);
  if (skippedProbeFailed > 0) console.log(`skipped (probe failed): ${skippedProbeFailed}`);
  if (skippedWorldMoved > 0) console.log(`skipped (world moved): ${skippedWorldMoved}`);
  if (skippedStateBoundChanged > 0) console.log(`skipped (state-bound changed): ${skippedStateBoundChanged}`);
  if (reVerifyUnavailable > 0) console.log(`re-verify unavailable: ${reVerifyUnavailable}`);
  // §4.4/A2: a refused-or-skipped downgrade class is a command that did NOT
  // do what was asked — exit non-zero so scripts can't miss it. Re-verify
  // unavailability counts too (A6/B7: an induced probe failure must never
  // exit clean). An ordinary interactive "no" stays exit 0 (a human choice).
  return skippedProbeFailed > 0 || skippedWorldMoved > 0 || skippedStateBoundChanged > 0 || reVerifyUnavailable > 0 ? 1 : 0;
}

/**
 * Honest replay-worthiness warning for `from-session` output. The "replayable"
 * filter (session.ts) only proves Reelier CAN re-issue these MCP calls — it
 * says nothing about whether you SHOULD. A compiled skill full of create_/
 * update_/delete_ steps re-executes those side effects on every replay.
 * Reuses the compiler's own per-step effect classification (compile.ts's
 * classifyEffect, already run inside compile()) rather than re-deriving it —
 * this never blocks compilation, it just tells the truth about what got written.
 */
function printReplayWorthiness(result: CompileResult): void {
  const sideEffectful = result.steps.filter((s) => s.effect !== "read");
  if (sideEffectful.length === 0) {
    console.log(`✓ all ${result.steps.length} steps are read-only — safe to replay repeatedly`);
    return;
  }
  console.log(
    `⚠ ${sideEffectful.length} of ${result.steps.length} steps are side-effectful (create/update/delete/write) — ` +
      "replaying re-executes those side effects. Reelier replays best on read-only / data-pull workflows."
  );
  console.log(`  ${sideEffectful.map((s) => s.tool).join(", ")}`);
}

function printSkipped(skipped: SessionSkip[]): void {
  if (skipped.length === 0) return;
  const byReason = new Map<string, string[]>();
  for (const s of skipped) {
    const list = byReason.get(s.reason) ?? [];
    list.push(s.name);
    byReason.set(s.reason, list);
  }
  console.log(`Skipped ${skipped.length} non-replayable/unresolved tool call(s):`);
  for (const [reason, names] of byReason) {
    const counts = new Map<string, number>();
    for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
    const nameList = [...counts.entries()].map(([n, c]) => (c > 1 ? `${n} x${c}` : n)).join(", ");
    console.log(`  - ${nameList}`);
    console.log(`    ${reason}`);
  }
}

const AGENT_OVERRIDE_ALIASES: Record<string, SessionFormatId> = {
  "claude-code": "claude-code",
  claude: "claude-code",
  codex: "codex",
  openclaw: "openclaw",
};

const STUB_AGENT_IDS = new Set<string>(["cursor", "windsurf"]);

/** Honest stub message for a SQLite-backed format we deliberately don't parse (see session-formats.ts's stubAgentSources doc comment for the evidence). Never fabricates a parse — reports what's on disk instead. */
async function printStubFindings(agentId: StubAgentId): Promise<void> {
  const src = stubAgentSources().find((s) => s.id === agentId);
  if (!src) return;
  const probe = await probeStubSource(src);
  console.log(`${src.label}: format not yet supported.`);
  console.log(`  ${src.findings}`);
  if (probe.found > 0) {
    console.log(`  Found ${probe.found} state.vscdb file(s) on this machine, e.g. ${probe.paths[0]}`);
  } else {
    console.log(`  No state.vscdb found under ${src.globalStorageDir} or ${src.workspaceStorageDir}.`);
  }
}

async function cmdFromSession(args: ParsedArgs): Promise<number> {
  const transcriptPath = args.positional[0];
  const agentOverride = args.opts.agent?.toLowerCase();

  if (agentOverride && STUB_AGENT_IDS.has(agentOverride)) {
    await printStubFindings(agentOverride as StubAgentId);
    return 1;
  }
  if (transcriptPath && /\.vscdb$/i.test(transcriptPath)) {
    // A Cursor/Windsurf SQLite file handed to us directly — same honest stub, no --agent needed to detect it.
    const guess: StubAgentId = /windsurf/i.test(transcriptPath) ? "windsurf" : "cursor";
    await printStubFindings(guess);
    return 1;
  }

  if (!transcriptPath) {
    console.error("Usage: reelier from-session <transcript.jsonl> [--out <skill.md>] [--name <name>] [--agent <claude-code|codex|openclaw|cursor|windsurf>] [--force]");
    return 1;
  }

  let format: SessionFormatId | undefined;
  if (agentOverride) {
    format = AGENT_OVERRIDE_ALIASES[agentOverride];
    if (!format) {
      console.error(`Unknown --agent '${args.opts.agent}'. Known: claude-code, codex, openclaw, cursor, windsurf.`);
      return 1;
    }
  }

  let source: string;
  try {
    source = await readFile(transcriptPath, "utf8");
  } catch (err) {
    console.error(`Could not read transcript file ${transcriptPath}: ${(err as Error).message}`);
    return 1;
  }

  const traceFileName = path.basename(transcriptPath);
  const name = args.opts.name ?? traceFileName.replace(/\.jsonl$/i, "");
  const detected = format ?? detectSessionFormat(source);
  console.log(`Format: ${detected ? SESSION_FORMAT_LABELS[detected] : "unrecognized (falling back to Claude Code parsing)"}`);

  const result = compileSessionTranscript(source, { name, traceFileName, format });

  console.log(`Scanned ${traceFileName}: ${result.ok ? result.replayableCount : 0} replayable call(s) found.`);
  console.log("");
  printSkipped(result.skipped);

  if (!result.ok) {
    console.log("");
    console.log(result.reason);
    return 1;
  }

  const outPath = args.opts.out ?? path.join(process.cwd(), `${result.compileResult.name}.skill.md`);
  if (!args.flags.has("force") && (await fileExists(outPath))) {
    console.error(`\nRefusing to overwrite existing file ${outPath} — pass --force to overwrite.`);
    return 1;
  }

  await writeFile(outPath, result.skillSource, "utf8");

  console.log("");
  console.log(`Wrote ${outPath}`);
  console.log(`  steps:   ${result.compileResult.stats.steps}`);
  console.log(`  asserts: ${result.compileResult.stats.asserts}`);
  console.log(`  binds:   ${result.compileResult.stats.binds}`);
  if (result.servers.length > 0) {
    console.log(`  MCP servers used: ${result.servers.join(", ")}`);
  }
  console.log("");
  printReplayWorthiness(result.compileResult);
  console.log("");
  if (result.compileResult.openQuestions.length === 0) {
    console.log("Open questions: (none)");
  } else {
    console.log(`Open questions (${result.compileResult.openQuestions.length}):`);
    for (const oq of result.compileResult.openQuestions) {
      const where = oq.stepN !== undefined ? `Step ${oq.stepN}` : "(trailing note)";
      console.log(`  - ${where}: ${oq.text}`);
    }
  }

  return 0;
}

/** "X replayable (Y read-only · Z side-effectful)" — the side-effectful count folds idempotent-write + destructive together (both re-execute a write on replay; the picker doesn't need the finer split compile.ts's stats.effects carries). */
function fmtEffectSplit(s: ScannedSession): string {
  const sideEffectful = s.effects["idempotent-write"] + s.effects.destructive;
  return `${s.replayableCount} replayable (${s.effects.read} read-only · ${sideEffectful} side-effectful)`;
}

function fmtSessionLine(index: number, s: ScannedSession): string {
  const when = new Date(s.mtimeMs).toISOString().slice(0, 16).replace("T", " ");
  const from = s.sourceId && s.sourceId !== "custom" ? `${s.sourceLabel} · ` : "";
  if (s.replayableCount > 0) {
    const servers = s.servers.length > 0 ? ` — ${s.servers.join(", ")}` : "";
    const warn = s.readOnly ? "" : " ⚠ side-effectful";
    return `  [${index}] ${from}${s.project} · ${when} · ${fmtEffectSplit(s)}${warn}${servers}`;
  }
  return `  (skipped) ${from}${s.project} · ${when} · no replayable tool calls found`;
}

/** Sort read-only-heavy sessions first (the ideal replay targets), side-effect-heavy ones lower — stable within each group, so recency (scanTranscripts' own sort) still breaks ties. */
function rankByReplayWorthiness(sessions: ScannedSession[]): ScannedSession[] {
  return [...sessions].sort((a, b) => Number(b.readOnly) - Number(a.readOnly));
}

export function parseDiscoverySelection(raw: string, max: number): number | null {
  if (!/^\d+$/.test(raw.trim())) return null;
  const selected = Number(raw.trim());
  return Number.isInteger(selected) && selected >= 1 && selected <= max ? selected : null;
}

export function formatDiscoveryOpportunity(index: number, opportunity: AgentOpportunity): string[] {
  const effects = opportunity.effectCounts;
  const writes = effects["idempotent-write"] + effects.destructive;
  const sideEffectLabel = writes > 0 ? ` · ${writes} proposed write${writes === 1 ? "" : "s"}` : "";
  return [
    `[${index}] ${opportunity.displayLabel}`,
    `    Observed ${opportunity.observedCount} time${opportunity.observedCount === 1 ? "" : "s"} · last used ${opportunity.lastUsedAt.slice(0, 10)}`,
    `    ${effects.read} reads${sideEffectLabel}`,
    `    Evaluation potential: ${opportunity.evaluationPotential}`,
    `    Approval boundary: ${opportunity.approvalBoundary}`,
  ];
}

async function configuredDiscoveryServers(cwd: string, homedir: string): Promise<string[]> {
  const names = new Set<string>();
  for (const config of await detectMcpConfigs(cwd, homedir)) {
    try {
      const parsed = parseMcpConfig(await readFile(config.path, "utf8"));
      for (const name of Object.keys(parsed.mcpServers ?? {})) names.add(name);
    } catch {
      // A malformed config is not a reason to lose local discovery; it simply
      // contributes no configured-server availability signal.
    }
  }
  return [...names].sort();
}

async function discoveryInputs(homedir: string, explicitDir?: string): Promise<DiscoverySessionInput[]> {
  const sessions = explicitDir ? await scanTranscripts(explicitDir) : await scanAgentSessions(homedir);
  const formats = new Map(agentSources(homedir).map((source) => [source.id, source.format]));
  const inputs: DiscoverySessionInput[] = [];
  for (const session of sessions) {
    try {
      inputs.push({
        content: await readFile(session.path, "utf8"),
        path: session.path,
        project: session.project,
        sourceId: session.sourceId,
        sourceLabel: session.sourceLabel,
        mtimeMs: session.mtimeMs,
        format: formats.get(session.sourceId),
      });
    } catch {
      // A session disappearing during a scan is skipped; no bundle is built
      // from a partial transcript.
    }
  }
  return inputs;
}

async function readDiscoverySigningMaterial(homedir: string): Promise<{ privateKey: NonNullable<Awaited<ReturnType<typeof loadSigningKey>>>["privateKey"]; keyId: string; publicKeyPem: string }> {
  const dir = signingKeyDir(homedir);
  let loaded = await loadSigningKey(dir);
  let publicPath: string | undefined;
  if (!loaded) {
    const generated = await generateSigningKeypair(dir);
    publicPath = generated.publicPath;
    loaded = await loadSigningKey(dir);
  }
  if (!loaded) throw new Error("Could not load the local Ed25519 signing key; run 'reelier init --signing' and try again.");
  const publicPem = await readFile(publicPath ?? path.join(dir, `${loaded.keyId}.pub.pem`), "utf8");
  return { privateKey: loaded.privateKey, keyId: loaded.keyId, publicKeyPem: publicPem };
}

const SUPPORTED_COVERAGE_HOSTS = ["codex", "claude-code"] as const;
const SUPPORTED_COVERAGE_HOSTS_LINE = `Supported hosts: ${SUPPORTED_COVERAGE_HOSTS.join(", ")}.`;

export async function cmdBridge(args: ParsedArgs): Promise<number> {
  const rawPort = args.opts.port ?? "4777";
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`Invalid bridge port: ${rawPort}`);
    return 1;
  }
  const server = createBridgeServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
  console.log(`Reelier local discovery bridge listening on http://127.0.0.1:${port}`);
  await new Promise<void>((resolve) => {
    const close = () => { server.close(() => resolve()); };
    process.once("SIGINT", close);
    process.once("SIGTERM", close);
  });
  return 0;
}

export async function cmdCoverage(args: ParsedArgs, homedirOverride?: string, cwdOverride?: string): Promise<number> {
  const host = args.opts.host;
  if (!host) {
    console.error(`Usage: reelier coverage --host <host>. ${SUPPORTED_COVERAGE_HOSTS_LINE}`);
    return 1;
  }
  if (!(SUPPORTED_COVERAGE_HOSTS as readonly string[]).includes(host)) {
    console.error(`Unsupported --host '${host}'. ${SUPPORTED_COVERAGE_HOSTS_LINE}`);
    return 1;
  }
  const homedir = homedirOverride ?? os.homedir();
  if (host === "claude-code") {
    const view = await collectClaudeCodeCoverage(cwdOverride ?? args.opts.workspace ?? process.cwd(), homedir, process.env);
    for (const line of renderCoverageView(view)) console.log(line);
    return 0;
  }
  const report = await collectCodexCoverage(homedir);
  for (const line of renderCoverageReport(report)) console.log(line);
  return 0;
}

export async function cmdDiscover(args: ParsedArgs): Promise<number> {
  const explicitDir = args.opts.dir;
  if (explicitDir) console.log(`Discovering opportunities in ${path.basename(path.resolve(explicitDir))}...`);
  else console.log("Discovering opportunities from Claude Code, Codex CLI, and OpenClaw history...");
  const inputs = await discoveryInputs(os.homedir(), explicitDir);
  const opportunities = discoverOpportunities(inputs, { configuredServers: await configuredDiscoveryServers(process.cwd(), os.homedir()) });
  console.log("");
  console.log("Agent opportunities found");
  console.log("");
  if (opportunities.length === 0) {
    console.log("No replayable MCP/API workflow shapes found. Reelier does not infer opportunities from shell or file edits.");
    return 0;
  }
  opportunities.forEach((opportunity, index) => console.log(formatDiscoveryOpportunity(index + 1, opportunity).join("\n")));
  if (!args.flags.has("upload")) return 0;

  const selectedIndex = args.opts.select ? parseDiscoverySelection(args.opts.select, opportunities.length) : args.flags.has("yes") ? 1 : null;
  let selected = selectedIndex ? opportunities[selectedIndex - 1] : undefined;
  if (!selected) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      const answer = (await rl.question("\nSelect one opportunity to upload (number, or Enter to cancel): ")).trim();
      const parsed = parseDiscoverySelection(answer, opportunities.length);
      if (parsed) selected = opportunities[parsed - 1];
    } finally {
      rl.close();
    }
  }
  if (!selected) {
    console.log("No opportunity selected — nothing uploaded.");
    return 0;
  }

  const unsigned = buildDiscoveryBundle(selected, { runNonce: `discover-${randomUUID()}` });
  console.log("");
  console.log(formatDiscoveryPreview(unsigned));
  if (!args.flags.has("yes")) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    let answer = "";
    try {
      answer = (await rl.question("\nUpload this exact bundle to Reelier Cloud? (y/N) ")).trim().toLowerCase();
    } finally {
      rl.close();
    }
    if (answer !== "y" && answer !== "yes") {
      console.log("Upload declined — nothing left this computer.");
      return 0;
    }
  }

  try {
    const config = resolvePushConfig(process.env, await readCliConfig());
    const signing = await readDiscoverySigningMaterial(os.homedir());
    const signed = signDiscoveryBundle(unsigned, signing);
    if (args.opts.out) await writeFile(path.resolve(args.opts.out), `${JSON.stringify(signed, null, 2)}\n`, "utf8");
    const uploaded = await uploadDiscoveryBundle(signed, config);
    console.log(`Uploaded sanitized discovery bundle ${uploaded.id}.`);
    console.log(`Private Arena review: ${uploaded.importUrl}`);
    return 0;
  } catch (error) {
    console.error((error as Error).message);
    return 1;
  }
}

async function cmdScan(args: ParsedArgs): Promise<number> {
  const explicitDir = args.opts.dir;
  const yes = args.flags.has("yes");

  let sessions: ScannedSession[];
  if (explicitDir) {
    console.log(`Scanning ${explicitDir} for agent session transcripts...`);
    sessions = await scanTranscripts(explicitDir);
  } else {
    console.log("Scanning every known agent/IDE for session transcripts:");
    for (const s of agentSources()) console.log(`  · ${s.label} — ${s.dir}`);
    sessions = await scanAgentSessions();
  }

  if (!explicitDir) {
    // Cursor/Windsurf are SQLite-backed (state.vscdb) — never scanned into ScannedSession
    // (no parser exists, see session-formats.ts), but still probed and reported honestly.
    for (const src of stubAgentSources()) {
      const probe = await probeStubSource(src);
      console.log(
        probe.found > 0
          ? `  · ${src.label} — ${probe.found} state.vscdb file(s) found, format not yet supported (${src.findings})`
          : `  · ${src.label} — none found`
      );
    }
  }

  const replayable = rankByReplayWorthiness(sessions.filter((s) => s.replayableCount > 0));
  const skipped = sessions.filter((s) => s.replayableCount === 0);
  const readOnlyCount = replayable.filter((s) => s.readOnly).length;

  console.log("");
  console.log(
    `Found ${sessions.length} session(s) · ${replayable.length} with replayable workflows · ${readOnlyCount} are read-only (ideal to replay).`
  );
  if (!explicitDir) {
    // Per-source breakdown — which IDEs had (parseable) transcripts vs. which
    // contributed nothing (missing dir, or a format we don't parse yet).
    const bySource = new Map<string, { total: number; replayable: number }>();
    for (const s of sessions) {
      const e = bySource.get(s.sourceLabel) ?? { total: 0, replayable: 0 };
      e.total++;
      if (s.replayableCount > 0) e.replayable++;
      bySource.set(s.sourceLabel, e);
    }
    const parts = agentSources().map((src) => {
      const e = bySource.get(src.label);
      return e ? `${src.label}: ${e.replayable}/${e.total} replayable` : `${src.label}: none found`;
    });
    console.log(`  by source — ${parts.join(" · ")}`);
  }
  // The self-measuring KPI: read-only rate + which unknown-verb tools are the
  // only thing standing between a session and fully-read-only replay.
  for (const line of formatReplayableRate(replayableRateStats(sessions))) {
    console.log(`  ${line}`);
  }
  console.log("");

  if (replayable.length === 0) {
    console.log("None of the scanned sessions contain a deterministically-replayable tool-call sequence (Reelier");
    console.log("replays API/MCP tool workflows, not file edits or shell commands) — nothing to compile.");
    if (skipped.length > 0) {
      console.log("");
      console.log(`Skipped (no replayable calls): ${skipped.length} session(s).`);
    }
    return 0;
  }

  console.log("Which should Reelier turn into a skill you can replay forever?");
  console.log("");
  for (let i = 0; i < replayable.length; i++) {
    console.log(fmtSessionLine(i + 1, replayable[i]));
  }
  if (skipped.length > 0) {
    console.log("");
    console.log(`(${skipped.length} other session(s) skipped — no replayable tool calls found, not offered as options.)`);
  }

  let selected: ScannedSession[];
  if (yes) {
    selected = replayable;
    console.log("");
    console.log(`--yes: compiling all ${selected.length} session(s) with replayable calls.`);
  } else {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    let answer: string;
    try {
      answer = (
        await rl.question(`\nSelect sessions to compile (comma-separated numbers, "all", or Enter for none): `)
      ).trim();
    } finally {
      rl.close();
    }
    if (answer === "" ) {
      console.log("No sessions selected — nothing compiled.");
      return 0;
    }
    if (answer.toLowerCase() === "all") {
      selected = replayable;
    } else {
      const indices = answer
        .split(",")
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= replayable.length);
      selected = indices.map((n) => replayable[n - 1]);
      if (selected.length === 0) {
        console.log("No valid selection — nothing compiled.");
        return 0;
      }
    }
  }

  const outDir = args.opts["out-dir"] ?? path.join(process.cwd(), ".reelier", "skills-from-scan");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(outDir, { recursive: true });

  console.log("");
  let compiledCount = 0;
  for (const session of selected) {
    let source: string;
    try {
      source = await readFile(session.path, "utf8");
    } catch (err) {
      console.log(`  ${session.path}: could not re-read (${(err as Error).message}) — skipped.`);
      continue;
    }
    const traceFileName = path.basename(session.path);
    const name = `${session.project}-${traceFileName.replace(/\.jsonl$/i, "")}`;
    const result = compileSessionTranscript(source, { name, traceFileName });
    if (!result.ok) {
      // Shouldn't happen (scan already filtered to replayableCount > 0), but never fabricate a skill if it does.
      console.log(`  ${session.path}: ${result.reason}`);
      continue;
    }
    const outPath = path.join(outDir, `${name}.skill.md`);
    await writeFile(outPath, result.skillSource, "utf8");
    console.log(
      `  Wrote ${outPath} (${result.compileResult.stats.steps} steps, ${result.compileResult.stats.asserts} asserts, ${result.skipped.length} calls skipped)`
    );
    compiledCount++;
  }

  console.log("");
  console.log(`Compiled ${compiledCount}/${selected.length} selected session(s) into ${outDir}.`);
  return 0;
}

async function cmdInstall(args: ParsedArgs): Promise<number> {
  const agent = args.opts.agent ?? "auto";
  if (agent !== "auto" && agent !== "claude") {
    console.error(agentGuardMessage("install", agent));
    return 1;
  }

  const cwd = process.cwd();
  const homedir = os.homedir();

  // `--config <path>` targets one file explicitly; otherwise every known host config that exists
  // is wrapped. Wrapping all of them is the honest default: a machine with both a Claude Code and
  // a Cursor config runs agents through both, and silently picking one would leave the other
  // unrecorded while reporting success.
  const explicit = args.opts.config;
  const targets: KnownMcpConfig[] = explicit
    ? [{ label: "explicit --config", path: explicit }]
    : await detectMcpConfigs(cwd, homedir);

  if (targets.length === 0) {
    const checked = knownMcpConfigPaths(cwd, homedir)
      .map((c) => `  ${c.label}: ${c.path}`)
      .join("\n");
    console.error(
      `No MCP config found. Checked:\n${checked}\n\nConfigure at least one MCP server first (or run ` +
        `'reelier init'), then re-run 'reelier install'. To wrap a config somewhere else: ` +
        `reelier install --config <path>`
    );
    return 1;
  }

  console.log(`reelier install — wrapping MCP servers so every tool call is recorded.`);
  console.log("");

  const plans: { target: KnownMcpConfig; plan: InstallPlan }[] = [];
  for (const target of targets) {
    const plan = await planInstall(target.path, cwd);
    plans.push({ target, plan });
    console.log(`${target.label} — ${target.path}`);
    if (plan.entries.length === 0) {
      console.log("  (no mcpServers entries)");
    }
    for (const e of plan.entries) {
      // Project-scoped entries (~/.claude.json's `projects` map) are named with their project
      // so "will wrap" and "reported, NOT wrapped" can never be read as being about the same file.
      const label = e.projectPath ? `${e.name} (projects/${e.projectPath})` : e.name;
      if (e.action === "wrap") console.log(`  ${label}: will wrap`);
      else if (e.action === "already-wrapped") console.log(`  ${label}: already wrapped — left alone`);
      else if (e.action === "skip-other-project") console.log(`  ${label}: reported, NOT wrapped — ${e.reason}`);
      else console.log(`  ${label}: skipped — ${e.reason}`);
    }
    console.log("");
  }

  // Printed before the "nothing to do" early return below, deliberately: the case where every
  // wrappable server is already wrapped is exactly the case where an operator would otherwise
  // read "nothing to do" as "fully covered".
  const otherProject = plans.flatMap((p) => p.plan.entries).filter((e) => e.action === "skip-other-project");
  if (otherProject.length > 0) {
    console.log(
      `${otherProject.length} project-scoped server(s) belong to other projects and were NOT wrapped. ` +
        `Install wraps only the project entry matching the directory it runs in — re-run 'reelier install' from ` +
        `that project's directory. To list every one from anywhere: reelier coverage --host claude-code`
    );
    console.log("");
  }

  const changed = plans.filter((p) => p.plan.changed);
  if (changed.length === 0) {
    console.log("Nothing to do — every configured server is already wrapped or can't be wrapped.");
    return 0;
  }

  if (args.flags.has("dry-run")) {
    for (const { target, plan } of changed) {
      console.log(`Dry run — ${target.label} (${target.path}):`);
      console.log(
        diffLines(plan.before, plan.after)
          .map((l) => `  ${l}`)
          .join("\n")
      );
      console.log("");
    }
    console.log("Nothing written (--dry-run).");
    return 0;
  }

  let wrapped = 0;
  for (const { target, plan } of changed) {
    let result: InstallResult;
    try {
      result = await applyInstall(plan);
    } catch (err) {
      // The backup-or-abort guard (applyInstall) fires here: nothing was written for THIS config.
      // Earlier configs in the loop are already written and stay written — each has its own
      // backup, and reporting a partial success honestly beats pretending it was all-or-nothing.
      console.error(`${target.path}: ${(err as Error).message}`);
      return 1;
    }
    wrapped += result.wrappedCount;
    console.log(`Wrapped ${result.wrappedCount} server(s) in ${target.path}.`);
    if (result.backupPath) console.log(`  Original backed up to ${result.backupPath}.`);
  }

  console.log("");
  console.log(`${wrapped} server(s) wrapped across ${changed.length} config(s).`);
  console.log("");
  console.log("Restart your agent, then work normally. When you want to save a workflow, tell your agent:");
  console.log('  "record this" ... do the work ... "done"');
  console.log("Then compile it: reelier from-session <the .jsonl transcript your agent just wrote>");
  console.log("");
  console.log("To revert: reelier uninstall");
  return 0;
}

/**
 * A minimal line diff for `--dry-run`. Dumping the whole rewritten config (the previous behavior)
 * buries a two-line change in a hundred lines of unchanged JSON, and a reader who cannot see what
 * changed cannot consent to it — which is the entire job of a dry run.
 *
 * Deliberately not a real LCS diff: config rewrites here only ever replace a server's command line
 * in place, so a positional walk with context is accurate for the change this command makes. If
 * `planInstall` ever reorders or removes keys, this must be replaced rather than trusted.
 */
export function diffLines(before: string, after: string): string[] {
  const b = before.split("\n");
  const a = after.split("\n");
  const out: string[] = [];
  const max = Math.max(b.length, a.length);
  let lastPrinted = -1;
  for (let i = 0; i < max; i++) {
    if (b[i] === a[i]) continue;
    if (lastPrinted !== -1 && i - lastPrinted > 1) out.push("   ...");
    if (b[i] !== undefined) out.push(`  - ${b[i].trim()}`);
    if (a[i] !== undefined) out.push(`  + ${a[i].trim()}`);
    lastPrinted = i;
  }
  return out.length > 0 ? out : ["  (no textual change)"];
}

async function cmdUninstall(args: ParsedArgs): Promise<number> {
  const agent = args.opts.agent ?? "auto";
  if (agent !== "auto" && agent !== "claude") {
    console.error(agentGuardMessage("uninstall", agent));
    return 1;
  }

  const cwd = process.cwd();
  const homedir = os.homedir();

  // The same host set `install` wraps, walked in the same order. Resolving a single path here (the
  // old behavior) meant a Cursor or Windsurf user who installed then uninstalled stayed wrapped
  // while being told the uninstall succeeded — a reverse gear that silently disengaged.
  const explicit = args.opts.config;
  const targets: KnownMcpConfig[] = explicit
    ? [{ label: "explicit --config", path: explicit }]
    : knownMcpConfigPaths(cwd, homedir);

  const plan = await planUninstall(targets);

  // Nothing restorable anywhere is an error, not a quiet success — same honest exit as before,
  // widened from one path to every path checked.
  if (plan.restorable === 0) {
    const checked = plan.checkedPaths.map((p) => `  ${p}`).join("\n");
    console.error(`No reelier install backup found to restore. Checked:\n${checked}`);
    // Every entry gets a line, including ones whose wrap state could not be read: "unknown" is not
    // "nothing to revert", and a config reelier cannot classify is exactly the one worth naming.
    for (const e of plan.entries) {
      console.error(`\n${e.label} — ${e.configPath}: ${describeUnrestorable(e)}`);
    }
    console.error(
      `\nTo undo a wrap by hand, replace each server's 'npx -y reelier mcp --wrap "<original>"' entry with ` +
        `<original>. If you have a backup file from elsewhere, copy its contents back over the config.`
    );
    return 1;
  }

  if (args.flags.has("dry-run")) {
    for (const e of plan.entries) {
      if (e.action === "restore") console.log(`${e.label} — would restore ${e.configPath} from ${e.backupPath}`);
      else console.log(`${e.label} — ${e.configPath}: ${describeUnrestorable(e)}`);
    }
    console.log("");
    console.log("Nothing written (--dry-run).");
    return 0;
  }

  const results = await applyUninstall(plan);

  let restored = 0;
  let failed = 0;
  for (const r of results) {
    switch (r.outcome) {
      case "restored":
        restored++;
        console.log(`${r.label} — restored ${r.configPath} from ${r.backupPath}.`);
        break;
      case "restore-failed":
        failed++;
        console.error(`${r.label} — FAILED to restore ${r.configPath} from ${r.backupPath}: ${r.error}`);
        console.error(`  Left untouched. ${describeUnrestorable(r)}`);
        break;
      default:
        // Never a silent skip: a config with no backup is the one case with no CLI route back.
        console.log(`${r.label} — ${r.configPath}: ${describeUnrestorable(r)}`);
    }
  }

  console.log("");
  console.log(`Restored ${restored} config(s)${failed > 0 ? `, ${failed} failed` : ""}. Backups left in place.`);
  if (restored > 0) console.log("Restart your agent to drop the wrap.");

  // A partial revert exits non-zero: the operator asked for everything back and did not get it.
  return failed > 0 ? 1 : 0;
}

/** One line saying what is still wrapped and why reelier could not revert it — never rendered as a pass. */
export function describeUnrestorable(e: UninstallPlanEntry): string {
  if (e.action === "orphan-backup") {
    return `config is gone but its backup remains (${e.backupPath}) — left alone; copy it back by hand if you want the file returned.`;
  }
  if (e.wrapState === "wrapped") {
    return `STILL WRAPPED (${e.wrappedServerNames.join(", ")}) and no backup exists — reelier cannot revert this one for you.`;
  }
  if (e.wrapState === "unknown") {
    return `no backup, and reelier could not read it to tell whether it is wrapped (${e.wrapStateReason ?? "unreadable"}) — check it by hand.`;
  }
  return "no backup, and nothing in it is wrapped — nothing to revert.";
}

function fmtFieldErrors(fieldErrors: unknown): string {
  if (fieldErrors === undefined) return "(no field errors returned)";
  try {
    return JSON.stringify(fieldErrors);
  } catch {
    return String(fieldErrors);
  }
}

export async function cmdPush(args: ParsedArgs): Promise<number> {
  const skillPath = args.positional[0];
  if (!skillPath) {
    console.error("Usage: reelier push <skill.md> [--all] [--dry-run] [--with-skill] [--share] [--public] [--timestamp]");
    return 1;
  }

  const dryRun = args.flags.has("dry-run");
  const all = args.flags.has("all");
  const withSkill = args.flags.has("with-skill");
  const share = args.flags.has("share");
  const isPublic = args.flags.has("public");
  const timestamp = args.flags.has("timestamp");

  // Tracks whether the cloud actually honored --share on at least one
  // pushed record this run — a mint failure or an older cloud that doesn't
  // understand `share` yet still returns a plain 202 with no shareUrl, and
  // that must never be a silent no-op (see the `share` block below).
  let sawShareUrl = false;

  let result;
  try {
    result = await pushSkill(skillPath, {
      all,
      dryRun,
      withSkill,
      share,
      public: isPublic,
      timestamp,
      onRecordResult: (r: PushRecordResult) => {
        if (dryRun) {
          console.log(`  [${r.index}] would push`);
          return;
        }
        switch (r.outcome) {
          case "pushed":
            console.log(`  [${r.index}] pushed${r.id ? ` id=${r.id}` : ""}`);
            if (r.shareUrl) {
              sawShareUrl = true;
              console.log(`    Receipt: ${r.shareUrl}`);
              if (r.badgeUrl) {
                console.log(`    [![reelier](${r.badgeUrl})](${r.shareUrl})`);
              }
            }
            break;
          case "rejected":
            console.log(
              `  [${r.index}] rejected (permanent — cursor advances past it): ${fmtFieldErrors(r.fieldErrors)}`
            );
            break;
          case "auth-failed":
            console.log(`  [${r.index}] auth failed (batch stops here): ${r.message}`);
            break;
          case "too-large":
            console.log(`  [${r.index}] rejected 413 (permanent — cursor advances past it): ${r.message}`);
            break;
          case "error":
            console.log(`  [${r.index}] error (batch stops here): ${r.message}`);
            break;
        }
      },
    });
  } catch (err) {
    // Deliberately just the error's message — resolvePushConfig() never puts
    // the key value into its message, and neither does anything else here.
    console.error((err as Error).message);
    // A --public 403 (unlinked tenant / reserved namespace) carries a
    // linkUrl the plain message doesn't include — print it too so the CLI
    // surfaces "the server's message + linkUrl when present" verbatim.
    if (err instanceof PublicSubmissionError && err.linkUrl) {
      console.error(err.linkUrl);
    }
    return 1;
  }

  if (result.dryRun) {
    console.log("");
    console.log(
      `Dry run: would push ${result.candidateCount} new record(s) for skill '${result.skillName}' ` +
        `(cursor ${result.cursorBefore} -> ${result.cursorBefore + result.candidateCount}).`
    );
    console.log("Dry run: no network calls made, no state written.");
    return 0;
  }

  console.log("");
  if (result.skillUploaded) {
    console.log(`Skill '${result.skillName}' uploaded.`);
  } else {
    console.log(`Skill '${result.skillName}' upload skipped (already uploaded — pass --with-skill to force).`);
  }
  // `--public` (skill-registry-v0 spec §2): report exactly what the cloud
  // decided — never claim "listed" or a same-day promise the cloud didn't
  // actually return.
  if (isPublic) {
    if (result.publicSubmission) {
      const ps = result.publicSubmission;
      if (ps.noop) {
        console.log(`Already listed (unchanged): ${ps.pageUrl}`);
      } else if (ps.status === "listed") {
        console.log(`Listed: ${ps.pageUrl}`);
        console.log(`  get: ${ps.getCommand}`);
      } else {
        console.log(`Pending review (usually within 2 business days): ${ps.pageUrl}`);
      }
    } else if (result.skillUploaded) {
      // The upload succeeded but the cloud didn't return registry details —
      // an older cloud that doesn't understand `public: true` yet.
      console.log("--public was requested, but the cloud returned no registry listing details (older cloud?).");
    }
  }
  const rejectedNote = result.rejectedCount > 0 ? `, ${result.rejectedCount} permanently rejected` : "";
  console.log(
    `Pushed ${result.pushedCount}/${result.candidateCount} new record(s)${rejectedNote} for '${result.skillName}'. ` +
      `Cursor: ${result.cursorBefore} -> ${result.cursorAfter}.`
  );
  // Privacy first: a push never creates a public receipt unless --share was
  // passed (see PushOptions.share in push.ts). When --share wasn't passed,
  // point at the authenticated dashboard instead, plus a one-line nudge.
  // When --share WAS passed but nothing came back with a shareUrl (older
  // cloud that doesn't understand `share` yet, or a mint failure the cloud
  // swallowed), say so explicitly rather than exiting 0 with no URL at all
  // — then fall back to the same dashboard/tip lines.
  if (result.pushedCount > 0) {
    if (share && !sawShareUrl) {
      console.log("share requested, but the cloud returned no receipt link (older cloud or share failure)");
    }
    if (!share || !sawShareUrl) {
      // The URL always resolves now (env -> config file -> DEFAULT_CLOUD_URL)
      // — same chain resolvePushConfig used to actually push this run.
      const fileConfig = await readCliConfig();
      const cloudUrl = (process.env.REELIER_CLOUD_URL || fileConfig.cloudUrl || DEFAULT_CLOUD_URL).replace(/\/+$/, "");
      console.log(`Dashboard: ${cloudUrl}/dashboard/runs`);
      console.log("  tip: add --share for a public receipt link");
    }
  }
  if (result.aborted) {
    console.log("Stopped early on a transient failure (auth or network/error) — cursor left at the last consumed record.");
    return 1;
  }
  return 0;
}

/**
 * `reelier get <owner>/<skill>[@<N> | @sha256:<hex>]` — CONSUME half of the
 * public skill registry (see src/get.ts's header for the fetch API contract
 * and the @N/@sha256 request-shape decision). Never executes the skill;
 * only fetches, verifies, and writes one file.
 */
function printTrustBlock(outcome: Extract<GetOutcome, { kind: "written" }>): void {
  const { result, steps } = outcome;
  const gradeLabel = result.effectGrade === "read_only" ? "READ-ONLY" : "WRITES";
  console.log(`Effect grade: ${gradeLabel}`);
  if (steps.length > 0) {
    console.log("Per-step effects:");
    for (const s of steps) {
      console.log(`  Step ${s.n} — ${s.title} [${s.effect}]`);
    }
  }
  console.log(`Endpoints: ${result.endpoints.length > 0 ? result.endpoints.join(", ") : "(none)"}`);
  console.log(`License: ${result.license}`);
  console.log(`Content hash: sha256:${result.contentSha256}`);
  console.log("");
  console.log(`Next: reelier run ${outcome.path}`);
  if (result.effectGrade === "writes") {
    console.log("");
    console.log("Replay re-executes. This skill performs writes; `reelier run` will require --allow-writes.");
  }
}

/**
 * Trust-block variant for `reelier get --mine` (see cmdGetMine below):
 * private skills carry no registry grade, so there's no READ-ONLY/WRITES
 * badge — just the locally-parsed per-step effects/endpoints, the content
 * hash, an explicit "not a public listing" provenance line, and the next
 * command. Never executes anything.
 */
function printPrivateTrustBlock(outcome: Extract<GetMineOutcome, { kind: "written" }>): void {
  const { result, steps, endpoints } = outcome;
  if (steps.length > 0) {
    console.log("Per-step effects:");
    for (const s of steps) {
      console.log(`  Step ${s.n} — ${s.title} [${s.effect}]`);
    }
  }
  console.log(`Endpoints: ${endpoints.length > 0 ? endpoints.join(", ") : "(none)"}`);
  console.log(`Content hash: sha256:${result.contentSha256}`);
  console.log("source: your private cloud copy (not a public listing)");
  console.log("");
  console.log(`Next: reelier run ${outcome.path}`);
}

async function cmdGetMine(name: string, args: ParsedArgs): Promise<number> {
  let outcome: GetMineOutcome;
  try {
    outcome = await getMineSkill(name, { dir: args.opts.dir, force: args.flags.has("force") });
  } catch (err) {
    console.error((err as Error).message);
    return 1;
  }

  switch (outcome.kind) {
    case "error":
      console.error(outcome.message);
      return 1;
    case "tamper":
      console.error(
        `Integrity check FAILED — the fetched content's sha256 does not match the server-declared contentSha256. ` +
          `Expected ${outcome.expectedSha}, got ${outcome.actualSha}. Nothing was written.`
      );
      return 1;
    case "hash-mismatch":
      console.error(
        `${outcome.path} already exists with different content (local sha256 ${outcome.existingSha}, incoming ` +
          `${outcome.incomingSha}). Run 'reelier diff' to compare, or pass --force to overwrite.`
      );
      return 1;
    case "up-to-date":
      console.log(`${outcome.path} is already up to date (skill '${outcome.skillName}').`);
      return 0;
    case "written":
      console.log(`Wrote ${outcome.path}.`);
      console.log("");
      printPrivateTrustBlock(outcome);
      return 0;
  }
}

export async function cmdGet(args: ParsedArgs): Promise<number> {
  const ref = args.positional[0];
  if (!ref) {
    console.error(
      "Usage: reelier get <owner>/<skill>[@<N> | @sha256:<hex>] [--dir <dir>] [--force]\n" +
        "       reelier get --mine <name> [--dir <dir>] [--force]"
    );
    return 1;
  }

  if (args.flags.has("mine")) {
    return cmdGetMine(ref, args);
  }

  let outcome: GetOutcome;
  try {
    outcome = await getSkill(ref, { dir: args.opts.dir, force: args.flags.has("force") });
  } catch (err) {
    console.error((err as Error).message);
    return 1;
  }

  switch (outcome.kind) {
    case "error":
      console.error(outcome.message);
      return 1;
    case "removed":
      console.error(`This skill has been removed from the registry: ${outcome.reason}`);
      return 1;
    case "tamper":
      console.error(
        `Integrity check FAILED — the fetched content's sha256 does not match the ${
          outcome.source === "pin" ? "requested @sha256: pin" : "server-declared contentSha256"
        }. Expected ${outcome.expectedSha}, got ${outcome.actualSha}. Nothing was written.`
      );
      return 1;
    case "hash-mismatch":
      console.error(
        `${outcome.path} already exists with different content (local sha256 ${outcome.existingSha}, incoming ` +
          `${outcome.incomingSha}). Run 'reelier diff' to compare, or pass --force to overwrite.`
      );
      return 1;
    case "up-to-date":
      console.log(`${outcome.path} is already up to date (skill '${outcome.skillName}' v${outcome.version}).`);
      return 0;
    case "written":
      console.log(`Wrote ${outcome.path} (v${outcome.result.version}).`);
      console.log("");
      printTrustBlock(outcome);
      return 0;
  }
}

/**
 * `reelier verify <permalink|file> [--key <pub.pem>]` — trust-ladder plan
 * task A4. Fetches/reads the receipt, recomputes the digest, and prints
 * every claim as its own line — never a bare OK (spec §1's governing rule:
 * a ladder of graded claims, never a blanket checkmark). Exits 1 only when
 * a claim that IS present actually FAILED verification; absent or
 * unchecked claims (unsigned, or signed with no --key given to check
 * against) never fail the exit code.
 */
export async function cmdVerify(args: ParsedArgs): Promise<number> {
  const target = args.positional[0];
  if (!target) {
    console.error("Usage: reelier verify <permalink|file> [--key <pub.pem>]");
    return 1;
  }

  let publicPem: string | undefined;
  if (args.opts.key) {
    try {
      publicPem = await readFile(args.opts.key, "utf8");
    } catch (err) {
      console.error(`Could not read --key ${args.opts.key}: ${(err as Error).message}`);
      return 1;
    }
  }

  const outcome = await resolveVerifyPayload(target, { cwd: process.cwd() });
  if (!outcome.ok) {
    console.error(outcome.message);
    return 1;
  }

  const result = evaluateVerifyClaims(outcome.payload, publicPem);
  console.log(`Verifying ${target}:`);
  for (const claim of result.claims) console.log(`  ${claim.line}`);
  console.log("");
  console.log(
    result.exitCode === 0
      ? "No present claim failed verification. (Absent/unchecked rows above are honest gaps, not passes — see docs/specs/trust-ladder-v1.md §1 for what each raises.)"
      : "At least one present claim FAILED verification — see the ✗ line above."
  );
  return result.exitCode;
}

/**
 * Compile a trace, print the "these are the gaps I won't guess about" open
 * questions block, replay it once at Level 0 (zero LLM calls, optionally
 * against real `--wrap`'d downstream(s) for the recorded-session path), and
 * print the closing receipt. Shared by both `init` paths (demo and real
 * MCP recording) so the compile/replay/receipt steps behave identically
 * regardless of how the trace was produced.
 */
async function compileReplayAndReceipt(
  tracePath: string,
  cwd: string,
  demoBenchmark: DemoBenchmarkComparison | undefined,
  wraps: string[]
): Promise<number> {
  console.log("");
  console.log("Compiling live (zero LLM calls)...");
  const source = await readFile(tracePath, "utf8");
  const records = parseTraceLines(source);
  const skillPath = path.join(cwd, "reelier-init-demo.skill.md");

  let compiled;
  try {
    compiled = await compileDemoTrace(records, path.basename(tracePath), skillPath);
  } catch (err) {
    console.error(`Compile failed: ${(err as Error).message}`);
    return 1;
  }
  console.log(`  Wrote ${compiled.skillPath}`);
  console.log(
    `  steps: ${compiled.result.stats.steps}  asserts: ${compiled.result.stats.asserts}  binds: ${compiled.result.stats.binds}`
  );
  console.log("");
  if (compiled.result.openQuestions.length === 0) {
    console.log("Open questions: (none) — these are the gaps I won't guess about");
  } else {
    console.log(`Open questions (${compiled.result.openQuestions.length}) — these are the gaps I won't guess about:`);
    for (const oq of compiled.result.openQuestions) {
      const where = oq.stepN !== undefined ? `Step ${oq.stepN}` : "(trailing note)";
      console.log(`  - ${where}: ${oq.text}`);
    }
  }

  console.log("");
  console.log("Replaying once (Level 0 — the LLM is never constructed or called)...");

  const downstreams: DownstreamConnection[] = [];
  try {
    for (const spec of wraps) {
      downstreams.push(await connectDownstream(spec));
    }
    const tools = downstreams.length > 0 ? { ...builtinTools, ...buildMcpTools(downstreams) } : undefined;

    const skill = parseSkill(compiled.source);
    const record = await runSkill(skill, {
      cwd,
      tools,
      maxLevel: 0,
      skillPath: compiled.skillPath,
      skillContentSha256: createHash("sha256").update(compiled.source, "utf8").digest("hex"),
      onStep: (rec) => {
        const icon = rec.outcome === "passed" || rec.outcome === "unchecked" ? "✓" : rec.outcome === "skipped" ? "○" : "✗";
        console.log(`  ${icon} Step ${rec.n} — ${rec.title} [${rec.outcome}] ${rec.ms}ms`);
      },
    });

    // Level 0 must never touch the LLM — assert that rather than assuming
    // it before the receipt claims "0 tokens" (never claim a step succeeded
    // that didn't).
    if (record.totals.llmInputTokens !== 0 || record.totals.llmOutputTokens !== 0) {
      console.error(
        `WARNING: Level 0 replay reported nonzero LLM token usage (${record.totals.llmInputTokens} in / ` +
          `${record.totals.llmOutputTokens} out) — that should be structurally impossible. Reporting the real ` +
          `numbers below rather than a "0 tokens" claim that wouldn't be true.`
      );
    }

    for (const line of formatReceipt(record, demoBenchmark)) console.log(line);
    for (const line of formatNextSteps(compiled.skillPath)) console.log(line);

    if (!record.passed) {
      console.error("\nReplay did not pass — see the failures above. That's still your real result, not hidden.");
      return 1;
    }
    return 0;
  } catch (err) {
    console.error(`Replay failed: ${(err as Error).message}`);
    return 1;
  } finally {
    await Promise.all(downstreams.map((d) => d.close().catch(() => {})));
  }
}

async function runDemoPath(cwd: string): Promise<number> {
  console.log("");
  console.log("Recording the zero-setup demo — 2 real HTTP requests, nothing fabricated:");
  console.log("  1. GET reelier's versioned npm registry metadata");
  console.log("  2. GET the package homepage, using the URL bound from step 1's response");
  console.log("");

  const traceDir = path.join(cwd, ".reelier", "traces");
  const recorder = new Recorder(traceDir);
  const recording = await runDemoRecording(recorder, { allowDestructive: false });
  if (!recording.ok) {
    console.error(`Recording failed: ${recording.message}`);
    return 1;
  }
  console.log(`  Recorded ${recording.tracePath}`);

  return compileReplayAndReceipt(recording.tracePath, cwd, LAUNCH_BENCHMARK_COMPARISON, []);
}

async function runRealPath(wrapCommand: string, cwd: string): Promise<number> {
  const traceDir = path.join(cwd, ".reelier", "traces");
  const tracePath = await findNewestTraceFile(traceDir);
  if (!tracePath) {
    console.error(
      `No trace found under ${traceDir} — recording may not have happened, or reelier_stop_recording was never ` +
        `called. Nothing to compile; re-run 'reelier init' once you've recorded a session.`
    );
    return 1;
  }
  console.log(`  Found trace ${tracePath}`);
  return compileReplayAndReceipt(tracePath, cwd, undefined, [wrapCommand]);
}

/**
 * Init's closing offer — wrap install as the recommended next step (lossless
 * capture by default). Re-detects the configs (init itself may have just
 * written .mcp.json). Interactive (real TTY, no --yes): y/N prompt, default
 * N — the config is never modified without an explicit yes. Non-interactive:
 * the exact `reelier install` one-liner is printed instead of a prompt. Every
 * write goes through applyInstall's backup-or-abort guard, and the
 * `reelier uninstall` exit is printed right after a successful install.
 */
async function offerWrapInstall(cwd: string, homedir: string, interactive: boolean): Promise<number> {
  const detection = await detectAgentConfig(cwd, homedir);
  const offer = await planWrapOffer(detection, interactive);
  for (const line of offer.lines) console.log(line);
  if (offer.mode !== "prompt" || !offer.plan) return 0;

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let choice: string;
  try {
    choice = (await rl.question("  Wrap them now? [y/N] ")).trim().toLowerCase();
  } finally {
    rl.close();
  }
  if (choice !== "y" && choice !== "yes") {
    console.log("  Skipped — turn it on anytime: reelier install");
    return 0;
  }

  for (const e of offer.plan.entries) {
    if (e.action === "wrap") console.log(`  ${e.name}: will wrap`);
    else if (e.action === "already-wrapped") console.log(`  ${e.name}: already wrapped — left alone`);
    else console.log(`  ${e.name}: skipped — ${e.reason}`);
  }

  let result: InstallResult;
  try {
    result = await applyInstall(offer.plan);
  } catch (err) {
    // applyInstall's backup-or-abort guard: nothing was written.
    console.error(`  Install aborted: ${(err as Error).message}`);
    return 1;
  }
  console.log(`  Wrapped ${result.wrappedCount} server(s) in ${offer.configPath}.`);
  if (result.backupPath) console.log(`  Original config backed up to ${result.backupPath}.`);
  console.log("  Restart your agent to pick up the wrapped servers. To revert: reelier uninstall");
  return 0;
}

/**
 * `reelier init --signing` — generate (or, if one already exists, report)
 * the local Ed25519 signing key at `~/.reelier/signing/`. A distinct,
 * short-circuiting path off `cmdInit`: it does none of the record/replay
 * demo flow, so it's fast, non-interactive, and safe to run repeatedly.
 * Idempotent by design (mirrors `reelier approve`'s unchanged-semantics,
 * trust-ladder plan task A2) — an existing key is printed, never
 * regenerated; there is no legitimate reason for a bare `--signing` re-run
 * to silently mint a second key a user didn't ask to rotate.
 */
async function cmdInitSigning(homedir: string): Promise<number> {
  const dir = signingKeyDir(homedir);

  const existing = await loadSigningKey(dir);
  if (existing) {
    let publicPem: string;
    try {
      publicPem = await readFile(path.join(dir, `${existing.keyId}.pub.pem`), "utf8");
    } catch (err) {
      console.error(
        `Signing key already exists: ${existing.keyId}, but its public key file could not be read (${
          (err as Error).message
        }). The private key is intact; re-derive/re-export the public half or generate a new key.`
      );
      return 1;
    }
    console.log(`Signing key already exists: ${existing.keyId}`);
    console.log(publicPem.trim());
    console.log("Register it: https://reelier.com/settings/keys");
    return 0;
  }

  const generated = await generateSigningKeypair(dir);
  console.log(`Generated signing key: ${generated.keyId}`);
  console.log(`Private key: ${generated.privatePath} (keep this secret — never commit it, never upload it)`);
  console.log(generated.publicPem.trim());
  console.log("Register it: https://reelier.com/settings/keys");
  return 0;
}

// Exported so test/init-signing-cli.test.ts can drive the `--signing` path
// directly (same reasoning as cmdPush's export note above).
export interface CmdInitOverrides {
  readonly cwd?: string;
  readonly homedir?: string;
  readonly authorityRoot?: string;
  readonly dependencies?: InitializationDependencies;
}

export async function cmdInit(args: ParsedArgs, overrides: CmdInitOverrides = {}): Promise<number> {
  const cwd = overrides.cwd ?? process.cwd();
  const homedir = overrides.homedir ?? os.homedir();

  if (args.flags.has("signing")) {
    return cmdInitSigning(homedir);
  }

  try {
    const result = await initializeInspection({
      cwd,
      homedir,
      dryRun: args.flags.has("dry-run"),
      ...(overrides.authorityRoot === undefined ? {} : { authorityRoot: overrides.authorityRoot }),
      ...(overrides.dependencies === undefined ? {} : { dependencies: overrides.dependencies }),
    });
    if (result.status === "busy") {
      console.error("Initialization busy: another local inspection is in progress.");
      return 2;
    }
    for (const line of renderInitializationReport(result.report, result.status === "dry-run")) console.log(line);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("checkpoint state refused")) {
      console.error("Initialization refused: checkpoint state is malformed, unknown, or stale.");
    } else {
      console.error("Initialization refused: local inspection failed.");
    }
    return 1;
  }

}

/** env -> config file -> DEFAULT_CLOUD_URL — same chain resolvePushConfig uses to resolve a base URL. */
async function resolveBaseUrl(): Promise<string> {
  const fileConfig = await readCliConfig();
  return (process.env.REELIER_CLOUD_URL || fileConfig.cloudUrl || DEFAULT_CLOUD_URL).replace(/\/+$/, "");
}

/**
 * `reelier login` — OAuth-Device-Flow-shaped handshake against Reelier
 * Cloud: start the device code, print it + the confirm URL, best-effort open
 * a browser, then poll until the user approves (or Ctrl-C cancels). Writes
 * the resulting key to ~/.reelier/config.json. Never prints the key itself —
 * only the resolved identity ("Logged in as ...").
 *
 * `fetchImpl`/`sleepImpl`/`spawnImpl` are injection seams for tests (house
 * default-parameter pattern, as in push.ts) — they pass straight through to
 * login.ts's own `startLogin`/`pollForToken`/`openBrowser` opts rather than
 * duplicating any polling/spawn logic here.
 */
export async function cmdLogin(
  fetchImpl: typeof fetch = fetch,
  sleepImpl?: (ms: number) => Promise<void>,
  spawnImpl?: typeof spawn
): Promise<number> {
  const baseUrl = await resolveBaseUrl();
  let start;
  try {
    start = await startLogin(baseUrl, fetchImpl);
  } catch (err) {
    console.error(`Failed to start login: ${(err as Error).message}`);
    return 1;
  }

  console.log("Confirm this code in your browser:\n");
  console.log(`    ${start.userCode}\n`);
  console.log(start.verificationUriComplete);
  console.log("\nWaiting for approval (Ctrl-C to cancel)...");

  openBrowser(start.verificationUriComplete, undefined, spawnImpl);

  let apiKey: string;
  let tenant: { name: string; githubLogin: string | null };
  try {
    ({ apiKey, tenant } = await pollForToken(baseUrl, start.deviceCode, {
      intervalSeconds: start.interval,
      fetchImpl,
      sleepImpl,
    }));
  } catch (err) {
    console.error((err as Error).message);
    return 1;
  }

  await writeCliConfig({
    cloudUrl: baseUrl === DEFAULT_CLOUD_URL ? undefined : baseUrl,
    apiKey,
    tenantName: tenant.name,
    githubLogin: tenant.githubLogin ?? undefined,
  });

  console.log(`Logged in as ${tenant.githubLogin ?? tenant.name}. 'reelier push <skill>' now syncs receipts.`);
  return 0;
}

/**
 * `reelier logout` — clears the locally stored key. Does NOT revoke the key
 * server-side; that happens from the dashboard (Settings), which is worth
 * saying out loud since a lingering key would otherwise silently work again.
 */
export async function cmdLogout(): Promise<number> {
  await clearCliCredentials();
  console.log("Logged out.");
  console.log("Note: this only clears the key on this machine — revoke it from the dashboard (Settings) if it may have leaked.");
  return 0;
}

/**
 * `reelier whoami` — GET /api/v1/me with the stored key, prints the resolved
 * identity or a precise reason it couldn't (no key at all vs. a rejected key).
 * `fetchImpl` is an injection seam for tests (house default-parameter
 * pattern, as in push.ts).
 */
export async function cmdWhoami(fetchImpl: typeof fetch = fetch): Promise<number> {
  const baseUrl = await resolveBaseUrl();
  const fileConfig = await readCliConfig();
  const apiKey = process.env.REELIER_CLOUD_KEY || fileConfig.apiKey;
  if (!apiKey) {
    console.error("Not logged in. Run 'reelier login'.");
    return 1;
  }

  let res;
  try {
    res = await fetchImpl(`${baseUrl}/api/v1/me`, {
      headers: { authorization: `Bearer ${apiKey}` },
    });
  } catch (err) {
    console.error(`Failed to look up identity: ${(err as Error).message}`);
    return 1;
  }
  if (res.status === 401) {
    console.error("API key is invalid or revoked. Run 'reelier login' again.");
    return 1;
  }
  if (!res.ok) {
    console.error(`Failed to look up identity (HTTP ${res.status}).`);
    return 1;
  }
  let tenant: { name: string; githubLogin: string | null };
  try {
    ({ tenant } = (await res.json()) as { tenant: { name: string; githubLogin: string | null } });
  } catch (err) {
    console.error(`Failed to look up identity: ${(err as Error).message}`);
    return 1;
  }
  console.log(`${tenant.githubLogin ?? tenant.name} (${baseUrl})`);
  return 0;
}

async function cmdConnect(args: ParsedArgs): Promise<number> {
  const provider = args.positional[0];
  if (provider !== "gmail" && provider !== "stripe") { console.error("connect requires gmail or stripe"); return 1; }
  const root = path.resolve(args.opts.path ?? "authority");
  await mkdir(path.join(root, "connectors"), { recursive: true });
  const file = path.join(root, "connectors", `${provider}.json`);
  try { await access(file); console.log(JSON.stringify({ provider, status: "configured", file })); return 0; } catch { /* create metadata below */ }
  await writeFile(file, `${JSON.stringify({ v: "reelier.connector-intent/v1", provider, status: "oauth-required", createdAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ provider, status: "oauth-required", next: "open browser to authorize the managed worker", file }));
  return 0;
}

export async function cmdConnections(args: ParsedArgs): Promise<number> {
  const root = path.resolve(args.opts.path ?? "authority");
  try {
    const report = await loadConnectionInventory(root);
    console.log(JSON.stringify(report));
    return report.issues.length === 0 ? 0 : 1;
  } catch {
    console.error(JSON.stringify({ v: "reelier.connection-inventory-refusal/v1", reasonCode: "inventory-unreadable" }));
    return 1;
  }
}

async function cmdDeploy(args: ParsedArgs): Promise<number> {
  const candidate = args.positional[0];
  if (!candidate) { console.error("deploy requires a candidate alias or file"); return 1; }
  const root = path.resolve(args.opts.path ?? "authority");
  const candidateFile = path.isAbsolute(candidate) ? candidate : path.resolve(process.cwd(), candidate);
  try {
    const raw = JSON.parse(await readFile(candidateFile, "utf8")) as Record<string, unknown>;
    const job = raw.job as Record<string, unknown> | undefined;
    const alias = typeof job?.jobId === "string" ? job.jobId : path.basename(candidate).replace(/\.json$/i, "");
    const output = path.join(root, "deployments", alias);
    const built = await buildAuthorityDeployment(candidateFile, output, path.join(root, "keys", "local-gate.pem"));
    console.log(JSON.stringify({ alias, status: "deployed", deploymentFile: built.deploymentFile, jobCardFile: built.jobCardFile, jobId: built.jobCard.jobId }));
    return 0;
  } catch (error) {
    console.error(JSON.stringify({ status: "refused", reasonCode: "deployment-invalid", message: error instanceof Error ? error.message : String(error) }));
    return 1;
  }
}

async function cmdDoctor(args: ParsedArgs): Promise<number> {
  return runAuthorityCommand({ positional: ["doctor"], flags: args.flags, opts: { path: args.opts.path ?? "authority/authority.yml" } });
}

const USAGE =
  "Usage: reelier <run|bench|baseline|cost|prices|mcp|serve|trace|compile|manifest|approve|push|get|verify|diff|ci|policy|init|discover|connections|connect|deploy|doctor|bridge|from-session|scan|install|uninstall|login|logout|whoami> [options]\n" +
  "  discover â€” rank observed workflow opportunities locally; use --upload to preview and explicitly send one sanitized bundle to Arena Cloud.\n" +
  "  bridge  — reelier bridge --port 4777: expose nonce-gated local capabilities and Work Card handoff metadata; never executes Cloud plugin code.\n" +
  "  login  — reelier login: connect this machine to Reelier Cloud via a device-code browser handshake; writes ~/.reelier/config.json.\n" +
  "  logout — reelier logout: clears the locally stored key (revoke it from the dashboard's Settings, not locally).\n" +
  "  whoami — reelier whoami: print the identity the stored key resolves to, or that you're not logged in.\n" +
  "  ci     — reelier ci [--force] [--path <dir>]: writes .github/workflows/reelier-replay.yml — drift-CI + PR receipts in one command.\n" +
  "  manifest — reelier manifest <skill.md> --wrap \"<command>\": stamp/refresh the skill's tool-schema manifest from live servers.\n" +
  "  resolve — reelier resolve <skill.md> --wrap \"<command>\": resolve deferred attestations (attest.defer) by probing for the provider record. Appends the answer as a NEW record; never amends the original, and writes nothing for one still legitimately waiting.\n" +
  "  approve — reelier approve <skill.md> [--all]: hash-bind approval onto each write/destructive step (the final replay boundary).\n" +
  "  mcp    — RECORDER: fronts your own --wrap'd MCP server(s) to capture their calls into a trace.\n" +
  "           Enforces .reelier/policy.yml (or ~/.reelier/policy.yml) — deny/dry-run rules; pass --allow-writes\n" +
  "           to satisfy a rule's 'unless: \"--allow-writes\"' escape.\n" +
  "  serve  — TOOL-SERVER: exposes Reelier's own commands (scan/from-session/replay/push/diff) as MCP tools.\n" +
  "           --workspace <abs-path>: workspace-sensitive defaults (compiled skills, .reelier/ state) resolve here\n" +
  "           instead of the process cwd — REQUIRED when a plugin host launches serve with the plugin dir as cwd.\n" +
  "           An explicit per-call cwd/out argument always wins over the workspace.\n" +
  "  get    — fetch a public registry skill to ./skills/<skill>.skill.md; never executes it.\n" +
  "           reelier get --mine <name> fetches YOUR OWN private skill (authenticated) instead.\n" +
  "  init   - reelier init [--dry-run]: checkpointed local inspection of Path A observation, Path B replay/freeze\n" +
  "           candidates, and Path C connections/candidates. It does not deploy, gate, dispatch, upload, or rewrite configs.\n" +
  "           --dry-run performs the same local inspection without writing .reelier/init artifacts.\n" +
  "  init --signing — generate (or print the existing) Ed25519 signing key at ~/.reelier/signing/; idempotent.\n" +
  "  authority certify — private expert workflow: init --config <v2>, then require --scenario <id> or --all for preflight,\n" +
  "           seal-readiness, export, and offline verify --input <export>. Readiness remains unsigned and non-dispatchable.\n" +
  "  verify <permalink|file> [--key <pub.pem>] — recompute the record digest and check signature/timestamp claims.\n" +
  "  diff   — compare the last two runs of a skill; exit 1 on drift (gate a scheduled replay).\n" +
  "  baseline — reelier baseline <skill.md>: the latest run against a median/MAD baseline of this skill's OWN previous runs,\n" +
  "           computed from .reelier/runs/ on this disk. Reports deviations; executes nothing, gates nothing, always exits 0.\n" +
  "  cost   — reelier cost [skill] [--since 7d|30d|all]: $ per run from recorded LLM tokens + ~/.reelier/prices.yml.\n" +
  "  prices — reelier prices lists the active merged price table; 'reelier prices update' prints the bundled table's freshness.\n" +
  "  policy check [path] — lint a policy.yml (unknown keys, bad globs, empty rules); exit 1 on any error.\n" +
  "  from-session — compile a transcript from Claude Code, Codex CLI, or OpenClaw into a skill.\n" +
  "           Format is sniffed from content; override with --agent <claude-code|codex|openclaw|cursor|windsurf>.\n" +
  "           --agent cursor / --agent windsurf report why those aren't supported yet instead of guessing.\n" +
  "  scan   — discover session transcripts from every known agent (also reports Cursor/Windsurf DB findings).\n" +
  "  coverage — reelier coverage --host <codex|claude-code> [--workspace <dir>]: read-only observed inventory of a host's\n" +
  "           MCP servers (config + plugins), wrapped/unwrapped per entry.\n" +
  "           --host claude-code covers the Claude Code CLI only; Claude Desktop / Cowork plugins are a separate host\n" +
  "           with a separate registry and are not inspected. It also lists EVERY project-scoped server under\n" +
  "           ~/.claude.json's `projects` map, with its own denominator — install rewrites only the one matching cwd.\n" +
  "           Observed inventory only; never a completeness claim.\n" +
  "  install / uninstall — wrap, and revert, every known host MCP config: Claude Code, Cursor, Windsurf.\n" +
  "           In ~/.claude.json install also wraps projects[<cwd>].mcpServers; other projects' entries are reported,\n" +
  "           never rewritten — re-run install from that directory, or see 'reelier coverage --host claude-code'.\n" +
  "           install backs up each config before rewriting it; uninstall restores the latest backup per config and\n" +
  "           reports every config it could NOT revert rather than skipping it. Both take --config <path> to target\n" +
  "           one file and --dry-run to see the plan; uninstall exits 1 if any config is left unreverted.";

async function main(): Promise<number> {
  const [, , cmd, ...rest] = process.argv;

  if (cmd === "--version" || cmd === "-v") {
    try {
      const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
      console.log(pkg.version);
    } catch {
      console.log("unknown");
    }
    return 0;
  }
  if (cmd === "--help" || cmd === "-h") {
    console.log(USAGE);
    return 0;
  }

  const args = parseArgv(rest);

  switch (cmd) {
    case "run":
      return cmdRun(args);
    case "bench":
      return cmdBench(args);
    case "baseline":
      return cmdBaseline(args);
    case "cost":
      return cmdCost(args);
    case "prices":
      return cmdPrices(args);
    case "mcp":
      return cmdMcp(args);
    case "serve":
      return cmdServe(args);
    case "trace":
      return cmdTrace(args);
    case "compile":
      return cmdCompile(args);
    case "manifest":
      return cmdManifest(args);
    case "resolve":
      return cmdResolve(args);
    case "approve":
      return cmdApprove(args);
    case "push":
      return cmdPush(args);
    case "get":
      return cmdGet(args);
    case "verify":
      return cmdVerify(args);
    case "diff":
      return cmdDiff(args);
    case "ci":
      return cmdCi(args);
    case "policy":
      return cmdPolicy(args);
    case "authority":
      return runAuthorityCommand(args);
    case "init":
      return cmdInit(args);
    case "discover":
      return cmdDiscover(args);
    case "connections":
      return cmdConnections(args);
    case "connect":
      return cmdConnect(args);
    case "deploy":
      return cmdDeploy(args);
    case "doctor":
      return cmdDoctor(args);
    case "bridge":
      return cmdBridge(args);
    case "coverage":
      return cmdCoverage(args);
    case "from-session":
      return cmdFromSession(args);
    case "scan":
      return cmdScan(args);
    case "install":
      return cmdInstall(args);
    case "uninstall":
      return cmdUninstall(args);
    case "login":
      return cmdLogin();
    case "logout":
      return cmdLogout();
    case "whoami":
      return cmdWhoami();
    default:
      console.error(USAGE);
      return 1;
  }
}

// Only run main() when this file is the process entry point (`node
// dist/cli.js ...`, the npx-installed `reelier` bin, an npm global bin
// symlink, or a node_modules/.bin shim) — NOT when it's merely imported as
// a module (e.g. test/push-cli.test.ts imports cmdPush directly to
// exercise its console output). Without this guard, importing cli.js for
// its exports would also execute the full CLI against the importer's own
// argv, printing USAGE and setting a stray exitCode.
//
// Node resolves import.meta.url to the REAL (symlink-followed) path of the
// running module, but leaves process.argv[1] as the symlink path the
// process was invoked through — so on Unix, comparing the two raw would
// always mismatch for every symlinked invocation (npm global bin, `npx
// reelier`, local node_modules/.bin), the CLI's primary distribution path.
// realpathSync(argv[1]) resolves argv[1] the same way import.meta.url
// already is before comparing. Wrapped in try/catch and falls back to the
// unresolved comparison — argv[1] might not exist in exotic embedding
// scenarios, and this must never throw at import time.
function resolveIsMainModule(): boolean {
  const argv1 = process.argv[1];
  if (argv1 === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(argv1)).href;
  } catch {
    return import.meta.url === pathToFileURL(argv1).href;
  }
}

const isMainModule = resolveIsMainModule();

if (isMainModule) {
  main()
    .then((code) => {
      // Set exitCode rather than force-calling process.exit(): fetch's
      // underlying async handles need a turn of the event loop to close
      // cleanly (a forced exit() here can race that teardown on Windows).
      process.exitCode = code;
    })
    .catch((err) => {
      console.error(err instanceof Error ? err.stack ?? err.message : String(err));
      process.exitCode = 1;
    });
}
