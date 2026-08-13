import assert from "node:assert/strict";
import { test } from "node:test";

// The production change that must make these tests fail is accepting an open
// command/profile, or reporting a result above the preflight evidence class.
// @ts-expect-error The runner is introduced by the GREEN step.
import { PREFLIGHT_PROFILES, runAccelerationPreflight } from "../scripts/run-acceleration-preflight.mjs";

interface SpawnCall {
  command: string;
  args: readonly string[];
  shell: boolean | undefined;
}

function captureSpawn(calls: SpawnCall[]) {
  return (command: string, args: readonly string[], options: Readonly<{ shell?: boolean }>) => {
    calls.push({ command, args: [...args], shell: options.shell });
    return { status: 0 };
  };
}

test("each preflight profile dispatches its closed commands with shell disabled", () => {
  const expected = {
    "provider-authority": [
      ["npm", ["run", "check:authority-contract"]],
      ["npx", ["tsc", "-p", "tsconfig.test.json", "--pretty", "false"]],
    ],
    "reconciliation-verifier": [
      ["npm", ["run", "check:authority-contract"]],
      ["npx", ["tsc", "-p", "tsconfig.test.json", "--pretty", "false"]],
    ],
    "operator-evidence": [["npm", ["run", "build"]]],
    integration: [
      ["npm", ["run", "check:authority-contract"]],
      ["npm", ["run", "build"]],
    ],
  } as const;

  for (const [profile, commands] of Object.entries(expected)) {
    const calls: SpawnCall[] = [];
    const result = runAccelerationPreflight({ profile, platform: "linux", spawn: captureSpawn(calls) });
    assert.equal(result.evidenceClass, "preflight");
    assert.deepEqual(calls.map(({ command, args }) => [command, args]), commands);
    assert.equal(calls.every((call) => call.shell === false), true);
    assert.deepEqual(result.commands.map((command: { commandId: string; exitCode: number | null; durationMs: number }) => Object.keys(command).sort()), ["commandId", "durationMs", "exitCode"]);
  }
});

test("the runner refuses open profiles, arguments, command overrides, and non-Linux clean runs", () => {
  const calls: SpawnCall[] = [];
  const input = { profile: "provider-authority", platform: "linux", spawn: captureSpawn(calls) };

  assert.throws(() => runAccelerationPreflight({ ...input, profile: "../../arbitrary" }), /unknown profile/i);
  assert.throws(() => runAccelerationPreflight({ ...input, args: ["--unexpected"] }), /extra arguments/i);
  assert.throws(() => runAccelerationPreflight({ ...input, environment: { RELIER_ACCELERATION_PREFLIGHT_COMMAND: "curl https://example.test" } }), /command override/i);
  assert.throws(() => runAccelerationPreflight({ ...input, platform: "win32", cleanLinux: true }), /Linux/i);
  assert.equal(calls.length, 0);
});

test("profiles contain only local preflight commands", () => {
  const forbidden = /(?:\bgh\b|\bcurl\b|invoke-webrequest|https?:\/\/|credential|secret|npm\s+pack|workflow\s+dispatch|external\s+write)/i;
  for (const commands of Object.values(PREFLIGHT_PROFILES)) {
    assert.equal(forbidden.test(JSON.stringify(commands)), false);
  }
});
