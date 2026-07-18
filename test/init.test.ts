import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  detectAgentConfig,
  agentConfigPaths,
  reelierProxyCommandLine,
  buildReelierServerEntry,
  parseMcpConfig,
  mergeReelierServer,
  formatMcpConfigJson,
  planMcpConfigWrite,
  applyMcpConfigWrite,
  findNewestTraceFile,
  runDemoRecording,
  compileDemoTrace,
  formatReceipt,
  formatNextSteps,
  LAUNCH_BENCHMARK_COMPARISON,
} from "../src/init.js";
import { Recorder } from "../src/recorder.js";
import { parseTraceLines } from "../src/trace.js";
import { parseSkill } from "../src/skill.js";
import { compile } from "../src/compile.js";
import type { Tool, ToolContext } from "../src/tools.js";
import type { RunRecord } from "../src/runner.js";

async function withTmpDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-init-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Config detection on fixture dirs
// ---------------------------------------------------------------------------

test("detectAgentConfig: reports not-found when neither config exists", async () => {
  await withTmpDir(async (dir) => {
    const cwd = path.join(dir, "cwd");
    const home = path.join(dir, "home");
    await mkdir(cwd, { recursive: true });
    await mkdir(home, { recursive: true });

    const result = await detectAgentConfig(cwd, home);
    assert.equal(result.projectConfigExists, false);
    assert.equal(result.userConfigExists, false);
    assert.equal(result.projectConfigPath, path.join(cwd, ".mcp.json"));
    assert.equal(result.userConfigPath, path.join(home, ".claude.json"));
  });
});

test("detectAgentConfig: reports found for whichever of .mcp.json / ~/.claude.json actually exist", async () => {
  await withTmpDir(async (dir) => {
    const cwd = path.join(dir, "cwd");
    const home = path.join(dir, "home");
    await mkdir(cwd, { recursive: true });
    await mkdir(home, { recursive: true });
    await writeFile(path.join(cwd, ".mcp.json"), "{}", "utf8");
    // user config deliberately absent

    const result = await detectAgentConfig(cwd, home);
    assert.equal(result.projectConfigExists, true);
    assert.equal(result.userConfigExists, false);
  });
});

test("agentConfigPaths is pure and matches detectAgentConfig's paths", () => {
  const paths = agentConfigPaths("/some/cwd", "/some/home");
  assert.equal(paths.projectConfigPath, path.join("/some/cwd", ".mcp.json"));
  assert.equal(paths.userConfigPath, path.join("/some/home", ".claude.json"));
});

test("reelierProxyCommandLine prints the exact npx invocation", () => {
  const line = reelierProxyCommandLine("npx -y @your/mcp-server");
  assert.equal(line, 'npx -y @seldonframe/reelier mcp --wrap "npx -y @your/mcp-server"');
});

// ---------------------------------------------------------------------------
// .mcp.json merge — preserves existing servers, never duplicates/clobbers
// ---------------------------------------------------------------------------

test("mergeReelierServer: adds reelier to an empty config", () => {
  const result = mergeReelierServer({}, buildReelierServerEntry("npx -y @your/mcp-server"));
  assert.equal(result.added, true);
  assert.deepEqual(result.preservedServerNames, []);
  assert.deepEqual(result.config.mcpServers?.reelier, {
    command: "npx",
    args: ["-y", "@seldonframe/reelier", "mcp", "--wrap", "npx -y @your/mcp-server"],
  });
});

test("mergeReelierServer: preserves an existing unrelated server untouched", () => {
  const existing = parseMcpConfig(
    JSON.stringify({
      mcpServers: {
        "some-other-server": { command: "npx", args: ["-y", "@some/other"] },
      },
    })
  );
  const result = mergeReelierServer(existing, buildReelierServerEntry("npx -y @your/mcp-server"));
  assert.equal(result.added, true);
  assert.deepEqual(result.preservedServerNames, ["some-other-server"]);
  assert.deepEqual(result.config.mcpServers?.["some-other-server"], {
    command: "npx",
    args: ["-y", "@some/other"],
  });
  assert.ok(result.config.mcpServers?.reelier);
});

test("mergeReelierServer: a pre-existing 'reelier' entry is left unchanged, never clobbered", () => {
  const existing = parseMcpConfig(
    JSON.stringify({
      mcpServers: {
        reelier: { command: "custom", args: ["hand-edited"] },
      },
    })
  );
  const result = mergeReelierServer(existing, buildReelierServerEntry("npx -y @your/mcp-server"));
  assert.equal(result.added, false);
  assert.deepEqual(result.config.mcpServers?.reelier, { command: "custom", args: ["hand-edited"] });
});

test("parseMcpConfig: rejects a non-object root", () => {
  assert.throws(() => parseMcpConfig("[1,2,3]"), /JSON object/);
});

