import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { once } from "node:events";
import { finished } from "node:stream/promises";
import { assertCodexDogfoodPlan, type CodexDogfoodPlan, type CodexDogfoodProfileConfig } from "./codex-dogfood.js";
import { probePinnedCodexBinary } from "./certification-config.js";

const PROFILE_NAME = "reelier-certification";

export interface MaterializedCodexDogfood {
  readonly profileName: typeof PROFILE_NAME;
  readonly rootProfilePath: string;
  readonly agentFiles: readonly string[];
  readonly hooksPath: string;
  readonly hookProgramPath: string;
  readonly identityMapPath: string;
}

export interface CodexDogfoodExecutionOptions {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly stdoutPath: string;
  readonly stderrPath: string;
}

export interface CodexDogfoodLauncherOperations {
  readonly probeBinary: (binaryPath: string, expectedVersion: string) => Promise<"available" | "missing">;
  readonly probeLogin: (binaryPath: string, codexHome: string) => Promise<"available" | "missing">;
  readonly execute: (command: string, args: readonly string[], options: CodexDogfoodExecutionOptions) => Promise<number>;
}

export interface CodexDogfoodLaunchResult {
  readonly exitCode: number;
  readonly stdoutPath: string;
  readonly stderrPath: string;
  readonly identityMapPath: string;
  readonly hookEvidenceDirectory: string;
}

export async function materializeCodexDogfood(input: Readonly<{
  plan: CodexDogfoodPlan;
  workspace: string;
  codexHome: string;
  evidenceDirectory: string;
}>): Promise<MaterializedCodexDogfood> {
  assertCodexDogfoodPlan(input.plan);
  const workspace = path.resolve(input.workspace);
  const codexHome = path.resolve(input.codexHome);
  const evidenceDirectory = path.resolve(input.evidenceDirectory);
  const agentsDirectory = path.join(workspace, ".codex", "agents");
  const hooksDirectory = path.join(workspace, ".codex", "hooks");
  const hookEvidenceDirectory = path.join(evidenceDirectory, "codex-hook-events");
  await Promise.all([mkdir(agentsDirectory, { recursive: true }), mkdir(hooksDirectory, { recursive: true }), mkdir(hookEvidenceDirectory, { recursive: true }), mkdir(codexHome, { recursive: true })]);

  const coordinator = profile(input.plan, "coordinator");
  const rootProfilePath = path.join(codexHome, `${PROFILE_NAME}.config.toml`);
  await writePrivate(rootProfilePath, rootProfileToml(coordinator));

  const childProfiles = input.plan.profiles.filter(item => item.profile !== "coordinator");
  const agentFiles: string[] = [];
  for (const child of childProfiles) {
    const file = path.join(agentsDirectory, `${child.profile}.toml`);
    await writePrivate(file, childProfileToml(child));
    agentFiles.push(file);
  }

  const identityMapPath = path.join(evidenceDirectory, "codex-identity-map.json");
  await writePrivate(identityMapPath, `${JSON.stringify({
    v: "reelier.codex-identity-map/v1",
    taskId: input.plan.taskId,
    profiles: childProfiles.map(item => ({ profile: item.profile, principalId: item.principalId, runtimeSessionId: item.runtimeSessionId, tokenEnv: item.tokenEnv })),
  }, null, 2)}\n`);
  const hookProgramPath = path.join(hooksDirectory, "reelier-subagent-start.mjs");
  await writePrivate(hookProgramPath, hookProgram());
  const hooksPath = path.join(workspace, ".codex", "hooks.json");
  const command = quoteCommand([process.execPath, hookProgramPath, identityMapPath, hookEvidenceDirectory]);
  await writePrivate(hooksPath, `${JSON.stringify({
    description: "Allows only predeclared Reelier subagent profiles, then binds SubagentStart agent_id values to their principals.",
    hooks: {
      PreToolUse: [{ matcher: "^Agent$", hooks: [{ type: "command", command, commandWindows: command, timeout: 10, statusMessage: "Checking Reelier subagent authority" }] }],
      SubagentStart: [{ hooks: [{ type: "command", command, commandWindows: command, timeout: 10, statusMessage: "Binding Reelier authority identity" }] }],
    },
  }, null, 2)}\n`);

  return Object.freeze({ profileName: PROFILE_NAME, rootProfilePath, agentFiles: Object.freeze(agentFiles), hooksPath, hookProgramPath, identityMapPath });
}

