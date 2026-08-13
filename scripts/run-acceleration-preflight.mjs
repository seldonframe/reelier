#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const PREFLIGHT_PROFILES = Object.freeze({
  "provider-authority": Object.freeze([
    Object.freeze({ command: "npm", args: Object.freeze(["run", "check:authority-contract"]) }),
    Object.freeze({ command: "npx", args: Object.freeze(["tsc", "-p", "tsconfig.test.json", "--pretty", "false"]) }),
  ]),
  "reconciliation-verifier": Object.freeze([
    Object.freeze({ command: "npm", args: Object.freeze(["run", "check:authority-contract"]) }),
    Object.freeze({ command: "npx", args: Object.freeze(["tsc", "-p", "tsconfig.test.json", "--pretty", "false"]) }),
  ]),
  "operator-evidence": Object.freeze([
    Object.freeze({ command: "npm", args: Object.freeze(["run", "build"]) }),
  ]),
  integration: Object.freeze([
    Object.freeze({ command: "npm", args: Object.freeze(["run", "check:authority-contract"]) }),
    Object.freeze({ command: "npm", args: Object.freeze(["run", "build"]) }),
  ]),
});

const COMMAND_OVERRIDE_KEYS = Object.freeze([
  "RELIER_ACCELERATION_PREFLIGHT_COMMAND",
  "RELIER_ACCELERATION_PREFLIGHT_ARGS",
]);

function assertNoCommandOverride(environment) {
  if (COMMAND_OVERRIDE_KEYS.some((key) => environment[key] !== undefined)) {
    throw new Error("command override environment variables are not supported");
  }
}

function closedWindowsCommand(command, args, platform) {
  if (platform !== "win32") return { command, args };
  const npmCli = join(dirname(process.execPath), "node_modules", "npm", "bin", `${command}-cli.js`);
  return { command: process.execPath, args: [npmCli, ...args] };
}

export function runAccelerationPreflight({
  profile,
  platform,
  spawn = spawnSync,
  args = [],
  cleanLinux = false,
  environment = {},
}) {
  const commands = PREFLIGHT_PROFILES[profile];
  if (!commands) throw new Error(`unknown profile: ${profile}`);
  if (args.length > 0) throw new Error("extra arguments are not supported");
  if (cleanLinux && platform !== "linux") throw new Error("--clean-linux requires Linux");
  assertNoCommandOverride(environment);

  const results = commands.map(({ command, args: commandArgs }, index) => {
    const startedAt = Date.now();
    const closedCommand = closedWindowsCommand(command, commandArgs, platform);
    const outcome = spawn(closedCommand.command, closedCommand.args, { shell: false, stdio: "inherit" });
    return Object.freeze({
      commandId: `${profile}:${index + 1}`,
      exitCode: outcome.status ?? null,
      durationMs: Date.now() - startedAt,
    });
  });

  return Object.freeze({ evidenceClass: "preflight", commands: Object.freeze(results) });
}

function parseCli(argv) {
  let profile;
  let cleanLinux = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--profile") {
      if (profile !== undefined || index + 1 === argv.length) throw new Error("--profile requires one value");
      profile = argv[index + 1];
      index += 1;
    } else if (argument === "--clean-linux") {
      cleanLinux = true;
    } else {
      throw new Error(`extra arguments are not supported: ${argument}`);
    }
  }
  if (profile === undefined) throw new Error("--profile requires one value");
  return { profile, cleanLinux };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { profile, cleanLinux } = parseCli(process.argv.slice(2));
    const result = runAccelerationPreflight({
      profile,
      platform: process.platform,
      cleanLinux,
      environment: process.env,
    });
    console.log(JSON.stringify(result));
    if (result.commands.some((command) => command.exitCode !== 0)) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