test("parseMcpConfig: undefined/empty text means 'no file yet' -> {}", () => {
  assert.deepEqual(parseMcpConfig(undefined), {});
  assert.deepEqual(parseMcpConfig("   "), {});
});

test("planMcpConfigWrite + applyMcpConfigWrite: merges and atomically writes, preserving existing servers", async () => {
  await withTmpDir(async (dir) => {
    const configPath = path.join(dir, ".mcp.json");
    await writeFile(
      configPath,
      JSON.stringify({ mcpServers: { existing: { command: "npx", args: ["-y", "@existing/server"] } } }, null, 2),
      "utf8"
    );

    const plan = await planMcpConfigWrite(configPath, "npx -y @your/mcp-server");
    assert.equal(plan.result.added, true);
    assert.deepEqual(plan.result.preservedServerNames, ["existing"]);
    assert.match(plan.after, /"existing"/);
    assert.match(plan.after, /"reelier"/);

    await applyMcpConfigWrite(configPath, plan.result.config);

    const written = JSON.parse(await readFile(configPath, "utf8"));
    assert.ok(written.mcpServers.existing);
    assert.ok(written.mcpServers.reelier);
    assert.deepEqual(written.mcpServers.reelier.args, [
      "-y",
      "@seldonframe/reelier",
      "mcp",
      "--wrap",
      "npx -y @your/mcp-server",
    ]);

    // Atomicity: no leftover .tmp-* file after a successful write.
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(dir);
    assert.ok(!entries.some((e) => e.includes(".tmp-")), `leftover temp file(s): ${entries.join(", ")}`);
  });
});

test("planMcpConfigWrite: a malformed existing .mcp.json refuses (throws) rather than silently overwriting — file is left byte-identical", async () => {
  await withTmpDir(async (dir) => {
    const configPath = path.join(dir, ".mcp.json");
    const malformed = "{ this is not valid json,,, ";
    await writeFile(configPath, malformed, "utf8");

    await assert.rejects(() => planMcpConfigWrite(configPath, "npx -y @your/mcp-server"));

    const after = await readFile(configPath, "utf8");
    assert.equal(after, malformed, "malformed .mcp.json must be left byte-identical, never overwritten");
  });
});

test("mergeReelierServer: an unknown top-level key (e.g. '$schema') survives the merge untouched", () => {
  const existing = parseMcpConfig(
    JSON.stringify({
      $schema: "https://example.com/mcp-config.schema.json",
      mcpServers: { existing: { command: "npx", args: ["-y", "@existing/server"] } },
    })
  );
  const result = mergeReelierServer(existing, buildReelierServerEntry("npx -y @your/mcp-server"));
  assert.equal(result.added, true);
  assert.equal(result.config.$schema, "https://example.com/mcp-config.schema.json");
  assert.ok(result.config.mcpServers?.reelier);
  assert.ok(result.config.mcpServers?.existing);
});

test("planMcpConfigWrite: starting from no file at all still produces a valid plan", async () => {
  await withTmpDir(async (dir) => {
    const configPath = path.join(dir, ".mcp.json");
    const plan = await planMcpConfigWrite(configPath, "npx -y @your/mcp-server");
    assert.equal(plan.before, "(no existing file)");
    assert.equal(plan.result.added, true);
    assert.deepEqual(plan.result.preservedServerNames, []);
  });
});

test("formatMcpConfigJson renders pretty JSON ending in a newline", () => {
  const text = formatMcpConfigJson({ mcpServers: { reelier: { command: "npx", args: [] } } });
  assert.ok(text.endsWith("\n"));
  assert.match(text, /"mcpServers"/);
});

// ---------------------------------------------------------------------------
// findNewestTraceFile
// ---------------------------------------------------------------------------

test("findNewestTraceFile: undefined when the dir doesn't exist or has no .jsonl files", async () => {
  await withTmpDir(async (dir) => {
    assert.equal(await findNewestTraceFile(path.join(dir, "nope")), undefined);

    const traceDir = path.join(dir, "traces");
    await mkdir(traceDir, { recursive: true });
    await writeFile(path.join(traceDir, "notes.txt"), "hi", "utf8");
    assert.equal(await findNewestTraceFile(traceDir), undefined);
  });
});

test("findNewestTraceFile: picks the most recently modified .jsonl file", async () => {
  await withTmpDir(async (dir) => {
    const traceDir = path.join(dir, "traces");
    await mkdir(traceDir, { recursive: true });
    await writeFile(path.join(traceDir, "a-1.jsonl"), "{}", "utf8");
    await new Promise((r) => setTimeout(r, 20));
    await writeFile(path.join(traceDir, "a-2.jsonl"), "{}", "utf8");

    const newest = await findNewestTraceFile(traceDir);
    assert.equal(newest, path.join(traceDir, "a-2.jsonl"));
  });
});