export async function launchCodexDogfood(input: Readonly<{
  plan: CodexDogfoodPlan;
  binaryPath: string;
  expectedVersion: string;
  codexHome: string;
  workspace: string;
  evidenceDirectory: string;
  sessionCredentialDirectory: string;
  materialized: MaterializedCodexDogfood;
  prompt?: string;
  operations?: CodexDogfoodLauncherOperations;
}>): Promise<CodexDogfoodLaunchResult> {
  assertCodexDogfoodPlan(input.plan);
  const operations = input.operations ?? defaultOperations;
  if (await operations.probeBinary(input.binaryPath, input.expectedVersion) !== "available") throw new TypeError("pinned Codex binary is unavailable or has the wrong version");
  if (await operations.probeLogin(input.binaryPath, input.codexHome) !== "available") throw new TypeError("Codex authentication is unavailable in the dedicated Codex home");

  const env: NodeJS.ProcessEnv = { ...process.env, CODEX_HOME: path.resolve(input.codexHome) };
  for (const profileConfig of input.plan.profiles) {
    const tokenPath = path.join(path.resolve(input.sessionCredentialDirectory), `${profileConfig.profile}.token`);
    let token: string;
    try { token = (await readFile(tokenPath, "utf8")).trim(); } catch { throw new TypeError(`Codex session credential is missing for ${profileConfig.profile}`); }
    if (!/^rat_[A-Za-z0-9_-]{8,512}$/.test(token)) throw new TypeError(`Codex session credential is invalid for ${profileConfig.profile}`);
    env[profileConfig.tokenEnv] = token;
  }

  const evidenceDirectory = path.resolve(input.evidenceDirectory);
  await mkdir(evidenceDirectory, { recursive: true });
  const stdoutPath = path.join(evidenceDirectory, "codex-exec.jsonl");
  const stderrPath = path.join(evidenceDirectory, "codex-exec.stderr.log");
  const args = [
    "exec", "--profile", input.materialized.profileName, "--json",
    "--dangerously-bypass-hook-trust", "--sandbox", "workspace-write",
    "--cd", path.resolve(input.workspace), input.prompt ?? certificationPrompt(input.plan),
  ] as const;
  const exitCode = await operations.execute(input.binaryPath, args, { cwd: path.resolve(input.workspace), env, stdoutPath, stderrPath });
  return Object.freeze({ exitCode, stdoutPath, stderrPath, identityMapPath: input.materialized.identityMapPath, hookEvidenceDirectory: path.join(evidenceDirectory, "codex-hook-events") });
}

export async function probeCodexLogin(binaryPath: string, codexHome: string, timeoutMs = 10_000): Promise<"available" | "missing"> {
  return new Promise(resolve => {
    let settled = false;
    const child = spawn(binaryPath, ["login", "status"], { shell: false, windowsHide: true, env: { ...process.env, CODEX_HOME: path.resolve(codexHome) }, stdio: "ignore" });
    const finish = (value: "available" | "missing") => { if (settled) return; settled = true; clearTimeout(timer); resolve(value); };
    child.once("error", () => finish("missing"));
    child.once("close", code => finish(code === 0 ? "available" : "missing"));
    const timer = setTimeout(() => { child.kill(); finish("missing"); }, timeoutMs);
    timer.unref();
  });
}

const defaultOperations: CodexDogfoodLauncherOperations = Object.freeze({
  probeBinary: probePinnedCodexBinary,
  probeLogin: probeCodexLogin,
  execute: executeCodex,
});

