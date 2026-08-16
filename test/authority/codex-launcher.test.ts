import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { createCodexDogfoodPlan } from "../../src/authority/host/codex-dogfood.js";
import { launchCodexDogfood, materializeCodexDogfood } from "../../src/authority/host/codex-launcher.js";

test("materializeCodexDogfood writes ten scoped profiles and a SubagentStart binding hook", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-codex-launcher-"));
  const workspace = path.join(root, "workspace");
  const codexHome = path.join(root, "codex-home");
  const evidence = path.join(root, "evidence");
  await mkdir(workspace);
  const plan = createCodexDogfoodPlan({ taskId: "task_cert", endpoint: "https://cell.example.test/mcp" });

  const result = await materializeCodexDogfood({ plan, workspace, codexHome, evidenceDirectory: evidence });

  assert.equal(result.profileName, "reelier-certification");
  assert.equal(result.agentFiles.length, 9);
  const rootProfile = await readFile(path.join(codexHome, "reelier-certification.config.toml"), "utf8");
  assert.match(rootProfile, /bearer_token_env_var = "REELIER_CODEX_COORDINATOR_TOKEN"/);
  assert.match(rootProfile, /ignore_default_excludes = false/);
  assert.doesNotMatch(rootProfile, /rat_[A-Za-z0-9_-]+/);
  const release = await readFile(path.join(workspace, ".codex", "agents", "release.toml"), "utf8");
  assert.match(release, /name = "release"/);
  assert.match(release, /bearer_token_env_var = "REELIER_CODEX_RELEASE_TOKEN"/);
  const hooks = JSON.parse(await readFile(path.join(workspace, ".codex", "hooks.json"), "utf8")) as { hooks: { PreToolUse: Array<{ matcher: string }>; SubagentStart: Array<{ hooks: Array<{ command: string }> }> } };
  assert.ok(hooks.hooks);
  assert.equal(hooks.hooks.PreToolUse[0].matcher, "^Agent$");
  assert.match(hooks.hooks.SubagentStart[0].hooks[0].command, new RegExp(process.execPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const mapping = JSON.parse(await readFile(result.identityMapPath, "utf8")) as { profiles: unknown[] };
  assert.equal(mapping.profiles.length, 9);

  const denied = await runHook(result.hookProgramPath, result.identityMapPath, path.join(evidence, "codex-hook-events"), { hook_event_name: "PreToolUse", tool_input: { agent_type: "default" } });
  assert.equal(denied.code, 0);
  assert.match(denied.stdout, /permissionDecision":"deny/);
  const reserved = await runHook(result.hookProgramPath, result.identityMapPath, path.join(evidence, "codex-hook-events"), { hook_event_name: "PreToolUse", tool_input: { agent_type: "release" } });
  assert.equal(reserved.code, 0);
  const bound = await runHook(result.hookProgramPath, result.identityMapPath, path.join(evidence, "codex-hook-events"), { hook_event_name: "SubagentStart", agent_id: "agent-1", agent_type: "release", turn_id: "turn-1", session_id: "parent-1" });
  assert.equal(bound.code, 0);
  assert.match(bound.stdout, /codex_release/);
});

function runHook(program: string, map: string, output: string, input: unknown): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [program, map, output], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += String(chunk); });
    child.stderr.on("data", chunk => { stderr += String(chunk); });
    child.once("error", reject);
    child.once("close", code => resolve({ code, stdout, stderr }));
    child.stdin.end(JSON.stringify(input));
  });
}

test("launchCodexDogfood pins the binary, injects scoped tokens without returning them, and records output", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-codex-run-"));
  const workspace = path.join(root, "workspace");
  const codexHome = path.join(root, "codex-home");
  const evidence = path.join(root, "evidence");
  const secrets = path.join(root, "secrets");
  await Promise.all([mkdir(workspace), mkdir(secrets)]);
  const plan = createCodexDogfoodPlan({ taskId: "task_cert", endpoint: "https://cell.example.test/mcp" });
  for (const profile of plan.profiles) await writeFile(path.join(secrets, `${profile.profile}.token`), `rat_${profile.profile}_secret`);
  const materialized = await materializeCodexDogfood({ plan, workspace, codexHome, evidenceDirectory: evidence });
  let invocation: { command: string; args: readonly string[]; env: NodeJS.ProcessEnv } | undefined;

  const result = await launchCodexDogfood({
    plan,
    binaryPath: "C:/tools/codex/codex.exe",
    expectedVersion: "0.134.0",
    codexHome,
    workspace,
    evidenceDirectory: evidence,
    sessionCredentialDirectory: secrets,
    materialized,
    operations: {
      async probeBinary() { return "available"; },
      async probeLogin() { return "available"; },
      async execute(command, args, options) {
        invocation = { command, args, env: options.env };
        await writeFile(options.stdoutPath, '{"type":"thread.started","thread_id":"thread_1"}\n');
        await writeFile(options.stderrPath, "");
        return 0;
      },
    },
  });

  assert.equal(result.exitCode, 0);
  assert.equal(invocation?.command, "C:/tools/codex/codex.exe");
  assert.deepEqual(invocation?.args.slice(0, 4), ["exec", "--profile", "reelier-certification", "--json"]);
  assert.equal(invocation?.env.REELIER_CODEX_RELEASE_TOKEN, "rat_release_secret");
  assert.equal("tokens" in result, false);
  assert.doesNotMatch(JSON.stringify(result), /rat_release_secret/);
  assert.match(await readFile(result.stdoutPath, "utf8"), /thread_1/);
});

test("launchCodexDogfood refuses missing login, missing tokens, and unpinned binaries", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-codex-refuse-"));
  const workspace = path.join(root, "workspace");
  const codexHome = path.join(root, "codex-home");
  const evidence = path.join(root, "evidence");
  const secrets = path.join(root, "secrets");
  await Promise.all([mkdir(workspace), mkdir(secrets)]);
  const plan = createCodexDogfoodPlan({ taskId: "task_cert", endpoint: "https://cell.example.test/mcp" });
  const materialized = await materializeCodexDogfood({ plan, workspace, codexHome, evidenceDirectory: evidence });
  const base = { plan, binaryPath: "codex", expectedVersion: "0.134.0", codexHome, workspace, evidenceDirectory: evidence, sessionCredentialDirectory: secrets, materialized };
  await assert.rejects(() => launchCodexDogfood({ ...base, operations: { probeBinary: async () => "missing", probeLogin: async () => "available", execute: async () => 0 } }), /pinned Codex binary/);
  await assert.rejects(() => launchCodexDogfood({ ...base, operations: { probeBinary: async () => "available", probeLogin: async () => "missing", execute: async () => 0 } }), /Codex authentication/);
  await assert.rejects(() => launchCodexDogfood({ ...base, operations: { probeBinary: async () => "available", probeLogin: async () => "available", execute: async () => 0 } }), /session credential/);
});