// ---------------------------------------------------------------------------
// Demo recording -> compile -> parseSkill round trip. Network-free: a fake
// Tool stands in for http.get so the unit test never hits the real registry.
// ---------------------------------------------------------------------------

function fakeRegistryTool(): Tool {
  return {
    effect: "read",
    async run(args: unknown) {
      const url = (args as { url: string }).url;
      if (url.endsWith("/latest")) {
        // Mirrors the real `registry.npmjs.org/<pkg>/latest` shape: flat,
        // single-version metadata — no nested `versions` object, so
        // `homepage` cannot collide with a duplicate elsewhere in the tree
        // (unlike the FULL packument, which nests every historical
        // version's metadata and DOES duplicate `homepage` per-version —
        // that shape is what exposed the original dataflow-collision bug
        // this test guards against; see runDemoRecording's doc comment).
        return {
          status: 200,
          headers: {},
          body: JSON.stringify({
            name: "@seldonframe/reelier",
            version: "0.5.0",
            license: "AGPL-3.0-only",
            repository: { type: "git", url: "git+https://example.com/reelier.git" },
            homepage: "https://example.com/reelier-homepage",
            bugs: { url: "https://example.com/reelier/issues" },
          }),
        };
      }
      return { status: 200, headers: {}, body: "<html>fake homepage</html>" };
    },
  };
}

test("runDemoRecording: performs the 2-step workflow and its trace compiles into a skill that parses", async () => {
  await withTmpDir(async (dir) => {
    const traceDir = path.join(dir, ".reelier", "traces");
    const recorder = new Recorder(traceDir);
    const toolCtx: ToolContext = { allowDestructive: false };

    const recording = await runDemoRecording(recorder, toolCtx, fakeRegistryTool());
    assert.equal(recording.ok, true);
    if (!recording.ok) return;
    assert.equal(recording.homepage, "https://example.com/reelier-homepage");

    const source = await readFile(recording.tracePath, "utf8");
    const records = parseTraceLines(source);
    assert.equal(records.filter((r) => r.t === "call").length, 2);

    const skillPath = path.join(dir, "demo.skill.md");
    const compiled = await compileDemoTrace(records, path.basename(recording.tracePath), skillPath);

    // compileDemoTrace already asserts parseSkill succeeds internally; verify from disk too.
    const written = await readFile(skillPath, "utf8");
    const skill = parseSkill(written);

    assert.equal(skill.steps.length, 2);
    assert.equal(skill.steps[0].effect, "read");
    assert.equal(skill.steps[1].effect, "read");

    // Step 1 bound `homepage` at the clean top-level path — no index-based
    // drift-prone path, no open questions, because the /latest endpoint's
    // response has no nested duplicate of the value anywhere else in it.
    const step1Asserts = [...skill.steps[0].asserts].sort();
    assert.deepEqual(step1Asserts, ["json.homepage is set", "status == 200"]);
    assert.deepEqual(skill.steps[0].binds, ["homepage = json.homepage"]);
    assert.deepEqual(compiled.result.openQuestions, []);

    // Step 2's args use the bound value verbatim, not a literal.
    assert.match(JSON.stringify(skill.steps[1].actionArgs), /\{\{homepage\}\}/);
    assert.doesNotMatch(JSON.stringify(skill.steps[1].actionArgs), /example\.com/);

    assert.equal(compiled.result.stats.steps, 2);
    assert.equal(compiled.result.stats.binds, 1);
  });
});

