#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TYPESCRIPT_ENTRYPOINT = resolve(REPOSITORY_ROOT, "node_modules/typescript/bin/tsc");
const CONTROLLED_CHILD_ENV = Object.freeze({ PATH: dirname(process.execPath) });

export const PREFLIGHT_PROFILES = Object.freeze({
  "provider-authority": Object.freeze([
    Object.freeze({ command: "node", args: Object.freeze(["scripts/build-authority-contract.mjs", "--check"]) }),
    Object.freeze({ command: "typescript", args: Object.freeze(["-p", "tsconfig.test.json", "--pretty", "false"]) }),
  ]),
  "reconciliation-verifier": Object.freeze([
    Object.freeze({ command: "node", args: Object.freeze(["scripts/build-authority-contract.mjs", "--check"]) }),
    Object.freeze({ command: "typescript", args: Object.freeze(["-p", "tsconfig.test.json", "--pretty", "false"]) }),
  ]),
  "operator-evidence": Object.freeze([
    Object.freeze({ command: "node", args: Object.freeze(["scripts/build-authority-contract.mjs", "--check"]) }),
    Object.freeze({ command: "typescript", args: Object.freeze(["-p", "tsconfig.json"]) }),
    Object.freeze({ command: "node", args: Object.freeze(["scripts/build-authority-contract.mjs", "--copy-schemas"]) }),
    Object.freeze({ command: "node", args: Object.freeze(["scripts/build-packs.mjs"]) }),
  ]),
  integration: Object.freeze([
    Object.freeze({ command: "node", args: Object.freeze(["scripts/build-authority-contract.mjs", "--check"]) }),
    Object.freeze({ command: "typescript", args: Object.freeze(["-p", "tsconfig.json"]) }),
    Object.freeze({ command: "node", args: Object.freeze(["scripts/build-authority-contract.mjs", "--copy-schemas"]) }),
    Object.freeze({ command: "node", args: Object.freeze(["scripts/build-packs.mjs"]) }),
  ]),
});

function assertNoEnvironmentOverrides(environment) {
  if (environment !== undefined && Object.keys(environment).length > 0) throw new Error("environment overrides are not supported");
}

function resolveClosedCommand(command, args) {
  if (command === "node") return { command: process.execPath, args: args.map((argument) => argument.startsWith("scripts/") ? resolve(REPOSITORY_ROOT, argument) : argument) };
  if (command === "typescript") {
    if (!existsSync(TYPESCRIPT_ENTRYPOINT)) throw new Error("local TypeScript unavailable");
    return {
      command: process.execPath,
      args: [TYPESCRIPT_ENTRYPOINT, ...args.map((argument) => argument.startsWith("tsconfig") ? resolve(REPOSITORY_ROOT, argument) : argument)],
    };
  }
  throw new Error("invalid preflight command");
}

export function runAccelerationPreflight({
  profile,
  platform,
  spawn = spawnSync,
  args = [],
  cleanLinux = false,
  environment,
}) {
  if (!Object.hasOwn(PREFLIGHT_PROFILES, profile)) throw new Error("unknown profile");
  if (args.length > 0) throw new Error("extra arguments are not supported");
  if (cleanLinux && platform !== "linux") throw new Error("--clean-linux requires Linux");
  assertNoEnvironmentOverrides(environment);

  const results = PREFLIGHT_PROFILES[profile].map(({ command, args: commandArgs }, index) => {
    const startedAt = Date.now();
    const closedCommand = resolveClosedCommand(command, commandArgs);
    let outcome;
    try {
      outcome = spawn(closedCommand.command, closedCommand.args, { shell: false, stdio: "pipe", env: CONTROLLED_CHILD_ENV });
    } catch {
      outcome = { status: null };
    }
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
      if (profile !== undefined || index + 1 === argv.length) throw new Error("invalid arguments");
      profile = argv[index + 1];
      index += 1;
    } else if (argument === "--clean-linux") {
      cleanLinux = true;
    } else {
      throw new Error("invalid arguments");
    }
  }
  if (profile === undefined) throw new Error("invalid arguments");
  return { profile, cleanLinux };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { profile, cleanLinux } = parseCli(process.argv.slice(2));
    const result = runAccelerationPreflight({ profile, platform: process.platform, cleanLinux });
    console.log(JSON.stringify(result));
    if (result.commands.some((command) => command.exitCode !== 0)) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "preflight failed");
    process.exitCode = 1;
  }
}