async function executeCodex(command: string, args: readonly string[], options: CodexDogfoodExecutionOptions): Promise<number> {
  const stdout = createWriteStream(options.stdoutPath, { flags: "wx", mode: 0o600 });
  const stderr = createWriteStream(options.stderrPath, { flags: "wx", mode: 0o600 });
  try {
    await Promise.all([once(stdout, "open"), once(stderr, "open")]);
    const child = spawn(command, [...args], { shell: false, windowsHide: true, cwd: options.cwd, env: options.env, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.pipe(stdout); child.stderr.pipe(stderr);
    const [code] = await once(child, "close") as [number | null];
    return code ?? 1;
  } finally {
    stdout.end(); stderr.end();
    await Promise.all([finished(stdout), finished(stderr)]);
  }
}

function profile(plan: CodexDogfoodPlan, name: CodexDogfoodProfileConfig["profile"]): CodexDogfoodProfileConfig {
  const found = plan.profiles.find(item => item.profile === name);
  if (!found) throw new TypeError(`Codex dogfood profile is missing: ${name}`);
  return found;
}

function rootProfileToml(config: CodexDogfoodProfileConfig): string {
  return `approval_policy = "never"\nsandbox_mode = "workspace-write"\nweb_search = "disabled"\n\n[features]\nhooks = true\nmulti_agent = true\napps = false\nremote_plugin = false\n\n[agents]\nmax_concurrent_threads_per_session = 9\n\n[shell_environment_policy]\nignore_default_excludes = false\n\n[mcp_servers.reelier_authority]\nurl = ${toml(config.mcpEndpoint)}\nbearer_token_env_var = ${toml(config.tokenEnv)}\nrequired = true\nenabled = true\ndefault_tools_approval_mode = "approve"\nstartup_timeout_sec = 20\ntool_timeout_sec = 120\n`;
}

function childProfileToml(config: CodexDogfoodProfileConfig): string {
  const readOnly = config.profile === "security_reviewer" || config.profile === "independent_verifier";
  return `name = ${toml(config.profile)}\ndescription = ${toml(description(config.profile))}\nsandbox_mode = "${readOnly ? "read-only" : "workspace-write"}"\ndeveloper_instructions = ${toml(instructions(config))}\n\n[mcp_servers.reelier_authority]\nurl = ${toml(config.mcpEndpoint)}\nbearer_token_env_var = ${toml(config.tokenEnv)}\nrequired = true\nenabled = true\ndefault_tools_approval_mode = "approve"\nstartup_timeout_sec = 20\ntool_timeout_sec = 120\n`;
}

function description(profileName: CodexDogfoodProfileConfig["profile"]): string {
  return `Reelier certification ${profileName.replaceAll("_", " ")} with a distinct task-scoped authority identity.`;
}

function instructions(config: CodexDogfoodProfileConfig): string {
  return `You are the ${config.profile.replaceAll("_", " ")} for Reelier task ${config.runtimeSessionId.split("_session_")[0]}. Use only the Reelier authority MCP server for consequential production writes. Never supply tenant, principal, account, credential, destination, amount, or authority fields in an Outcome body. Your authenticated principal and runtime session come from the host. Stop and report an exception when an Outcome is ambiguous, unavailable, or conflicting; never retry a dispatched write.`;
}

function certificationPrompt(plan: CodexDogfoodPlan): string {
  const children = plan.profiles.filter(item => item.profile !== "coordinator").map(item => item.profile).join(", ");
  return `Run the Reelier ten-agent certification for task ${plan.taskId}. Spawn exactly these nine custom agents: ${children}. Request only narrower child authority through Reelier. Preparation-only agents must receive zero-effect grants. Execute the signed job plan, intentionally submit the specified duplicate and conflicting Outcome cases, preserve the partial secret-handoff exception, then request root revocation and export the task receipt graph. Never use direct provider credentials or direct provider write routes. Do not claim success unless status and offline verification confirm the resulting state.`;
}

function hookProgram(): string {
  return `import { createHash } from "node:crypto";\nimport { mkdirSync, readFileSync, writeFileSync } from "node:fs";\nimport path from "node:path";\nconst [mapPath, outDir] = process.argv.slice(2);\nconst input = JSON.parse(readFileSync(0, "utf8"));\nconst map = JSON.parse(readFileSync(mapPath, "utf8"));\nmkdirSync(outDir, { recursive: true });\nif (input.hook_event_name === "PreToolUse") {\n  const requested = input.tool_input?.agent_type;\n  const profile = map.profiles.find((item) => item.profile === requested);\n  if (!profile) { process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "Only predeclared Reelier certification agent profiles may be spawned." } })); process.exit(0); }\n  const reservation = path.join(outDir, "reserved-" + profile.profile + ".json");\n  try { writeFileSync(reservation, JSON.stringify({ v: "reelier.codex-subagent-reservation/v1", taskId: map.taskId, profile: profile.profile, principalId: profile.principalId, runtimeSessionId: profile.runtimeSessionId }) + "\\n", { flag: "wx", mode: 0o600 }); } catch (error) { if (error?.code !== "EEXIST") throw error; process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "This Reelier certification profile was already spawned." } })); }\n  process.exit(0);\n}\nif (input.hook_event_name !== "SubagentStart" || typeof input.agent_id !== "string" || typeof input.agent_type !== "string") { console.error("invalid Reelier Codex hook event"); process.exit(2); }\nconst profile = map.profiles.find((item) => item.profile === input.agent_type);\nif (!profile || !readFileSync(path.join(outDir, "reserved-" + profile.profile + ".json"), "utf8")) { console.error("unregistered or unreserved Reelier agent profile"); process.exit(2); }\nconst idHash = createHash("sha256").update(input.agent_id, "utf8").digest("hex");\nconst event = { v: "reelier.codex-subagent-binding/v1", taskId: map.taskId, agentId: input.agent_id, agentType: input.agent_type, principalId: profile.principalId, runtimeSessionId: profile.runtimeSessionId, turnId: input.turn_id, parentSessionId: input.session_id, identitySource: "hook" };\ntry { writeFileSync(path.join(outDir, idHash + ".json"), JSON.stringify(event) + "\\n", { flag: "wx", mode: 0o600 }); } catch (error) { if (error?.code !== "EEXIST") throw error; const prior = JSON.parse(readFileSync(path.join(outDir, idHash + ".json"), "utf8")); if (JSON.stringify(prior) !== JSON.stringify(event)) { console.error("conflicting Codex agent identity binding"); process.exit(2); } }\nprocess.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SubagentStart", additionalContext: "Reelier host-bound identity: principal " + profile.principalId + ", runtime session " + profile.runtimeSessionId + ", root task " + map.taskId + ". These values are not Outcome body fields." } }));\n`;
}

function toml(value: string): string { return JSON.stringify(value); }
function quoteCommand(parts: readonly string[]): string { return parts.map(item => `"${item.replaceAll('"', '\\"')}"`).join(" "); }
async function writePrivate(file: string, bytes: string): Promise<void> { await writeFile(file, bytes, { mode: 0o600 }); }