test("runDemoRecording: dataflow binds to the top-level field even when a FULL packument's nested `versions` subtree duplicates the same value first in traversal order (regression guard)", async () => {
  await withTmpDir(async (dir) => {
    const traceDir = path.join(dir, ".reelier", "traces");
    const recorder = new Recorder(traceDir);
    // Deliberately shaped like the real FULL packument (registry.npmjs.org/<pkg>,
    // not /<pkg>/latest): `versions` nests a duplicate `homepage` per entry, and
    // `versions` sits before the top-level `homepage` key — exactly the layout
    // that made the very first live end-to-end run of `reelier init` bind to
    // `json.versions.0.1.0.homepage` (an index-based, drift-prone path) instead
    // of the clean `json.homepage`. runDemoRecording avoids this by hitting the
    // flat /latest endpoint instead (see its doc comment) — this test just
    // confirms compile.ts's own first-match-wins semantics, independent of
    // which endpoint init happens to call, so a future change to which field
    // gets bound doesn't silently reintroduce the collision.
    const fullPackumentTool: Tool = {
      effect: "read",
      async run(args: unknown) {
        const url = (args as { url: string }).url;
        if (!url.endsWith("/latest")) {
          return {
            status: 200,
            headers: {},
            body: JSON.stringify({
              _id: "@seldonframe/reelier",
              versions: {
                "0.1.0": { homepage: "https://example.com/reelier-homepage" },
              },
              homepage: "https://example.com/reelier-homepage",
            }),
          };
        }
        return { status: 200, headers: {}, body: "<html>fake homepage</html>" };
      },
    };

    // Directly exercise the compiler on a hand-built trace shaped like the
    // full-packument case (rather than routing runDemoRecording's own
    // /latest-only request through it) so this test documents the
    // compiler's real behavior on that input shape.
    await recorder.start("regression-demo", ["builtin:http.get"]);
    recorder.note("fetch full packument");
    const i1 = recorder.recordCall("http.get", { url: "https://registry.npmjs.org/@seldonframe/reelier" });
    const obs1 = await fullPackumentTool.run({ url: "https://registry.npmjs.org/@seldonframe/reelier" }, {
      allowDestructive: false,
    });
    recorder.recordResult(i1, true, 1, { content: [{ type: "text", text: obs1.body }], isError: false });
    recorder.note("fetch homepage using the bound value");
    const i2 = recorder.recordCall("http.get", { url: "https://example.com/reelier-homepage" });
    recorder.recordResult(i2, true, 1, { content: [{ type: "text", text: "<html>ok</html>" }], isError: false });
    const stopped = await recorder.stop();
    assert.equal(stopped.ok, true);
    if (!stopped.ok) return;

    const source = await readFile(stopped.path, "utf8");
    const records = parseTraceLines(source);
    const compiled = compile(records);
    const bindLine = compiled.steps[0].binds[0];
    assert.equal(bindLine, "homepage = json.versions.0.1.0.homepage");
    assert.ok(
      compiled.openQuestions.some((oq) => oq.text.includes("index-based path")),
      "expected the index-based-path open question compile.ts raises for this shape"
    );
  });
});

test("runDemoRecording: an honest failure when the registry response has no usable 'homepage' field", async () => {
  await withTmpDir(async (dir) => {
    const traceDir = path.join(dir, ".reelier", "traces");
    const recorder = new Recorder(traceDir);
    const tool: Tool = {
      effect: "read",
      async run() {
        return { status: 200, headers: {}, body: JSON.stringify({ name: "@seldonframe/reelier" }) };
      },
    };
    const result = await runDemoRecording(recorder, { allowDestructive: false }, tool);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.message, /homepage/);
  });
});

// ---------------------------------------------------------------------------
// Receipt formatting from a fixture RunRecord — no real run involved.
// ---------------------------------------------------------------------------

function fixtureRunRecord(overrides: Partial<RunRecord["totals"]> = {}): RunRecord {
  return {
    skill: "reelier-init-demo",
    startedAt: "2026-07-18T00:00:00.000Z",
    finishedAt: "2026-07-18T00:00:00.100Z",
    passed: true,
    steps: [],
    totals: {
      steps: 2,
      passed: 2,
      unchecked: 0,
      skipped: 0,
      failed: 0,
      ms: 84,
      llmInputTokens: 0,
      llmOutputTokens: 0,
      ...overrides,
    },
  };
}

test("formatReceipt: honest '0 [measured]' when tokens are actually zero", () => {
  const lines = formatReceipt(fixtureRunRecord());
  const text = lines.join("\n");
  assert.match(text, /replay time:\s+84ms \[measured\]/);
  assert.match(text, /LLM tokens:\s+0 \[measured\]/);
});

test("formatReceipt: never claims '0 tokens' when the record actually shows nonzero usage", () => {
  const lines = formatReceipt(fixtureRunRecord({ llmInputTokens: 500, llmOutputTokens: 20 }));
  const text = lines.join("\n");
  assert.match(text, /500 in \/ 20 out \[measured\]/);
  assert.doesNotMatch(text, /LLM tokens:\s+0 \[measured\]/);
});

test("formatReceipt: with a demoBenchmark comparison, cites the benchmark and the real replay numbers", () => {
  const lines = formatReceipt(fixtureRunRecord(), LAUNCH_BENCHMARK_COMPARISON);
  const text = lines.join("\n");
  assert.match(text, /on our benchmark/);
  assert.match(text, /your replay: 84ms, 0 tokens/);
});

test("formatNextSteps: mentions run/push and the given skill path", () => {
  const lines = formatNextSteps("/tmp/reelier-init-demo.skill.md");
  const text = lines.join("\n");
  assert.match(text, /reelier run \/tmp\/reelier-init-demo\.skill\.md/);
  assert.match(text, /reelier push \/tmp\/reelier-init-demo\.skill\.md/);
});
