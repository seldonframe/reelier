import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

// The production change that must make these tests fail is accepting an open
// command/profile, or reporting a result above the preflight evidence class.
const { PREFLIGHT_PROFILES, runAccelerationPreflight } = await import(
  pathToFileURL(path.join(process.cwd(), "scripts", "run-acceleration-preflight.mjs")).href,
);

interface SpawnCall {
  command: string;
  args: readonly string[];
  shell: boolean | undefined;
  stdio: unknown;
  env: unknown;
}

function captureSpawn(calls: SpawnCall[]) {
  return (command: string, args: readonly string[], options: Readonly<{ shell?: boolean; stdio?: unknown; env?: unknown }>) => {
    calls.push({ command, args: [...args], shell: options.shell, stdio: options.stdio, env: options.env });
    return { status: 0 };
  };
}

test("each preflight profile dispatches its closed local Node commands with a controlled environment", () => {
  const expected = {
    "provider-authority": [
      [process.execPath, [path.resolve("scripts/build-authority-contract.mjs"), "--check"]],
      [process.execPath, [path.resolve("node_modules/typescript/bin/tsc"), "-p", path.resolve("tsconfig.test.json"), "--pretty", "false"]],
    ],
    "reconciliation-verifier": [
      [process.execPath, [path.resolve("scripts/build-authority-contract.mjs"), "--check"]],
      [process.execPath, [path.resolve("node_modules/typescript/bin/tsc"), "-p", path.resolve("tsconfig.test.json"), "--pretty", "false"]],
    ],
    "operator-evidence": [
      [process.execPath, [path.resolve("scripts/build-authority-contract.mjs"), "--check"]],
      [process.execPath, [path.resolve("node_modules/typescript/bin/tsc"), "-p", path.resolve("tsconfig.json")]],
      [process.execPath, [path.resolve("scripts/build-authority-contract.mjs"), "--copy-schemas"]],
      [process.execPath, [path.resolve("scripts/build-packs.mjs")]],
    ],
    integration: [
      [process.execPath, [path.resolve("scripts/build-authority-contract.mjs"), "--check"]],
      [process.execPath, [path.resolve("node_modules/typescript/bin/tsc"), "-p", path.resolve("tsconfig.json")]],
      [process.execPath, [path.resolve("scripts/build-authority-contract.mjs"), "--copy-schemas"]],
      [process.execPath, [path.resolve("scripts/build-packs.mjs")]],
    ],
  } as const;

  for (const [profile, commands] of Object.entries(expected)) {
    const calls: SpawnCall[] = [];
    const result = runAccelerationPreflight({ profile, platform: "linux", spawn: captureSpawn(calls) });
    assert.equal(result.evidenceClass, "preflight");
    assert.deepEqual(calls.map(({ command, args }) => [command, args]), commands);
    assert.equal(calls.every((call) => call.shell === false), true);
    assert.equal(calls.every((call) => call.stdio === "pipe"), true);
    assert.equal(calls.every((call) => JSON.stringify(call.env) === JSON.stringify({ PATH: path.dirname(process.execPath) })), true);
    assert.equal(result.commands.every((command: { commandId: string; exitCode: number | null; durationMs: number }) => (
      Object.keys(command).sort().join(",") === "commandId,durationMs,exitCode"
    )), true);
  }
});

test("the runner refuses open profiles, environment control, and non-Linux clean runs before dispatch", () => {
  const calls: SpawnCall[] = [];
  const input = { profile: "provider-authority", platform: "linux", spawn: captureSpawn(calls) };

  for (const profile of ["../../arbitrary", "toString", "constructor", "__proto__"]) {
    assert.throws(() => runAccelerationPreflight({ ...input, profile }), /^Error: unknown profile$/i);
  }
  assert.throws(() => runAccelerationPreflight({ ...input, args: ["--unexpected"] }), /extra arguments/i);
  for (const environment of [
    { RELIER_ACCELERATION_PREFLIGHT_COMMAND: "curl https://example.test" },
    { npm_config_registry: "https://registry.example.test" },
    { NODE_OPTIONS: "--require attacker" },
    { PATH: "C:\\attacker" },
    { HTTPS_PROXY: "http://proxy.example.test" },
    { TOKEN: "value" },
  ]) assert.throws(() => runAccelerationPreflight({ ...input, environment }), /^Error: environment overrides are not supported$/i);
  assert.throws(() => runAccelerationPreflight({ ...input, platform: "win32", cleanLinux: true }), /Linux/i);
  assert.equal(calls.length, 0);
});

test("profiles contain only local preflight commands", () => {
  const forbidden = /(?:\bgh\b|\bcurl\b|\bnpx\b|invoke-webrequest|https?:\/\/|credential|secret|npm\s+pack|workflow\s+dispatch|external\s+write)/i;
  for (const commands of Object.values(PREFLIGHT_PROFILES)) {
    assert.equal(forbidden.test(JSON.stringify(commands)), false);
  }
});

test("Windows dispatch uses the same shell-free local Node executable", () => {
  const calls: SpawnCall[] = [];
  const result = runAccelerationPreflight({ profile: "provider-authority", platform: "win32", spawn: captureSpawn(calls) });
  assert.equal(result.evidenceClass, "preflight");
  assert.equal(calls.every((call) => call.command === process.execPath && call.shell === false), true);
  assert.deepEqual(calls.map((call) => call.args[0]), [
    path.resolve("scripts/build-authority-contract.mjs"),
    path.resolve("node_modules/typescript/bin/tsc"),
  ]);
});

test("the CLI emits exactly one preflight-only JSON line", () => {
  const result = spawnSync(process.execPath, ["scripts/run-acceleration-preflight.mjs", "--profile", "provider-authority"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.endsWith("\n"), true);
  const summary = JSON.parse(result.stdout) as { evidenceClass: string; commands: unknown[] };
  assert.equal(result.stdout, `${JSON.stringify(summary)}\n`);
  assert.deepEqual(Object.keys(summary).sort(), ["commands", "evidenceClass"]);
  assert.equal(summary.evidenceClass, "preflight");
  assert.equal(Array.isArray(summary.commands), true);
});

test("CLI refusals are stable and do not echo caller values", () => {
  const result = spawnSync(process.execPath, ["scripts/run-acceleration-preflight.mjs", "--profile", "../../not-a-command"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "unknown profile\n");
});
